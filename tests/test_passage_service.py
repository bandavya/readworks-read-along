"""Offline guards for privacy, idempotence, and the team's artifact mapping."""
import importlib.util
import io
import json
import os
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch


class FakeClientError(Exception):
    def __init__(self, code):
        self.response = {"Error": {"Code": code}}


class FakeS3:
    def __init__(self):
        self.objects = {}

    def get_object(self, Bucket, Key):
        value = self.objects.get((Bucket, Key))
        if value is None:
            raise FakeClientError("NoSuchKey")
        return {"Body": io.BytesIO(value)}

    def head_object(self, Bucket, Key):
        if (Bucket, Key) not in self.objects:
            raise FakeClientError("404")
        return {"ContentLength": len(self.objects[Bucket, Key])}

    def put_object(self, Bucket, Key, Body, IfNoneMatch=None, **_):
        if IfNoneMatch == "*" and (Bucket, Key) in self.objects:
            raise FakeClientError("PreconditionFailed")
        self.objects[Bucket, Key] = Body

    def generate_presigned_url(self, operation, Params, ExpiresIn):
        assert operation == "get_object" and ExpiresIn == 900
        return "https://example.invalid/" + Params["Key"]


class FakeTable:
    def __init__(self):
        self.items = []

    def query(self, KeyConditionExpression, ConsistentRead):
        assert ConsistentRead is True
        return {"Items": self.items}


class FakeKey:
    def __init__(self, name):
        self.name = name

    def eq(self, value):
        return (self.name, value)


fake_s3 = FakeS3()
fake_table = FakeTable()
boto3 = types.ModuleType("boto3")
boto3.client = lambda service: fake_s3
boto3.resource = lambda service: types.SimpleNamespace(Table=lambda name: fake_table)
conditions = types.ModuleType("boto3.dynamodb.conditions")
conditions.Key = FakeKey
botocore = types.ModuleType("botocore")
exceptions = types.ModuleType("botocore.exceptions")
exceptions.ClientError = FakeClientError

with patch.dict(sys.modules, {
    "boto3": boto3, "boto3.dynamodb": types.ModuleType("boto3.dynamodb"),
    "boto3.dynamodb.conditions": conditions, "botocore": botocore,
    "botocore.exceptions": exceptions,
}), patch.dict(os.environ, {"CONTENT_BUCKET": "content", "AUDIO_BUCKET": "audio",
                         "JOB_TABLE": "jobs", "VOICE_ID": "Joanna", "ENGINE": "neural",
                         "LANGUAGE": "en-US", "SOURCE_BUCKET": "source"}):
    spec = importlib.util.spec_from_file_location(
        "passage_service", Path(__file__).resolve().parents[1] / "lambdas" / "passage_service" / "handler.py")
    service = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(service)

bridge_spec = importlib.util.spec_from_file_location(
    "reader_bridge_for_service", Path(__file__).resolve().parents[1] / "lambdas" / "reader_bridge" / "handler.py")
bridge = importlib.util.module_from_spec(bridge_spec)
bridge_spec.loader.exec_module(bridge)


def call(method, resource, body=None, pid=None):
    event = {"httpMethod": method, "resource": resource, "body": json.dumps(body) if body is not None else None,
             "pathParameters": {"id": pid} if pid else None}
    result = service.handle(event, None)
    return result["statusCode"], json.loads(result["body"])


