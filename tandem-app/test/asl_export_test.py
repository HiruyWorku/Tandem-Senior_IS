"""Synthetic collection -> split export -> training -> held-out evaluation."""
import hashlib
import contextlib
import io
import json
import pickle
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from asl.export_partitions import export, main, validate_split
from asl.train_reviewed import load_partition, train_partitions
from asl.evaluation import UNKNOWN, validate_benchmark, score_predictions
from asl.features import extract_from_flat


class ExportTest(unittest.TestCase):
    def fixture(self, root):
        split = {'training_signers': ['t1', 't2'], 'validation_signers': ['v1'],
                 'benchmark_signers': ['b1', 'b2'], 'dataset_license': 'Synthetic fixture',
                 'consent_review': 'No participant data'}
        paths = []
        for signer in ['t1', 't2', 'v1', 'b1', 'b2']:
            path = root / (signer + '.jsonl')
            labels = ['A', 'B']*2 if signer.startswith('t') else ['A', 'B', UNKNOWN]
            records = [{'sample_id': signer + '-' + str(i), 'label': label,
                        'landmarks': [j / 100 for j in range(63)]}
                       for i, label in enumerate(labels)]
            path.write_text(''.join(json.dumps(record) + '\n' for record in records))
            self.manifest(path, signer)
            paths.append(path)
        return paths, split

    def manifest(self, path, signer):
        manifest = {'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
                    'signer_id': signer, 'session_id': signer + '-session1',
                    'source': 'Synthetic test', 'license': 'Fixture', 'consent_review': 'No participant data'}
        path.with_suffix('.json').write_text(json.dumps(manifest))

    def test_real_pipeline_preserves_features_and_disjoint_identities(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            paths, split = self.fixture(root)
            output = root / 'export'
            self.assertEqual(export(paths, split, output), {'training': 8, 'validation': 3, 'benchmark': 6})
            train, train_manifest = load_partition(output / 'training.npz', output / 'training.json')
            validate, _ = load_partition(output / 'validation.npz', output / 'validation.json')
            np.testing.assert_array_equal(train['X'][0], extract_from_flat([j/100 for j in range(63)]))
            bundle, _ = train_partitions(train, validate, .8)
            benchmark_manifest = json.loads((output / 'benchmark.json').read_text())
            model_manifest = {**train_manifest, 'sha256': hashlib.sha256(pickle.dumps(bundle)).hexdigest(),
                              'training_signers': ['t1', 't2'], 'validation_signers': ['v1']}
            with np.load(output / 'benchmark.npz', allow_pickle=False) as data:
                self.assertEqual(set(data['session_id']), {'b1-session1', 'b2-session1'})
                X, y, signers = validate_benchmark(data, model_manifest, benchmark_manifest,
                                                  model_manifest['sha256'], benchmark_manifest['sha256'])
            report = score_predictions(bundle['model'].predict_proba(X), bundle['classes'], y, signers, .8)
            self.assertEqual(report['signers'], 2)
            self.assertEqual(output.stat().st_mode & 0o777, 0o700)
            for path in output.iterdir():
                self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            with self.assertRaises(ValueError):
                export(paths, split, output)

    def test_split_provenance_and_missing_signers_fail_before_writing(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            paths, split = self.fixture(root)
            for invalid in [{**split, 'benchmark_signers': ['t1', 'b2']},
                            {**split, 'dataset_license': ''}]:
                with self.assertRaises(ValueError):
                    validate_split(invalid)
            output = root / 'export'
            with self.assertRaises(ValueError):
                export(paths[:-1], split, output)
            self.assertFalse(output.exists())
            manifest = json.loads(paths[0].with_suffix('.json').read_text())
            paths[0].with_suffix('.json').write_text(json.dumps({**manifest, 'sha256': 'wrong'}))
            with self.assertRaises(ValueError):
                export(paths, split, output)
            self.assertFalse(output.exists())

    def test_duplicate_samples_invalid_landmarks_and_large_records_fail(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            paths, split = self.fixture(root)
            original = paths[0].read_text()
            first = json.loads(original.splitlines()[0])
            for invalid in [original + json.dumps(first) + '\n',
                            '[]\n',
                            json.dumps({**first, 'landmarks': [True]*63}) + '\n',
                            json.dumps({**first, 'landmarks': [float('nan')]*63}) + '\n',
                            json.dumps({**first, 'extra': 'x'*17000}) + '\n']:
                paths[0].write_text(invalid)
                self.manifest(paths[0], 't1')
                output = root / 'export'
                with self.assertRaises(ValueError):
                    export(paths, split, output)
                self.assertFalse(output.exists())

    def test_cli_reports_only_counts_and_write_failure_removes_partial_output(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            paths, split = self.fixture(root)
            output = root / 'export'
            with patch('asl.export_partitions.np.savez_compressed', side_effect=OSError('Fixture disk failure')):
                with self.assertRaises(OSError):
                    export(paths, split, output)
            self.assertFalse(output.exists())
            split_path = root / 'split.json'
            split_path.write_text(json.dumps(split))
            argv = ['--split-manifest', str(split_path), '--output', str(output)]
            for path in paths:
                argv.extend(['--collection', str(path)])
            stdout = io.StringIO()
            with contextlib.redirect_stdout(stdout):
                main(argv)
            self.assertEqual(json.loads(stdout.getvalue()), {
                'partition_samples': {'training': 8, 'validation': 3, 'benchmark': 6},
                'production_ready': False})


if __name__ == '__main__':
    unittest.main()
