#!/usr/bin/env python3
"""
ASL Dataset Download & Preprocessing
======================================
Downloads the Kaggle ASL Alphabet dataset and extracts 73-dim landmark
features using MediaPipe, saving everything to  asl/dataset_v2.npz.

Dataset
-------
  Akash Nagaraj — ASL Alphabet (Kaggle)
  https://www.kaggle.com/datasets/grassknoted/asl-alphabet
  87,000 images · 29 classes · 200×200 px

Feature extraction
------------------
  Each image → MediaPipe HandLandmarker → 73-dim vector (features.py)
  Images where no hand is detected are skipped (~5-15 % depending on class).

Why this beats self-collected data
-----------------------------------
  Even though all images come from one signer, 3,000 images per letter
  capture a wide range of hand orientations, distances, and finger positions
  within each sign.  That variety is what the model actually needs.

Prerequisites
-------------
  pip install kaggle
  1. Go to kaggle.com → Account → API → Create New Token
  2. Place the downloaded kaggle.json at  ~/.kaggle/kaggle.json
  3. Run:  python asl/download_dataset.py

Output
------
  asl/dataset_v2.npz   (X: float32 N×73, y: str N)

Next step
---------
  python asl/train.py
"""

import os
import sys
import json
import shutil
import zipfile
import subprocess
import time
from pathlib import Path

# ── Config ──────────────────────────────────────────────────────────────────
KAGGLE_DATASET   = 'grassknoted/asl-alphabet'
DOWNLOAD_DIR     = Path(__file__).parent / 'kaggle_download'
TRAIN_DIR_NAME   = 'asl_alphabet_train'       # inside the zip
NPZ_OUT          = Path(__file__).parent / 'dataset_v2.npz'
SKIP_CLASSES     = {'nothing', 'del', 'space'}   # not useful for our model
MAX_PER_CLASS    = 1500   # cap to keep processing time ~15-20 min on CPU
MIN_DETECT_CONF  = 0.5


# ── Helpers ──────────────────────────────────────────────────────────────────

def ensure_kaggle():
    """Install the kaggle CLI if not present."""
    try:
        import kaggle          # noqa: F401
        return True
    except ImportError:
        print('Installing kaggle CLI…')
        subprocess.check_call([sys.executable, '-m', 'pip', 'install', 'kaggle', '-q'])
        return True


def check_credentials():
    cred = Path.home() / '.kaggle' / 'kaggle.json'
    if cred.exists():
        return True

    print('\n' + '─'*60)
    print('  Kaggle API credentials not found.')
    print()
    print('  To set them up (takes ~2 minutes):')
    print('  1. Create a free account at  https://www.kaggle.com')
    print('  2. Go to  kaggle.com → Account → API → Create New Token')
    print('  3. A file called kaggle.json will download — move it to:')
    print(f'       {cred}')
    print('  4. Run this script again.')
    print('─'*60 + '\n')
    return False


def find_train_dir(base: Path) -> Path:
    """
    Locate the directory that actually contains per-class subdirectories
    (single letters like A, B, C…).  The Kaggle zip nests the data one or
    two levels deep depending on how it was packaged, so we search rather
    than assume a fixed path.
    """
    for root, dirs, _ in os.walk(base):
        p = Path(root)
        letter_dirs = [d for d in dirs if len(d) == 1 and d.upper() in 'ABCDEFGHIJKLMNOPQRSTUVWXYZ']
        if len(letter_dirs) >= 20:   # found the level with A-Z classes
            return p
    return base  # fallback — let the caller handle an empty result


def download_dataset():
    DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)

    # If already downloaded, skip straight to finding the train dir
    if any(DOWNLOAD_DIR.iterdir()):
        print(f'Download directory already exists — skipping download.')
    else:
        print(f'Downloading {KAGGLE_DATASET} (~1 GB) …')
        t0 = time.time()
        result = subprocess.run(
            ['kaggle', 'datasets', 'download', '-d', KAGGLE_DATASET,
             '-p', str(DOWNLOAD_DIR), '--unzip'],
            check=False
        )
        if result.returncode != 0:
            print('ERROR: Kaggle download failed. Check your credentials and internet.')
            sys.exit(1)
        print(f'Download complete in {time.time()-t0:.0f}s')

    train_dir = find_train_dir(DOWNLOAD_DIR)
    print(f'Using train directory: {train_dir}')
    return train_dir


def extract_features_parallel(train_dir: Path):
    """
    Walk train_dir/<LABEL>/*.jpg, run MediaPipe on up to MAX_PER_CLASS images
    per class, and return (X, y) arrays.
    """
    import cv2
    import mediapipe as mp
    import numpy as np

    # Import shared feature extractor
    root = Path(__file__).parent.parent
    sys.path.insert(0, str(root))
    from asl.features import extract

    mp_hands = mp.solutions.hands
    hands    = mp_hands.Hands(
        static_image_mode=True,
        max_num_hands=1,
        min_detection_confidence=MIN_DETECT_CONF,
    )

    class_dirs = sorted([d for d in train_dir.iterdir() if d.is_dir()])
    print(f'\nFound {len(class_dirs)} class directories.')

    X_all, y_all = [], []
    total_skipped = 0

    for cls_dir in class_dirs:
        label = cls_dir.name.upper()
        if label.lower() in SKIP_CLASSES:
            print(f'  {label:>8s}: skipped (not a sign letter)')
            continue

        imgs = sorted(cls_dir.glob('*.jpg'))[:MAX_PER_CLASS]
        if not imgs:
            imgs = sorted(cls_dir.glob('*.png'))[:MAX_PER_CLASS]

        feats, skipped = [], 0
        for img_path in imgs:
            img = cv2.imread(str(img_path))
            if img is None:
                skipped += 1
                continue
            rgb     = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
            results = hands.process(rgb)
            if results.multi_hand_landmarks:
                fv = extract(results.multi_hand_landmarks[0].landmark)
                feats.append(fv)
            else:
                skipped += 1

        total_skipped += skipped
        print(f'  {label:>8s}: {len(feats):4d} features extracted  '
              f'({skipped} skipped — no hand detected)')

        X_all.extend(feats)
        y_all.extend([label] * len(feats))

    hands.close()

    print(f'\nTotal: {len(X_all)} samples extracted, {total_skipped} skipped.')
    return X_all, y_all


def save_npz(X_all, y_all):
    import numpy as np

    X = np.array(X_all, dtype=np.float32)
    y = np.array(y_all, dtype=str)

    print(f'\nSaving to {NPZ_OUT} …')
    np.savez_compressed(str(NPZ_OUT), X=X, y=y)
    size_mb = NPZ_OUT.stat().st_size / 1e6
    print(f'Saved  {X.shape[0]} samples × {X.shape[1]} features  ({size_mb:.1f} MB)')
    print(f'Classes: {sorted(set(y_all))}')


def main():
    print('Tandem — ASL Dataset Download & Preprocessing')
    print('=' * 50)

    ensure_kaggle()
    if not check_credentials():
        sys.exit(1)

    train_dir = download_dataset()
    t0 = time.time()
    X_all, y_all = extract_features_parallel(train_dir)

    if not X_all:
        print('ERROR: No features extracted. Something went wrong with MediaPipe.')
        sys.exit(1)

    save_npz(X_all, y_all)

    elapsed = (time.time() - t0) / 60
    print(f'\nPreprocessing complete in {elapsed:.1f} min')
    print('\nNext step:')
    print('  python asl/train.py')
    print('  (or:  npm run asl:train)')


if __name__ == '__main__':
    main()
