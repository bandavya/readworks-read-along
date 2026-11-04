"""Sound Along TTS workflow workers.

Each function is a Step Functions task. The event passed between states is a
plain dict that accumulates fields. Handlers read what they need and return the
merged state for the next task.

Design reference: sections 4.2 (data flow), 5 (data model), 6.3 (Polly workflow).
"""
import hashlib
import json
import os
import re
import time
from datetime import datetime, timezone

import boto3

CONTENT_BUCKET = os.environ.get("CONTENT_BUCKET", "")
AUDIO_BUCKET = os.environ.get("AUDIO_BUCKET", "")
JOB_TABLE = os.environ.get("JOB_TABLE", "")
VOICE_ID = os.environ.get("VOICE_ID", "Joanna")
ENGINE = os.environ.get("ENGINE", "neural")
LANGUAGE = os.environ.get("LANGUAGE", "en-US")
ENV_NAME = os.environ.get("ENV_NAME", "sandbox")

s3 = boto3.client("s3")
ddb = boto3.resource("dynamodb")
polly = boto3.client("polly")


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _table():
    return ddb.Table(JOB_TABLE)


def _audio_id(title: str, passage_id: str, version: int = 1) -> str:
    """Backward-compatible `au` stem: Title_v<version>_<passageId> (section 5.3)."""
    safe_title = re.sub(r"[^A-Za-z0-9]+", "_", title).strip("_")
    return f"{safe_title}_v{version}_{passage_id}"


# ---------------------------------------------------------------------------
# 1. LoadPassage
# ---------------------------------------------------------------------------
def load_passage(event, _context):
    passage_id = event["passageId"]
    key = event.get("key") or f"passages/{passage_id}.json"
    obj = s3.get_object(Bucket=CONTENT_BUCKET, Key=key)
    passage = json.loads(obj["Body"].read())
    raw_text = passage.get("text")
    if not isinstance(raw_text, str) or not raw_text.strip():
        raise ValueError("no reader-ready passage text")
    return {
        "passageId": passage["passageId"],
        "title": passage.get("title", passage["passageId"]),
        "rawText": raw_text,
        "language": passage.get("language", LANGUAGE),
        "soundAlong": passage.get("soundAlong", {"enabled": True, "audioAccess": "assignment"}),
        "sourceKey": key,
        "startedAt": _now(),
    }


# ---------------------------------------------------------------------------
# 2. NormalizeText
# ---------------------------------------------------------------------------
def normalize_text(event, _context):
    text = event["rawText"]
    # Collapse whitespace; keep sentence punctuation for natural prosody.
    normalized = re.sub(r"\s+", " ", text).strip()
    event["normalizedText"] = normalized
    event["charCount"] = len(normalized)
    return event


# ---------------------------------------------------------------------------
# 3. ComputeTextHash
# ---------------------------------------------------------------------------
def compute_hash(event, _context):
    basis = f"{event['normalizedText']}|{VOICE_ID}|{ENGINE}|{event['language']}"
    digest = hashlib.sha256(basis.encode("utf-8")).hexdigest()
    event["textHash"] = f"sha256:{digest}"
    event["voiceId"] = VOICE_ID
    event["engine"] = ENGINE
    return event


# ---------------------------------------------------------------------------
# 4. CheckExistingManifest (dedup: T10)
# ---------------------------------------------------------------------------
def check_existing_manifest(event, _context):
    resp = _table().get_item(
        Key={"passageId": event["passageId"], "textHash": event["textHash"]}
    )
    item = resp.get("Item")
    cached = bool(item and item.get("status") == "approved")
    event["cached"] = cached
    if not cached:
        # Record the job as in-progress so the status page (T11) can show it.
        _table().put_item(
            Item={
                "passageId": event["passageId"],
                "textHash": event["textHash"],
                "status": "running",
                "voiceId": VOICE_ID,
                "engine": ENGINE,
                "charCount": event["charCount"],
                "updatedAt": _now(),
            }
        )
    return event


