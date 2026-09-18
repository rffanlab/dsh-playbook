"""Actual filesystem and FFmpeg fixtures; not a live-model production test."""
import copy
import hashlib
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
import unittest
import uuid
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'src'))
import media_worker as media
import media_worker_test as fixtures
# Execute only shipped definitions, exactly as the Host assembles them, without the CLI.
space = dict(vars(media), __name__='delivery_fixture')
exec(compile((Path(__file__).resolve().parents[1]/'src/delivery_worker.py').read_text(), 'delivery_worker.py', 'exec'), space)
deliver=space['delivery_main']

class DeliveryFilesTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        fixtures.MediaTests.setUpClass()
    @classmethod
    def tearDownClass(cls):
        fixtures.MediaTests.tearDownClass()
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='delivery-files-')
        self.workspace=Path(self.temp.name)
        self.cwd=Path.cwd(); os.chdir(self.workspace)
        key=str(uuid.uuid4())
        self.owner={'protocol':1,'key':key,'runId':'synthetic:'+key,'sessionId':'s','workspace':str(self.workspace),'root':str(self.workspace/'.dsh-runs'/key)}
        prepared=media.prepare_workspace(self.owner)
        self.owner.update(prepared=True,realRoot=prepared['root'],markerSha256=prepared['markerSha256'],createdAtMs=prepared['createdAtMs'])
        self.root=Path(prepared['root']);os.chdir(self.root)
        for name in ['narration.txt','title.md','captions.srt','s1.wav','s2.wav','final.mp4','pilot.mp4','cover.png']:
            shutil.copyfile(fixtures.MediaTests.root/name,self.root/name)
        (self.root/'production.json').write_text(json.dumps(fixtures.MediaTests.manifest,ensure_ascii=False))
        self.qa=media.validate({'kind':'video','manifest':'production.json','isolation':self.owner},self.root)
        self.assertTrue(self.qa['passed'],self.qa)
        self.request={'mode':'bundle','runId':self.owner['runId'],'isolation':self.owner,'deliveryId':str(uuid.uuid4()),
            'candidateKey':'a'*64,'revision':0,'manifestPath':str(self.root/'production.json'),'bindings':self.qa['bindings'],
            'artifactIds':{p:'artifact-'+hashlib.sha256(p.encode()).hexdigest() for p in self.qa['bindings']},
            'video':self.qa['video']['binding'],'systemReport':'Synthetic validation report; no speech or authorship claim.'}
    def tearDown(self):
        os.chdir(self.cwd)
        for path in self.workspace.rglob('*'):
            if not path.is_symlink():path.chmod(0o700 if path.is_dir() else 0o600)
        self.temp.cleanup()
    def test_real_QA_video_snapshot_and_source_overwrite(self):
        out=deliver(self.request);self.assertTrue(out['passed'],out)
        video=next(f for f in out['files'] if f['role']=='video')
        self.assertEqual(hashlib.sha256(Path(video['path']).read_bytes()).hexdigest(),self.qa['video']['binding']['sha256'])
        self.assertNotEqual(video['path'],video['sourcePath'])
        (self.root/'final.mp4').write_bytes(b'overwritten old file')
        self.assertTrue(deliver({'mode':'verify','runId':self.owner['runId'],'isolation':self.owner,'files':out['files']})['passed'])
        self.assertFalse(out['creationAttested'])
    def test_changed_file_and_manifest_are_rejected(self):
        (self.root/'final.mp4').write_bytes(b'something else')
        self.assertIn('DELIVERY_BYTES_CHANGED',deliver(self.request)['error'])
        (self.root/'production.json').write_text('{}')
        self.assertIn('DELIVERY_BYTES_CHANGED',deliver(self.request)['error'])
    def test_known_previous_hash_is_rejected_even_with_valid_media(self):
        self.request['excludedVideoDigests']=[self.qa['video']['binding']['sha256']]
        out=deliver(self.request);self.assertFalse(out['passed']);self.assertIn('CROSS_RUN_DUPLICATE',out['error'])
    def test_symlink_and_hardlink_substitution_fail(self):
        original=self.root/'final.mp4';original.unlink()
        original.symlink_to(fixtures.MediaTests.root/'final.mp4')
        self.assertIn('SYMLINK',deliver(self.request)['error'])
        original.unlink();os.link(fixtures.MediaTests.root/'final.mp4',original)
        self.assertIn('HARDLINK',deliver(self.request)['error'])
    def test_existing_snapshot_directory_is_not_overwritten(self):
        self.assertTrue(deliver(self.request)['passed'])
        self.assertFalse(deliver(self.request)['passed'])
    def test_foreign_manifest_and_auxiliary_file_are_rejected(self):
        self.request['extraPaths']=[str(fixtures.MediaTests.root/'title.md')]
        self.assertIn('CROSS_RUN_PATH',deliver(self.request)['error'])
        self.request.pop('extraPaths');self.request['manifestPath']=str(fixtures.MediaTests.root/'production.json')
        self.assertFalse(deliver(self.request)['passed'])
    def test_tampered_delivered_bytes_do_not_satisfy_snapshot_receipt(self):
        out=deliver(self.request);video=next(f for f in out['files'] if f['role']=='video')
        path=Path(video['path']);path.chmod(0o600);path.write_bytes(b'tampered')
        result=deliver({'mode':'verify','runId':self.owner['runId'],'isolation':self.owner,'files':out['files']})
        self.assertIn('DELIVERY_BYTES_CHANGED',result['error'])
    def test_empty_failed_build_leftover_has_no_valid_post_probe(self):
        p=self.root/'failed.mp4';p.write_bytes(b'')
        result=deliver({'mode':'probe','runId':self.owner['runId'],'isolation':self.owner,'paths':[str(p)],'allowMissing':False})
        self.assertFalse(result['passed'])
