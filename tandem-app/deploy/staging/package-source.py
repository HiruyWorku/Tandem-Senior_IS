#!/usr/bin/env python3
"""Package application source without local configuration, credentials, or model artifacts."""
from pathlib import Path
import sys
import tarfile

root = Path(__file__).resolve().parents[2]
files = [root / name for name in ['package.json', 'package-lock.json', 'Dockerfile', '.dockerignore', 'server.js']]
for folder in ['server', 'public', 'deploy/staging']:
    files += [file for file in (root / folder).rglob('*') if file.is_file() and not file.is_symlink()
              and '__pycache__' not in file.parts and file.suffix != '.pyc'
              and file.name not in ['.env', 'runtime.env', '.release.lock']
              and not file.name.startswith(('compose.before-', '.release-'))]
with tarfile.open(sys.argv[1], 'w:gz') as archive:
    for file in files:
        archive.add(file, arcname=str(Path('tandem-app') / file.relative_to(root)), recursive=False)
print('Prepared source-only archive; local runtime configuration excluded.')
