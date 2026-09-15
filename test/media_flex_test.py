"""True decoder/cache tests plus narration-overlay contracts; no real model benchmark."""
import copy
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src'))
import media_worker as worker
import media_worker_test as fixture


class FlexMediaTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        fixture.MediaTests.setUpClass()
        cls.root = fixture.MediaTests.root
        cls.manifest = copy.deepcopy(fixture.MediaTests.manifest)

    @classmethod
    def tearDownClass(cls):
        fixture.MediaTests.tearDownClass()

    def setUp(self):
        (self.root/'production.json').write_text(json.dumps(self.manifest),encoding='utf-8')
        (self.root/'captions.srt').write_text('1\n00:00:00,000 --> 00:00:02,000\n第一段完整句子。\n\n2\n00:00:02,000 --> 00:00:04,000\n第二段完整句子。\n',encoding='utf-8')

    def qa(self):
        result=worker.validate({'kind':'video','manifest':'production.json'},self.root)
        self.assertTrue(result['passed'],result)
        return result

    def test_display_punctuation_does_not_force_speech_regeneration(self):
        subs='1\n00:00:00,000 --> 00:00:04,000\n第一段完整句子\n第二段完整句子\n'
        result=worker.subtitle_check(subs,4,'“第一段完整句子。”\n第二段完整句子。')
        self.assertTrue(result['scriptCoverage'])
        self.assertTrue(result['punctuationNormalized'])

    def test_numerals_decimal_sign_and_words_are_not_relaxed(self):
        for expected,actual in [('速度1.5','速度15'),('温度-5','温度5'),('比例15%','比例15'),('不要放弃工作','放弃工作')]:
            with self.assertRaises(worker.Invalid):
                worker.subtitle_check('1\n00:00:00,000 --> 00:00:02,000\n'+actual,2,expected)

    def test_ass_quote_overlay_may_overlap_complete_narration(self):
        subs='[Events]\nFormat: Layer, Start, End, Style, Text\nDialogue: 0,0:00:00.00,0:00:02.00,Txt,第一段完整句子\nDialogue: 1,0:00:00.50,0:00:03.50,Quote,一条原文引用，不代替口播\nDialogue: 0,0:00:02.00,0:00:04.00,Txt,第二段完整句子\n'
        result=worker.subtitle_check(subs,4,'第一段完整句子。第二段完整句子。','ass',['Txt'])
        self.assertEqual(result['ignoredOverlayEvents'],1)
        self.assertTrue(result['scriptCoverage'])
        (self.root/'captions.ass').write_text(subs,encoding='utf-8')
        manifest={**self.manifest,'subtitles':{'path':'captions.ass','format':'ass','narrationStyles':['Txt']}}
        (self.root/'production.json').write_text(json.dumps(manifest),encoding='utf-8')
        self.assertTrue(self.qa()['subtitles']['scriptCoverage'])

    def test_ass_cannot_hide_missing_speech_with_style_selection(self):
        subs='[Events]\nFormat: Layer, Start, End, Style, Text\nDialogue: 0,0:00:00.00,0:00:02.00,Txt,第一段完整句子\n'
        with self.assertRaises(worker.Invalid):worker.subtitle_check(subs,4,'第一段完整句子。第二段完整句子。','ass',['Txt'])

    def test_handoff_rehashes_identical_media_without_redecoding(self):
        before=self.qa()
        with patch.object(worker,'media',side_effect=AssertionError('unchanged bytes must not be decoded twice')):
            after=worker.validate({'kind':'handoff','manifest':'production.json','previousQa':before},self.root)
        self.assertTrue(after['passed'],after)
        self.assertFalse(after['cache']['decodedAgain'])
        self.assertEqual(after['video']['binding']['sha256'],before['video']['binding']['sha256'])

    def test_report_metadata_does_not_stale_unchanged_media(self):
        before=self.qa()
        manifest={**self.manifest,'internal_report':'new report metadata'}
        (self.root/'production.json').write_text(json.dumps(manifest),encoding='utf-8')
        after=worker.validate({'kind':'handoff','manifest':'production.json','previousQa':before},self.root)
        self.assertTrue(after['passed'],after)

    def test_hash_cache_never_accepts_changed_artifact_or_timeline(self):
        before=self.qa()
        original=(self.root/'title.md').read_bytes()
        try:
            (self.root/'title.md').write_bytes(original+b'changed title')
            after=worker.validate({'kind':'handoff','manifest':'production.json','previousQa':before},self.root)
            self.assertFalse(after['passed']);self.assertIn('QA_STALE',' '.join(after['failures']))
        finally:(self.root/'title.md').write_bytes(original)
        modified=copy.deepcopy(self.manifest);modified['segments'][1]['start']=2.5
        (self.root/'production.json').write_text(json.dumps(modified),encoding='utf-8')
        self.assertFalse(worker.validate({'kind':'handoff','manifest':'production.json','previousQa':before},self.root)['passed'])

    def test_diagnosis_measures_recorded_video_without_a_complete_manifest(self):
        result=worker.validate({'kind':'diagnose','video':'silent.mp4'},self.root)
        self.assertTrue(result['notAGate']);self.assertFalse(result['passed'])
        self.assertTrue(result['video']['audio']['allZero'])
        self.assertFalse(result['speechRecognition'])
