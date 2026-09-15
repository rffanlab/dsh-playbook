"""Real files with original failure shapes; no execution of user-supplied scripts."""
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
import uuid
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src'))
import media_worker as worker


class ManifestBaseTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='dsh-path-')
        self.old = Path.cwd()
        self.workspace = Path(self.tmp.name)
        os.chdir(self.workspace)
        key = str(uuid.uuid4())
        self.own = {'protocol': 1, 'runId': 'run:' + key, 'sessionId': 'fixture', 'key': key,
                    'workspace': str(self.workspace), 'root': str(self.workspace / '.dsh-runs' / key)}
        receipt = worker.prepare_workspace(self.own)
        self.own.update(prepared=True, realRoot=receipt['root'], markerSha256=receipt['markerSha256'], createdAtMs=receipt['createdAtMs'])
        self.root = Path(receipt['root'])
        self.make(self.root / 'work')

    def tearDown(self):
        os.chdir(self.old)
        self.tmp.cleanup()

    def make(self, directory):
        directory.mkdir(exist_ok=True, parents=True)
        (directory / 'script.txt').write_text('完整口播没有省略。', encoding='utf-8')
        (directory / 'production.json').write_text(json.dumps({'schemaVersion': 1, 'script': 'script.txt',
            'segments': [{'id': 'one', 'text': '完整口播没有省略。'}]}), encoding='utf-8')

    def test_actual_same_file_accepts_absolute_workspace_and_run_notations(self):
        for name in [str(self.root / 'work/production.json'), 'work/production.json',
                     '.dsh-runs/' + self.own['key'] + '/work/production.json',
                     './.dsh-runs/' + self.own['key'] + '/work/production.json']:
            result = worker.validate({'kind': 'narration', 'manifest': name, 'isolation': self.own}, self.root)
            self.assertTrue(result['passed'], result)
            self.assertEqual(result['manifestPath'], str(self.root / 'work/production.json'))

    def test_another_run_name_is_rejected_even_if_a_nested_lookalike_file_exists(self):
        # No probing alternative directories to make a path pass.
        self.make(self.root / '.dsh-runs/foreign/work')
        result = worker.validate({'kind': 'narration', 'manifest': '.dsh-runs/foreign/work/production.json', 'isolation': self.own}, self.root)
        self.assertFalse(result['passed'])
        self.assertIn('CROSS_RUN_PATH', ' '.join(result['failures']))

    def test_absent_file_and_wrong_narration_are_not_fixed_by_renaming(self):
        missing = worker.validate({'kind': 'narration', 'manifest': 'missing.json', 'isolation': self.own}, self.root)
        self.assertFalse(missing['passed'])
        (self.root / 'work/script.txt').write_text('This is a different complete script.')
        wrong = worker.validate({'kind': 'narration', 'manifest': '.dsh-runs/' + self.own['key'] + '/work/production.json', 'isolation': self.own}, self.root)
        self.assertFalse(wrong['passed'])
        self.assertIn('NARRATION_COVERAGE', ' '.join(wrong['failures']))

    def test_legacy_scope_preserves_same_run_files_without_fresh_origin_attestation(self):
        legacy = self.workspace / 'episode-v2'
        self.make(legacy)
        scope = {'mode': 'legacy-same-run', 'runId': 'legacy-run', 'workspace': str(self.workspace),
                 'allowedRoots': [str(legacy)], 'allowedFiles': [], 'independentRun': False, 'creationAttested': False}
        request = {'kind': 'narration', 'manifest': str(legacy / 'production.json'), 'legacyScope': scope}
        result = worker.validate(request, self.workspace)
        self.assertTrue(result['passed'], result)
        self.assertFalse(result['legacyContinuation']['independentRun'])
        self.assertNotIn('ownership', result)
        self.make(legacy / 'v3')
        result = worker.validate({**request, 'manifest': str(legacy / 'v3/production.json')}, self.workspace)
        self.assertTrue(result['passed'], result)
        self.assertTrue((legacy / 'production.json').exists())

    def test_legacy_scope_cannot_read_unrelated_or_managed_outputs(self):
        legacy = self.workspace / 'episode-v2'
        self.make(legacy)
        scope = {'mode': 'legacy-same-run', 'runId': 'legacy-run', 'workspace': str(self.workspace),
                 'allowedRoots': [str(legacy)], 'allowedFiles': [], 'independentRun': False, 'creationAttested': False}
        other = self.workspace / 'another-project'
        self.make(other)
        for p in [other / 'production.json', self.root / 'work/production.json']:
            result = worker.validate({'kind': 'narration', 'manifest': str(p), 'legacyScope': scope}, self.workspace)
            self.assertFalse(result['passed'], result)

    def test_legacy_allowlist_cannot_be_mixed_with_new_owned_run(self):
        scope = {'mode': 'legacy-same-run', 'runId': 'legacy-run'}
        result = worker.validate({'kind': 'narration', 'manifest': 'work/production.json', 'isolation': self.own, 'legacyScope': scope}, self.root)
        self.assertFalse(result['passed'])