class PassageServiceTests(unittest.TestCase):
    def setUp(self):
        fake_s3.objects.clear()
        fake_table.items.clear()

    def record(self):
        return {"uuid": "made-up-001", "title": "A Tiny Tree", "text": "A tree grows.  \n\nIt is small.",
                "content": "<p>A tree grows.</p>", "questionSets": [{"answers": ["secret"]}],
                "answers": ["secret"], "questions": [{"prompt": "private"}],
                "answerMapA": {"x": "secret"}, "gradeBand": "2-3",
                "vocabulary": [{"word": "tree", "definition": "A tall plant.", "answer": "secret"}]}

    def test_submit_strips_assessments_from_public_input(self):
        code, result = call("POST", "/v1/passages", self.record())
        self.assertEqual(code, 202)
        self.assertEqual(result["status"], "queued")
        intake = json.loads(fake_s3.objects["content", "passages/made-up-001.json"])
        for forbidden in ("questionSets", "questions", "answers", "answerMapA", "content", "uuid"):
            self.assertNotIn(forbidden, intake)
        self.assertEqual(intake["text"], "A tree grows.\n\nIt is small.")
        self.assertEqual(intake["vocabulary"], [{"word": "tree", "definition": "A tall plant."}])
        self.assertEqual(result["words"], intake["text"].split())
        self.assertEqual(bridge._html_for(intake, intake["text"]).count("<p>"), 2)
        self.assertEqual(bridge._vocab(intake)["v0"]["definition"], "A tall plant.")

    def test_repeat_reuses_and_changed_text_conflicts(self):
        call("POST", "/v1/passages", self.record())
        code, result = call("POST", "/v1/passages", self.record())
        self.assertEqual((code, result["reused"]), (200, True))
        changed = self.record()
        changed["text"] = "Different made-up text."
        code, _ = call("POST", "/v1/passages", changed)
        self.assertEqual(code, 409)

    def test_pointer_and_private_publication_links(self):
        fake_s3.objects["source", "products/tiny.json"] = json.dumps(self.record()).encode()
        code, _ = call("POST", "/v1/passages", {"source": {"bucket": "source", "key": "products/tiny.json"}})
        self.assertEqual(code, 202)
        _, marker = call("GET", "/v1/passages/{id}", pid="made-up-001")
        pipeline_hash = json.loads(fake_s3.objects["content", "api-jobs/made-up-001.json"])["pipeline_hash"]
        fake_table.items.append({"passageId": "made-up-001", "textHash": pipeline_hash, "status": "approved"})
        fake_s3.objects["content", "manifests/made-up-001.json"] = json.dumps({
            "textHash": pipeline_hash, "status": "approved", "voiceId": "Joanna",
            "audioKey": "audio/tiny.mp3", "speechMarksKey": "audio/tiny.speechmarks.json"}).encode()
        fake_s3.objects["content", "content/made-up-001.json"] = json.dumps({
            "passageId": "made-up-001", "text": "A tree grows.\n\nIt is small.", "audioManifest": {"audioKey": "audio/tiny.mp3", "speechMarksKey": "audio/tiny.speechmarks.json"}}).encode()
        fake_s3.objects["audio", "audio/tiny.mp3"] = b"audio"
        fake_s3.objects["audio", "audio/tiny.speechmarks.json"] = b"[]"
        code, result = call("GET", "/v1/passages/{id}", pid="made-up-001")
        self.assertEqual((code, result["status"]), (200, "published"))
        self.assertIsNone(result["timing_url"])
        self.assertIn("speechmarks.json", result["timing_json_url"])
        self.assertEqual(marker["status"], "queued")
        fake_table.items[0]["status"] = "reader_publish_failed"
        code, result = call("GET", "/v1/passages/{id}", pid="made-up-001")
        self.assertEqual((code, result["status"]), (200, "failed"))
        self.assertIsNone(result["audio_url"])
        self.assertIsNone(result["timing_json_url"])
        self.assertIn("reader publication failed", result["reasons"][0])

    def test_quality_gate_hold_returns_review_reasons_without_links(self):
        call("POST", "/v1/passages", self.record())
        pipeline_hash = json.loads(fake_s3.objects["content", "api-jobs/made-up-001.json"])["pipeline_hash"]
        fake_table.items.append({"passageId": "made-up-001", "textHash": pipeline_hash,
                                 "status": "held", "holdReasons": ["Job row fallback"]})
        fake_s3.objects["content", "review/made-up-001.json"] = json.dumps({
            "passageId": "made-up-001", "textHash": pipeline_hash, "status": "held",
            "reasons": ["A spoken word did not match", "Check the voice take"]}).encode()
        fake_s3.objects["content", "manifests/made-up-001.json"] = json.dumps({
            "textHash": pipeline_hash, "status": "approved", "voiceId": "Joanna",
            "audioKey": "audio/tiny.mp3", "speechMarksKey": "audio/tiny.speechmarks.json"}).encode()
        fake_s3.objects["content", "content/made-up-001.json"] = json.dumps({
            "passageId": "made-up-001", "text": "A tree grows.\n\nIt is small.",
            "audioManifest": {"audioKey": "audio/tiny.mp3",
                              "speechMarksKey": "audio/tiny.speechmarks.json"}}).encode()
        fake_s3.objects["audio", "audio/tiny.mp3"] = b"audio"
        fake_s3.objects["audio", "audio/tiny.speechmarks.json"] = b"[]"
        code, result = call("GET", "/v1/passages/{id}", pid="made-up-001")
        self.assertEqual((code, result["status"]), (200, "held"))
        self.assertEqual(result["reasons"], ["A spoken word did not match", "Check the voice take"])
        for field in ("audio_url", "timing_url", "timing_json_url"):
            self.assertIsNone(result[field])

        del fake_s3.objects["content", "review/made-up-001.json"]
        _, result = call("GET", "/v1/passages/{id}", pid="made-up-001")
        self.assertEqual((result["status"], result["reasons"]), ("held", ["Job row fallback"]))

    def test_vocabulary_change_conflicts_and_support_fields_are_sanitized(self):
        record = self.record()
        record["vocabulary"] = {"support": {"senses": {"sense-1": {
            "word": "tree", "definition": "A tall plant.",
            "example_list": ["The tree grows."], "answers": ["secret"]}}}}
        self.assertEqual(call("POST", "/v1/passages", record)[0], 202)
        intake = json.loads(fake_s3.objects["content", "passages/made-up-001.json"])
        self.assertEqual(intake["vocabulary"]["support"]["senses"]["sense-1"], {
            "word": "tree", "definition": "A tall plant.", "example_list": ["The tree grows."]})
        record["vocabulary"]["support"]["senses"]["sense-1"]["definition"] = "Different meaning."
        self.assertEqual(call("POST", "/v1/passages", record)[0], 409)

    def test_marker_only_submission_repairs_after_grace_period(self):
        record = self.record()
        call("POST", "/v1/passages", record)
        del fake_s3.objects["content", "passages/made-up-001.json"]
        marker = json.loads(fake_s3.objects["content", "api-jobs/made-up-001.json"])
        marker["submitted_at"] = "2020-01-01T00:00:00+00:00"
        fake_s3.objects["content", "api-jobs/made-up-001.json"] = json.dumps(marker).encode()
        code, result = call("POST", "/v1/passages", record)
        self.assertEqual((code, result["reused"]), (202, True))
        self.assertIn(("content", "passages/made-up-001.json"), fake_s3.objects)
    def test_missing_pointer_is_client_error(self):
        code, result = call("POST", "/v1/passages", {
            "source": {"bucket": "source", "key": "products/missing.json"}})
        self.assertEqual(code, 400)
        self.assertIn("not found", result["error"])
    def test_reserved_id_and_unsupported_force(self):
        record = self.record()
        record["uuid"] = "index"
        self.assertEqual(call("POST", "/v1/passages", record)[0], 400)
        record["uuid"] = "made-up-001"
        record["force"] = True
        self.assertEqual(call("POST", "/v1/passages", record)[0], 409)


if __name__ == "__main__":
    unittest.main()
