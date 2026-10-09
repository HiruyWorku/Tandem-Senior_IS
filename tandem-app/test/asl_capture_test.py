"""Capture control/cleanup contracts with synthetic frames; no camera access."""
import hashlib
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from asl.capture_session import capture, main
from asl.session_store import SessionStore
from asl.export_partitions import export
from asl.evaluation import UNKNOWN


def metadata(signer='t1'):
    return {'signer_id': signer, 'session_id': signer + '-session', 'source': 'Synthetic tests',
            'license': 'Fixture', 'consent_review': 'No participant data',
            'lighting': 'Synthetic', 'viewpoint': 'Synthetic', 'dominant_hand': 'right'}


class Camera:
    def __init__(self, opened=True):
        self.opened = opened
        self.released = False
    def isOpened(self): return self.opened
    def read(self): return True, np.zeros((5, 5, 3), dtype=np.uint8)
    def release(self): self.released = True


class CV:
    COLOR_BGR2RGB = FONT_HERSHEY_SIMPLEX = LINE_AA = WND_PROP_VISIBLE = 1
    def __init__(self, keys, opened=True):
        self.keys = iter(keys)
        self.cap = Camera(opened)
        self.destroyed = False
    def VideoCapture(self, _index): return self.cap
    def cvtColor(self, frame, _code): return frame.copy()
    def putText(self, frame, *_args): frame.fill(255)
    def imshow(self, *_args): pass
    def waitKey(self, _delay): return next(self.keys)
    def getWindowProperty(self, *_args): return 1
    def destroyAllWindows(self): self.destroyed = True


class Detector:
    def __init__(self, counts):
        self.counts = iter(counts)
        self.timestamps = []
    def detect_for_video(self, image, timestamp):
        assert not image.data.any(), 'Preview annotations entered detector input.'
        self.timestamps.append(timestamp)
        hand = [SimpleNamespace(x=i/30, y=i/40, z=i/50) for i in range(21)]
        return SimpleNamespace(hand_landmarks=[hand] * next(self.counts))


MP = SimpleNamespace(Image=lambda **kw: SimpleNamespace(**kw), ImageFormat=SimpleNamespace(SRGB=1))


