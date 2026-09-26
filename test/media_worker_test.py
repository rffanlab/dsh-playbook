"""Real FFmpeg tests, synthetic tones are NOT speech-accuracy tests."""
import copy
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src'))
import media_worker as worker


class MediaTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not shutil.which('ffmpeg') or not shutil.which('ffprobe'):
            raise RuntimeError('ffmpeg and ffprobe are required: media tests must not silently skip')
        cls.temp = tempfile.TemporaryDirectory(prefix='playbook-media-test-')
        cls.root = Path(cls.temp.name)
        def ff(*args):
            subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', *args], check=True,
                           stdin=subprocess.DEVNULL, capture_output=True, timeout=30)
        cls.ff = staticmethod(ff)
        for i, frequency in enumerate([440, 660], 1):
            ff('-f', 'lavfi', '-i', 'sine=frequency=%s:duration=2' % frequency, str(cls.root / ('s%d.wav' % i)))
        ff('-f', 'lavfi', '-i', 'color=c=black:s=160x90:r=5:d=4', '-i', str(cls.root/'s1.wav'), '-i', str(cls.root/'s2.wav'),
           '-filter_complex', '[1:a][2:a]concat=n=2:v=0:a=1[a]', '-map', '0:v', '-map', '[a]',
           '-c:v', 'libx264', '-threads', '1', '-c:a', 'aac', '-t', '4', str(cls.root/'final.mp4'))
        ff('-f', 'lavfi', '-i', 'color=c=black:s=160x90:r=5:d=2', '-i', str(cls.root/'s1.wav'),
           '-c:v', 'libx264', '-threads', '1', '-c:a', 'aac', '-t', '2', str(cls.root/'pilot.mp4'))
        ff('-f', 'lavfi', '-i', 'color=c=black:s=160x90:r=5:d=4', '-f', 'lavfi', '-i', 'anullsrc=r=16000:cl=mono',
           '-c:v', 'libx264', '-threads', '1', '-c:a', 'aac', '-t', '4', str(cls.root/'silent.mp4'))
        ff('-f', 'lavfi', '-i', 'color=c=black:s=160x90:r=5:d=6', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.3',
           '-af', 'apad', '-c:v', 'libx264', '-threads', '1', '-c:a', 'aac', '-t', '6', str(cls.root/'beep-and-hold.mp4'))
        ff('-f', 'lavfi', '-i', 'color=c=black:s=160x90:r=5:d=2', '-an', '-c:v', 'libx264', '-threads', '1', str(cls.root/'no-audio.mp4'))
        ff('-f', 'lavfi', '-i', 'color=c=black:s=160x90', '-frames:v', '1', '-threads', '1', str(cls.root/'cover.png'))
        (cls.root/'narration.txt').write_text('第一段完整句子。\n第二段完整句子。',encoding='utf-8')
        (cls.root/'title.md').write_text('Synthetic technical fixture; no speech claim.',encoding='utf-8')
        (cls.root/'captions.srt').write_text('1\n00:00:00,000 --> 00:00:02,000\n第一段完整句子。\n\n2\n00:00:02,000 --> 00:00:04,000\n第二段完整句子。\n',encoding='utf-8')
        cls.manifest = {'schemaVersion':1, 'script':'narration.txt',
          'segments':[{'id':'S01','text':'第一段完整句子。','audio':'s1.wav','start':0,'end':2},
                      {'id':'S02','text':'第二段完整句子。','audio':'s2.wav','start':2,'end':4}],
          'pilotVideo':'pilot.mp4','video':'final.mp4','cover':'cover.png','title':'title.md','subtitles':'captions.srt',
          'durationSeconds':4,'coverForVideoSha256':hashlib.sha256((cls.root/'final.mp4').read_bytes()).hexdigest()}

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def check(self, kind, change=None):
        manifest=copy.deepcopy(self.manifest)
        if change:
            change(manifest)
        (self.root/'production.json').write_text(json.dumps(manifest,ensure_ascii=False),encoding='utf-8')
        return worker.validate({'kind':kind,'manifest':'production.json'},self.root)

    def test_complete_text_maps_and_unicode_whitespace_normalize(self):
        result=self.check('narration')
        self.assertTrue(result['passed'],result)
        self.assertEqual(result['coverage']['segmentCount'],2)
        self.assertFalse(result['speechRecognition'])

    def test_summary_instead_of_full_script_is_rejected(self):
        result=self.check('narration',lambda m:m['segments'][0].update(text='第一段...'))
        self.assertFalse(result['passed']); self.assertIn('NARRATION_COVERAGE',' '.join(result['failures']))

    def test_missing_or_repeated_segment_is_rejected(self):
        self.assertFalse(self.check('narration',lambda m:m['segments'].pop())['passed'])
        self.assertFalse(self.check('narration',lambda m:m['segments'][1].update(id='S01'))['passed'])

    def test_real_pilot_and_full_decode_pass_technical_only(self):
        self.assertTrue(self.check('pilot')['passed'])
        result=self.check('video')
        self.assertTrue(result['passed'],result)
        self.assertTrue(result['subtitles']['scriptCoverage']);self.assertFalse(result['semanticVerification'])
        self.assertIn(str(self.root/'final.mp4'),result['bindings'])


    def test_segment_timing_compat_alias_is_accepted_without_rewriting_source(self):
        def change(m):
            timing = {}
            for segment in m['segments']:
                timing[segment['id']] = {k: segment[k] for k in ['audio','start','end']}
                for key in ['audio','start','end']:
                    segment.pop(key)
            m['segmentTiming'] = timing
        result = self.check('video', change)
        self.assertTrue(result['passed'], result)
        self.assertTrue(result['manifestNormalization']['applied'])
        self.assertEqual(result['manifestNormalization']['source'], 'segmentTiming')
        self.assertEqual(result['manifestNormalization']['copiedFieldCount'], 6)

    def test_missing_segment_audio_names_exact_manifest_field(self):
        result = self.check('video', lambda m: m['segments'][1].pop('audio'))
        self.assertFalse(result['passed'])
        self.assertEqual(result['diagnostic']['code'], 'MANIFEST_PATH_REQUIRED')
        self.assertEqual(result['diagnostic']['path'], 'segments[1].audio')
        self.assertIn('segmentTiming', result['diagnostic']['hint'])
        self.assertNotEqual(result['failures'][0], 'A non-empty local path is required')

    def test_segment_duration_error_reports_id_numbers_and_smallest_fix(self):
        result = self.check('video', lambda m: m['segments'][1].update(end=3.2))
        self.assertFalse(result['passed'])
        self.assertEqual(result['diagnostic']['code'], 'MANIFEST_SEGMENT_DURATION')
        self.assertEqual(result['diagnostic']['path'], 'segments[1].start/end')
        self.assertIn('S02', result['failures'][0])
        self.assertIn('measured source audio', result['failures'][0])
        self.assertTrue(result['diagnostic']['doNotRepeatUnchangedRead'])

    def test_audio_stream_present_but_all_zero_is_rejected(self):
        result=self.check('video',lambda m:m.update(video='silent.mp4',coverForVideoSha256=hashlib.sha256((self.root/'silent.mp4').read_bytes()).hexdigest()))
        self.assertFalse(result['passed']);self.assertTrue(result['video']['audio']['allZero'])

    def test_one_beep_is_not_narration_coverage(self):
        reader=worker.Reader(self.root); value=worker.media(reader,'beep-and-hold.mp4',self.root)
        self.assertFalse(value['audio']['allZero']);self.assertGreater(value['audio']['longestLowSeconds'],5)
        self.assertTrue(worker.audio_failures(value,'fixture'))

    def test_missing_audio_track_fails(self):
        with self.assertRaises(worker.Invalid):worker.media(worker.Reader(self.root),'no-audio.mp4',self.root)

    def test_reused_audio_for_different_text_fails(self):
        result=self.check('video',lambda m:m['segments'][1].update(audio='s1.wav'))
        self.assertFalse(result['passed']);self.assertIn('Duplicate audio',' '.join(result['failures']))

    def test_stale_duration_and_cover_binding_fail(self):
        self.assertFalse(self.check('video',lambda m:m.update(durationSeconds=73.8))['passed'])
        self.assertFalse(self.check('video',lambda m:m.update(coverForVideoSha256='old-video'))['passed'])

    def test_subtitle_missing_text_or_out_of_range_fails(self):
        with self.assertRaises(worker.Invalid):worker.subtitle_check('1\n00:00:00,000 --> 00:00:02,000\n摘要...\n',4,'完整讲解')
        with self.assertRaises(worker.Invalid):worker.subtitle_check('1\n00:00:00,000 --> 00:00:20,000\n文字\n',4,'文字')

    def test_missing_file_is_repairable_failure_not_permission_block(self):
        result=self.check('narration',lambda m:m.update(script='missing.txt'))
        self.assertFalse(result['passed']);self.assertEqual(result['status'],'fail')

    def test_realpath_blocks_symlink_escape_and_urls(self):
        with tempfile.TemporaryDirectory() as outside:
            p=Path(outside)/'secret.txt';p.write_text('not in the session workspace')
            link=self.root/'outside.txt';link.symlink_to(p)
            try:
                result=self.check('narration',lambda m:m.update(script='outside.txt'))
                self.assertFalse(result['passed']);self.assertIn('escapes',' '.join(result['failures']))
            finally:link.unlink()
        result=self.check('narration',lambda m:m.update(script='https://example.com/a.txt'))
        self.assertFalse(result['passed'])

    def test_fake_pass_flags_do_not_override_machine_facts(self):
        result=self.check('narration',lambda m:(m.update(passed=True,release_ready=True),m['segments'][0].update(text='假的...')))
        self.assertFalse(result['passed'])
