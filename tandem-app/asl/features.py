"""
ASL landmark feature extraction — v2
=====================================
Produces a 73-dimensional, scale-invariant feature vector from 21 MediaPipe
hand landmarks.

Feature breakdown
-----------------
  0–62  : Normalised (x, y, z) for all 21 landmarks          (63 values)
  63–72 : Bend angle at 10 finger joints, normalised to [0,1] (10 values)

Normalisation
-------------
- Position: subtract wrist (landmark 0)
- Scale   : divide by wrist→middle-MCP (landmark 9) Euclidean distance
- Depth   : z is kept relative to wrist and scaled the same way
- Angles  : acos result divided by π → [0, 1]

Why this is better than the v1 features (x-min_x, y-min_y, no z, no angles):
- Scale-invariant (hand close vs far from camera doesn't matter)
- Depth-aware (helps distinguish flat vs curled 3-D poses)
- Joint angles add a signal that is highly discriminative between letters
  (e.g. A=all-curled, B=all-straight, C=all-curved share similar raw coords
   but very different angle profiles)
"""

import math
import numpy as np

# Each tuple (a, b, c) defines a joint angle: angle at vertex b between
# the vectors b→a and b→c.  Ordered from proximal to distal per finger.
JOINT_TRIPLETS = [
    # Thumb
    (1, 2, 3), (2, 3, 4),
    # Index
    (5, 6, 7), (6, 7, 8),
    # Middle
    (9, 10, 11), (10, 11, 12),
    # Ring
    (13, 14, 15), (14, 15, 16),
    # Pinky
    (17, 18, 19), (18, 19, 20),
]

N_FEATURES = 73  # 63 coords + 10 angles


def _get_xyz(lm):
    """Accept mediapipe Landmark objects, dicts, or plain (x,y,z) sequences."""
    if hasattr(lm, 'x'):
        return lm.x, lm.y, getattr(lm, 'z', 0.0)
    if isinstance(lm, dict):
        return lm['x'], lm['y'], lm.get('z', 0.0)
    # list / tuple
    return lm[0], lm[1], lm[2] if len(lm) > 2 else 0.0


def _angle(a, b, c):
    """
    Angle (radians) at vertex b between vectors b→a and b→c.
    Returns value in [0, π], normalised to [0, 1].
    """
    v1 = (a[0]-b[0], a[1]-b[1], a[2]-b[2])
    v2 = (c[0]-b[0], c[1]-b[1], c[2]-b[2])
    dot  = v1[0]*v2[0] + v1[1]*v2[1] + v1[2]*v2[2]
    mag1 = math.sqrt(v1[0]**2 + v1[1]**2 + v1[2]**2) + 1e-9
    mag2 = math.sqrt(v2[0]**2 + v2[1]**2 + v2[2]**2) + 1e-9
    cos_a = max(-1.0, min(1.0, dot / (mag1 * mag2)))
    return math.acos(cos_a) / math.pi  # → [0, 1]


def extract(landmarks):
    """
    Compute the 73-dim feature vector for one hand.

    Parameters
    ----------
    landmarks : sequence of 21 items
        Each item can be a mediapipe NormalizedLandmark, a dict with keys
        'x'/'y'/'z', or a sequence [x, y, z].

    Returns
    -------
    np.ndarray of shape (73,), dtype float32
    """
    pts = [_get_xyz(lm) for lm in landmarks]

    wx, wy, wz = pts[0]          # wrist
    mx, my, mz = pts[9]          # middle-finger MCP (reference distance)

    scale = math.sqrt((mx-wx)**2 + (my-wy)**2 + (mz-wz)**2)
    if scale < 1e-6:
        scale = 1.0

    # ── 63 normalised coordinate features ─────────────────────────────
    coords = []
    for x, y, z in pts:
        coords.extend([
            (x - wx) / scale,
            (y - wy) / scale,
            (z - wz) / scale,
        ])

    # ── 10 joint-angle features ────────────────────────────────────────
    angles = [_angle(pts[a], pts[b], pts[c]) for a, b, c in JOINT_TRIPLETS]

    return np.array(coords + angles, dtype=np.float32)


def extract_from_flat(flat_xyz):
    """
    Convenience wrapper: accept a flat list/array of 63 values
    (x0,y0,z0, x1,y1,z1, …) — the format sent by the browser.
    """
    assert len(flat_xyz) == 63, f"Expected 63 values, got {len(flat_xyz)}"
    pts = [(flat_xyz[i*3], flat_xyz[i*3+1], flat_xyz[i*3+2]) for i in range(21)]
    return extract(pts)
