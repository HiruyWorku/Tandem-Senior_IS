"""Offline evaluation of an operator-trusted single-frame letter classifier.

Requires a separately collected, signer-disjoint benchmark and provenance.
This does not establish continuous ASL understanding or a production release.
"""
import argparse
import hashlib
import json
import math
import pickle
import time
from pathlib import Path

import numpy as np

UNKNOWN = '__unknown__'


def validate_benchmark(data, model_manifest, benchmark_manifest, model_hash, dataset_hash):
    for manifest, expected in [(model_manifest, model_hash), (benchmark_manifest, dataset_hash)]:
        if manifest.get('sha256') != expected:
            raise ValueError('Artifact checksum does not match its provenance manifest.')
        if any(not isinstance(manifest.get(key), str) or not manifest[key].strip()
               for key in ['source', 'license', 'consent_review']):
            raise ValueError('Source, license and consent review are required.')
    train = model_manifest.get('training_signers')
    validation = model_manifest.get('validation_signers')
    if (not isinstance(train, list) or not train or not isinstance(validation, list) or
            any(not isinstance(value, str) or not value.strip() for value in train + validation)):
        raise ValueError('Declare training and validation signer identities.')
    required = ['X', 'y', 'signer_id', 'sample_id']
    if any(key not in data for key in required):
        raise ValueError('Benchmark needs features, labels, signer identities and sample identities.')
    X, y, signers, samples = (np.asarray(data[key]) for key in required)
    count = len(X)
    if (X.shape != (count, 73) or not 1 <= count <= 100000 or X.dtype.kind not in 'fi' or
            not np.isfinite(X).all() or any(array.shape != (count,) or array.dtype.kind not in 'US'
                                          for array in [y, signers, samples])):
        raise ValueError('Invalid benchmark arrays.')
    if (any(not str(value).strip() for value in signers) or
            any(not str(value).strip() for value in samples) or len(set(samples.tolist())) != count):
        raise ValueError('Benchmark identities must be nonempty and samples unique.')
    if any(value != UNKNOWN and (len(value) != 1 or not 'A' <= value <= 'Z') for value in y):
        raise ValueError('Unsupported benchmark label.')
    if set(signers.tolist()) & set(train + validation):
        raise ValueError('Benchmark signers overlap training or validation signers.')
    if len(set(signers.tolist())) < 2 or UNKNOWN not in y:
        raise ValueError('Benchmark needs multiple unseen signers and unknown/non-letter inputs.')
    return X.astype(np.float32), y, signers


def score_predictions(probabilities, labels, truth, signers, threshold):
    labels = list(labels)
    probabilities = np.asarray(probabilities, dtype=float)
    if (type(threshold) not in (int, float) or not math.isfinite(threshold) or not 0 <= threshold <= 1 or
            not labels or len(set(labels)) != len(labels) or
            any(not isinstance(value, str) or len(value) != 1 or not 'A' <= value <= 'Z' for value in labels) or
            probabilities.shape != (len(truth), len(labels)) or not np.isfinite(probabilities).all() or
            (probabilities < 0).any() or (probabilities > 1).any() or
            not np.allclose(probabilities.sum(axis=1), 1, atol=1e-6)):
        raise ValueError('Invalid model predictions or predeclared threshold.')
    if any(value != UNKNOWN and value not in labels for value in truth):
        raise ValueError('Benchmark contains letters unsupported by this model.')
    indices = probabilities.argmax(axis=1)
    predicted = np.asarray(labels)[indices]
    accepted = probabilities[np.arange(len(truth)), indices] >= threshold
    correct = predicted == truth
    known = truth != UNKNOWN

    def metrics(mask):
        total = int(mask.sum())
        accepted_count = int((mask & accepted).sum())
        correct_count = int((mask & accepted & correct).sum())
        return {'samples': total, 'accepted': accepted_count, 'abstained': total - accepted_count,
                'correct_accepted': correct_count, 'wrong_accepted': accepted_count - correct_count,
                'coverage': accepted_count / total if total else None,
                'accepted_accuracy': correct_count / accepted_count if accepted_count else None}

    per_signer = [metrics(signers == signer) for signer in np.unique(signers)]
    return {'samples': len(truth), 'signers': len(per_signer), 'threshold': threshold,
            'overall': metrics(np.ones(len(truth), dtype=bool)), 'known_letters': metrics(known),
            'unknown_inputs': metrics(~known),
            'worst_signer_wrong_acceptance_rate': max(m['wrong_accepted'] / m['samples'] for m in per_signer),
            'per_letter': {label: metrics(truth == label) for label in labels}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--model', type=Path, required=True, help='Operator-trusted local pickle only')
    parser.add_argument('--model-manifest', type=Path, required=True)
    parser.add_argument('--benchmark', type=Path, required=True)
    parser.add_argument('--benchmark-manifest', type=Path, required=True)
    parser.add_argument('--threshold', type=float, required=True, help='Chosen before examining benchmark results')
    parser.add_argument('--report', type=Path, required=True)
    args = parser.parse_args()
    model_bytes = args.model.read_bytes()
    model_hash = hashlib.sha256(model_bytes).hexdigest()
    dataset_hash = hashlib.sha256(args.benchmark.read_bytes()).hexdigest()
    model_manifest = json.loads(args.model_manifest.read_text())
    benchmark_manifest = json.loads(args.benchmark_manifest.read_text())
    # Reject missing provenance or leaked signers BEFORE loading executable pickle.
    with np.load(args.benchmark, allow_pickle=False) as data:
        X, truth, signers = validate_benchmark(data, model_manifest, benchmark_manifest, model_hash, dataset_hash)
    bundle = pickle.loads(model_bytes)
    if bundle.get('version') != 2:
        raise ValueError('This evaluator requires the 73-feature v2 model contract.')
    model = bundle['model']
    if getattr(model, 'n_features_in_', None) != 73:
        raise ValueError('Incompatible model feature count.')
    encoder = bundle.get('label_encoder')
    labels = encoder.inverse_transform(model.classes_).tolist() if encoder is not None else list(bundle['classes'])
    start = time.perf_counter()
    probabilities = np.concatenate([model.predict_proba(X[index:index + 512]) for index in range(0, len(X), 512)])
    elapsed = time.perf_counter() - start
    report = score_predictions(probabilities, labels, truth, signers, args.threshold)
    report.update({'model_sha256': model_hash, 'benchmark_sha256': dataset_hash,
                   'batch_inference_seconds': elapsed, 'task': 'single-frame letter classification',
                   'production_ready': False})
    args.report.write_text(json.dumps(report, indent=2, allow_nan=False) + '\n')
    print('Aggregate benchmark report written. No production quality claim is implied.')


if __name__ == '__main__':
    main()
