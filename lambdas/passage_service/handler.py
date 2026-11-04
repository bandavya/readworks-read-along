"""IAM-only passage intake and status for the existing Sound Along pipeline."""
import base64
import binascii
import hashlib
import json
import os
import re
from datetime import datetime, timezone

import boto3
from boto3.dynamodb.conditions import Key
from botocore.exceptions import ClientError

CONTENT_BUCKET = os.environ["CONTENT_BUCKET"]
AUDIO_BUCKET = os.environ["AUDIO_BUCKET"]
JOB_TABLE = os.environ["JOB_TABLE"]
SOURCE_BUCKET = os.environ.get("SOURCE_BUCKET", "")
VOICE_ID = os.environ["VOICE_ID"]
ENGINE = os.environ["ENGINE"]
LANGUAGE = os.environ["LANGUAGE"]

s3 = boto3.client("s3")
table = boto3.resource("dynamodb").Table(JOB_TABLE)
ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9-]{0,79}$")
MAX_BYTES = 1024 * 1024
SAFE_FIELDS = ("title", "text", "gradeBand", "lexile", "wordCount", "language")


def response(code, data):
    return {"statusCode": code, "headers": {"Content-Type": "application/json", "Cache-Control": "no-store"},
            "body": json.dumps(data)}


def read_json(bucket, key):
    with s3.get_object(Bucket=bucket, Key=key)["Body"] as body:
        raw = body.read(MAX_BYTES + 1)
    if len(raw) > MAX_BYTES:
        raise ValueError("JSON object exceeds 1 MiB")
    return json.loads(raw)


def existing(bucket, key):
    try:
        return read_json(bucket, key)
    except ClientError as exc:
        if exc.response["Error"]["Code"] in ("NoSuchKey", "404", "NotFound"):
            return None
        raise


def validate_id(value):
    if not isinstance(value, str) or not ID.fullmatch(value) or value.lower() == "index":
        raise ValueError("invalid or reserved passage id")
    return value


def normalized(text):
    return " ".join(text.split())


def reader_text(text):
    """Normalize spacing within lines while retaining paragraph boundaries."""
    return "\n".join(" ".join(line.split()) for line in text.splitlines()).strip()


def safe_vocabulary(value):
    """Retain only the vocabulary fields consumed by the reader bridge."""
    if isinstance(value, list):
        if not all(isinstance(item, dict) and isinstance(item.get("word"), str) for item in value):
            raise ValueError("vocabulary entries need a word")
        if not all(isinstance(item.get(field, ""), str) for item in value for field in ("definition", "example")):
            raise ValueError("vocabulary definitions and examples must be strings")
        return [{field: item[field] for field in ("word", "definition", "example") if field in item}
                for item in value]
    if isinstance(value, dict):
        support = value.get("support")
        senses = support.get("senses") if isinstance(support, dict) else None
        if not isinstance(senses, dict):
            raise ValueError("vocabulary support needs senses")
        clean = {}
        for sense_id, entry in senses.items():
            if not isinstance(sense_id, str) or not isinstance(entry, dict) or not isinstance(entry.get("word"), str):
                raise ValueError("vocabulary senses need an id and word")
            fields = {field: entry[field] for field in ("word", "definition", "example_list", "part_of_speech") if field in entry}
            if not isinstance(fields.get("definition", ""), str) or any(
                not isinstance(fields.get(field, []), list) or
                not all(isinstance(item, str) for item in fields[field])
                for field in ("example_list", "part_of_speech") if field in fields
            ):
                raise ValueError("vocabulary sense fields have invalid types")
            clean[sense_id] = fields
        return {"support": {"senses": clean}}
    raise ValueError("vocabulary must be a list or support object")


