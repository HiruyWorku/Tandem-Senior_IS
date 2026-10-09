"""Export reviewed per-session landmark JSONL into signer-separated NPZ files."""
import argparse
import hashlib
import json
import math
from pathlib import Path
import re

import numpy as np

from asl.features import extract_from_flat
from asl.evaluation import UNKNOWN

PARTITIONS = ('training', 'validation', 'benchmark')
IDENTITY = re.compile(r'^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$')


def checksum(path):
    digest = hashlib.sha256()
    with path.open('rb') as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def validate_split(split):
    if not isinstance(split, dict):
        raise ValueError('Expected a split manifest object.')
    if any(not isinstance(split.get(k), str) or not split[k].strip()
           for k in ['dataset_license', 'consent_review']):
        raise ValueError('Reviewed derived-dataset rights and consent declarations are required.')
    groups = {}
    for name, minimum in [('training', 2), ('validation', 1), ('benchmark', 2)]:
        identities = split.get(name + '_signers')
        if (not isinstance(identities, list) or len(identities) < minimum or
                any(not isinstance(v, str) or not IDENTITY.fullmatch(v) for v in identities)
                or len(set(identities)) != len(identities)):
            raise ValueError('Split requires unique pseudonymous signer identities in each partition.')
        for identity in identities:
            if identity in groups:
                raise ValueError('Signer assigned to multiple partitions.')
            groups[identity] = name
    return groups


def export(collections, split, output):
    if output.exists():
        raise ValueError('Output directory already exists.')
    groups = validate_split(split)
    split_hash = hashlib.sha256(json.dumps(split, sort_keys=True, allow_nan=False).encode()).hexdigest()
    rows = {name: [] for name in PARTITIONS}
    samples, sessions, sources, observed = set(), set(), [], set()
    for path in collections:
        manifest = json.loads(path.with_suffix('.json').read_text())
        if not isinstance(manifest, dict):
            raise ValueError('Expected a collection manifest object.')
        digest = hashlib.sha256()
        if any(not isinstance(manifest.get(k), str) or not manifest[k].strip()
               for k in ['source', 'license', 'consent_review']):
            raise ValueError('Collection source, license and consent review are required.')
        signer, session = manifest.get('signer_id'), manifest.get('session_id')
        if (not isinstance(signer, str) or signer not in groups or
                not isinstance(session, str) or not IDENTITY.fullmatch(session)):
            raise ValueError('Collection needs an assigned signer and pseudonymous session identity.')
        if (signer, session) in sessions:
            raise ValueError('Duplicate collection session.')
        sessions.add((signer, session))
        observed.add(signer)
        sources.append(manifest)
        count = 0
        with path.open('rb') as file:
            while True:
                line = file.readline(16385)
                if not line:
                    break
                digest.update(line)
                if len(line) > 16384:
                    raise ValueError('Collection record exceeds its size bound.')
                record = json.loads(line)
                if not isinstance(record, dict):
                    raise ValueError('Expected a collection record object.')
                label, sample, landmarks = (record.get(k) for k in ['label', 'sample_id', 'landmarks'])
                if (not isinstance(sample, str) or not IDENTITY.fullmatch(sample) or sample in samples
                        or not isinstance(label, str) or
                        (label != UNKNOWN and (len(label) != 1 or not 'A' <= label <= 'Z'))):
                    raise ValueError('Invalid label or duplicate/malformed sample identity.')
                if (not isinstance(landmarks, list) or len(landmarks) != 63 or
                        any(type(v) not in (int, float) or abs(v) > 10 or not math.isfinite(v)
                            for v in landmarks)):
                    raise ValueError('Expected 63 bounded finite landmark coordinates.')
                features = extract_from_flat(landmarks)
                if features.shape != (73,) or not np.isfinite(features).all():
                    raise ValueError('Invalid extracted features.')
                samples.add(sample)
                if len(samples) > 100000:
                    raise ValueError('Collection exceeds the total sample bound.')
                rows[groups[signer]].append((features, label, signer, session, sample))
                count += 1
        if not count:
            raise ValueError('Empty collection session.')
        if manifest.get('sha256') != digest.hexdigest():
            raise ValueError('Collection checksum does not match its manifest.')
    if observed != set(groups):
        raise ValueError('Every preassigned signer needs collected samples.')
    training_labels = {row[1] for row in rows['training']}
    if len(training_labels) < 2 or UNKNOWN in training_labels:
        raise ValueError('Training needs multiple known letters; unknowns belong in evaluation partitions.')
    for name in ['validation', 'benchmark']:
        labels = {row[1] for row in rows[name]}
        if UNKNOWN not in labels or not labels & training_labels or labels - training_labels - {UNKNOWN}:
            raise ValueError('Evaluation partitions need supported letters and unknown inputs.')

    # Write only after validating all collections, so no partial input becomes a dataset.
    output.mkdir(mode=0o700)
    created = []
    try:
        for name in PARTITIONS:
            values = rows[name]
            path = output / (name + '.npz')
            created.append(path)
            with path.open('xb') as file:
                path.chmod(0o600)
                np.savez_compressed(file, X=np.asarray([row[0] for row in values], dtype=np.float32),
                                    y=np.asarray([row[1] for row in values]),
                                    signer_id=np.asarray([row[2] for row in values]),
                                    session_id=np.asarray([row[3] for row in values]),
                                    sample_id=np.asarray([row[4] for row in values]))
            manifest_path = output / (name + '.json')
            created.append(manifest_path)
            manifest = {'sha256': checksum(path), 'source': 'Reviewed per-session landmark collections',
                        'license': split['dataset_license'], 'consent_review': split['consent_review'],
                        'partition': name, 'feature_version': 2,
                        'signer_split_sha256': split_hash,
                        'collections': [source for source in sources if groups[source['signer_id']] == name]}
            with manifest_path.open('x') as file:
                manifest_path.chmod(0o600)
                file.write(json.dumps(manifest, indent=2) + '\n')
    except Exception:
        for path in created:
            path.unlink(missing_ok=True)
        output.rmdir()
        raise
    return {name: len(rows[name]) for name in PARTITIONS}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--collection', type=Path, action='append', required=True)
    parser.add_argument('--split-manifest', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args(argv)
    split = json.loads(args.split_manifest.read_text())
    counts = export(args.collection, split, args.output)
    print(json.dumps({'partition_samples': counts, 'production_ready': False}))


if __name__ == '__main__':
    main()
