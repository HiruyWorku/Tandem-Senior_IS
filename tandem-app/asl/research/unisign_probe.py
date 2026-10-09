"""Inspect the checksum-pinned Uni-Sign ASL checkpoint in an isolated CPU container.

Research only. Does not translate, collect participant data, or enable call inference.
Run with the isolation settings in docs/CONTINUOUS_ASL.md, not on an upload endpoint.
"""
import argparse
import hashlib
import json
from pathlib import Path
import resource
import time

CHECKPOINT_SHA256 = '1bfd5f3312f04e4736f0a52f4ef9535916e6de9676a2a0d00c708748683fb00d'
CHECKPOINT_BYTES = 1186925007


def inspect(path):
    path = Path(path)
    if path.stat().st_size != CHECKPOINT_BYTES:
        raise ValueError('Checkpoint size mismatch.')
    checksum = hashlib.sha256()
    with path.open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            checksum.update(chunk)
    if checksum.hexdigest() != CHECKPOINT_SHA256:
        raise ValueError('Checkpoint SHA256 mismatch.')

    import torch
    started = time.monotonic()
    checkpoint = torch.load(path, map_location='cpu', weights_only=True, mmap=True)
    state = checkpoint['model']
    if not all(isinstance(key, str) and isinstance(value, torch.Tensor)
               for key, value in state.items()):
        raise ValueError('Unsupported state dictionary.')
    dtypes = {}
    for tensor in state.values():
        dtypes[str(tensor.dtype)] = dtypes.get(str(tensor.dtype), 0) + 1
    return {
        'sha256_verified': True,
        'torch_version': torch.__version__,
        'weights_only_loaded': True,
        'load_seconds': round(time.monotonic() - started, 3),
        'state_keys': len(state),
        'dtypes': dtypes,
        'embedding_shape': list(state['mt5_model.shared.weight'].shape),
        'pose_projection_shape': list(state['pose_proj.weight'].shape),
        'peak_rss_kib': resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
        'mmap_used': True,
        'translation_executed': False,
    }


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('checkpoint')
    arguments = parser.parse_args()
    try:
        print(json.dumps(inspect(arguments.checkpoint), sort_keys=True))
    except Exception:
        # Deliberately omit paths, checkpoint contents and tracebacks.
        raise SystemExit('Research checkpoint inspection failed.')