# ---------------------------------------------------------------------------
# 5/6. SubmitPolly (async audio + speech marks)
# ---------------------------------------------------------------------------
def submit_polly(event, _context):
    audio_id = _audio_id(event["title"], event["passageId"])
    event["audioId"] = audio_id
    event["audioKey"] = f"audio/{audio_id}.mp3"
    event["speechMarksKey"] = f"audio/{audio_id}.speechmarks.json"

    common = dict(
        Text=event["normalizedText"],
        VoiceId=VOICE_ID,
        LanguageCode=event["language"],
        OutputS3BucketName=AUDIO_BUCKET,
    )
    if ENGINE in ("neural", "standard", "long-form", "generative"):
        common["Engine"] = ENGINE

    audio_task = polly.start_speech_synthesis_task(
        **common,
        OutputFormat="mp3",
        OutputS3KeyPrefix=f"polly/{audio_id}/audio",
    )
    marks_task = polly.start_speech_synthesis_task(
        **common,
        OutputFormat="json",
        SpeechMarkTypes=["word", "sentence"],
        OutputS3KeyPrefix=f"polly/{audio_id}/marks",
    )
    event["audioTaskId"] = audio_task["SynthesisTask"]["TaskId"]
    event["marksTaskId"] = marks_task["SynthesisTask"]["TaskId"]
    event["audioTaskUri"] = audio_task["SynthesisTask"]["OutputUri"]
    event["marksTaskUri"] = marks_task["SynthesisTask"]["OutputUri"]
    event["pollyStatus"] = "running"
    return event


# ---------------------------------------------------------------------------
# 7. WaitForCompletion -> CheckPollyStatus
# ---------------------------------------------------------------------------
def check_polly(event, _context):
    audio = polly.get_speech_synthesis_task(TaskId=event["audioTaskId"])["SynthesisTask"]
    marks = polly.get_speech_synthesis_task(TaskId=event["marksTaskId"])["SynthesisTask"]
    statuses = {audio["TaskStatus"], marks["TaskStatus"]}

    if "failed" in statuses:
        event["pollyStatus"] = "failed"
        event["pollyFailureReason"] = audio.get("TaskStatusReason") or marks.get("TaskStatusReason")
    elif statuses == {"completed"}:
        event["pollyStatus"] = "completed"
        # Record the exact S3 keys Polly produced (OutputUri -> key).
        event["pollyAudioKey"] = _key_from_uri(audio["OutputUri"])
        event["pollyMarksKey"] = _key_from_uri(marks["OutputUri"])
    else:
        event["pollyStatus"] = "running"
    return event


def _key_from_uri(uri: str) -> str:
    # https://s3.<region>.amazonaws.com/<bucket>/<key>
    parts = uri.split(f"/{AUDIO_BUCKET}/", 1)
    return parts[1] if len(parts) == 2 else uri


# ---------------------------------------------------------------------------
# 8. ValidateOutputs (T03, T04, T13-friendly)
# ---------------------------------------------------------------------------
def validate_outputs(event, _context):
    problems = []
    # Audio exists and is non-trivial.
    try:
        head = s3.head_object(Bucket=AUDIO_BUCKET, Key=event["pollyAudioKey"])
        event["audioBytes"] = head["ContentLength"]
        if head["ContentLength"] < 1000:
            problems.append("audio too small")
    except Exception as exc:  # noqa: BLE001
        problems.append(f"audio missing: {exc}")

    # Speech marks exist and reference the passage words.
    try:
        marks_obj = s3.get_object(Bucket=AUDIO_BUCKET, Key=event["pollyMarksKey"])
        marks = _parse_speech_marks(marks_obj["Body"].read().decode("utf-8"))
        word_marks = [m for m in marks if m.get("type") == "word"]
        if not word_marks:
            problems.append("no word speech marks")
        event["wordMarkCount"] = len(word_marks)
        event["speechMarks"] = marks
    except Exception as exc:  # noqa: BLE001
        problems.append(f"speech marks missing: {exc}")

    event["valid"] = len(problems) == 0
    event["validationProblems"] = problems
    return event


