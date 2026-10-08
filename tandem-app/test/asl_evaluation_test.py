import sys
import contextlib
import io
import hashlib
import json
import pickle
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from asl.evaluation import UNKNOWN, main, score_predictions, validate_benchmark


class FixtureModel:
    n_features_in_ = 73
    classes_ = np.array(['A', 'B'])

    def predict_proba(self, X):
        return np.tile([.9, .1], (len(X), 1))


class EvaluationTest(unittest.TestCase):
    def fixture(self):
        data = {'X': np.zeros((4, 73)), 'y': np.array(['A', 'B', UNKNOWN, UNKNOWN]),
                'signer_id': np.array(['new-1', 'new-2', 'new-1', 'new-2']),
                'sample_id': np.array(['1', '2', '3', '4'])}
        manifest = {'sha256': 'fixture-hash', 'source': 'Synthetic contract fixture',
                    'license': 'Fixture', 'consent_review': 'No participant data'}
        model = {**manifest, 'training_signers': ['train-1'], 'validation_signers': ['validation-1']}
        return data, model, manifest

    def test_signer_and_provenance_boundaries(self):
        data, model, manifest = self.fixture()
        X, y, signers = validate_benchmark(data, model, manifest, 'fixture-hash', 'fixture-hash')
        self.assertEqual(X.shape, (4, 73))
        self.assertEqual(len(signers), 4)
        for invalid in [{**model, 'training_signers': ['new-1']},
                        {**model, 'validation_signers': ['new-2']},
                        {**model, 'sha256': 'different'}, {**model, 'license': ''}]:
            with self.assertRaises(ValueError):
                validate_benchmark(data, invalid, manifest, 'fixture-hash', 'fixture-hash')

    def test_missing_identity_and_unknown_inputs_cannot_be_a_benchmark(self):
        data, model, manifest = self.fixture()
        for invalid in [{k: v for k, v in data.items() if k != 'signer_id'},
                        {**data, 'signer_id': np.array(['new-1'] * 4)},
                        {**data, 'sample_id': np.array(['duplicate'] * 4)},
                        {**data, 'y': np.array(['A'] * 4)},
                        {**data, 'X': np.full((4, 73), np.nan)}]:
            with self.assertRaises(ValueError):
                validate_benchmark(invalid, model, manifest, 'fixture-hash', 'fixture-hash')

    def test_wrong_acceptance_and_abstention_are_distinct(self):
        data, _, _ = self.fixture()
        report = score_predictions([[.9, .1], [.7, .3], [.95, .05], [.5, .5]],
                                   ['A', 'B'], data['y'], data['signer_id'], .8)
        self.assertEqual(report['overall']['accepted'], 2)
        self.assertEqual(report['overall']['wrong_accepted'], 1)
        self.assertEqual(report['overall']['accepted_accuracy'], .5)
        self.assertEqual(report['unknown_inputs']['wrong_accepted'], 1)
        self.assertEqual(report['unknown_inputs']['abstained'], 1)
        self.assertEqual(report['worst_signer_wrong_acceptance_rate'], .5)
        report = score_predictions([[.5, .5]] * 4, ['A', 'B'], data['y'], data['signer_id'], .9)
        self.assertIsNone(report['overall']['accepted_accuracy'])
        self.assertEqual(report['overall']['coverage'], 0)

    def test_invalid_scores_and_unsupported_labels_fail(self):
        data, _, _ = self.fixture()
        for probabilities in [[[.8, .8]] * 4, [[float('nan'), .2]] * 4, [[1, 0]] * 3]:
            with self.assertRaises(ValueError):
                score_predictions(probabilities, ['A', 'B'], data['y'], data['signer_id'], .8)
        with self.assertRaises(ValueError):
            score_predictions([[.5, .5]] * 4, ['A', 'B'], np.array(['Z'] * 4), data['signer_id'], .8)

    def test_cli_reports_real_inference_and_checks_provenance_before_pickle(self):
        data, model_manifest, benchmark_manifest = self.fixture()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            model = root / 'model.p'; benchmark = root / 'benchmark.npz'; report = root / 'report.json'
            model.write_bytes(pickle.dumps({'model': FixtureModel(), 'classes': ['A', 'B'], 'version': 2}))
            np.savez(benchmark, **data)
            model_manifest['sha256'] = hashlib.sha256(model.read_bytes()).hexdigest()
            benchmark_manifest['sha256'] = hashlib.sha256(benchmark.read_bytes()).hexdigest()
            (root / 'model.json').write_text(json.dumps(model_manifest))
            (root / 'benchmark.json').write_text(json.dumps(benchmark_manifest))
            argv = ['evaluation', '--model', str(model), '--model-manifest', str(root / 'model.json'),
                    '--benchmark', str(benchmark), '--benchmark-manifest', str(root / 'benchmark.json'),
                    '--threshold', '.8', '--report', str(report)]
            with patch.object(sys, 'argv', argv), contextlib.redirect_stdout(io.StringIO()):
                main()
            result = json.loads(report.read_text())
            self.assertEqual(result['overall']['accepted'], 4)
            self.assertEqual(result['overall']['wrong_accepted'], 3)
            self.assertFalse(result['production_ready'])
            self.assertNotIn('new-1', report.read_text())
            model_manifest['training_signers'] = ['new-1']
            (root / 'model.json').write_text(json.dumps(model_manifest))
            with patch.object(sys, 'argv', argv), patch('asl.evaluation.pickle.loads') as load:
                with self.assertRaises(ValueError):
                    main()
                load.assert_not_called()


if __name__ == '__main__':
    unittest.main()
