"""
ASL Prediction API — v2
========================
Serves predictions from the best available model:
  - model_v2.p  (MLP, 73 features)  ← preferred
  - model.p     (RandomForest, 84 features, legacy)

The client sends a flat array of 63 floats (21 landmarks × x,y,z) which
the server converts to 73 features using asl/features.py.

Endpoints
---------
POST /predict
    Body: {"landmarks": [x0,y0,z0, x1,y1,z1, …, x20,y20,z20]}  (63 floats)
    Returns: {"prediction": "A", "confidence": 0.92, "model_version": 2}

GET  /health
    Returns: "OK"

GET  /model-info
    Returns: info about the loaded model
"""

import os
import sys
import math
import pickle
import logging

import numpy as np
from flask import Flask, request, jsonify
from flask_cors import CORS

# ── Path so we can import asl.features ─────────────────────────────────────
_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, _root)

logging.basicConfig(level=logging.INFO, format='%(levelname)s %(message)s')
log = logging.getLogger('asl_api')

app = Flask(__name__)
CORS(app)

# ── Model loading ───────────────────────────────────────────────────────────
MODEL_V2 = os.path.join(_root, 'asl', 'model_v2.p')
MODEL_V1 = os.path.join(_root, 'asl', 'model.p')

model         = None
model_version = None
model_classes = None
label_encoder = None   # only set for v2 models trained with integer-encoded labels


def _load():
    global model, model_version, model_classes, label_encoder

    if os.path.exists(MODEL_V2):
        with open(MODEL_V2, 'rb') as f:
            d = pickle.load(f)
        model         = d['model']
        model_version = 2
        model_classes = d.get('classes', [])
        label_encoder = d.get('label_encoder', None)
        log.info(f'Loaded v2 MLP model — {len(model_classes)} classes, '
                 f'{d.get("n_features", 73)} features')
        return

    if os.path.exists(MODEL_V1):
        with open(MODEL_V1, 'rb') as f:
            d = pickle.load(f)
        model         = d['model']
        model_version = 1
        model_classes = model.classes_.tolist()
        log.warning('Loaded legacy v1 RandomForest model.')
        log.warning('Run  python asl/download_dataset.py  then  python asl/train.py')
        return

    raise FileNotFoundError(
        'No model found. Run  python asl/download_dataset.py  then  python asl/train.py')


_load()


# ── Feature helpers ─────────────────────────────────────────────────────────

# Joint triplets for angle features (same as features.py)
_JOINTS = [
    (1,2,3),(2,3,4), (5,6,7),(6,7,8), (9,10,11),(10,11,12),
    (13,14,15),(14,15,16), (17,18,19),(18,19,20),
]


def _angle(pts, a, b, c):
    v1 = tuple(pts[a][i] - pts[b][i] for i in range(3))
    v2 = tuple(pts[c][i] - pts[b][i] for i in range(3))
    dot  = sum(v1[i]*v2[i] for i in range(3))
    m1   = math.sqrt(sum(v**2 for v in v1)) + 1e-9
    m2   = math.sqrt(sum(v**2 for v in v2)) + 1e-9
    ca   = max(-1.0, min(1.0, dot / (m1 * m2)))
    return math.acos(ca) / math.pi


def _features_v2(flat63):
    """Convert 63 flat xyz values → 73-feature vector."""
    pts = [(flat63[i*3], flat63[i*3+1], flat63[i*3+2]) for i in range(21)]
    wx, wy, wz = pts[0]
    mx, my, mz = pts[9]
    scale = math.sqrt((mx-wx)**2 + (my-wy)**2 + (mz-wz)**2) or 1.0

    coords = []
    for x, y, z in pts:
        coords.extend([(x-wx)/scale, (y-wy)/scale, (z-wz)/scale])

    angles = [_angle(pts, a, b, c) for a, b, c in _JOINTS]
    return np.array(coords + angles, dtype=np.float32)


def _features_v1(flat_xy):
    """Legacy: pad raw x-min/y-min features to 84 dimensions."""
    features = list(flat_xy)
    if len(features) < 84:
        features += [0.0] * (84 - len(features))
    return np.array(features[:84], dtype=np.float32)


# ── Routes ──────────────────────────────────────────────────────────────────

@app.route('/predict', methods=['POST'])
def predict():
    data = request.get_json(silent=True) or {}

    # ── New format: flat [x0,y0,z0, …, x20,y20,z20] (63 values) ──────────
    landmarks = data.get('landmarks')
    if landmarks and len(landmarks) == 63:
        if model_version == 2:
            features = _features_v2(landmarks).reshape(1, -1)
        else:
            # v1 model: build old-style x-min/y-min features from the xyz
            x_vals = [landmarks[i*3]   for i in range(21)]
            y_vals = [landmarks[i*3+1] for i in range(21)]
            min_x, min_y = min(x_vals), min(y_vals)
            old_feats = []
            for i in range(21):
                old_feats.extend([x_vals[i]-min_x, y_vals[i]-min_y])
            features = _features_v1(old_feats).reshape(1, -1)

    # ── Legacy format: 'features' key (42 x-min/y-min values) ────────────
    elif 'features' in data:
        if model_version == 1:
            features = _features_v1(data['features']).reshape(1, -1)
        else:
            return jsonify({'error': 'v2 model requires the "landmarks" format'}), 400
    else:
        return jsonify({'error': 'Send {"landmarks": [63 floats]} in the request body'}), 400

    try:
        proba      = model.predict_proba(features)[0]
        idx        = int(np.argmax(proba))
        confidence = float(proba[idx])
        # v2 models store integer-encoded predictions — decode via label_encoder
        if label_encoder is not None:
            prediction = str(label_encoder.inverse_transform([idx])[0])
        else:
            prediction = model_classes[idx] if idx < len(model_classes) else str(idx)
    except Exception as e:
        log.error(f'Inference error: {e}')
        return jsonify({'error': str(e)}), 500

    return jsonify({
        'prediction':    prediction,
        'confidence':    round(confidence, 4),
        'model_version': model_version,
    })


@app.route('/health')
def health():
    return 'OK'


@app.route('/model-info')
def model_info():
    return jsonify({
        'version':   model_version,
        'classes':   model_classes,
        'n_classes': len(model_classes),
        'model_type': type(model).__name__,
    })


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5003, debug=False)