def _parse_speech_marks(body: str):
    """Polly speech marks are newline-delimited JSON objects."""
    out = []
    for line in body.splitlines():
        line = line.strip()
        if line:
            out.append(json.loads(line))
    return out


# ---------------------------------------------------------------------------
# 9. WriteManifest (section 5.2) -> normalized speech marks + canonical keys
# ---------------------------------------------------------------------------
def write_manifest(event, _context):
    audio_id = event["audioId"]

    # Copy Polly outputs to canonical keys referenced by the manifest.
    s3.copy_object(
        Bucket=AUDIO_BUCKET,
        CopySource={"Bucket": AUDIO_BUCKET, "Key": event["pollyAudioKey"]},
        Key=event["audioKey"],
        ContentType="audio/mpeg",
    )
    # Store cleaned speech marks as a single JSON array for the browser.
    s3.put_object(
        Bucket=AUDIO_BUCKET,
        Key=event["speechMarksKey"],
        Body=json.dumps(event["speechMarks"]).encode("utf-8"),
        ContentType="application/json",
    )

    manifest = {
        "passageId": event["passageId"],
        "textHash": event["textHash"],
        "audioId": audio_id,
        "audioProvider": "amazon-polly",
        "audioType": "synthetic",
        "voiceId": event["voiceId"],
        "engine": event["engine"],
        "language": event["language"],
        "audioKey": event["audioKey"],
        "speechMarksKey": event["speechMarksKey"],
        "status": "approved",
        "reviewStatus": "sampled",
        "createdAt": _now(),
    }
    s3.put_object(
        Bucket=CONTENT_BUCKET,
        Key=f"manifests/{event['passageId']}.json",
        Body=json.dumps(manifest, indent=2).encode("utf-8"),
        ContentType="application/json",
    )

    _table().put_item(
        Item={
            "passageId": event["passageId"],
            "textHash": event["textHash"],
            "status": "approved",
            "reviewStatus": "sampled",
            "voiceId": event["voiceId"],
            "engine": event["engine"],
            "audioKey": event["audioKey"],
            "speechMarksKey": event["speechMarksKey"],
            "charCount": event["charCount"],
            "updatedAt": _now(),
        }
    )
    event["manifest"] = manifest
    return event


# ---------------------------------------------------------------------------
# 10. PublishDemoJson (ReadWorks-shaped derivative, backward-compatible `au`)
# ---------------------------------------------------------------------------
def publish_demo_json(event, _context):
    src = s3.get_object(Bucket=CONTENT_BUCKET, Key=event["sourceKey"])
    passage = json.loads(src["Body"].read())

    demo = dict(passage)
    demo["au"] = event["audioId"]  # section 5.3 filename-stem convention
    demo["audioManifest"] = {
        "audioKey": event["audioKey"],
        "speechMarksKey": event["speechMarksKey"],
        "audioType": event["manifest"]["audioType"],
        "voiceId": event["voiceId"],
    }
    s3.put_object(
        Bucket=CONTENT_BUCKET,
        Key=f"content/{event['passageId']}.json",
        Body=json.dumps(demo, indent=2).encode("utf-8"),
        ContentType="application/json",
    )
    event["demoKey"] = f"content/{event['passageId']}.json"
    return event


# ---------------------------------------------------------------------------
# 11. EmitMetrics (section 13 cost/scale signals)
# ---------------------------------------------------------------------------
def emit_metrics(event, _context):
    cw = boto3.client("cloudwatch")
    cw.put_metric_data(
        Namespace="SoundAlong",
        MetricData=[
            {"MetricName": "CharactersSubmitted", "Value": event.get("charCount", 0), "Unit": "Count"},
            {"MetricName": "AudioBytes", "Value": event.get("audioBytes", 0), "Unit": "Bytes"},
            {"MetricName": "WordMarks", "Value": event.get("wordMarkCount", 0), "Unit": "Count"},
            {"MetricName": "GenerationsCompleted", "Value": 1, "Unit": "Count"},
        ],
    )
    # Approx cost input from section 13: ~$4 per million characters.
    event["estimatedCostUsd"] = round(event.get("charCount", 0) / 1_000_000 * 4.0, 6)
    return event
