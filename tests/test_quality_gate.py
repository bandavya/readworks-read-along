"""Offline gate checks with invented text and fake AWS. Run: python -I tests/test_quality_gate.py"""
import importlib.util
import io
import json
import os
from pathlib import Path
import sys
import types
import unittest
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "lambdas/quality_gate"))
spec = importlib.util.spec_from_file_location("quality_gate_handler", ROOT / "lambdas/quality_gate/handler.py")


class FakeS3:
    def __init__(self):
        self.objects = {}
        self.writes = []

    def seed(self, bucket, key, value):
        self.objects[bucket, key] = value if isinstance(value, bytes) else json.dumps(value).encode()

    def get_object(self, Bucket, Key):
        return {"Body": io.BytesIO(self.objects[Bucket, Key])}

    def put_object(self, Bucket, Key, Body, **_kwargs):
        self.objects[Bucket, Key] = Body
        self.writes.append((Bucket, Key))

    def copy_object(self, Bucket, Key, CopySource, **_kwargs):
        self.objects[Bucket, Key] = self.objects[CopySource["Bucket"], CopySource["Key"]]
        self.writes.append((Bucket, Key))

    def json(self, bucket, key):
        return json.loads(self.objects[bucket, key])


class FakeTable:
    def __init__(self):
        self.updates = []
        self.puts = []
        self.item = None

    def get_item(self, **_kwargs):
        return {"Item": self.item} if self.item else {}

    def put_item(self, Item):
        self.puts.append(Item)

    def update_item(self, **kwargs):
        self.updates.append(kwargs)


class FakeTranscribe:
    def __init__(self, s3):
        self.s3 = s3
        self.words = []
        self.status = "COMPLETED"
        self.calls = []

    def start_transcription_job(self, **kwargs):
        self.calls.append(kwargs)
        items = [{"type": "pronunciation", "start_time": str(i * 0.3),
                  "end_time": str(i * 0.3 + 0.2),
                  "alternatives": [{"content": word}]} for i, word in enumerate(self.words)]
        self.s3.seed(kwargs["OutputBucketName"], kwargs["OutputKey"], {"results": {"items": items}})

    def get_transcription_job(self, **_kwargs):
        return {"TranscriptionJob": {"TranscriptionJobStatus": self.status,
                                     "FailureReason": "audio unavailable"}}


class GateTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.s3 = FakeS3()
        cls.table = FakeTable()
        cls.transcribe = FakeTranscribe(cls.s3)
        fake_boto3 = types.SimpleNamespace(
            client=lambda name: {"s3": cls.s3, "transcribe": cls.transcribe}[name],
            resource=lambda name: types.SimpleNamespace(Table=lambda _name: cls.table),
        )
        cls.modules = mock.patch.dict(sys.modules, {"boto3": fake_boto3})
        cls.modules.start()
        cls.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.module)

    @classmethod
    def tearDownClass(cls):
        cls.modules.stop()

    def setUp(self):
        self.s3.objects.clear()
        self.s3.writes.clear()
        self.table.updates.clear()
        self.table.puts.clear()
        self.table.item = None
        self.transcribe.calls.clear()
        self.transcribe.status = "COMPLETED"
        self.s3.seed("content", "config/names.json", {"names": []})
        self.event = {"passageId": "made-up-01", "textHash": "sha256:example",
                      "audioTaskId": "polly-task-example", "pollyAudioKey": "polly/take.mp3",
                      "language": "en-US"}

    def run_gate(self, written, heard):
        self.event["rawText"] = written
        self.transcribe.words = heard.split()
        with mock.patch.dict(os.environ, {"AUDIO_BUCKET": "audio", "CONTENT_BUCKET": "content",
                                       "JOB_TABLE": "jobs"}):
            started = self.module.start(self.event, None)
            return self.module.check(started, None)

    def assert_hold(self, result, phrase):
        self.assertFalse(result["qualityGatePassed"])
        self.assertIn(phrase, " ".join(result["holdReasons"]))
        self.assertEqual(self.table.updates[-1]["ExpressionAttributeValues"][":held"], "held")
        self.assertEqual(self.s3.json("content", "review/made-up-01.json")["status"], "held")

    def test_clean_pass(self):
        result = self.run_gate("The fox ran home.", "The fox ran home")
        self.assertTrue(result["qualityGatePassed"])
        self.assertEqual(self.transcribe.calls[0]["Media"]["MediaFileUri"], "s3://audio/polly/take.mp3")
        self.assertEqual(self.s3.writes, [])

    def test_swapped_word(self):
        self.assert_hold(self.run_gate("The fox ran home.", "The bear ran home"), "fox")

    def test_dropped_sentence(self):
        self.assert_hold(self.run_gate("The fox ran home. It slept.", "The fox ran home"), "It slept")

    def test_extra_phrase(self):
        self.assert_hold(self.run_gate("The fox ran home.", "The fox really quickly ran home"), "really quickly")

    def test_listed_name(self):
        self.s3.seed("content", "config/names.json", {"names": [
            {"written": "Mira", "heard_as": ["Meera"], "scope": "made-up-01"}]})
        result = self.run_gate("Mira ran home.", "Meera ran home")
        self.assertTrue(result["qualityGatePassed"])
        self.assertEqual(self.s3.writes, [])

    def test_number_spoken_as_words(self):
        result = self.run_gate("12 birds flew.", "Twelve birds flew")
        self.assertTrue(result["qualityGatePassed"])

    def test_hold_preserves_existing_reader_voice(self):
        old = {"voices": [{"id": "generated", "audio": "audio/older.mp3"}]}
        self.s3.seed("site", "data/made-up-01.json", old)
        self.assert_hold(self.run_gate("The fox ran home.", "The bear ran home"), "fox")
        self.assertEqual(self.s3.json("site", "data/made-up-01.json"), old)
        self.assertFalse(any(bucket == "site" for bucket, _ in self.s3.writes))

    def test_transcription_failure_holds(self):
        self.transcribe.status = "FAILED"
        self.assert_hold(self.run_gate("The fox ran home.", ""), "audio unavailable")

    def test_cache_requires_prior_voice_check(self):
        self.table.item = {"status": "approved"}  # legacy worker result
        self.event["charCount"] = 10
        with mock.patch.dict(os.environ, {"JOB_TABLE": "jobs", "VOICE_ID": "Joanna", "ENGINE": "neural"}):
            result = self.module.check_existing_manifest(self.event, None)
        self.assertFalse(result["cached"])
        self.assertEqual(self.table.puts[-1]["status"], "running")

    def test_finished_passage_is_reused_and_never_breaks_the_workflow(self):
        self.table.item = {"status": "generated", "readerPublishedAt": "2026-11-04T12:00:00Z",
                           "audioKey": "audio/a.mp3", "speechMarksKey": "audio/a.json"}
        self.event["charCount"] = 10
        with mock.patch.dict(os.environ, {"JOB_TABLE": "jobs", "VOICE_ID": "Joanna", "ENGINE": "neural"}):
            result = self.module.check_existing_manifest(self.event, None)
        self.assertTrue(result["cached"])
        self.assertIs(result["readerNeedsPublish"], False)

    def test_checked_passage_the_reader_missed_is_sent_again(self):
        self.table.item = {"status": "reader_publish_failed", "audioKey": "audio/a.mp3", "speechMarksKey": "audio/a.json"}
        self.event["charCount"] = 10
        with mock.patch.dict(os.environ, {"JOB_TABLE": "jobs", "VOICE_ID": "Joanna", "ENGINE": "neural"}):
            result = self.module.check_existing_manifest(self.event, None)
        self.assertTrue(result["readerNeedsPublish"])
        self.assertEqual(result["pollyMarksKey"], "audio/a.json")

    def test_gated_manifest_uses_polly_marks(self):
        self.s3.seed("audio", "polly/take.mp3", b"made-up-audio")
        self.event.update({"qualityGatePassed": True, "audioId": "made-up-audio",
                           "audioKey": "audio/made-up-audio.mp3", "speechMarksKey": "audio/made-up-audio.speechmarks.json",
                           "speechMarks": [{"type": "word", "time": 100, "value": "fox"}],
                           "voiceId": "Joanna", "engine": "neural", "charCount": 10})
        with mock.patch.dict(os.environ, {"AUDIO_BUCKET": "audio", "CONTENT_BUCKET": "content", "JOB_TABLE": "jobs"}):
            result = self.module.write_manifest(self.event, None)
        self.assertEqual(result["manifest"]["status"], "generated")
        self.assertEqual(self.table.puts[-1]["status"], "generated")
        self.assertEqual(self.s3.json("audio", self.event["speechMarksKey"]), self.event["speechMarks"])


if __name__ == "__main__":
    unittest.main()