def prepare(record):
    if not isinstance(record, dict):
        raise ValueError("passage must be an object")
    pid = validate_id(record.get("passageId", record.get("uuid")))
    if "uuid" in record and "passageId" in record and record["uuid"] != pid:
        raise ValueError("uuid and passageId disagree")
    title, raw_text = record.get("title"), record.get("text")
    if not isinstance(title, str) or not title.strip() or not isinstance(raw_text, str):
        raise ValueError("title and text are required strings")
    text = reader_text(raw_text)
    if not text or len(text.split()) > 20000:
        raise ValueError("text must contain 1 to 20,000 words")
    language = record.get("language", LANGUAGE)
    if language != LANGUAGE:
        raise ValueError("language must match the configured pipeline language")
    # An allowlist is safer than copying source product records to content/<id>.json.
    if "gradeBand" in record and not isinstance(record["gradeBand"], str):
        raise ValueError("gradeBand must be a string")
    for field in ("lexile", "wordCount"):
        if field in record and (not isinstance(record[field], int) or isinstance(record[field], bool)):
            raise ValueError(f"{field} must be an integer")
    clean = {key: record[key] for key in SAFE_FIELDS if key in record}
    clean.update({"passageId": pid, "title": title.strip(), "text": text,
                  "language": language,
                  "soundAlong": {"enabled": True, "audioAccess": "assignment"}})
    if "vocabulary" in record:
        clean["vocabulary"] = safe_vocabulary(record["vocabulary"])
    if len(json.dumps(clean).encode("utf-8")) > MAX_BYTES:
        raise ValueError("passage exceeds 1 MiB")
    basis = f"{normalized(text)}|{VOICE_ID}|{ENGINE}|{language}"
    pipeline_hash = "sha256:" + hashlib.sha256(basis.encode("utf-8")).hexdigest()
    text_hash = hashlib.sha256(text.encode("utf-8")).hexdigest()
    return clean, text_hash, pipeline_hash


def marker_key(pid):
    return f"api-jobs/{pid}.json"


def submit(event):
    raw = event.get("body") or ""
    if event.get("isBase64Encoded"):
        raw = base64.b64decode(raw, validate=True)
    if len(raw.encode("utf-8") if isinstance(raw, str) else raw) > MAX_BYTES:
        raise ValueError("request exceeds 1 MiB")
    request = json.loads(raw)
    if not isinstance(request, dict):
        raise ValueError("request must be an object")
    if request.get("force") is not None and not isinstance(request["force"], bool):
        raise ValueError("force must be a boolean")
    if request.get("force"):
        return response(409, {"error": "force regeneration is unavailable on this pipeline"})
    if "source" in request:
        source = request["source"]
        if not isinstance(source, dict) or set(source) != {"bucket", "key"}:
            raise ValueError("source needs bucket and key")
        bucket, key = source["bucket"], source["key"]
        if bucket not in (CONTENT_BUCKET, SOURCE_BUCKET) or not bucket:
            raise ValueError("source bucket is not configured")
        if not isinstance(key, str) or not key.endswith(".json") or key.startswith("/") or ".." in key.split("/") or "\\" in key or "//" in key:
            raise ValueError("unsafe source key")
        try:
            record = read_json(bucket, key)
        except ClientError as exc:
            if exc.response["Error"]["Code"] in ("NoSuchKey", "404", "NotFound"):
                raise ValueError("source object not found") from exc
            raise
    else:
        record = request
    clean, text_hash, pipeline_hash = prepare(record)
    pid = clean["passageId"]
    marker = existing(CONTENT_BUCKET, marker_key(pid))
    if marker:
        if marker.get("pipeline_hash") != pipeline_hash or marker.get("text_sha256") != text_hash:
            return response(409, {"error": "passage id already has different text or settings"})
        intake = existing(CONTENT_BUCKET, f"passages/{pid}.json")
        if intake is None:
            age = (datetime.now(timezone.utc) - datetime.fromisoformat(marker["submitted_at"])).total_seconds()
            if age < 45:
                return response(202, status(pid, marker, reused=True))
            s3.put_object(Bucket=CONTENT_BUCKET, Key=f"passages/{pid}.json",
                          Body=json.dumps(clean).encode("utf-8"), ContentType="application/json",
                          IfNoneMatch="*")
            return response(202, status(pid, marker, reused=True))
        if intake != clean:
            return response(409, {"error": "intake object differs from this submission"})
        return response(200, status(pid, marker, reused=True))
    # Never overwrite an operator's direct S3 upload at this id.
    try:
        s3.head_object(Bucket=CONTENT_BUCKET, Key=f"passages/{pid}.json")
        return response(409, {"error": "passage id already exists outside this API"})
    except ClientError as exc:
        if exc.response["Error"]["Code"] not in ("NoSuchKey", "404", "NotFound"):
            raise
    marker = {"id": pid, "text_sha256": text_hash, "pipeline_hash": pipeline_hash,
              "voice": VOICE_ID, "submitted_at": datetime.now(timezone.utc).isoformat(),
              "words": clean["text"].split()}
    try:
        s3.put_object(Bucket=CONTENT_BUCKET, Key=marker_key(pid),
                      Body=json.dumps(marker).encode("utf-8"), ContentType="application/json",
                      IfNoneMatch="*")
    except ClientError as exc:
        if exc.response["Error"]["Code"] in ("PreconditionFailed", "ConditionalRequestConflict"):
            return response(409, {"error": "concurrent submission; retry GET"})
        raise
    s3.put_object(Bucket=CONTENT_BUCKET, Key=f"passages/{pid}.json",
                  Body=json.dumps(clean).encode("utf-8"), ContentType="application/json",
                  IfNoneMatch="*")
    return response(202, status(pid, marker))


