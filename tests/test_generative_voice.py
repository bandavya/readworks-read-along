"""Offline checks for the generative-voice mode with invented text and fake AWS. Run: python -I tests/test_generative_voice.py"""
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import types
import unittest
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
ENV = {"VOICE_ID": "Ruth", "ENGINE": "generative", "AUDIO_BUCKET": "audio", "CONTENT_BUCKET": "content",
       "JOB_TABLE": "jobs"}


class FakeS3:
    def __init__(self):
        self.objects = {}

    def seed(self, bucket, key, value):
        self.objects[bucket, key] = value if isinstance(value, bytes) else json.dumps(value).encode()

    def get_object(self, Bucket, Key):
        return {"Body": io.BytesIO(self.objects[Bucket, Key])}

    def put_object(self, Bucket, Key, Body, **_kwargs):
        self.objects[Bucket, Key] = Body


class FakeTable:
    def __init__(self):
        self.updates = []

    def update_item(self, **kwargs):
        self.updates.append(kwargs)


class FakePolly:
    def __init__(self):
        self.started = []
        self.status = "completed"

    def start_speech_synthesis_task(self, **kwargs):
        self.started.append(kwargs)
        return {"SynthesisTask": {"TaskId": "task-1", "OutputUri": "https://s3.us-west-2.amazonaws.com/audio/polly/take.mp3"}}

    def get_speech_synthesis_task(self, TaskId):
        return {"SynthesisTask": {"TaskStatus": self.status, "TaskStatusReason": "voice unavailable",
                                  "OutputUri": "https://s3.us-west-2.amazonaws.com/audio/polly/take.mp3"}}


class FakeTranscribe:
    def __init__(self):
        self.calls = []
        self.status = "COMPLETED"

    def start_transcription_job(self, **kwargs):
        self.calls.append(kwargs)

    def get_transcription_job(self, **_kwargs):
        return {"TranscriptionJob": {"TranscriptionJobStatus": self.status, "FailureReason": "audio unavailable"}}


def transcript(words):
    """Transcribe-shaped output for [(word, start, end)], with a punctuation item that carries no times."""
    items = [{"type": "pronunciation", "start_time": str(s), "end_time": str(e), "alternatives": [{"content": w}]}
             for w, s, e in words]
    items.append({"type": "punctuation", "alternatives": [{"content": "."}]})
    return {"results": {"items": items}}


def timed(text):
    return [(w, i * 0.5, i * 0.5 + 0.4) for i, w in enumerate(text.split())]


class GenerativeVoiceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.s3, cls.table, cls.polly, cls.transcribe = FakeS3(), FakeTable(), FakePolly(), FakeTranscribe()
        clients = {"s3": cls.s3, "polly": cls.polly, "transcribe": cls.transcribe,
                   "cloudwatch": types.SimpleNamespace()}
        fake_boto3 = types.SimpleNamespace(
            client=lambda name: clients[name],
            resource=lambda name: types.SimpleNamespace(Table=lambda _name: cls.table))
        cls.patches = [mock.patch.dict(sys.modules, {"boto3": fake_boto3}), mock.patch.dict(os.environ, ENV)]
        for patch in cls.patches:
            patch.start()
        for name in ("worker_handler", "reader_bridge_handler"):
            sys.modules.pop(name, None)
        spec = importlib.util.spec_from_file_location("generative_voice_handler",
                                                      ROOT / "lambdas/generative_voice/handler.py")
        cls.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.module)

    @classmethod
    def tearDownClass(cls):
        for patch in cls.patches:
            patch.stop()
        for name in ("worker_handler", "reader_bridge_handler", "comparison", "names", "audio_check"):
            sys.modules.pop(name, None)

    def setUp(self):
        self.s3.objects.clear()
        self.table.updates.clear()
        self.polly.started.clear()
        self.polly.status = "completed"
        self.transcribe.calls.clear()
        self.transcribe.status = "COMPLETED"

    def marks(self, text, words):
        return self.module.build_marks(text, words)

    # -- Polly: audio only ---------------------------------------------------
    def test_no_speech_marks_task(self):
        event = {"title": "Made Up", "passageId": "made-up-01", "normalizedText": "The fox ran.", "language": "en-US"}
        out = self.module.submit_polly(event, None)
        self.assertEqual(len(self.polly.started), 1)
        request = self.polly.started[0]
        self.assertEqual((request["VoiceId"], request["Engine"], request["OutputFormat"]), ("Ruth", "generative", "mp3"))
        self.assertNotIn("SpeechMarkTypes", request)
        self.assertNotIn("marksTaskId", out)
        done = self.module.check_polly(out, None)
        self.assertEqual((done["pollyStatus"], done["pollyAudioKey"]), ("completed", "polly/take.mp3"))
        self.polly.status = "failed"
        self.assertEqual(self.module.check_polly(out, None)["pollyStatus"], "failed")

    def test_transcription_job_reads_the_mp3(self):
        event = {"audioTaskId": "task-1", "pollyAudioKey": "polly/take.mp3", "language": "en-US"}
        out = self.module.start_transcription(event, None)
        call = self.transcribe.calls[0]
        self.assertEqual(call["Media"]["MediaFileUri"], "s3://audio/polly/take.mp3")
        self.assertEqual(call["OutputKey"], f"transcribe/{out['transcribeJobName']}.json")
        self.assertTrue(out["transcribeJobName"].startswith("sound-along-qg-"))

    # -- Marks ---------------------------------------------------------------
    def test_clean_marks_are_polly_shaped(self):
        text = "The fox ran home."
        marks, report = self.marks(text, timed("The fox ran home"))
        self.assertEqual([m["value"] for m in marks], ["The", "fox", "ran", "home."])
        self.assertEqual([m["time"] for m in marks], [0, 500, 1000, 1500])
        self.assertTrue(all(m["type"] == "word" for m in marks))
        self.assertEqual((marks[1]["start"], marks[1]["end"]), (4, 7))
        self.assertEqual(report["estimatedWords"], 0)

    def test_accented_text_uses_byte_offsets(self):
        text = "Café ñandú ran home"
        marks, _ = self.marks(text, timed("Cafe nandu ran home"))
        raw = text.encode("utf-8")
        for mark in marks:
            self.assertEqual(raw[mark["start"]:mark["end"]].decode("utf-8"), mark["value"])
        self.assertEqual((marks[0]["start"], marks[0]["end"]), (0, 5))     # é is two bytes
        self.assertEqual(marks[1]["start"], 6)
        self.assertEqual(marks[2]["start"], len("Café ñandú ".encode("utf-8")))

    def test_missed_word_is_spaced_between_neighbors(self):
        text = "The quick brown fox ran home today"
        heard = [("The", 0.0, 0.3), ("quick", 1.0, 1.3), ("fox", 2.0, 2.3), ("ran", 2.5, 2.8),
                 ("home", 3.0, 3.3), ("today", 3.5, 3.8)]
        marks, report = self.marks(text, heard)
        self.assertEqual(len(marks), 7)
        self.assertEqual(marks[2]["value"], "brown")
        self.assertEqual(marks[2]["time"], 1500)
        self.assertEqual(report["estimatedWords"], 1)
        times = [m["time"] for m in marks]
        self.assertEqual(times, sorted(set(times)))

    def test_missed_words_at_the_ends_still_get_times(self):
        text = "Then the fox ran home quickly and slept"
        heard = timed("the fox ran home quickly")
        marks, report = self.marks(text, heard)
        self.assertEqual(len(marks), 8)
        self.assertEqual(report["estimatedWords"], 3)
        self.assertEqual(marks[0]["time"], 0)
        times = [m["time"] for m in marks]
        self.assertTrue(all(b > a for a, b in zip(times, times[1:])))

    def test_numbers_match_their_spoken_form(self):
        text = "She had 12 apples and 1,200 pears, 3rd day."
        heard = timed("She had twelve apples and twelve hundred pears third day")
        marks, report = self.marks(text, heard)
        self.assertEqual(len(marks), 9)
        self.assertEqual(report["estimatedWords"], 0)
        self.assertEqual(marks[2]["time"], 1000)       # "12" starts where "twelve" starts
        self.assertEqual(marks[5]["time"], 2500)       # "1,200" starts at "twelve hundred"

    def test_a_different_name_spelling_still_aligns(self):
        marks, report = self.marks("Mira ran home with Sam", timed("Meera ran home with Sam"))
        self.assertEqual([m["time"] for m in marks], [0, 500, 1000, 1500, 2000])
        self.assertEqual(report["estimatedWords"], 0)

    def test_dash_with_no_letters_gets_no_mark(self):
        marks, _ = self.marks("The fox - ran home", timed("The fox ran home"))
        self.assertEqual([m["value"] for m in marks], ["The", "fox", "ran", "home"])

    def test_too_few_aligned_words_fails_with_a_reason(self):
        with self.assertRaises(self.module.MarksError) as ctx:
            self.marks("The fox ran home with a friend today", timed("A cat sat down near some people yesterday"))
        self.assertIn("matched the written text", str(ctx.exception))
        self.assertIn("80%", str(ctx.exception))

    def test_no_recognized_words_fails(self):
        with self.assertRaises(self.module.MarksError):
            self.marks("The fox ran home", [])

    # -- The step that writes the marks file ----------------------------------
    def check_event(self, text="The fox ran home."):
        return {"passageId": "made-up-01", "textHash": "sha256:example", "audioId": "Made_Up_v1_made-up-01",
                "normalizedText": text, "language": "en-US", "transcribeJobName": "sound-along-qg-job"}

    def test_check_writes_a_marks_file_the_bridge_can_read(self):
        self.s3.seed("audio", "transcribe/sound-along-qg-job.json", transcript(timed("The fox ran home")))
        out = self.module.check_transcription(self.check_event(), None)
        self.assertEqual(out["transcribeStatus"], "done")
        body = self.s3.objects["audio", out["pollyMarksKey"]].decode("utf-8")
        lines = [json.loads(line) for line in body.splitlines()]
        self.assertEqual([m["value"] for m in lines], ["The", "fox", "ran", "home."])
        bridge = importlib.util.spec_from_file_location("bridge_for_test", ROOT / "lambdas/reader_bridge/handler.py")
        reader = importlib.util.module_from_spec(bridge)
        bridge.loader.exec_module(reader)
        rows = reader._timings("The fox ran home.", body.encode("utf-8"))
        self.assertEqual(rows[0], [0.0, 0.5])
        self.assertEqual(len(rows), 4)

    def test_running_job_waits_and_a_poor_match_fails_the_run(self):
        self.transcribe.status = "IN_PROGRESS"
        self.assertEqual(self.module.check_transcription(self.check_event(), None)["transcribeStatus"], "running")
        self.transcribe.status = "COMPLETED"
        self.s3.seed("audio", "transcribe/sound-along-qg-job.json", transcript(timed("Entirely other words here")))
        out = self.module.check_transcription(self.check_event(), None)
        self.assertEqual((out["transcribeStatus"], out["pollyStatus"]), ("failed", "failed"))
        self.assertIn("matched the written text", out["pollyFailureReason"])
        self.assertEqual(self.table.updates[-1]["ExpressionAttributeValues"][":s"], "failed")

    def test_failed_job_fails_the_run(self):
        self.transcribe.status = "FAILED"
        out = self.module.check_transcription(self.check_event(), None)
        self.assertEqual(out["transcribeStatus"], "failed")
        self.assertIn("audio unavailable", out["pollyFailureReason"])

    def test_bridge_labels_the_voice_source(self):
        self.s3.exceptions = types.SimpleNamespace(NoSuchKey=KeyError)
        written = []
        reader = self.module._load("reader_bridge_handler", "reader_bridge/handler.py")
        reader._write_json = lambda s3, bucket, key, value: written.append((key, value))
        # The module's own write is wrapped for the duration of one call; check the wrapper with a stand-in handler.
        reader.handler = lambda event, context: reader._write_json(None, "b", "data/made-up-01.json", {
            "voices": [{"text_hash": "sha256:example", "source": "Polly generative, timed by Polly speech marks"},
                       {"text_hash": "sha256:other", "source": "volunteer"}]})
        self.module.bridge({"passageId": "made-up-01", "textHash": "sha256:example"}, None)
        sources = [v["source"] for v in written[-1][1]["voices"]]
        self.assertEqual(sources, ["Polly generative, timed by Amazon Transcribe", "volunteer"])


