import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('release', Path(__file__).resolve().parents[1] / 'deploy/staging/release.py')
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)
IMAGE = 'tandem-staging-app:release-test'


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name) / 'app/deploy/staging'
        self.directory.mkdir(parents=True)
        self.settings = self.directory / '.env'
        self.original = b'APP_HOST=test.example.com\nENABLE_SPEECH=false\n'
        self.settings.write_bytes(self.original)
        self.commands = []
        self.restarts = 0
        self.failure = None
        self.rollback_failure = False

    def execute(self, command, env=None):
        self.commands.append((command, env))
        if command[:3] == ['docker', 'image', 'ls']:
            return ''
        if 'ps' in command:
            return 'container'
        if command[:3] == ['docker', 'inspect', '--format']:
            if '{{.Image}}' in command:
                return 'sha256:previous-running-image'
            return next(
                line.split('=', 1)[1] for line in self.settings.read_text().splitlines() if line.startswith('APP_IMAGE='))
        if 'audit' in command and self.failure == 'audit':
            raise RuntimeError('Dependency audit rejected candidate')
        if 'run' in command and 'app' in command and self.failure == 'configuration':
            raise RuntimeError('Candidate cannot start')
        if command[:2] == ['systemctl', 'restart']:
            self.restarts += 1
            if (self.restarts == 1 and self.failure == 'restart') or (self.restarts == 2 and self.rollback_failure):
                raise RuntimeError('Restart failed')
        if command[:2] == ['docker', 'exec']:
            if '/metrics' in command[-1] and self.failure == 'busy':
                raise RuntimeError('Active caller')
            if '/ready' in command[-1] and self.failure == 'readiness' and self.restarts == 1:
                raise RuntimeError('Candidate readiness failed')
        return ''

    def test_success_audits_and_validates_before_switch_and_preserves_settings(self):
        release.release(self.directory, IMAGE, self.execute)
        self.assertEqual(self.restarts, 1)
        self.assertEqual(self.settings.read_bytes(), self.original + f'APP_IMAGE={IMAGE}\n'.encode())
        self.assertEqual(self.settings.stat().st_mode & 0o777, 0o600)
        commands = [command for command, _ in self.commands]
        audit = next(i for i, command in enumerate(commands) if 'audit' in command)
        restart = next(i for i, command in enumerate(commands) if command[:2] == ['systemctl', 'restart'])
        self.assertLess(audit, restart)
        validation = next(env for command, env in self.commands if 'run' in command and 'app' in command)
        self.assertEqual(validation['APP_IMAGE'], IMAGE)

    def test_candidate_failures_leave_running_release_and_settings_untouched(self):
        for failure in ['audit', 'configuration']:
            with self.subTest(failure=failure):
                self.failure = failure
                with self.assertRaises(RuntimeError):
                    release.release(self.directory, IMAGE, self.execute)
                self.assertEqual(self.settings.read_bytes(), self.original)
                self.assertEqual(self.restarts, 0)

    def test_failed_restart_or_readiness_restores_exact_previous_image(self):
        for failure in ['restart', 'readiness']:
            with self.subTest(failure=failure):
                self.settings.write_bytes(self.original)
                self.restarts = 0
                self.failure = failure
                with self.assertRaisesRegex(RuntimeError, 'previous image restored'):
                    release.release(self.directory, IMAGE, self.execute)
                self.assertEqual(self.restarts, 2)
                self.assertIn('APP_IMAGE=tandem-staging-app:rollback-', self.settings.read_text())
                tag = next(command for command, _ in self.commands if command[:3] == ['docker', 'image', 'tag'])
                self.assertEqual(tag[3], 'sha256:previous-running-image')

    def test_rollback_failure_is_reported_and_keeps_recovery_image(self):
        self.failure = 'restart'
        self.rollback_failure = True
        with self.assertRaisesRegex(RuntimeError, 'rollback failed.*Previous image retained'):
            release.release(self.directory, IMAGE, self.execute)
        self.assertIn('APP_IMAGE=tandem-staging-app:rollback-', self.settings.read_text())

    def test_invalid_or_reused_release_tag_cannot_change_settings(self):
        with self.assertRaises(ValueError):
            release.release(self.directory, 'tandem-staging-app:latest', self.execute)
        with self.assertRaises(ValueError):
            release.release(self.directory, IMAGE, lambda *args: 'existing-image')
        self.assertEqual(self.settings.read_bytes(), self.original)

    def test_active_connections_postpone_release_without_changing_settings(self):
        self.failure = 'busy'
        with self.assertRaisesRegex(RuntimeError, 'release postponed'):
            release.release(self.directory, IMAGE, self.execute)
        self.assertEqual(self.restarts, 0)
        self.assertEqual(self.settings.read_bytes(), self.original)


if __name__ == '__main__':
    unittest.main()