class CaptureTest(unittest.TestCase):
    def test_explicit_samples_labels_and_manifest_without_images(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'session'
            cv = CV([ord(' '), ord('n'), ord(' '), ord('q')])
            detector = Detector([1, 1, 1, 1])
            with SessionStore(output, metadata()) as store:
                ticks = iter([10, 10, 10, 11, 12])
                self.assertEqual(capture(cv, MP, detector, store, ['A', UNKNOWN], clock=lambda: next(ticks)), 2)
            self.assertTrue(cv.cap.released and cv.destroyed)
            self.assertEqual(detector.timestamps, [0, 1, 1000, 2000])
            self.assertEqual({p.name for p in output.iterdir()}, {'session.jsonl', 'session.json'})
            rows = [json.loads(line) for line in (output / 'session.jsonl').read_text().splitlines()]
            self.assertEqual([row['label'] for row in rows], ['A', UNKNOWN])
            manifest = json.loads((output / 'session.json').read_text())
            self.assertEqual(manifest['sha256'], hashlib.sha256((output / 'session.jsonl').read_bytes()).hexdigest())
            self.assertEqual(manifest['signer_id'], 't1')
            self.assertEqual(manifest['samples'], 2)
            self.assertEqual(output.stat().st_mode & 0o777, 0o700)
            for path in output.iterdir(): self.assertEqual(path.stat().st_mode & 0o777, 0o600)

    def test_absent_multiple_hands_and_no_capture_do_not_create_samples(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'session'
            cv = CV([ord(' '), ord(' '), ord('q')])
            with SessionStore(output, metadata()) as store:
                self.assertEqual(capture(cv, MP, Detector([0, 2, 1]), store, ['A']), 0)
            self.assertFalse(output.exists())
            self.assertTrue(cv.cap.released and cv.destroyed)

    def test_failed_camera_and_detector_clean_resources_and_partial_files(self):
        with tempfile.TemporaryDirectory() as directory:
            for opened in [False, True]:
                output = Path(directory) / 'session'
                cv = CV([], opened)
                with self.assertRaises((RuntimeError, StopIteration)):
                    with SessionStore(output, metadata()) as store:
                        capture(cv, MP, Detector([]), store, ['A'])
                self.assertFalse(output.exists())
                self.assertTrue(cv.cap.released and cv.destroyed)

    def test_reviewed_metadata_and_asset_hash_fail_before_native_import_or_camera(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            model = root / 'landmarker.task'; model.write_bytes(b'Synthetic not a model')
            record = root / 'metadata.json'; record.write_text(json.dumps(metadata()))
            output = root / 'session'
            argv = ['--metadata', str(record), '--landmarker-model', str(model),
                    '--landmarker-sha256', 'wrong', '--output', str(output)]
            with self.assertRaises(ValueError): main(argv)
            self.assertFalse(output.exists())
            with self.assertRaises(ValueError): SessionStore(output, {**metadata(), 'consent_review': ''})
            self.assertFalse(output.exists())

    def test_completed_sessions_feed_reviewed_export(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            collections = []
            for signer in ['t1', 't2', 'v1', 'b1', 'b2']:
                output = root / signer
                with SessionStore(output, metadata(signer)) as store:
                    for i, label in enumerate(['A', 'B'] if signer.startswith('t') else ['A', 'B', UNKNOWN]):
                        store.append(label, [0]*63, i*1000)
                    store.finish()
                collections.append(output / 'session.jsonl')
            split = {'training_signers': ['t1', 't2'], 'validation_signers': ['v1'],
                     'benchmark_signers': ['b1', 'b2'], 'dataset_license': 'Fixture',
                     'consent_review': 'No participant data'}
            self.assertEqual(export(collections, split, root / 'partitions'),
                             {'training': 4, 'validation': 3, 'benchmark': 6})

    def test_capture_throttles_repeated_keys_and_stops_at_sample_limit(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'session'
            cv = CV([ord(' ')]*3)
            detector = Detector([1]*3)
            ticks = iter([0, 0, .1, .6])
            with SessionStore(output, metadata(), max_samples=2) as store:
                self.assertEqual(capture(cv, MP, detector, store, ['A'], clock=lambda: next(ticks)), 2)
            manifest = json.loads((output / 'session.json').read_text())
            self.assertEqual(manifest['stop_reason'], 'sample_limit')
            self.assertTrue(cv.cap.released and cv.destroyed)

    def test_interrupted_camera_retains_completed_samples_with_explicit_reason(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'session'
            cv = CV([ord(' ')])
            reads = iter([(True, np.zeros((5, 5, 3), dtype=np.uint8)), (False, None)])
            cv.cap.read = lambda: next(reads)
            with SessionStore(output, metadata()) as store:
                self.assertEqual(capture(cv, MP, Detector([1]), store, ['A']), 1)
            self.assertEqual(json.loads((output / 'session.json').read_text())['stop_reason'], 'camera_interrupted')
            self.assertTrue(cv.cap.released and cv.destroyed)

    def test_elapsed_time_limit_finalizes_samples_and_releases_camera(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'session'
            cv = CV([ord(' ')])
            ticks = iter([0, 0, 2])
            with SessionStore(output, metadata()) as store:
                self.assertEqual(capture(cv, MP, Detector([1]), store, ['A'],
                                         clock=lambda: next(ticks), duration_seconds=1), 1)
            self.assertEqual(json.loads((output / 'session.json').read_text())['stop_reason'], 'time_limit')
            self.assertTrue(cv.cap.released and cv.destroyed)


if __name__ == '__main__':
    unittest.main()
