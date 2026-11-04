"""Offline contract checks for the reader bridge. Run: python -I tests/test_reader_bridge.py"""
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import types
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("reader_bridge", ROOT / "lambdas/reader_bridge/handler.py")
bridge = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(bridge)


class FakeS3:
    class exceptions:
        class NoSuchKey(Exception):
            pass
        class AccessDenied(Exception):
            pass

    def __init__(self):
        self.objects = {}
        self.writes = []
        self.allow_list = True

    def seed(self, bucket, key, value):
        self.objects[bucket, key] = value if isinstance(value, bytes) else json.dumps(value).encode()

    def get_object(self, Bucket, Key):
        try:
            return {"Body": io.BytesIO(self.objects[Bucket, Key])}
        except KeyError:
            if not self.allow_list:
                raise self.exceptions.AccessDenied("403 AccessDenied") from None
            raise self.exceptions.NoSuchKey(Key) from None

    def head_object(self, Bucket, Key):
        if (Bucket, Key) not in self.objects:
            raise self.exceptions.NoSuchKey(Key)
        return {"ETag": '"1234abcd"', "ContentLength": len(self.objects[Bucket, Key])}

    def copy_object(self, Bucket, Key, CopySource, **kwargs):
        self.objects[Bucket, Key] = self.objects[CopySource["Bucket"], CopySource["Key"]]
        self.writes.append((Bucket, Key, kwargs))

    def put_object(self, Bucket, Key, Body, **kwargs):
        self.objects[Bucket, Key] = Body
        self.writes.append((Bucket, Key, kwargs))

    def json(self, bucket, key):
        return json.loads(self.objects[bucket, key])


class FakeTable:
    def __init__(self):
        self.updates = []

    def update_item(self, **kwargs):
        self.updates.append(kwargs)


def marks_for(text, override=None):
    normalized = re.sub(r"\s+", " ", text).strip()
    lines = []
    for i, word in enumerate(re.finditer(r"\S+", normalized)):
        value = (override or {}).get(i, re.sub(r"[^\w]", "", word.group()))
        lines.append(json.dumps({"time": i * 300, "type": "word", "start": word.start(),
                                 "end": word.end(), "value": value}))
    return ("\n".join(lines) + "\n").encode()


