"""Train an experimental letter baseline on explicitly signer-separated data.

No camera, downloads, benchmark inputs, random sample split or automatic rollout.
"""
import argparse
import hashlib
import io
import json
import pickle
from pathlib import Path

import numpy as np
import sklearn
from sklearn.ensemble import RandomForestClassifier

from asl.evaluation import UNKNOWN, score_predictions


def load_partition(path, manifest_path):
    raw = path.read_bytes()
    manifest = json.loads(manifest_path.read_text())
    if manifest.get('sha256') != hashlib.sha256(raw).hexdigest():
        raise ValueError('Dataset checksum does not match its manifest.')
    if any(not isinstance(manifest.get(key), str) or not manifest[key].strip()
           for key in ['source', 'license', 'consent_review']):
        raise ValueError('Dataset source, license and consent review are required.')
    with np.load(io.BytesIO(raw), allow_pickle=False) as data:
        arrays = {key: data[key] for key in ['X', 'y', 'signer_id', 'sample_id']}
    X, y, signers, samples = (arrays[key] for key in ['X', 'y', 'signer_id', 'sample_id'])
    count = len(X)
    if (X.shape != (count, 73) or not 1 <= count <= 100000 or X.dtype.kind not in 'fi'
            or not np.isfinite(X).all() or any(a.shape != (count,) or a.dtype.kind not in 'US'
                                              for a in [y, signers, samples])):
        raise ValueError('Invalid partition arrays.')
    y, signers, samples = (a.astype(str) for a in [y, signers, samples])
    arrays.update(y=y, signer_id=signers, sample_id=samples)
    if (any(not str(v).strip() for v in signers) or any(not str(v).strip() for v in samples)
            or len(set(samples.tolist())) != count):
        raise ValueError('Signer identities must be nonempty and sample identities unique.')
    if any(v != UNKNOWN and (len(v) != 1 or not 'A' <= v <= 'Z') for v in y):
        raise ValueError('Unsupported partition label.')
    return arrays, manifest


def train_partitions(training, validation, threshold):
    training_signers = set(training['signer_id'].tolist())
    validation_signers = set(validation['signer_id'].tolist())
    if training_signers & validation_signers:
        raise ValueError('Training and validation signers overlap.')
    if set(training['sample_id'].tolist()) & set(validation['sample_id'].tolist()):
        raise ValueError('Training and validation samples overlap.')
    labels = sorted(set(training['y'].tolist()))
    if len(training_signers) < 2 or not validation_signers or len(labels) < 2 or UNKNOWN in labels:
        raise ValueError('Need multiple training signers/classes and a separate validation signer.')
    if (UNKNOWN not in validation['y'] or not any(v != UNKNOWN for v in validation['y'])
            or any(v != UNKNOWN and v not in labels for v in validation['y'])):
        raise ValueError('Validation needs unknown inputs and supported letters.')
    # Validate threshold before fitting; never tune on the final benchmark.
    score_predictions(np.full((len(validation['y']), len(labels)), 1 / len(labels)),
                      labels, validation['y'], validation['signer_id'], threshold)
    model = RandomForestClassifier(n_estimators=100, max_depth=16, min_samples_leaf=2,
                                   class_weight='balanced', n_jobs=1, random_state=42)
    model.fit(training['X'], training['y'])
    report = score_predictions(model.predict_proba(validation['X']), model.classes_.tolist(),
                               validation['y'], validation['signer_id'], threshold)
    report.update(task='single-frame letter classification', partition='validation',
                  production_ready=False)
    return {'model': model, 'classes': model.classes_.tolist(), 'version': 2, 'n_features': 73}, report


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['training', 'training-manifest', 'validation', 'validation-manifest', 'output']:
        parser.add_argument('--' + name, type=Path, required=True)
    parser.add_argument('--threshold', type=float, required=True)
    parser.add_argument('--model-license', required=True, help='Operator-reviewed rights for the derived model')
    parser.add_argument('--model-consent-review', required=True)
    args = parser.parse_args(argv)
    if not args.model_license.strip() or not args.model_consent_review.strip():
        raise ValueError('Derived-model license and consent review are required.')
    # Require a new private directory, so existing models/results cannot be overwritten.
    if args.output.exists():
        raise ValueError('Output directory already exists.')
    training, train_manifest = load_partition(args.training, args.training_manifest)
    validation, validation_manifest = load_partition(args.validation, args.validation_manifest)
    bundle, report = train_partitions(training, validation, args.threshold)
    model_bytes = pickle.dumps(bundle)
    provenance = {
        'sha256': hashlib.sha256(model_bytes).hexdigest(),
        'source': 'Trained on reviewed training partition; evaluated on separate validation',
        'license': args.model_license, 'consent_review': args.model_consent_review,
        'training_signers': sorted(set(training['signer_id'].tolist())),
        'validation_signers': sorted(set(validation['signer_id'].tolist())),
        'training_dataset': train_manifest, 'validation_dataset': validation_manifest,
        'sklearn_version': sklearn.__version__, 'threshold': args.threshold,
        'task': 'single-frame letter classification', 'production_ready': False,
    }
    args.output.mkdir(mode=0o700)
    artifacts = {'model_v2.p': model_bytes,
                 'model-provenance.json': (json.dumps(provenance, indent=2, allow_nan=False) + '\n').encode(),
                 'validation-report.json': (json.dumps(report, indent=2, allow_nan=False) + '\n').encode()}
    try:
        for name, content in artifacts.items():
            path = args.output / name
            with path.open('xb') as file:
                path.chmod(0o600)
                file.write(content)
    except Exception:
        # A partial bundle must not look deployable.
        for name in artifacts:
            (args.output / name).unlink(missing_ok=True)
        args.output.rmdir()
        raise
    print('Experimental model and private validation artifacts written; deployment remains disabled.')


if __name__ == '__main__':
    main()
