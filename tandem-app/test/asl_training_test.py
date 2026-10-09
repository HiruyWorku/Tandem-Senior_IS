"""Real sklearn training/inference on synthetic, signer-separated fixtures only."""
import contextlib
import hashlib
import io
import json
import pickle
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from asl.train_reviewed import load_partition, main, train_partitions
from asl.evaluation import UNKNOWN
from server.asl_api import create_app


class TrainingTest(unittest.TestCase):
    def fixture(self):
        training = {'X': np.array([[-1]*73, [1]*73]*8, dtype=np.float32),
                    'y': np.array(['A', 'B']*8),
                    'signer_id': np.array(['train-1']*8 + ['train-2']*8),
                    'sample_id': np.array(['t' + str(i) for i in range(16)])}
        validation = {'X': np.array([[-1]*73, [1]*73, [0]*73], dtype=np.float32),
                      'y': np.array(['A', 'B', UNKNOWN]),
                      'signer_id': np.array(['validate-1']*3),
                      'sample_id': np.array(['v0', 'v1', 'v2'])}
        return training, validation

    def write_partition(self, root, name, data):
        path = root / (name + '.npz')
        np.savez(path, **data)
        manifest = {'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
                    'source': 'Synthetic tests', 'license': 'Fixture',
                    'consent_review': 'No participant data'}
        manifest_path = root / (name + '.json')
        manifest_path.write_text(json.dumps(manifest))
        return path, manifest_path

    def test_validation_cannot_enter_fit_or_change_model_bytes(self):
        training, validation = self.fixture()
        a, report = train_partitions(training, validation, .8)
        b, _ = train_partitions(training, {**validation, 'X': np.full((3, 73), 100)}, .8)
        self.assertEqual(pickle.dumps(a), pickle.dumps(b))
        self.assertEqual(report['partition'], 'validation')
        self.assertFalse(report['production_ready'])
        self.assertNotIn('validate-1', json.dumps(report))
        response = create_app(a).test_client().post('/predict', json={'landmarks': [0]*63})
        self.assertEqual(response.status_code, 200)
        self.assertIn(response.json['prediction'], ['A', 'B'])

    def test_overlap_unknown_classes_and_threshold_fail_before_fit(self):
        training, validation = self.fixture()
        cases = [({**training, 'signer_id': np.array(['validate-1']*16)}, validation, .8),
                 (training, {**validation, 'sample_id': np.array(['t0', 'v1', 'v2'])}, .8),
                 (training, {**validation, 'y': np.array(['A', 'B', 'A'])}, .8),
                 (training, {**validation, 'y': np.array([UNKNOWN]*3)}, .8),
                 (training, {**validation, 'y': np.array(['A', 'Z', UNKNOWN])}, .8),
                 (training, validation, float('nan'))]
        with patch('asl.train_reviewed.RandomForestClassifier') as constructor:
            for train, validate, threshold in cases:
                with self.assertRaises(ValueError):
                    train_partitions(train, validate, threshold)
            constructor.assert_not_called()

    def test_manifests_arrays_and_identity_validation(self):
        training, _ = self.fixture()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for invalid in [{**training, 'X': np.full((16, 73), np.nan)},
                            {**training, 'sample_id': np.array(['same']*16)},
                            {**training, 'signer_id': np.array([' ']*16)}]:
                path, manifest = self.write_partition(root, 'invalid', invalid)
                with self.assertRaises(ValueError):
                    load_partition(path, manifest)
            path, manifest = self.write_partition(root, 'valid', training)
            self.assertEqual(load_partition(path, manifest)[0]['X'].shape, (16, 73))
            original = json.loads(manifest.read_text())
            for change in [{'sha256': 'wrong'}, {'consent_review': ''}]:
                manifest.write_text(json.dumps({**original, **change}))
                with self.assertRaises(ValueError):
                    load_partition(path, manifest)

    def test_cli_writes_private_compatible_bundle_and_refuses_overwrite(self):
        training, validation = self.fixture()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            train, train_manifest = self.write_partition(root, 'training', training)
            validate, validation_manifest = self.write_partition(root, 'validation', validation)
            output = root / 'result'
            argv = ['--training', str(train), '--training-manifest', str(train_manifest),
                    '--validation', str(validate), '--validation-manifest', str(validation_manifest),
                    '--threshold', '.8', '--output', str(output),
                    '--model-license', 'Synthetic fixture', '--model-consent-review', 'No participant data']
            with contextlib.redirect_stdout(io.StringIO()):
                main(argv)
            raw = (output / 'model_v2.p').read_bytes()
            provenance = json.loads((output / 'model-provenance.json').read_text())
            self.assertEqual(provenance['sha256'], hashlib.sha256(raw).hexdigest())
            self.assertEqual(provenance['training_signers'], ['train-1', 'train-2'])
            self.assertEqual(provenance['validation_signers'], ['validate-1'])
            self.assertFalse(provenance['production_ready'])
            self.assertEqual(output.stat().st_mode & 0o777, 0o700)
            for file in output.iterdir():
                self.assertEqual(file.stat().st_mode & 0o777, 0o600)
            with self.assertRaises(ValueError):
                main(argv)
            self.assertEqual(raw, (output / 'model_v2.p').read_bytes())

    def test_numeric_npz_byte_string_metadata_normalizes_to_unicode(self):
        training, _ = self.fixture()
        for key in ['y', 'signer_id', 'sample_id']:
            training[key] = training[key].astype('S')
        with tempfile.TemporaryDirectory() as directory:
            path, manifest = self.write_partition(Path(directory), 'bytes', training)
            loaded, _ = load_partition(path, manifest)
            self.assertEqual(loaded['y'].dtype.kind, 'U')
            self.assertEqual(loaded['signer_id'][0], 'train-1')


if __name__ == '__main__':
    unittest.main()
