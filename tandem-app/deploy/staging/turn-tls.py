#!/usr/bin/env python3
"""Install or renew coturn TLS using an already-issued public certificate.

Run on idle TURN for initial activation. Renewal swaps a protected certificate
directory and uses coturn's SIGUSR2 reload, preserving existing allocations.
Certificate issuance and cloud firewall changes are separate operations.
"""
import argparse
import fcntl
import grp
import hashlib
import os
from pathlib import Path
import re
import shlex
import socket
import ssl
import subprocess
import tempfile
import time
import uuid


def run(command):
    result = subprocess.run(command, capture_output=True, timeout=30)
    if result.returncode:
        raise RuntimeError("TURN TLS command failed; upstream output withheld")
    return result.stdout


def atomic_write(path, content, mode=0o640, group=None):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=".tandem-", dir=path.parent)
    try:
        os.fchmod(fd, mode)
        if group is not None:
            os.fchown(fd, 0, group)
        with os.fdopen(fd, "wb") as file:
            file.write(content if isinstance(content, bytes) else content.encode())
            file.flush()
            os.fsync(file.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def tls_config(original, root):
    active = [line.strip() for line in original.splitlines() if not line.lstrip().startswith("#")]
    if "use-auth-secret" not in active or not any(re.match(r"static-auth-secret\s*=\s*\S+", line) for line in active):
        raise RuntimeError("Shared-secret authentication must be configured before TLS")
    if any(re.match(r"(no-auth|user|lt-cred-mech)\s*(=|$)", line) for line in active):
        raise RuntimeError("Conflicting TURN authentication; configuration unchanged")
    managed = r"^\s*(tls-listening-port|cert|pkey|no-tls|no-dtls|no-sslv3|no-tlsv1|no-tlsv1_1)\s*(=|$)"
    retained = [line for line in original.splitlines() if not re.match(managed, line)]
    return "\n".join(retained) + f"\ntls-listening-port=443\ncert={root}/current/fullchain.pem\npkey={root}/current/privkey.pem\nno-dtls\nno-sslv3\nno-tlsv1\nno-tlsv1_1\n"


def validate_certificate(lineage, hostname, execute=run):
    cert = lineage / "fullchain.pem"
    key = lineage / "privkey.pem"
    execute(["openssl", "x509", "-in", str(cert), "-noout", "-checkend", "604800"])
    execute(["openssl", "verify", "-verify_hostname", hostname, "-CApath", "/etc/ssl/certs", "-untrusted", str(cert), str(cert)])
    public = execute(["openssl", "x509", "-in", str(cert), "-pubkey", "-noout"])
    private_public = execute(["openssl", "pkey", "-in", str(key), "-pubout"])
    if public != private_public:
        raise RuntimeError("Certificate and private key do not match")
    der = execute(["openssl", "x509", "-in", str(cert), "-outform", "DER"])
    return hashlib.sha256(der).digest()


def served_fingerprint(hostname, port=443):
    context = ssl.create_default_context()
    with socket.create_connection(("127.0.0.1", port), timeout=2) as connection:
        with context.wrap_socket(connection, server_hostname=hostname) as secured:
            return hashlib.sha256(secured.getpeercert(binary_form=True)).digest()


def verify_certificate(hostname, expected, read=served_fingerprint):
    deadline = time.monotonic() + 15
    while True:
        try:
            if read(hostname) == expected:
                return
        except (OSError, ssl.SSLError):
            pass
        if time.monotonic() >= deadline:
            raise RuntimeError("TURN did not serve the expected trusted certificate")
        time.sleep(0.25)


def select_revision(root, revision):
    temporary = root / (".current-" + uuid.uuid4().hex)
    temporary.symlink_to(revision.name)
    os.replace(temporary, root / "current")


def activate(hostname, lineage, *, root=Path("/etc/tandem-turn-tls"),
             config=Path("/etc/turnserver.conf"),
             dropin=Path("/etc/systemd/system/coturn.service.d/tandem-tls.conf"),
             renew=False, group=None, execute=run, validate=validate_certificate, verify=verify_certificate):
    expected = validate(lineage, hostname, execute)
    original = config.read_bytes()
    # Validate authentication before changing even the certificate selection.
    updated = tls_config(original.decode(), root)
    if renew and (f"cert={root}/current/fullchain.pem" not in original.decode() or
                  not (root / "current").is_symlink()):
        raise RuntimeError("TLS is not installed; renewal refused")
    previous = (root / "current").resolve() if (root / "current").is_symlink() else None
    prior_dropin = dropin.read_bytes() if dropin.exists() else None
    root.mkdir(parents=True, exist_ok=True, mode=0o750)
    os.chmod(root, 0o750)
    if group is not None:
        os.chown(root, 0, group)
    revision = root / ("certificate-" + uuid.uuid4().hex)
    revision.mkdir(mode=0o750)
    if group is not None:
        os.chown(revision, 0, group)
    for name in ("fullchain.pem", "privkey.pem"):
        atomic_write(revision / name, (lineage / name).read_bytes(), group=group)
    if not renew:
        atomic_write(root / ("turnserver.before-tls-" + uuid.uuid4().hex + ".conf"), original, 0o600)
    select_revision(root, revision)
    try:
        if renew:
            execute(["systemctl", "kill", "--kill-who=main", "--signal=USR2", "coturn"])
        else:
            atomic_write(config, updated, group=group)
            atomic_write(dropin, "[Service]\nAmbientCapabilities=CAP_NET_BIND_SERVICE\nExecReload=\nExecReload=/bin/kill -USR2 $MAINPID\n", 0o644)
            execute(["systemctl", "daemon-reload"])
            execute(["systemctl", "restart", "coturn"])
        execute(["systemctl", "is-active", "--quiet", "coturn"])
        verify(hostname, expected)
    except Exception as failure:
        try:
            if previous:
                select_revision(root, previous)
            else:
                (root / "current").unlink(missing_ok=True)
            if renew:
                execute(["systemctl", "kill", "--kill-who=main", "--signal=USR2", "coturn"])
                prior_der = execute(["openssl", "x509", "-in", str(previous / "fullchain.pem"), "-outform", "DER"])
                verify(hostname, hashlib.sha256(prior_der).digest())
            else:
                atomic_write(config, original, group=group)
                if prior_dropin is None:
                    dropin.unlink(missing_ok=True)
                else:
                    atomic_write(dropin, prior_dropin, 0o644)
                execute(["systemctl", "daemon-reload"])
                execute(["systemctl", "restart", "coturn"])
            execute(["systemctl", "is-active", "--quiet", "coturn"])
        except Exception:
            raise RuntimeError("TURN TLS activation and recovery failed; use the protected configuration/certificate backups") from failure
        raise RuntimeError("TURN TLS activation failed; previous configuration/certificate restored") from failure


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--hostname", required=True)
    parser.add_argument("--lineage", type=Path, required=True)
    parser.add_argument("--renew", action="store_true")
    args = parser.parse_args()
    if os.geteuid() != 0:
        parser.error("Run as root on the TURN VM")
    if not re.fullmatch(r"(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}", args.hostname):
        parser.error("Use a public DNS hostname")
    lineage = args.lineage.absolute()
    if lineage.parent != Path("/etc/letsencrypt/live"):
        parser.error("Use a Certbot lineage directly beneath /etc/letsencrypt/live")
    root = Path("/etc/tandem-turn-tls")
    root.mkdir(mode=0o750, exist_ok=True)
    if root.is_symlink() or root.stat().st_uid != 0 or root.stat().st_mode & 0o022:
        parser.error("TLS state directory must be root-owned and not writable by group/others")
    group = grp.getgrnam("turnserver").gr_gid
    lock = root / ".lock"
    with lock.open("a") as file:
        os.chmod(lock, 0o600)
        fcntl.flock(file, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if not args.renew:
            installed = Path("/usr/local/lib/tandem-turn-tls.py")
            atomic_write(installed, Path(__file__).read_bytes(), 0o755)
            hook = ("#!/bin/sh\nset -eu\n" +
                    f"[ \"${{RENEWED_LINEAGE:-}}\" = {shlex.quote(str(lineage))} ] || exit 0\n" +
                    f"exec /usr/bin/python3 {installed} --renew --hostname {shlex.quote(args.hostname)} --lineage {shlex.quote(str(lineage))}\n")
            atomic_write(Path("/etc/letsencrypt/renewal-hooks/deploy/tandem-turn-tls"), hook, 0o700)
        activate(args.hostname, lineage, renew=args.renew, group=group)
    print("TURN TLS certificate activated and verified" if args.renew else "TURN TLS 443 installed and verified; certificate renewal hook installed")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        raise SystemExit(str(error)) from None
