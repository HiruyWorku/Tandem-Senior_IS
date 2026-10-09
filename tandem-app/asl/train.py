#!/usr/bin/env python3
"""
ASL Model Training — v2
========================
Legacy unverified experiment. The supported training command is now
`python -m asl.train_reviewed`; see EVALUATION.md for required partitions and
provenance. This script is retained for historical reproduction only.
Trains a 3-layer MLP on MediaPipe landmark features extracted by features.py.
The sample-level cross-validation and hold-out results below do not establish
unseen-signer accuracy: related signer/session images can appear on both sides
of those splits. Compare models on a signer-held-out benchmark before making
quality or runtime claims. Static letters do not establish continuous ASL
understanding.

Usage
-----
    cd tandem-app
    python asl/train.py                    # uses asl/data_v2/
    python asl/train.py --data asl/data_v2 # explicit path

Output
------
    asl/model_v2.p   — pickled dict: {'model': MLPClassifier, 'classes': [...]}

The server (server/asl_api.py) auto-detects and loads model_v2.p if present.
"""

import os
import sys
import argparse
import pickle
import time

import cv2
import mediapipe as mp
import numpy as np
from sklearn.neural_network import MLPClassifier
from sklearn.model_selection import StratifiedKFold, cross_val_score
from sklearn.preprocessing import LabelEncoder
from sklearn.metrics import classification_report, confusion_matrix
from sklearn.utils.class_weight import compute_class_weight

# Ensure we can import features.py from the asl/ directory
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from asl.features import extract

# ── Config ─────────────────────────────────────────────────────────────────
DEFAULT_DATA_DIR   = os.path.join(os.path.dirname(__file__), 'data_v2')
MODEL_OUT          = os.path.join(os.path.dirname(__file__), 'model_v2.p')
MIN_DETECTION_CONF = 0.5
SUPPORTED_EXTS     = {'.jpg', '.jpeg', '.png', '.bmp'}


# ── MediaPipe setup ─────────────────────────────────────────────────────────
mp_hands = mp.solutions.hands


def extract_from_image(img_path, hands):
    """Return feature vector or None if no hand detected."""
    img = cv2.imread(img_path)
    if img is None:
        return None
    rgb     = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    results = hands.process(rgb)
    if not results.multi_hand_landmarks:
        return None
    return extract(results.multi_hand_landmarks[0].landmark)


NPZ_PATH = os.path.join(os.path.dirname(__file__), 'dataset_v2.npz')


def load_from_npz():
    """Load pre-extracted features saved by download_dataset.py (instant)."""
    d = np.load(NPZ_PATH, allow_pickle=False)
    X = d['X'].astype(np.float32)
    y = d['y'].astype(str)
    labels = sorted(np.unique(y).tolist())
    print(f'Loaded {len(X)} samples × {X.shape[1]} features from {NPZ_PATH}')
    print(f'Classes ({len(labels)}): {", ".join(labels)}')
    return X, y


def load_dataset(data_dir):
    """Walk data_dir/<label>/*.jpg and return (X, y, label_names)."""
    if not os.path.isdir(data_dir):
        print(f'ERROR: data directory not found: {data_dir}')
        print('Options:')
        print('  1.  python asl/download_dataset.py   (uses Kaggle dataset — recommended)')
        print('  2.  python asl/collect.py            (collect your own data)')
        sys.exit(1)

    label_names = sorted([
        d for d in os.listdir(data_dir)
        if os.path.isdir(os.path.join(data_dir, d))
    ])

    if not label_names:
        print(f'ERROR: No class subdirectories in {data_dir}')
        sys.exit(1)

    print(f'\nFound {len(label_names)} classes: {", ".join(label_names)}')

    X, y = [], []
    skipped = 0

    with mp_hands.Hands(
        static_image_mode=True,
        max_num_hands=1,
        min_detection_confidence=MIN_DETECTION_CONF,
    ) as hands:
        for label in label_names:
            class_dir = os.path.join(data_dir, label)
            imgs = [
                f for f in os.listdir(class_dir)
                if os.path.splitext(f)[1].lower() in SUPPORTED_EXTS
            ]

            class_feats = []
            for fname in sorted(imgs):
                fv = extract_from_image(os.path.join(class_dir, fname), hands)
                if fv is not None:
                    class_feats.append(fv)
                else:
                    skipped += 1

            print(f'  {label:>4s}: {len(class_feats):4d} samples'
                  f'  (skipped {len(imgs)-len(class_feats)} — no hand detected)')

            X.extend(class_feats)
            y.extend([label] * len(class_feats))

    print(f'\nTotal: {len(X)} samples, {skipped} skipped (hand not detected)')
    return np.array(X, dtype=np.float32), np.array(y)


