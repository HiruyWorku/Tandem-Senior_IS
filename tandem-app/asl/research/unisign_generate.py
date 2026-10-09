"""Offline synthetic Uni-Sign execution check, not a translation service.

Requires the checksum-pinned author's source/tokenizer files and ASL checkpoint.
Execute only with the documented unprivileged, network-disabled container bounds.
No participant clips, labels, uploads or application provider connections are used.
"""
import argparse
import ast
import hashlib
import json
from pathlib import Path
import resource
import signal
import sys
import time
from types import SimpleNamespace, ModuleType
from unittest.mock import patch

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('assets', type=Path)
parser.add_argument('checkpoint', type=Path)
parser.add_argument('--frames', type=int, choices=[16, 256], default=16)
parser.add_argument('--tokens', type=int, choices=range(1, 101), default=16)
parser.add_argument('--beams', type=int, choices=range(1, 5), default=1)
arguments = parser.parse_args()
signal.alarm(120)
root = arguments.assets
manifest = json.loads(Path(__file__).with_name('unisign_assets.json').read_text())
for relative, metadata in manifest.items():
    assert hashlib.sha256((root / relative).read_bytes()).hexdigest() == metadata['sha256']
checkpoint_path = arguments.checkpoint
digest = hashlib.sha256()
with checkpoint_path.open('rb') as source:
    for chunk in iter(lambda: source.read(1024 * 1024), b''):
        digest.update(chunk)
assert digest.hexdigest() == '1bfd5f3312f04e4736f0a52f4ef9535916e6de9676a2a0d00c708748683fb00d'

import torch
from transformers import MT5Config, MT5ForConditionalGeneration, T5Tokenizer
torch.set_num_threads(2)
sys.path.insert(0, str(root / 'source'))
tree = ast.parse((root / 'source/models.py').read_text())
tree.body = [node for node in tree.body if not
             (isinstance(node, ast.Import) and any(alias.name == 'torchvision' for alias in node.names))]
module = ModuleType('research_unisign_model')
exec(compile(tree, 'pinned_unisign_models.py', 'exec'), module.__dict__)
print(json.dumps({'phase': 'imports_complete'}), flush=True)
config = MT5Config.from_pretrained(root / 'tokenizer', local_files_only=True)
tokenizer = T5Tokenizer.from_pretrained(root / 'tokenizer', local_files_only=True, legacy=False)
args = SimpleNamespace(dataset='How2Sign', rgb_support=False, hidden_dim=256, label_smoothing=0.2)
started = time.monotonic()
with patch.object(MT5ForConditionalGeneration, 'from_pretrained', side_effect=lambda *a, **kw: MT5ForConditionalGeneration(config)):
    with patch.object(T5Tokenizer, 'from_pretrained', return_value=tokenizer):
        with torch.device('meta'):
            model = module.Uni_Sign(args)
checkpoint = torch.load(checkpoint_path, map_location='cpu', weights_only=True, mmap=True)
model.load_state_dict(checkpoint['model'], strict=True, assign=True)
assert not any(parameter.is_meta for parameter in model.parameters())
assert not any(buffer.is_meta for buffer in model.buffers())
model.eval()
print(json.dumps({'phase': 'strict_model_loaded', 'seconds': round(time.monotonic() - started, 3)}), flush=True)

frames = arguments.frames
src_input = {part: torch.zeros(1, frames, count, 3, dtype=torch.bfloat16)
             for part, count in [('body', 9), ('left', 21), ('right', 21), ('face_all', 18)]}
src_input['attention_mask'] = torch.ones(1, frames, dtype=torch.long)
started = time.monotonic()
with torch.inference_mode():
    intermediate = model(src_input, {'gt_sentence': ['']})
    assert torch.isfinite(intermediate['inputs_embeds']).all()
    print(json.dumps({'phase': 'pose_forward_complete', 'seconds': round(time.monotonic() - started, 3)}), flush=True)
    output = model.generate(intermediate, max_new_tokens=arguments.tokens, num_beams=arguments.beams)
decoded = tokenizer.batch_decode(output, skip_special_tokens=True)[0]
print(json.dumps({
    'phase': 'synthetic_generation_complete',
    'frames': frames,
    'max_new_tokens': arguments.tokens,
    'beams': arguments.beams,
    'input': 'all_zero_pose_no_signing',
    'output_tokens': int(output.shape[-1]),
    'generated_nonempty_text': bool(decoded.strip()),
    'seconds': round(time.monotonic() - started, 3),
    'peak_rss_kib': resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
    'translation_accuracy_measured': False,
}, sort_keys=True), flush=True)