class BridgeTests(unittest.TestCase):
    def setUp(self):
        self.s3 = FakeS3()
        self.table = FakeTable()
        self.source = json.loads((ROOT / "demo-data/passages/demo-passage-001.json").read_text())
        self.pid = self.source["passageId"]
        self.event = {"passageId": self.pid, "sourceKey": f"passages/{self.pid}.json",
                      "pollyMarksKey": "polly/marks.json", "audioKey": "audio/voice.mp3",
                      "voiceId": "Joanna", "engine": "neural", "textHash": "sha256:abc"}
        self.s3.seed("content", self.event["sourceKey"], self.source)
        self.s3.seed("audio", self.event["pollyMarksKey"], marks_for(self.source["text"]))
        self.s3.seed("audio", self.event["audioKey"], b"made-up-mp3")

    def run_bridge(self, settle=lambda: None):
        return bridge.publish(self.event, self.s3, self.table, "content", "audio", "site", settle)

    def test_lone_dash_keeps_its_slot_without_a_highlight(self):
        self.source["text"] = "He went — home."
        text = self.source["text"]
        lines = []
        for word in re.finditer(r"\S+", text):
            if word.group() != "—":
                start = len(text[:word.start()].encode())
                lines.append(json.dumps({"time": 100 * start, "type": "word", "start": start,
                                         "end": start + len(word.group().encode()),
                                         "value": word.group().strip(".")}))
        self.s3.seed("content", self.event["sourceKey"], self.source)
        self.s3.seed("audio", self.event["pollyMarksKey"], "\n".join(lines).encode())
        self.run_bridge()
        doc = self.s3.json("site", f"data/{self.pid}.json")
        self.assertEqual(re.findall(r'data-i="(\d+)"', doc["html"]), ["0", "1", "3"])
        self.assertIsNone(doc["voices"][0]["t"][2])
        self.assertEqual(len(doc["voices"][0]["t"]), 4)

    def test_library_entry_survives_another_run_overwriting_the_list(self):
        self.s3.seed("site", "data/index.json", [{"uuid": "other"}])
        overwritten = []

        def another_run_finishes():
            if not overwritten:
                overwritten.append(True)
                self.s3.seed("site", "data/index.json", [{"uuid": "other"}, {"uuid": "third"}])
        self.run_bridge(another_run_finishes)
        rows = [row["uuid"] for row in self.s3.json("site", "data/index.json")]
        self.assertEqual(sorted(rows), sorted(["other", "third", self.pid]))

    def test_clean_passage_contract(self):
        result = self.run_bridge()
        doc = self.s3.json("site", f"data/{self.pid}.json")
        index = self.s3.json("site", "data/index.json")
        self.assertTrue(result["readerReady"])
        self.assertEqual(doc["uuid"], self.pid)
        self.assertEqual(doc["title"], self.source["title"])
        self.assertEqual(doc["authors"], [])
        self.assertEqual(doc["lang"], "EN")
        self.assertEqual(doc["grade"], "2")
        self.assertEqual(doc["lexile"], 430)
        self.assertEqual(doc["wordcount"], len(self.source["text"].split()))
        self.assertEqual(doc["words"], doc["wordcount"])
        self.assertEqual(doc["title_words"], self.source["title"].split())
        self.assertEqual(doc["by_words"], [])
        self.assertEqual(doc["credit"], "")
        self.assertEqual(len(re.findall(r'data-i="\d+"', doc["html"])), doc["words"])
        self.assertEqual(doc["vocab"]["v0"]["word"], "color")
        self.assertEqual(doc["vocab"]["v1"]["definition"], "something unexpected that happens")
        self.assertIn('data-vocab-sense-id="v0"', doc["html"])
        self.assertEqual(doc["html"].count('data-vocab-sense-id="v0"'), 1)
        voice = doc["voices"][0]
        self.assertEqual(voice["id"], "generated")
        self.assertEqual(voice["lead"], [None] * len(doc["title_words"]))
        self.assertEqual(len(voice["t"]), doc["words"])
        self.assertEqual(voice["t"][0], [0, 0.3])
        self.assertGreater(voice["t"][-1][1], voice["t"][-1][0])
        self.assertTrue(voice["audio"].startswith(f"audio/{self.pid}/"))
        self.assertIn(("site", voice["audio"]), self.s3.objects)
        self.assertEqual(index, [{"uuid": self.pid, "title": doc["title"], "grade": "2",
                                  "lexile": 430, "lang": "EN", "words": doc["words"], "voices": ["generated"]}])
        if shutil.which("node"):
            result = subprocess.run(["node", str(ROOT / "tests/reader_path.cjs")],
                                    input=json.dumps({"index": index, "doc": doc}), text=True,
                                    capture_output=True, check=False)
            self.assertEqual(result.returncode, 0, result.stderr)
        for bucket, key, kwargs in self.s3.writes:
            if key.startswith("data/"):
                self.assertEqual(kwargs["CacheControl"], "no-cache")

    def test_text_paragraphs(self):
        self.source["text"] = "A small bird.\nIt can sing."
        self.s3.seed("content", self.event["sourceKey"], self.source)
        self.s3.seed("audio", self.event["pollyMarksKey"], marks_for(self.source["text"]))
        self.run_bridge()
        html_text = self.s3.json("site", f"data/{self.pid}.json")["html"]
        self.assertEqual(html_text.count("<p>"), 2)
        self.assertIn("</p><p>", html_text)

    def test_readworks_shaped_content(self):
        self.source["content"] = f"<h2>How it works</h2><figure><figcaption>Photo caption</figcaption></figure><p>{self.source['text']}</p>"
        self.source["canonical_grade"] = 18
        self.source["l"] = ["430"]
        self.source["vocab"] = {"support": {"senses": {"sense-1": {"definition": "visible quality"}},
                                            "occurrences": {"sense-100": {"word": "color"}}}}
        self.source["uuid"] = self.pid
        self.source.pop("passageId")
        self.source.pop("gradeBand")
        self.source.pop("lexile")
        self.source.pop("vocabulary")
        self.s3.seed("content", self.event["sourceKey"], self.source)
        self.run_bridge()
        doc = self.s3.json("site", f"data/{self.pid}.json")
        self.assertEqual(doc["grade"], "2")
        self.assertEqual(doc["lexile"], "430")
        self.assertIn("<p><span", doc["html"])
        self.assertIn('sa-unread', doc["html"])
        self.assertEqual(len(re.findall(r'data-i="\d+"', doc["html"])), doc["words"])
        self.assertEqual(doc["vocab"]["sense-1"]["word"], "color")
        self.assertEqual(doc["vocab"]["sense-1"]["definition"], "visible quality")
        fake_boto3 = types.SimpleNamespace(client=lambda name: self.s3,
                                           resource=lambda name: types.SimpleNamespace())
        with mock.patch.dict(sys.modules, {"boto3": fake_boto3}):
            worker_spec = importlib.util.spec_from_file_location("worker_uuid", ROOT / "lambdas/worker/handler.py")
            worker = importlib.util.module_from_spec(worker_spec)
            worker_spec.loader.exec_module(worker)
        worker.CONTENT_BUCKET = "content"
        self.assertEqual(worker.load_passage({"passageId": self.pid}, None)["passageId"], self.pid)

    def test_number_and_hyphen(self):
        self.source["text"] = "We saw 12 well-known birds."
        self.s3.seed("content", self.event["sourceKey"], self.source)
        text = self.source["text"]
        lines = [json.dumps({"time": t, "type": "word", "start": a, "end": b, "value": value})
                 for t, a, b, value in [(0, 0, 2, "We"), (200, 3, 6, "saw"),
                                        (400, 7, 9, "twelve"), (600, 10, 14, "well"),
                                        (720, 15, 20, "known"), (900, 21, 27, "birds")]]
        self.s3.seed("audio", self.event["pollyMarksKey"], ("\n".join(lines) + "\n").encode())
        self.run_bridge()
        t = self.s3.json("site", f"data/{self.pid}.json")["voices"][0]["t"]
        self.assertEqual(len(t), 5)
        self.assertEqual(t[2], [0.4, 0.6])
        self.assertEqual(t[3], [0.6, 0.9])

    def test_numeric_forms_use_offsets_for_written_and_spoken_marks(self):
        self.source["text"] = "In 1999, 12 cost $3.50, then 1,000 won 3rd place."
        self.s3.seed("content", self.event["sourceKey"], self.source)
        text = self.source["text"]
        words = list(re.finditer(r"\S+", text))
        spoken = {1: "nineteen ninety nine", 2: "12", 4: "three dollars fifty cents",
                  6: "one thousand", 8: "third"}
        lines = []
        for i, word in enumerate(words):
            value = spoken.get(i, re.sub(r"[^\w]", "", word.group()))
            lines.append(json.dumps({"time": i * 300, "type": "word",
                                     "start": len(text[:word.start()].encode()),
                                     "end": len(text[:word.end()].encode()), "value": value}))
        self.s3.seed("audio", self.event["pollyMarksKey"], "\n".join(lines).encode())
        self.run_bridge()
        self.assertEqual(len(self.s3.json("site", f"data/{self.pid}.json")["voices"][0]["t"]), len(words))

    def test_edited_text_rebuilds_and_discards_old_voice_timing(self):
        self.source["text"] = "One small bird sings."
        self.s3.seed("content", self.event["sourceKey"], self.source)
        self.s3.seed("audio", self.event["pollyMarksKey"], marks_for(self.source["text"]))
        self.run_bridge()
        self.source["text"] = "One large bird sings."
        self.source["title"] = "A New Title"
        self.s3.seed("content", self.event["sourceKey"], self.source)
        self.s3.seed("audio", self.event["pollyMarksKey"], marks_for(self.source["text"]))
        self.event["textHash"] = "sha256:new"
        self.run_bridge()
        doc = self.s3.json("site", f"data/{self.pid}.json")
        self.assertEqual(doc["title"], "A New Title")
        self.assertEqual(len(doc["voices"]), 1)
        self.assertEqual(doc["voices"][0]["text_hash"], "sha256:new")
        self.assertEqual(doc["words"], 4)

    def test_unexpected_s3_failure_marks_job_failed(self):
        self.s3.allow_list = False
        fake_boto3 = types.SimpleNamespace(client=lambda name: self.s3,
                                           resource=lambda name: types.SimpleNamespace(Table=lambda table: self.table))
        env = {"JOB_TABLE": "jobs", "CONTENT_BUCKET": "content", "AUDIO_BUCKET": "audio",
               "FRONTEND_BUCKET": "site"}
        with mock.patch.dict(sys.modules, {"boto3": fake_boto3}), mock.patch.dict(os.environ, env):
            result = bridge.handler(self.event, None)
        self.assertFalse(result["readerReady"])
        self.assertIn("403", result["readerFailureReason"])
        self.assertEqual(self.table.updates[-1]["ExpressionAttributeValues"][":s"], "reader_publish_failed")

    def test_cached_job_reuses_audio_after_bridge_failure(self):
        self.run_bridge()
        self.assertIn("readerPublishedAt", self.table.updates[-1]["UpdateExpression"])
        doc = self.s3.json("site", f"data/{self.pid}.json")
        self.s3.seed("audio", "audio/canonical.speechmarks.json",
                     [json.loads(line) for line in self.s3.objects["audio", self.event["pollyMarksKey"]].decode().splitlines()])
        fake_item = {"status": "reader_publish_failed", "audioKey": self.event["audioKey"],
                     "speechMarksKey": "audio/canonical.speechmarks.json"}
        fake_table = types.SimpleNamespace(get_item=lambda **kwargs: {"Item": fake_item})
        fake_boto3 = types.SimpleNamespace(client=lambda name: self.s3,
                                           resource=lambda name: types.SimpleNamespace(Table=lambda name: fake_table))
        with mock.patch.dict(sys.modules, {"boto3": fake_boto3}):
            worker_spec = importlib.util.spec_from_file_location("worker_cached", ROOT / "lambdas/worker/handler.py")
            worker = importlib.util.module_from_spec(worker_spec)
            worker_spec.loader.exec_module(worker)
        worker.JOB_TABLE = "jobs"
        cached = worker.check_existing_manifest({**self.event, "charCount": 10}, None)
        self.assertTrue(cached["cached"])
        self.assertTrue(cached["readerNeedsPublish"])
        self.assertEqual(cached["pollyMarksKey"], fake_item["speechMarksKey"])
        fake_item["status"] = "approved"
        self.assertTrue(worker.check_existing_manifest({**self.event, "charCount": 10}, None)["readerNeedsPublish"])
        fake_item["readerPublishedAt"] = "2026-11-04T12:00:00Z"
        self.assertFalse(worker.check_existing_manifest({**self.event, "charCount": 10}, None)["readerNeedsPublish"])
        bridge.publish(cached, self.s3, self.table, "content", "audio", "site", settle=lambda: None)
        self.assertEqual(self.s3.json("site", f"data/{self.pid}.json"), doc)

    def test_frontend_publish_keeps_live_index(self):
        if not shutil.which("node"):
            self.skipTest("Node.js is unavailable")
        result = subprocess.run(["node", str(ROOT / "tests/test_publish_frontend.cjs")],
                                text=True, capture_output=True, check=False)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_unaligned_marks_publish_nothing(self):
        self.s3.seed("audio", self.event["pollyMarksKey"], marks_for(self.source["text"], {1: "wrong"}))
        fake_boto3 = types.SimpleNamespace(client=lambda name: self.s3,
                                           resource=lambda name: types.SimpleNamespace(Table=lambda table: self.table))
        env = {"JOB_TABLE": "jobs", "CONTENT_BUCKET": "content", "AUDIO_BUCKET": "audio",
               "FRONTEND_BUCKET": "site"}
        with mock.patch.dict(sys.modules, {"boto3": fake_boto3}), mock.patch.dict(os.environ, env):
            result = bridge.handler(self.event, None)
        self.assertFalse(result["readerReady"])
        self.assertIn("differs", result["readerFailureReason"])
        self.assertEqual(self.table.updates[0]["ExpressionAttributeValues"][":s"], "reader_publish_failed")
        self.assertFalse(any(bucket == "site" for bucket, _, _ in self.s3.writes))

    def test_second_voice_keeps_first(self):
        self.run_bridge()
        doc = self.s3.json("site", f"data/{self.pid}.json")
        human = {"id": "human", "audio": "audio/old.mp3", "lead": [],
                 "t": [[0, 1]] * doc["words"], "source": "local recording"}
        doc["voices"].append(human)
        self.s3.seed("site", f"data/{self.pid}.json", doc)
        self.event["voiceId"] = "Matthew"
        self.event["textHash"] = "sha256:def"
        self.run_bridge()
        after = self.s3.json("site", f"data/{self.pid}.json")
        self.assertEqual([v["id"] for v in after["voices"]], ["generated", "human", "generated-matthew"])
        self.assertEqual(after["voices"][1], human)
        self.assertEqual(self.s3.json("site", "data/index.json")[0]["voices"],
                         ["generated", "human", "generated-matthew"])

    def test_same_hash_rerun(self):
        first = self.run_bridge()
        before = self.s3.json("site", f"data/{self.pid}.json")
        second = self.run_bridge()
        after = self.s3.json("site", f"data/{self.pid}.json")
        self.assertEqual(first["readerAudioKey"], second["readerAudioKey"])
        self.assertEqual(before, after)
        self.assertEqual(len(after["voices"]), 1)
        self.assertEqual(len(self.s3.json("site", "data/index.json")), 1)

    def test_missing_reader_text(self):
        self.source.pop("text")
        self.s3.seed("content", self.event["sourceKey"], self.source)
        with self.assertRaisesRegex(bridge.ReaderInputError, "no reader-ready"):
            self.run_bridge()
        fake_boto3 = types.SimpleNamespace(client=lambda name: self.s3,
                                           resource=lambda name: types.SimpleNamespace())
        with mock.patch.dict(sys.modules, {"boto3": fake_boto3}):
            worker_spec = importlib.util.spec_from_file_location("worker", ROOT / "lambdas/worker/handler.py")
            worker = importlib.util.module_from_spec(worker_spec)
            worker_spec.loader.exec_module(worker)
        worker.CONTENT_BUCKET = "content"
        with self.assertRaisesRegex(ValueError, "no reader-ready passage text"):
            worker.load_passage({"passageId": self.pid}, None)
        self.assertFalse(self.s3.writes)


if __name__ == "__main__":
    unittest.main()
