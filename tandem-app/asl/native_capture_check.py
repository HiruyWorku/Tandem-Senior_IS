"""Native detector/preprocessing compatibility on blank frames, no camera/window."""
import argparse
import hashlib
from pathlib import Path

import numpy as np
from asl.capture_session import make_detector


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--landmarker-model', type=Path, required=True)
    parser.add_argument('--landmarker-sha256', required=True)
    args = parser.parse_args(argv)
    raw = args.landmarker_model.read_bytes()
    if hashlib.sha256(raw).hexdigest() != args.landmarker_sha256:
        raise ValueError('Landmarker checksum mismatch.')
    import cv2 as cv
    import mediapipe as mp
    with make_detector(mp, raw) as detector:
        frame = np.zeros((240, 320, 3), dtype=np.uint8)
        for timestamp in [1, 100, 1000]:
            rgb = cv.cvtColor(frame, cv.COLOR_BGR2RGB)
            result = detector.detect_for_video(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb), timestamp)
            assert result.hand_landmarks == []
        cv.putText(frame, 'Synthetic compatibility check', (10, 30),
                   cv.FONT_HERSHEY_SIMPLEX, .6, (255, 255, 255), 2, cv.LINE_AA)
    print('Native blank-frame detection/conversion/annotation passed; no camera or window opened.')


if __name__ == '__main__':
    main()