def train(X, y):
    """Train and cross-validate an MLP classifier."""
    from sklearn.model_selection import train_test_split

    # Encode string labels → integers (required by MLPClassifier early_stopping
    # in sklearn >= 1.4 when labels are strings)
    le = LabelEncoder()
    y_enc = le.fit_transform(y)

    print(f'\nTraining MLP on {len(X)} samples, {X.shape[1]} features, '
          f'{len(le.classes_)} classes …')

    clf = MLPClassifier(
        hidden_layer_sizes=(256, 128, 64),
        activation='relu',
        solver='adam',
        alpha=1e-4,
        batch_size=64,
        learning_rate='adaptive',
        learning_rate_init=1e-3,
        max_iter=500,
        early_stopping=True,
        validation_fraction=0.1,
        n_iter_no_change=20,
        random_state=42,
        verbose=False,
    )

    # 5-fold cross-validation
    print('Running 5-fold cross-validation…')
    t0     = time.time()
    cv     = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)
    scores = cross_val_score(clf, X, y_enc, cv=cv, scoring='accuracy', n_jobs=-1)
    print(f'  CV accuracy: {scores.mean()*100:.1f}% ± {scores.std()*100:.1f}%  '
          f'({time.time()-t0:.0f}s)')

    # Final fit on all data
    print('Fitting on full dataset…')
    t0 = time.time()
    clf.fit(X, y_enc)
    print(f'  Done in {time.time()-t0:.0f}s  '
          f'({clf.n_iter_} iterations, loss={clf.loss_:.4f})')

    # Per-class report on a held-out split
    X_tr, X_te, y_tr, y_te = train_test_split(
        X, y_enc, test_size=0.15, stratify=y_enc, random_state=0)
    clf_eval = MLPClassifier(**clf.get_params())
    clf_eval.fit(X_tr, y_tr)
    y_pred   = clf_eval.predict(X_te)
    print('\nPer-class accuracy on 15% hold-out:')
    print(classification_report(y_te, y_pred,
                                target_names=le.classes_, digits=3))

    # Attach the label encoder so the server can decode integer predictions
    clf.label_encoder_ = le
    return clf


def save_model(clf, label_names):
    le = getattr(clf, 'label_encoder_', None)
    payload = {
        'model':         clf,
        'classes':       label_names,
        'label_encoder': le,
        'version':       2,
        'n_features':    73,
    }
    with open(MODEL_OUT, 'wb') as f:
        pickle.dump(payload, f)
    size_mb = os.path.getsize(MODEL_OUT) / 1e6
    print(f'\nModel saved → {MODEL_OUT}  ({size_mb:.1f} MB)')
    print('Restart the server (npm run start:all) to use the new model.')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--data', default=DEFAULT_DATA_DIR,
                    help='Image directory (only used when dataset_v2.npz is absent)')
    args = ap.parse_args()

    # Prefer the pre-extracted NPZ (from download_dataset.py) — much faster
    if os.path.exists(NPZ_PATH):
        print(f'Found {NPZ_PATH} — loading pre-extracted features.')
        X, y = load_from_npz()
    else:
        print(f'{NPZ_PATH} not found — extracting features from images in {args.data}')
        print('Tip: run  python asl/download_dataset.py  to get a larger, better dataset.')
        X, y = load_dataset(args.data)

    label_names = sorted(np.unique(y).tolist())
    clf = train(X, y)
    save_model(clf, label_names)


if __name__ == '__main__':
    main()
