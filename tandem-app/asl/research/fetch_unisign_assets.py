"""Download only pinned public research source/tokenizer assets; no weights/videos.

External source is for isolated research execution, outside application deployment.
"""
import argparse
import hashlib
import json
from pathlib import Path
from urllib.request import urlopen

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('output', type=Path)
root = parser.parse_args().output
root.mkdir(parents=True, exist_ok=False)
source_revision = 'eed438bcb49e30405cd6ccdfcccca330c134e830'
tokenizer_revision = '2eb15465c5dd7f72a8f7984306ad05ebc3dd1e1f'
sources = ['models.py', 'config.py', 'deformable_attention_2d.py',
           'stgcn_layers/__init__.py', 'stgcn_layers/gcn_utils.py',
           'stgcn_layers/stgcn_block.py']
tokenizer = ['config.json', 'generation_config.json', 'special_tokens_map.json',
             'tokenizer_config.json', 'spiece.model']
manifest = {}
expected = json.loads(Path(__file__).with_name('unisign_assets.json').read_text())
for folder, files, base in [
    ('source', sources, f'https://raw.githubusercontent.com/ZechengLi19/Uni-Sign/{source_revision}/'),
    ('tokenizer', tokenizer, f'https://huggingface.co/google/mt5-base/resolve/{tokenizer_revision}/'),
]:
    for name in files:
        target = root / folder / name
        target.parent.mkdir(parents=True, exist_ok=True)
        with urlopen(base + name, timeout=30) as response:
            payload = response.read(8 * 1024 * 1024 + 1)
        if len(payload) > 8 * 1024 * 1024:
            raise SystemExit('Research asset exceeds its download bound.')
        record = {'bytes': len(payload), 'sha256': hashlib.sha256(payload).hexdigest()}
        if record != expected[f'{folder}/{name}']:
            raise SystemExit('Research asset checksum mismatch.')
        target.write_bytes(payload)
        manifest[f'{folder}/{name}'] = record
(root / 'asset-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
print(json.dumps({'source_files': len(sources), 'tokenizer_files': len(tokenizer), 'bytes': sum(v['bytes'] for v in manifest.values())}))
