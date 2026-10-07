import hashlib
import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("turn_tls", Path(__file__).parents[1] / "deploy/staging/turn-tls.py")
tls = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tls)


class TurnTlsTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.base = Path(self.directory.name)
        self.root = self.base / "tls"
        self.config = self.base / "turnserver.conf"
        self.dropin = self.base / "systemd/tls.conf"
        self.lineage = self.base / "lineage"
        self.lineage.mkdir()
        (self.lineage / "fullchain.pem").write_bytes(b"public certificate fixture")
        (self.lineage / "privkey.pem").write_bytes(b"private key fixture")
        self.original = "# existing relay\nuse-auth-secret\nstatic-auth-secret=fixture-secret\nlistening-port=3478\nmin-port=49160\nmax-port=49200\nno-tls\n"
        self.config.write_text(self.original)
        self.commands = []
        self.verified = []

    def tearDown(self):
        self.directory.cleanup()

    def execute(self, command):
        self.commands.append(command)
        if command[0] == "openssl":
            return b"old certificate DER"
        return b""

    def activate(self, **kwargs):
        return tls.activate("relay.example.com", self.lineage, root=self.root, config=self.config,
                            dropin=self.dropin, execute=kwargs.pop("execute", self.execute),
                            validate=kwargs.pop("validate", lambda *args: b"new fingerprint"),
                            verify=kwargs.pop("verify", lambda *args: self.verified.append(args)), **kwargs)

    def test_install_preserves_auth_and_udp_configuration_and_protects_keys(self):
        self.activate()
        content = self.config.read_text()
        self.assertIn("static-auth-secret=fixture-secret", content)
        self.assertIn("listening-port=3478", content)
        self.assertIn("min-port=49160\nmax-port=49200", content)
        self.assertIn("tls-listening-port=443", content)
        self.assertIn("denied-peer-ip=169.254.0.0-169.254.255.255", content)
        self.assertIn("denied-peer-ip=10.0.0.0-10.255.255.255", content)
        self.assertIn("no-tcp-relay\nno-multicast-peers\nno-cli", content)
        self.assertIn("user-quota=8\ntotal-quota=40", content)
        self.assertEqual(tls.tls_config(content, self.root), content)
        self.assertNotIn("\nno-tls\n", content)
        self.assertIn("AmbientCapabilities=CAP_NET_BIND_SERVICE", self.dropin.read_text())
        self.assertIn("ExecReload=/bin/kill -USR2 $MAINPID", self.dropin.read_text())
        self.assertEqual((self.root / "current/privkey.pem").stat().st_mode & 0o777, 0o640)
        backup = next(self.root.glob("turnserver.before-tls-*.conf"))
        self.assertEqual(backup.read_text(), self.original)
        self.assertEqual(backup.stat().st_mode & 0o777, 0o600)
        self.assertEqual(self.verified, [("relay.example.com", b"new fingerprint")])

    def test_validation_failure_changes_no_configuration_or_certificate_selection(self):
        def reject(*args):
            raise RuntimeError("invalid certificate")
        with self.assertRaisesRegex(RuntimeError, "invalid certificate"):
            self.activate(validate=reject)
        self.assertEqual(self.config.read_text(), self.original)
        self.assertFalse(self.root.exists())
        self.assertEqual(self.commands, [])

    def test_insecure_authentication_is_rejected_before_files_change(self):
        for settings in ["no-auth\n", self.original + "user=static:credential\n",
                         self.original + "allowed-peer-ip=169.254.169.254\n", self.original + "server-relay\n"]:
            self.config.write_text(settings)
            with self.assertRaises(RuntimeError):
                self.activate()
            self.assertEqual(self.config.read_text(), settings)
            self.assertFalse(self.root.exists())

    def test_initial_failure_restores_configuration_dropin_and_restarts_original(self):
        self.dropin.parent.mkdir(parents=True)
        self.dropin.write_text("prior dropin")
        def fail_verify(*args):
            raise RuntimeError("new TLS listener failed")
        with self.assertRaisesRegex(RuntimeError, "previous configuration/certificate restored"):
            self.activate(verify=fail_verify)
        self.assertEqual(self.config.read_text(), self.original)
        self.assertEqual(self.dropin.read_text(), "prior dropin")
        self.assertFalse((self.root / "current").exists())
        self.assertEqual(self.commands.count(["systemctl", "restart", "coturn"]), 2)

    def test_renewal_signals_without_restart_or_changing_configuration(self):
        self.activate()
        content = self.config.read_bytes()
        previous = (self.root / "current").resolve()
        self.commands.clear()
        self.activate(renew=True)
        self.assertEqual(self.config.read_bytes(), content)
        self.assertNotEqual((self.root / "current").resolve(), previous)
        self.assertEqual(self.commands, [["systemctl", "kill", "--kill-who=main", "--signal=USR2", "coturn"],
                                        ["systemctl", "is-active", "--quiet", "coturn"]])

    def test_failed_renewal_restores_and_verifies_previous_certificate(self):
        self.activate()
        previous = (self.root / "current").resolve()
        self.commands.clear()
        def verify(hostname, fingerprint):
            if fingerprint == b"new fingerprint":
                raise RuntimeError("reload failed")
            self.assertEqual(fingerprint, hashlib.sha256(b"old certificate DER").digest())
        with self.assertRaisesRegex(RuntimeError, "previous configuration/certificate restored"):
            self.activate(renew=True, verify=verify)
        self.assertEqual((self.root / "current").resolve(), previous)
        self.assertEqual(sum(command[1] == "kill" for command in self.commands if command[0] == "systemctl"), 2)
        self.assertNotIn(["systemctl", "restart", "coturn"], self.commands)

    def test_failed_recovery_is_explicit_and_keeps_configuration_backup(self):
        def execute(command):
            if command[:2] == ["systemctl", "restart"]:
                raise RuntimeError("restart failed")
            return b""
        with self.assertRaisesRegex(RuntimeError, "activation and recovery failed"):
            self.activate(execute=execute)
        self.assertEqual(self.config.read_text(), self.original)
        self.assertEqual(len(list(self.root.glob("turnserver.before-tls-*.conf"))), 1)

    def test_validation_checks_hostname_trust_expiry_and_matching_key(self):
        commands = []
        def execute(command):
            commands.append(command)
            if "-pubkey" in command or "-pubout" in command:
                return b"matching public key"
            return b"certificate DER"
        self.assertEqual(tls.validate_certificate(self.lineage, "relay.example.com", execute),
                         hashlib.sha256(b"certificate DER").digest())
        self.assertTrue(any("-verify_hostname" in command and "relay.example.com" in command for command in commands))
        self.assertTrue(any("-checkend" in command and "604800" in command for command in commands))
        def mismatch(command):
            return b"different public key" if "-pubout" in command else execute(command)
        with self.assertRaisesRegex(RuntimeError, "do not match"):
            tls.validate_certificate(self.lineage, "relay.example.com", mismatch)


if __name__ == "__main__":
    unittest.main()