class TemplateTests(unittest.TestCase):
    """Needs Node and installed packages; runs `cdk synth` without any AWS access."""

    @classmethod
    def setUpClass(cls):
        if not shutil.which("npx") or not (ROOT / "node_modules").exists():
            raise unittest.SkipTest("Node packages are not installed")
        cls.out = tempfile.mkdtemp()
        cls.addClassCleanup(shutil.rmtree, cls.out, True)

    def synth(self, name, *context):
        out = os.path.join(self.out, name)
        args = ["npx", "cdk", "synth", "--quiet", "--output", out]
        for item in context:
            args += ["-c", item]
        env = {**os.environ, "CDK_DEFAULT_ACCOUNT": "111111111111", "CDK_DEFAULT_REGION": "us-west-2"}
        for _ in range(3):   # the Node process occasionally exits on its own on some machines
            result = subprocess.run(args, cwd=ROOT, env=env, capture_output=True, text=True, shell=os.name == "nt")
            if result.returncode == 0:
                return Path(out, "SoundAlong-sandbox.template.json").read_text(encoding="utf-8")
        self.fail(result.stderr[-800:])

    def test_off_by_default_and_on_adds_the_new_steps(self):
        default = self.synth("default")
        self.assertEqual(default, self.synth("off", "generativeVoice=false"))
        for text in ("Ruth", "generative_voice", "StartTranscribeWordTimes"):
            self.assertNotIn(text, default)
        on = self.synth("on", "generativeVoice=true")
        for text in ("Ruth", "generative_voice.handler.submit_polly", "generative_voice.handler.bridge",
                     "StartTranscribeWordTimes"):
            self.assertIn(text, on)
        gated = self.synth("gated", "generativeVoice=true", "qualityGate=true")
        self.assertIn("CheckHeardWords", gated)
        # The voice check normally starts its own job. In this mode it reads the one already made.
        self.assertIn('StartTranscription\\"', self.synth("gate", "qualityGate=true"))
        self.assertNotIn('StartTranscription\\"', gated)


if __name__ == "__main__":
    unittest.main()