def status(pid, marker, reused=False):
    result = {"id": pid, "status": "queued", "reused": reused,
              "voice": marker["voice"], "text_sha256": marker["text_sha256"],
              "words": marker["words"], "reasons": [], "audio_url": None,
              "timing_url": None, "timing_json_url": None,
              "status_path": f"/v1/passages/{pid}"}
    rows = table.query(KeyConditionExpression=Key("passageId").eq(pid), ConsistentRead=True).get("Items", [])
    matching = next((row for row in rows if row.get("textHash") == marker["pipeline_hash"]), None)
    if matching and matching.get("status") == "reader_publish_failed":
        result.update(status="failed", reasons=["reader publication failed; inspect the job row"])
        return result
    if matching and matching.get("status") == "held":
        review = existing(CONTENT_BUCKET, f"review/{pid}.json")
        reasons = (review.get("reasons") if review and review.get("status") == "held"
                   and review.get("passageId") == pid
                   and review.get("textHash") == marker["pipeline_hash"]
                   else matching.get("holdReasons"))
        result.update(status="held", reasons=reasons if isinstance(reasons, list)
                      and all(isinstance(reason, str) for reason in reasons)
                      else ["quality gate held this passage; inspect the job row"])
        return result
    if matching and matching.get("status") in ("running", "approved", "generated"):
        result["status"] = "running"
    manifest = existing(CONTENT_BUCKET, f"manifests/{pid}.json")
    content = existing(CONTENT_BUCKET, f"content/{pid}.json")
    if manifest and manifest.get("textHash") == marker["pipeline_hash"] and content:
        audio_key, marks_key = manifest.get("audioKey"), manifest.get("speechMarksKey")
        if (manifest.get("status") in ("approved", "generated") and manifest.get("voiceId") == marker["voice"]
                and content.get("passageId") == pid and hashlib.sha256(content.get("text", "").encode("utf-8")).hexdigest() == marker["text_sha256"]
                and content.get("audioManifest", {}).get("audioKey") == audio_key
                and content.get("audioManifest", {}).get("speechMarksKey") == marks_key
                and audio_key and marks_key):
            try:
                s3.head_object(Bucket=AUDIO_BUCKET, Key=audio_key)
                s3.head_object(Bucket=AUDIO_BUCKET, Key=marks_key)
            except ClientError:
                result.update(status="failed", reasons=["published audio or speech marks missing"])
            else:
                result.update(status="published",
                              audio_url=s3.generate_presigned_url("get_object", Params={"Bucket": AUDIO_BUCKET, "Key": audio_key}, ExpiresIn=900),
                              timing_json_url=s3.generate_presigned_url("get_object", Params={"Bucket": AUDIO_BUCKET, "Key": marks_key}, ExpiresIn=900))
        else:
            result.update(status="failed", reasons=["published artifacts do not match the submission"])
    elif matching and matching.get("status") not in ("running", "approved", "generated"):
        result.update(status="failed", reasons=["pipeline job did not complete"])
    if result["status"] in ("queued", "running"):
        age = (datetime.now(timezone.utc) - datetime.fromisoformat(marker["submitted_at"])).total_seconds()
        if age > 25 * 60:
            result.update(status="failed", reasons=["no pipeline result after 25 minutes; inspect workflow before retrying"])
    return result


def handle(event, _context):
    try:
        route = event.get("resource", "") + " " + event.get("httpMethod", "")
        if route == "/v1/passages POST":
            return submit(event)
        if route == "/v1/passages/{id} GET":
            pid = validate_id((event.get("pathParameters") or {}).get("id"))
            marker = existing(CONTENT_BUCKET, marker_key(pid))
            return response(200, status(pid, marker)) if marker else response(404, {"error": "job not found"})
        return response(404, {"error": "not found"})
    except (ValueError, UnicodeError, binascii.Error) as exc:
        return response(400, {"error": str(exc)})
    except ClientError as exc:
        if exc.response["Error"]["Code"] in ("AccessDenied", "403"):
            return response(403, {"error": "source or storage access denied"})
        return response(500, {"error": "storage or job lookup failed"})
