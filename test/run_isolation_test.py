"""Actual filesystem/decoder checks; fixtures are synthetic, never a model benchmark."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
import time
import unittest
import uuid
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src'))
import media_worker as worker
import media_worker_test as media_fixture


class RunIsolationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        media_fixture.MediaTests.setUpClass()

    @classmethod
    def tearDownClass(cls):
        media_fixture.MediaTests.tearDownClass()

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='playbook-isolation-test-')
        self.workspace = Path(self.tmp.name)
        self.cwd = Path.cwd()
        os.chdir(self.workspace)
        key = str(uuid.uuid4())
        self.own = {'protocol': 1, 'runId': 'synthetic:' + key, 'sessionId': 's', 'key': key,
                    'workspace': str(self.workspace), 'root': str(self.workspace / '.dsh-runs' / key)}
        receipt = worker.prepare_workspace(self.own)
        self.own.update(prepared=True, realRoot=receipt['root'], markerSha256=receipt['markerSha256'], createdAtMs=receipt['createdAtMs'])
        self.root = Path(receipt['root'])

    def tearDown(self):
        os.chdir(self.cwd)
        self.tmp.cleanup()

    def narration(self, source='brief/narration.txt'):
        (self.root / 'brief/narration.txt').write_text('完整口播。', encoding='utf-8')
        manifest = {'schemaVersion': 1, 'script': source, 'segments': [{'id': 's', 'text': '完整口播。'}]}
        (self.root / 'production.json').write_text(json.dumps(manifest), encoding='utf-8')
        return worker.validate({'kind': 'narration', 'manifest': str(self.root / 'production.json'), 'isolation': self.own}, self.root)

    def test_fresh_allocation_is_idempotent_only_for_same_identity(self):
        result = worker.prepare_workspace(self.own)
        self.assertEqual(result['markerSha256'], self.own['markerSha256'])
        self.assertTrue(all((self.root / name).is_dir() for name in ['brief', 'work', 'evidence', 'artifacts', 'final']))
        other = dict(self.own, runId='another-run')
        with self.assertRaises(worker.Invalid):
            worker.prepare_workspace(other)

    def test_nonempty_arbitrary_root_is_never_adopted(self):
        key = str(uuid.uuid4())
        root = self.workspace / '.dsh-runs' / key
        root.mkdir()
        (root / 'final.mp4').write_bytes(b'old candidate')
        with self.assertRaises(worker.Invalid):
            worker.prepare_workspace(dict(self.own, key=key, root=str(root)))

    def test_current_full_narration_reports_real_host_owner(self):
        result = self.narration()
        self.assertTrue(result['passed'], result)
        self.assertEqual(result['ownership']['runId'], self.own['runId'])
        self.assertTrue(all(b['runId'] == self.own['runId'] for b in result['bindings'].values()))

    def test_old_workspace_manifest_passes_legacy_check_but_not_isolated_check(self):
        (self.workspace / 'old.txt').write_text('完整口播。', encoding='utf-8')
        (self.workspace / 'old.json').write_text(json.dumps({'schemaVersion': 1, 'script': 'old.txt', 'segments': [{'id': 's', 'text': '完整口播。'}]}))
        request = {'kind': 'narration', 'manifest': str(self.workspace / 'old.json')}
        self.assertTrue(worker.validate(request, self.workspace)['passed'])
        result = worker.validate({**request, 'isolation': self.own}, self.root)
        self.assertFalse(result['passed'])
        self.assertIn('CROSS_RUN_PATH', ' '.join(result['failures']))

    def test_foreign_script_under_same_session_workspace_is_rejected(self):
        (self.workspace / 'old-script.txt').write_text('完整口播。')
        result = self.narration(str(self.workspace / 'old-script.txt'))
        self.assertFalse(result['passed'])
        self.assertIn('CROSS_RUN_PATH', ' '.join(result['failures']))

    def test_relative_parent_escape_is_rejected(self):
        result = self.narration('../old-script.txt')
        self.assertFalse(result['passed'])
        self.assertIn('RUN_PATH_TRAVERSAL', ' '.join(result['failures']))

    def test_symlink_and_hardlink_are_not_fresh_outputs(self):
        old = self.workspace / 'old.txt'
        old.write_text('完整口播。')
        (self.root / 'linked.txt').symlink_to(old)
        result = self.narration('linked.txt')
        self.assertIn('RUN_SYMLINK', ' '.join(result['failures']))
        (self.root / 'linked.txt').unlink()
        os.link(old, self.root / 'linked.txt')
        result = self.narration('linked.txt')
        self.assertIn('RUN_HARDLINK', ' '.join(result['failures']))

    def test_changed_model_sidecar_does_not_reassign_the_run(self):
        marker = self.root / '.dsh-run.json'
        data = json.loads(marker.read_text())
        data['runId'] = 'renamed-by-model'
        marker.write_text(json.dumps(data))
        result = self.narration()
        self.assertFalse(result['passed'])
        self.assertIn('RUN_MARKER_CHANGED', ' '.join(result['failures']))

    def test_preserved_old_mtime_is_a_rejection_not_a_creation_attestation(self):
        self.narration()
        source = self.root / 'brief/narration.txt'
        os.utime(source, (time.time() - 86400, time.time() - 86400))
        result = worker.validate({'kind': 'narration', 'manifest': 'production.json', 'isolation': self.own}, self.root)
        self.assertFalse(result['passed'])
        self.assertIn('ARTIFACT_PREDATES_RUN', ' '.join(result['failures']))

    def test_full_media_decode_within_run_and_foreign_video_rejection(self):
        source = media_fixture.MediaTests.root
        files = ['narration.txt', 'title.md', 'captions.srt', 's1.wav', 's2.wav', 'final.mp4', 'pilot.mp4', 'cover.png']
        for name in files:
            shutil.copyfile(source / name, self.root / name)
        manifest = dict(media_fixture.MediaTests.manifest)
        (self.root / 'production.json').write_text(json.dumps(manifest), encoding='utf-8')
        request = {'kind': 'video', 'manifest': 'production.json', 'isolation': self.own}
        result = worker.validate(request, self.root)
        self.assertTrue(result['passed'], result)
        self.assertFalse(result['semanticVerification'])
        # Technical validation cannot tell an unknown copy from new bytes. Engine hash history handles known duplicates.
        self.assertEqual(result['video']['binding']['sha256'], hashlib.sha256((source / 'final.mp4').read_bytes()).hexdigest())
        manifest['video'] = str(source / 'final.mp4')
        (self.root / 'production.json').write_text(json.dumps(manifest), encoding='utf-8')
        result = worker.validate(request, self.root)
        self.assertFalse(result['passed'])
        self.assertIn('CROSS_RUN_PATH', ' '.join(result['failures']))
