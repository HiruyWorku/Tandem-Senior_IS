#!/usr/bin/env python3
"""Release an application image; preserve secrets and restore the prior image on failure."""
import argparse
import fcntl
import os
from pathlib import Path
import re
import subprocess
import tempfile
import uuid


def run(command, *, env=None):
    result = subprocess.run(command, env=env, capture_output=True, text=True, timeout=600)
    if result.returncode:
        # Command output may contain resolved configuration; never echo it.
        raise RuntimeError(f"{command[0]} command failed (exit {result.returncode}).")
    return result.stdout.strip()


def write_settings(path, content):
    descriptor, temporary = tempfile.mkstemp(prefix='.release-', dir=path.parent)
    try:
        with os.fdopen(descriptor, 'wb') as file:
            file.write(content)
            file.flush()
            os.fsync(file.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def with_image(content, image):
    lines = content.decode().splitlines()
    return ('\n'.join(line for line in lines if not line.startswith('APP_IMAGE=')) +
            f'\nAPP_IMAGE={image}\n').encode()


def verify(execute, compose, image):
    execute(['systemctl', 'is-active', '--quiet', 'tandem-staging'])
    active = execute(compose + ['ps', '--quiet', 'app'])
    if not active or '\n' in active or execute(['docker', 'inspect', '--format', '{{.Config.Image}}', active]) != image:
        raise RuntimeError('Running application does not match the selected image.')
    execute(['docker', 'exec', active, 'node', '-e',
             "fetch('http://127.0.0.1:3000/ready',{signal:AbortSignal.timeout(5000)}).then(async r=>{if(!r.ok||!(await r.json()).ready)process.exit(1)}).catch(()=>process.exit(1));"])


def ensure_idle(execute, container):
    try:
        execute(['docker', 'exec', container, 'node', '-e',
                 "fetch('http://127.0.0.1:3000/metrics',{headers:{Authorization:'Bearer '+process.env.METRICS_TOKEN},signal:AbortSignal.timeout(5000)}).then(async r=>{if(!r.ok)throw Error();const line=(await r.text()).split('\\n').find(l=>l.startsWith('tandem_sockets '));if(!line||Number(line.split(' ')[1])!==0)throw Error();}).catch(()=>process.exit(1));"])
    except Exception as error:
        raise RuntimeError('Active connections or metrics unavailable; release postponed.') from error


def release(directory, image, execute=run):
    if not re.fullmatch(r'tandem-staging-app:release-[A-Za-z0-9][A-Za-z0-9._-]{0,80}', image):
        raise ValueError('Use a unique tandem-staging-app:release-<identifier> image tag.')
    settings = directory / '.env'
    original = settings.read_bytes()
    compose = ['docker', 'compose', '--project-directory', str(directory), '-f', str(directory / 'compose.yaml')]
    environment = {**os.environ, 'APP_IMAGE': image}
    if execute(['docker', 'image', 'ls', '--quiet', image]):
        raise ValueError('Release tag already exists; use a new identifier.')
    container = execute(compose + ['ps', '--quiet', 'app'])
    if not container or '\n' in container:
        raise RuntimeError('Expected exactly one running application container.')
    ensure_idle(execute, container)
    previous = execute(['docker', 'inspect', '--format', '{{.Image}}', container])
    rollback = f'tandem-staging-app:rollback-{uuid.uuid4().hex}'
    execute(['docker', 'image', 'tag', previous, rollback])
    print('Building candidate application image.', flush=True)
    execute(['docker', 'build', '--tag', image, str(directory.parent.parent)])
    execute(['docker', 'run', '--rm', '--read-only', '--user', 'node', '--tmpfs', '/tmp:rw,size=64m,mode=1777',
             '--entrypoint', 'npm', image, '--cache', '/tmp/npm-cache', 'audit', '--omit=dev', '--audit-level=high'])
    execute(compose + ['config', '--quiet'], env=environment)
    execute(compose + ['run', '--rm', '--no-deps', '--entrypoint', 'node', 'app', '-e',
             "const a=require('./server').createApplication();a.close().catch(()=>process.exit(1));"], env=environment)
    ensure_idle(execute, container)
    print('Candidate audit and configuration passed; switching application image.', flush=True)
    try:
        write_settings(settings, with_image(original, image))
        execute(['systemctl', 'restart', 'tandem-staging'])
        verify(execute, compose, image)
    except Exception as failure:
        # Pin the exact running image from before the rollout; never rebuild old source.
        try:
            write_settings(settings, with_image(original, rollback))
            execute(['systemctl', 'restart', 'tandem-staging'])
            verify(execute, compose, rollback)
        except Exception:
            raise RuntimeError(f'Rollout failed and rollback failed. Previous image retained as {rollback}.') from failure
        raise RuntimeError(f'Rollout failed; previous image restored as {rollback}.') from failure
    print(f'Release ready: {image}. Rollback image: {rollback}.', flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--image', required=True)
    arguments = parser.parse_args()
    if os.geteuid() != 0:
        parser.error('Run this release command as root on the staging VM.')
    directory = Path(__file__).resolve().parent
    try:
        with (directory / '.release.lock').open('a') as lock:
            os.chmod(directory / '.release.lock', 0o600)
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            release(directory, arguments.image)
    except Exception as error:
        print(str(error), flush=True)
        raise SystemExit(1)
