#!/usr/bin/env python3
"""One-time, explicitly approved coturn authentication migration with rollback."""
import datetime
import os
import pathlib
import re
import shutil
import subprocess
import sys

if os.geteuid() != 0:
    raise SystemExit("Run as root on the TURN VM.")
secret_file = pathlib.Path(sys.argv[1])
secret = secret_file.read_text().strip()
if not re.fullmatch(r"[0-9a-f]{64}", secret):
    raise SystemExit("Invalid secret format; no configuration changed.")
config = pathlib.Path("/etc/turnserver.conf")
original = config.read_text()
backup = config.with_name("turnserver.conf.before-tandem-" + datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ"))
shutil.copy2(config, backup)
os.chmod(backup, 0o600)
lines = [line for line in original.splitlines() if not re.match(
    r"^\s*(user|lt-cred-mech|use-auth-secret|static-auth-secret|no-auth)\s*(=|$)", line)]
updated = "\n".join(lines) + "\nuse-auth-secret\nstatic-auth-secret=" + secret + "\n"
try:
    config.write_text(updated)
    subprocess.run(["systemctl", "restart", "coturn"], check=True, capture_output=True)
    subprocess.run(["systemctl", "is-active", "--quiet", "coturn"], check=True)
except Exception:
    config.write_text(original)
    subprocess.run(["systemctl", "restart", "coturn"], check=False, capture_output=True)
    raise SystemExit("TURN migration failed; original configuration restored.")
finally:
    secret_file.unlink(missing_ok=True)
print("TURN shared-secret authentication enabled; original configuration backed up.")
