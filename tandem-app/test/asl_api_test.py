"""Exercise the real Flask boundary with deterministic models, no artifacts/providers."""
import sys
import os
import pickle
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from server.asl_api import create_app, load_model
from asl.features import extract_from_flat


class Model:
    n_features_in_ = 73
    classes_ = np.array([0, 1])

    def __init__(self, probabilities=None):
        self.probabilities = probabilities if probabilities is not None else [[0.2, 0.8]]
        self.calls = []

    def predict_proba(self, features):
        self.calls.append(features.copy())
        return self.probabilities


class ApiTest(unittest.TestCase):
    def fixture(self, model=None, version=2, classes=None, encoder=None):
        model = model if model is not None else Model()
        app = create_app({'model': model, 'version': version,
                          'classes': classes or ['A', 'B'], 'label_encoder': encoder})
        app.testing = True
        return app.test_client(), model

    def test_training_transform_matches_inference_including_small_reference_distance(self):
        client, model = self.fixture()
        for scale in [1, 5e-7, 0]:
            landmarks = [coordinate for i in range(21) for coordinate in (i / 30, i / 40, i / 50)]
            landmarks[27:30] = [scale, 0, 0]
            response = client.post('/predict', json={'landmarks': landmarks})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json, {'prediction': 'B', 'confidence': 0.8, 'model_version': 2})
            np.testing.assert_array_equal(model.calls[-1], extract_from_flat(landmarks).reshape(1, 73))
            self.assertEqual(response.headers['Cache-Control'], 'no-store')
            self.assertNotIn('Access-Control-Allow-Origin', response.headers)

    def test_malformed_bounded_input_never_calls_inference(self):
        client, model = self.fixture()
        for value in [None, [], 'private conversation', {}, {'landmarks': 'x' * 63},
                      {'landmarks': [True] * 63}, {'landmarks': [float('nan')] * 63},
                      {'landmarks': [float('inf')] * 63}, {'landmarks': [10 ** 1000] * 63},
                      {'landmarks': [10 ** 1000] + [0] * 62},
                      {'landmarks': [11] * 63}, {'landmarks': [0] * 62}, {'features': [0] * 42}]:
            response = client.post('/predict', json=value)
            self.assertIn(response.status_code, [400, 413])
            self.assertNotIn('private conversation', response.get_data(as_text=True))
        self.assertEqual(model.calls, [])
        response = client.post('/predict', data='x' * 17000, content_type='application/json')
        self.assertEqual(response.status_code, 413)
        self.assertEqual(response.headers['Cache-Control'], 'no-store')

    def test_noncontiguous_encoded_classes_decode_the_selected_class_value(self):
        class Encoder:
            def inverse_transform(self, values):
                self.values = values
                return ['Z']
        encoder = Encoder()
        model = Model(); model.classes_ = np.array([4, 25])
        client, _ = self.fixture(model, classes=['E', 'Z'], encoder=encoder)
        response = client.post('/predict', json={'landmarks': [0] * 63})
        self.assertEqual(response.json['prediction'], 'Z')
        self.assertEqual(encoder.values, [25])

    def test_model_failures_and_invalid_probabilities_withhold_private_details(self):
        class Broken(Model):
            def predict_proba(self, _features):
                raise RuntimeError('private model and conversation details')
        for model in [Broken(), Model([[float('nan'), 0.8]]), Model([[0.8, 0.8]]),
                      Model([[-0.1, 1.1]]), Model([[0.8]]), Model([0.2, 0.8])]:
            client, _ = self.fixture(model)
            with self.assertLogs('asl_api', level='ERROR') as captured:
                response = client.post('/predict', json={'landmarks': [0] * 63})
            self.assertEqual(response.status_code, 503)
            self.assertNotIn('private', response.get_data(as_text=True))
            self.assertNotIn('private', ''.join(captured.output))
        client, _ = self.fixture(classes=['A', 'unsupported word'])
        with self.assertLogs('asl_api', level='ERROR'):
            self.assertEqual(client.post('/predict', json={'landmarks': [0] * 63}).status_code, 503)

    def test_legacy_contract_keeps_exact_dimensions_and_rejects_malformed_features(self):
        model = Model(); model.n_features_in_ = 84
        client, _ = self.fixture(model, version=1)
        for body in [{'landmarks': [0] * 63}, {'features': [0] * 42}]:
            self.assertEqual(client.post('/predict', json=body).status_code, 200)
            self.assertEqual(model.calls[-1].shape, (1, 84))
        self.assertEqual(client.post('/predict', json={'features': [True] * 42}).status_code, 400)
        self.assertEqual(client.get('/health').status_code, 200)
        self.assertEqual(client.get('/model-info').json['version'], 1)

    def test_incompatible_artifacts_fail_before_serving_requests(self):
        model = Model(); model.n_features_in_ = 42
        with self.assertRaises(ValueError):
            self.fixture(model)

    def test_trusted_local_loader_prefers_v2_and_retains_legacy_fallback(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); (root / 'asl').mkdir()
            legacy = Model(); legacy.n_features_in_ = 84
            legacy.classes_ = np.array(['A', 'B'])
            (root / 'asl' / 'model.p').write_bytes(pickle.dumps({'model': legacy}))
            with patch('server.asl_api.ROOT', root), patch.dict(os.environ):
                os.environ.pop('ASL_MODEL_DIR', None)
                self.assertEqual(load_model()['version'], 1)
                (root / 'asl' / 'model_v2.p').write_bytes(pickle.dumps({'model': Model(), 'classes': ['A', 'B']}))
                self.assertEqual(load_model()['version'], 2)
                response = create_app().test_client().post('/predict', json={'landmarks': [0] * 63})
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json['model_version'], 2)

    def test_configured_directory_is_required_and_does_not_fall_back(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch.dict(os.environ, {'ASL_MODEL_DIR': directory}):
                with self.assertRaises(FileNotFoundError):
                    load_model()
                Path(directory, 'model_v2.p').write_bytes(pickle.dumps({'model': Model()}))
                self.assertEqual(load_model()['version'], 2)
            with patch.dict(os.environ, {'ASL_MODEL_DIR': ' '}):
                with self.assertRaises(ValueError):
                    load_model()


if __name__ == '__main__':
    unittest.main()
