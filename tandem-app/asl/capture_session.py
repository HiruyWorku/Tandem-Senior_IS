"""Operator-local, explicitly labeled camera capture. No image files/uploads."""
import argparse
import hashlib
import json
import math
from pathlib import Path
import time

from asl.session_store import SessionStore, validate_metadata
from asl.evaluation import UNKNOWN


def make_detector(mp, model_bytes):
    options = mp.tasks.vision.HandLandmarkerOptions(
        base_options=mp.tasks.BaseOptions(model_asset_buffer=model_bytes),
        running_mode=mp.tasks.vision.RunningMode.VIDEO, num_hands=2,
        min_hand_detection_confidence=.5, min_hand_presence_confidence=.5,
        min_tracking_confidence=.5)
    return mp.tasks.vision.HandLandmarker.create_from_options(options)


def capture(cv, mp, detector, store, labels, camera=0, clock=time.monotonic, duration_seconds=900):
    cap = cv.VideoCapture(camera)
    try:
        if not cap.isOpened():
            raise RuntimeError('Camera unavailable.')
        index, timestamp, last_save = 0, -1, float('-inf')
        started = clock()
        reason = 'operator_finished'
        while store.count < store.max_samples:
            ok, frame = cap.read()
            if not ok:
                reason = 'camera_interrupted'
                break
            now = clock()
            if now - started >= duration_seconds:
                reason = 'time_limit'
                break
            timestamp = max(timestamp + 1, int((now - started) * 1000))
            rgb = cv.cvtColor(frame, cv.COLOR_BGR2RGB)
            result = detector.detect_for_video(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb), timestamp)
            landmarks = None
            if len(result.hand_landmarks) == 1 and len(result.hand_landmarks[0]) == 21:
                landmarks = [float(value) for point in result.hand_landmarks[0]
                             for value in [point.x, point.y, point.z]]
                if any(not math.isfinite(v) or abs(v) > 10 for v in landmarks):
                    landmarks = None
            status = 'One hand detected' if landmarks is not None else 'Need exactly one detected hand'
            # Preview annotations never enter detection or saved landmark data.
            for row, text in enumerate([f'Label: {labels[index]} | Saved: {store.count}', status,
                                        'SPACE save sample | N next label | Q quit']):
                cv.putText(frame, text, (15, 30 + row * 30), cv.FONT_HERSHEY_SIMPLEX,
                           .6, (255, 255, 255), 2, cv.LINE_AA)
            cv.imshow('Tandem reviewed landmark capture', frame)
            key = cv.waitKey(10) & 0xff
            if key in [ord('q'), 27] or cv.getWindowProperty('Tandem reviewed landmark capture', cv.WND_PROP_VISIBLE) < 1:
                break
            if key == ord('n'):
                index = (index + 1) % len(labels)
            if key == ord(' ') and landmarks is not None and now - last_save >= .5:
                store.append(labels[index], landmarks, timestamp)
                last_save = now
        if store.count >= store.max_samples:
            reason = 'sample_limit'
        return store.finish(reason)
    finally:
        try:
            cap.release()
        finally:
            cv.destroyAllWindows()


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--metadata', type=Path, required=True)
    parser.add_argument('--landmarker-model', type=Path, required=True)
    parser.add_argument('--landmarker-sha256', required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--camera', type=int, default=0)
    parser.add_argument('--max-samples', type=int, default=5000)
    parser.add_argument('--duration-seconds', type=int, default=900)
    parser.add_argument('--labels', nargs='+', default=list('ABCDEFGHIJKLMNOPQRSTUVWXYZ') + [UNKNOWN])
    args = parser.parse_args(argv)
    metadata = validate_metadata(json.loads(args.metadata.read_text()))
    if (args.output.exists() or args.camera < 0 or not 1 <= args.max_samples <= 100000
            or not 1 <= args.duration_seconds <= 3600):
        raise ValueError('Use a new output directory and valid camera/sample limits.')
    if (len(set(args.labels)) != len(args.labels) or any(label != UNKNOWN and
            (len(label) != 1 or not 'A' <= label <= 'Z') for label in args.labels)):
        raise ValueError('Expected distinct letter or unknown labels.')
    model_bytes = args.landmarker_model.read_bytes()
    digest = hashlib.sha256(model_bytes).hexdigest()
    if digest != args.landmarker_sha256:
        raise ValueError('Landmarker model checksum mismatch.')
    # Optional native packages are imported only after reviewed inputs pass.
    import cv2 as cv
    import mediapipe as mp
    metadata.update(landmarker_sha256=digest, mediapipe_version=mp.__version__,
                    opencv_version=cv.__version__, camera_index=args.camera,
                    detector='MediaPipe HandLandmarker VIDEO', detector_max_hands=2,
                    min_hand_detection_confidence=.5, min_hand_presence_confidence=.5,
                    min_tracking_confidence=.5, capture_interval_seconds=.5)
    with make_detector(mp, model_bytes) as detector:
        with SessionStore(args.output, metadata, args.max_samples) as store:
            count = capture(cv, mp, detector, store, args.labels, args.camera,
                            duration_seconds=args.duration_seconds)
    print(json.dumps({'samples': count, 'production_ready': False}))


if __name__ == '__main__':
    main()
