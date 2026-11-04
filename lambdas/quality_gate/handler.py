"""Check Polly audio against passage words before any publishing task runs."""
import hashlib
import json
import os
import re
from datetime import datetime, timezone

import boto3

import comparison
import names


def _read_json(s3, bucket, key):
    with s3.get_object(Bucket=bucket, Key=key)["Body"] as body:
        return json.loads(body.read())


def _review_key(event):
    passage_id = event["passageId"]
    if not re.fullmatch(r"[A-Za-z0-9-]+", passage_id):
        raise ValueError("unsafe passage ID for review path")
    return f"review/{passage_id}.json"


def start(event, _context):
    job_name = "sound-along-qg-" + hashlib.sha256(event["audioTaskId"].encode()).hexdigest()[:40]
    transcribe = boto3.client("transcribe")
    transcribe.start_transcription_job(
        TranscriptionJobName=job_name,
        LanguageCode=event["language"],
        MediaFormat="mp3",
        Media={"MediaFileUri": f"s3://{os.environ['AUDIO_BUCKET']}/{event['pollyAudioKey']}"},
        OutputBucketName=os.environ["AUDIO_BUCKET"],
        OutputKey=f"transcribe/{job_name}.json",
    )
    return {**event, "transcribeJobName": job_name, "transcribeStatus": "running"}


def _hold(event, s3, table, reasons, report=None):
    key = _review_key(event)
    doc = {
        "passageId": event["passageId"],
        "textHash": event["textHash"],
        "status": "held",
        "reasons": reasons,
        "flags": (report or {}).get("flags", []),
        "acceptedNames": (report or {}).get("accepted_names", []),
        "transcribeJobName": event["transcribeJobName"],
        "checkedAt": datetime.now(timezone.utc).isoformat(),
    }
    s3.put_object(Bucket=os.environ["CONTENT_BUCKET"], Key=key,
                  Body=json.dumps(doc, ensure_ascii=False).encode("utf-8"),
                  ContentType="application/json")
    table.update_item(
        Key={"passageId": event["passageId"], "textHash": event["textHash"]},
        UpdateExpression="SET #s = :held, reviewKey = :key, holdReasons = :reasons, updatedAt = :now",
        ExpressionAttributeNames={"#s": "status"},
        ExpressionAttributeValues={":held": "held", ":key": key, ":reasons": reasons,
                                   ":now": doc["checkedAt"]},
    )
    return {**event, "transcribeStatus": "done", "qualityGatePassed": False,
            "reviewKey": key, "holdReasons": reasons}


def check(event, _context):
    transcribe = boto3.client("transcribe")
    job = transcribe.get_transcription_job(TranscriptionJobName=event["transcribeJobName"])["TranscriptionJob"]
    status = job["TranscriptionJobStatus"]
    if status in ("QUEUED", "IN_PROGRESS"):
        return {**event, "transcribeStatus": "running"}

    s3 = boto3.client("s3")
    table = boto3.resource("dynamodb").Table(os.environ["JOB_TABLE"])
    if status != "COMPLETED":
        return _hold(event, s3, table, ["Speech recognition could not finish: " +
                                        str(job.get("FailureReason") or status)])

    try:
        transcript = _read_json(s3, os.environ["AUDIO_BUCKET"],
                                f"transcribe/{event['transcribeJobName']}.json")
        spoken = comparison.transcribe_words(transcript)
        written = event["rawText"].split()
        entries = names.load(s3, os.environ["CONTENT_BUCKET"])
        _, report = comparison.reconcile(spoken, [], written, names=entries,
                                         scope=event["passageId"],
                                         language=event["language"].split("-")[0])
        if not written or not any(comparison.tokens(word) for word in written):
            return _hold(event, s3, table, ["Passage has no words to check"])
    except (KeyError, TypeError, ValueError, IndexError) as exc:
        return _hold(event, s3, table, ["Speech recognition result could not be compared: " + str(exc)])

    if report["flag_count"]:
        return _hold(event, s3, table, comparison.word_reasons(report), report)
    return {**event, "transcribeStatus": "done", "qualityGatePassed": True}


def check_existing_manifest(event, _context):
    """Gated runs reuse only an earlier voice-checked result."""
    table = boto3.resource("dynamodb").Table(os.environ["JOB_TABLE"])
    item = table.get_item(Key={"passageId": event["passageId"],
                               "textHash": event["textHash"]}).get("Item")
    finished = bool(item and item.get("status") == "generated")
    # A checked passage the reader never received is sent again, without new audio.
    event["readerNeedsPublish"] = bool(item and item.get("status") in ("generated", "reader_publish_failed")
                                       and not item.get("readerPublishedAt") and item.get("audioKey")
                                       and item.get("speechMarksKey"))
    if event["readerNeedsPublish"]:
        event["audioKey"] = item["audioKey"]
        event["pollyMarksKey"] = item["speechMarksKey"]
    event["cached"] = finished or event["readerNeedsPublish"]
    if not event["cached"]:
        table.put_item(Item={
            "passageId": event["passageId"], "textHash": event["textHash"],
            "status": "running", "voiceId": os.environ["VOICE_ID"],
            "engine": os.environ["ENGINE"], "charCount": event["charCount"],
            "updatedAt": datetime.now(timezone.utc).isoformat(),
        })
    return event


def write_manifest(event, _context):
    """The team's manifest shape, with an honest status after word checking."""
    if event.get("qualityGatePassed") is not True:
        raise ValueError("voice check did not pass")
    s3 = boto3.client("s3")
    audio_bucket = os.environ["AUDIO_BUCKET"]
    content_bucket = os.environ["CONTENT_BUCKET"]
    s3.copy_object(Bucket=audio_bucket,
                   CopySource={"Bucket": audio_bucket, "Key": event["pollyAudioKey"]},
                   Key=event["audioKey"], ContentType="audio/mpeg")
    s3.put_object(Bucket=audio_bucket, Key=event["speechMarksKey"],
                  Body=json.dumps(event["speechMarks"]).encode("utf-8"),
                  ContentType="application/json")
    manifest = {
        "passageId": event["passageId"], "textHash": event["textHash"],
        "audioId": event["audioId"], "audioProvider": "amazon-polly",
        "audioType": "synthetic", "voiceId": event["voiceId"],
        "engine": event["engine"], "language": event["language"],
        "audioKey": event["audioKey"], "speechMarksKey": event["speechMarksKey"],
        "status": "generated", "reviewStatus": "needs human check",
        "createdAt": datetime.now(timezone.utc).isoformat(),
    }
    s3.put_object(Bucket=content_bucket, Key=f"manifests/{event['passageId']}.json",
                  Body=json.dumps(manifest, indent=2).encode("utf-8"),
                  ContentType="application/json")
    boto3.resource("dynamodb").Table(os.environ["JOB_TABLE"]).put_item(Item={
        "passageId": event["passageId"], "textHash": event["textHash"],
        "status": "generated", "reviewStatus": "needs human check",
        "voiceId": event["voiceId"], "engine": event["engine"],
        "audioKey": event["audioKey"], "speechMarksKey": event["speechMarksKey"],
        "charCount": event["charCount"],
        "updatedAt": datetime.now(timezone.utc).isoformat(),
    })
    event["manifest"] = manifest
    return event
