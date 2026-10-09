"""Private, explicitly labeled landmark sessions; no images or uploads."""
import hashlib
import json
import math
import os
from pathlib import Path
import uuid

from asl.export_partitions import IDENTITY
from asl.evaluation import UNKNOWN


def validate_metadata(metadata):
    if not isinstance(metadata, dict):
        raise ValueError('Expected reviewed session metadata.')
    for key in ['signer_id', 'session_id']:
        if not isinstance(metadata.get(key), str) or not IDENTITY.fullmatch(metadata[key]):
            raise ValueError('Pseudonymous signer and session identities are required.')
    for key in ['source', 'license', 'consent_review', 'lighting', 'viewpoint', 'dominant_hand']:
        if not isinstance(metadata.get(key), str) or not metadata[key].strip():
            raise ValueError('Reviewed provenance and collection conditions are required.')
    if metadata['dominant_hand'] not in ['left', 'right', 'ambidextrous']:
        raise ValueError('Declare the actual dominant hand.')
    return dict(metadata)


class SessionStore:
    def __init__(self, output, metadata, max_samples=5000):
        self.metadata = validate_metadata(metadata)
        if type(max_samples) is not int or not 1 <= max_samples <= 100000:
            raise ValueError('Invalid sample limit.')
        self.max_samples = max_samples
        self.output = Path(output)
        self.output.mkdir(mode=0o700)
        self.count = 0
        self.digest = hashlib.sha256()
        self.closed = False
        self.pending = self.output / 'session.jsonl.part'
        try:
            self.file = self.pending.open('xb')
            self.pending.chmod(0o600)
        except Exception:
            self.pending.unlink(missing_ok=True)
            self.output.rmdir()
            raise

    def append(self, label, landmarks, timestamp_ms):
        if self.closed or self.count >= self.max_samples:
            raise ValueError('Session is closed or has reached its sample limit.')
        if (not isinstance(label, str) or
                (label != UNKNOWN and (len(label) != 1 or not 'A' <= label <= 'Z'))):
            raise ValueError('Expected a reviewed letter or unknown label.')
        if (not isinstance(landmarks, list) or len(landmarks) != 63 or
                any(type(v) not in (int, float) or abs(v) > 10 or not math.isfinite(v) for v in landmarks)
                or type(timestamp_ms) is not int or timestamp_ms < 0):
            raise ValueError('Invalid landmark sample.')
        record = {'sample_id': uuid.uuid4().hex, 'label': label,
                  'landmarks': landmarks, 'timestamp_ms': timestamp_ms}
        raw = (json.dumps(record, allow_nan=False, separators=(',', ':')) + '\n').encode()
        if len(raw) > 16384:
            raise ValueError('Sample exceeds its record size bound.')
        self.file.write(raw)
        self.digest.update(raw)
        self.count += 1

    def finish(self, reason='operator_finished'):
        if self.closed:
            raise ValueError('Session is already closed.')
        if not self.count:
            self.abort()
            return 0
        self.file.flush()
        os.fsync(self.file.fileno())
        self.file.close()
        manifest = {**self.metadata, 'sha256': self.digest.hexdigest(), 'samples': self.count,
                    'capture_format': 'single-hand-landmarks-v1', 'stop_reason': reason,
                    'production_ready': False}
        pending_manifest = self.output / 'session.json.part'
        with pending_manifest.open('x') as file:
            pending_manifest.chmod(0o600)
            file.write(json.dumps(manifest, indent=2, allow_nan=False) + '\n')
            file.flush()
            os.fsync(file.fileno())
        self.pending.rename(self.output / 'session.jsonl')
        pending_manifest.rename(self.output / 'session.json')
        self.closed = True
        return self.count

    def abort(self):
        if self.closed:
            return
        self.file.close()
        for name in ['session.jsonl.part', 'session.json.part', 'session.jsonl', 'session.json']:
            (self.output / name).unlink(missing_ok=True)
        self.output.rmdir()
        self.closed = True

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        if not self.closed:
            self.abort()
