"""Bounded Docker runtime contract; synthetic fixtures never measure accuracy."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import uuid


def docker(*args, check=True):
    return subprocess.run(['docker', *args], check=check, capture_output=True,
                          text=True, timeout=45)


def main(image):
    prefix = 'tandem-asl-check-' + uuid.uuid4().hex[:12]
    network = prefix + '-net'
    containers = []
    network_created = False
    phase = 'fixture'
    try:
        with tempfile.TemporaryDirectory(prefix='tandem-asl-check-') as directory:
            root = Path(directory)
            root.chmod(0o755)
            for name in ['valid', 'mismatch', 'missing']:
                (root / name).mkdir(mode=0o755)
            fixture = """import pickle, pathlib, numpy as np, sklearn.base
from sklearn.tree import DecisionTreeClassifier
model = DecisionTreeClassifier(random_state=0).fit(np.array([[0]*73,[1]*73]), ['A','B'])
bundle = {'model': model, 'classes': ['A','B']}
pathlib.Path('/out/valid/model_v2.p').write_bytes(pickle.dumps(bundle))
sklearn.base.__version__ = '0.0.0'
pathlib.Path('/out/mismatch/model_v2.p').write_bytes(pickle.dumps(bundle))
"""
            docker('run', '--rm', '--network', 'none', '--user', '0:0',
                   '-v', directory + ':/out', image, 'python', '-c', fixture)
            phase = 'compose'
            env = {**os.environ, 'ASL_MODEL_DIRECTORY': str(root / 'valid')}
            subprocess.run(['docker', 'compose', '-f', str(Path(__file__).with_name('compose.yaml')),
                            'config', '--quiet'], check=True, capture_output=True, timeout=15, env=env)
            phase = 'isolation'
            docker('network', 'create', '--internal', network)
            network_created = True
            restrictions = ['--read-only', '--cap-drop', 'ALL', '--security-opt',
                            'no-new-privileges', '--cpus', '1', '--memory', '384m',
                            '--pids-limit', '64', '--tmpfs', '/tmp:size=32m,mode=1777',
                            '--network', network]
            for kind in ['missing', 'mismatch', 'valid']:
                phase = kind
                name = prefix + '-' + kind
                containers.append(name)
                docker('run', '-d', '--name', name, *restrictions,
                       '-v', str(root / kind) + ':/models:ro', image)
                if kind != 'valid':
                    deadline = time.monotonic() + 20
                    while time.monotonic() < deadline:
                        state = json.loads(docker('inspect', name).stdout)[0]['State']
                        if not state['Running']:
                            break
                        time.sleep(0.2)
                    assert not state['Running'] and state['ExitCode'] != 0
                    logs = docker('logs', name).stdout + docker('logs', name).stderr
                    assert 'Fingerspelling model startup failed.' in logs
                    assert 'Traceback' not in logs and '0.0.0' not in logs
                    continue
                info = json.loads(docker('inspect', name).stdout)[0]
                assert info['Config']['User'] == '10001:10001'
                assert info['HostConfig']['ReadonlyRootfs']
                assert not info['HostConfig']['PortBindings']
                phase = 'readiness'
                deadline = time.monotonic() + 25
                while True:
                    try:
                        docker('exec', name, 'python', '-c',
                               "import urllib.request; assert urllib.request.urlopen('http://127.0.0.1:5003/health',timeout=2).read(16)==b'OK'")
                        break
                    except subprocess.CalledProcessError:
                        if time.monotonic() >= deadline:
                            raise RuntimeError('Readiness deadline') from None
                        time.sleep(0.2)
                phase = 'http-contract'
                client = '''import json, urllib.request, urllib.error
base = 'http://HOST:5003'
for body, expected in [(json.dumps({'landmarks': [0]*63}).encode(), 200),
                                       (b'{"landmarks":[]}', 400), (b'x'*17000, 413)]:
                    request = urllib.request.Request(base + '/predict', data=body,
                                                     headers={'Content-Type': 'application/json'})
                    try:
                        response = urllib.request.urlopen(request, timeout=3)
                    except urllib.error.HTTPError as error:
                        response = error
                    with response:
                        assert response.status == expected
                        assert response.headers['Cache-Control'] == 'no-store'
                        assert response.headers['X-Content-Type-Options'] == 'nosniff'
                        assert response.headers.get('Access-Control-Allow-Origin') is None
                        result = json.loads(response.read(1024))
                        if expected == 200:
                            assert result == {'prediction': 'A', 'confidence': 1.0, 'model_version': 2}
'''.replace('HOST', name)
                docker('run', '--rm', *restrictions, image, 'python', '-c', client)
                phase = 'shutdown'
                docker('stop', '--time', '10', name)
                assert json.loads(docker('inspect', name).stdout)[0]['State']['ExitCode'] == 0
        print('ASL runtime passed: isolated startup, missing/mismatched artifact rejection, HTTP bounds, graceful stop.')
    except Exception:
        print('ASL runtime failed at phase: ' + phase, file=sys.stderr)
        return 1
    finally:
        cleanup_ok = True
        for name in containers:
            try:
                cleanup_ok = docker('rm', '-f', name, check=False).returncode == 0 and cleanup_ok
            except Exception:
                cleanup_ok = False
        if network_created:
            try:
                cleanup_ok = docker('network', 'rm', network, check=False).returncode == 0 and cleanup_ok
            except Exception:
                cleanup_ok = False
        if not cleanup_ok:
            print('ASL runtime cleanup failed for owned test resources.', file=sys.stderr)
            return 1
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1] if len(sys.argv) == 2 else 'tandem-asl:runtime-check'))
