"""Experimental fingerspelling inference behind the authenticated Node boundary.

Only load operator-trusted local pickle artifacts. This service does not establish
signer-independent accuracy or continuous ASL understanding.
"""
import logging
import math
import os
import pickle
import sys
from pathlib import Path

import numpy as np
from flask import Flask, jsonify, request

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from asl.features import extract_from_flat

log = logging.getLogger('asl_api')


def load_model():
    configured = os.environ.get('ASL_MODEL_DIR')
    if configured is not None and not configured.strip():
        raise ValueError('Configured model directory is empty.')
    directory = Path(configured) if configured is not None else ROOT / 'asl'
    for version, filename in [(2, 'model_v2.p'), (1, 'model.p')]:
        path = directory / filename
        if path.is_file():
            # Pickle can execute code; artifacts are trusted deployment inputs,
            # never request uploads or automatic remote downloads.
            with path.open('rb') as file:
                bundle = pickle.load(file)
            return {**bundle, 'version': version,
                    'classes': bundle.get('classes', bundle['model'].classes_.tolist())}
    raise FileNotFoundError('No trusted local fingerspelling model is configured.')


def finite_vector(value, length):
    return (isinstance(value, list) and len(value) == length and
            all(type(item) in (int, float) and abs(item) <= 10 and
                math.isfinite(item) for item in value))


def legacy_features(flat):
    return np.array(flat + [0.0] * (84 - len(flat)), dtype=np.float32)


def create_app(model_bundle=None):
    bundle = load_model() if model_bundle is None else model_bundle
    model = bundle['model']
    version = bundle['version']
    classes = list(bundle['classes'])
    encoder = bundle.get('label_encoder')
    expected = {1: 84, 2: 73}.get(version)
    if (not expected or not classes or not callable(getattr(model, 'predict_proba', None)) or
            getattr(model, 'n_features_in_', expected) != expected):
        raise ValueError('Incompatible fingerspelling model contract.')

    app = Flask(__name__)
    app.config['MAX_CONTENT_LENGTH'] = 16 * 1024

    @app.after_request
    def private_response(response):
        response.headers['Cache-Control'] = 'no-store'
        response.headers['X-Content-Type-Options'] = 'nosniff'
        return response

    @app.errorhandler(413)
    def oversized(_error):
        return jsonify(error='Prediction request is too large.'), 413

    @app.post('/predict')
    def predict():
        data = request.get_json(silent=True)
        if not isinstance(data, dict):
            return jsonify(error='Expected a JSON prediction object.'), 400
        landmarks = data.get('landmarks')
        if 'landmarks' in data:
            if not finite_vector(landmarks, 63):
                return jsonify(error='Expected 63 finite landmark coordinates.'), 400
            if version == 2:
                # Match training, including near-zero reference distances.
                features = extract_from_flat(landmarks)
            else:
                xs, ys = landmarks[::3], landmarks[1::3]
                min_x, min_y = min(xs), min(ys)
                flat = [coordinate for x, y in zip(xs, ys)
                        for coordinate in (x - min_x, y - min_y)]
                features = legacy_features(flat)
        elif version == 1 and finite_vector(data.get('features'), 42):
            features = legacy_features(data['features'])
        else:
            return jsonify(error='Send supported landmark coordinates.'), 400

        try:
            probabilities = np.asarray(model.predict_proba(features.reshape(1, -1)), dtype=float)
            if (probabilities.shape != (1, len(classes)) or
                    not np.isfinite(probabilities).all() or
                    (probabilities < 0).any() or (probabilities > 1).any() or
                    not np.isclose(probabilities.sum(), 1, atol=1e-6)):
                raise ValueError('Invalid model probabilities.')
            index = int(np.argmax(probabilities[0]))
            if encoder is not None:
                prediction = str(encoder.inverse_transform([model.classes_[index]])[0])
            else:
                prediction = str(classes[index])
            if len(prediction) != 1 or not 'A' <= prediction <= 'Z':
                raise ValueError('Unsupported model prediction.')
            return jsonify(prediction=prediction, confidence=round(float(probabilities[0, index]), 4),
                           model_version=version)
        except Exception:
            log.error('Fingerspelling inference failed.')
            return jsonify(error='Fingerspelling prediction unavailable.'), 503

    @app.get('/health')
    def health():
        return 'OK'

    @app.get('/model-info')
    def model_info():
        return jsonify(version=version, classes=classes, n_classes=len(classes), model_type=type(model).__name__)

    return app


if __name__ == '__main__':
    logging.basicConfig(level=logging.INFO, format='%(levelname)s %(message)s')
    create_app().run(host=os.environ.get('ASL_BIND_HOST', '127.0.0.1'), port=5003, debug=False)
