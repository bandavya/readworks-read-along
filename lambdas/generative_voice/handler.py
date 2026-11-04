"""Optional generative-voice mode: Polly generative audio, word times from Amazon Transcribe.

Polly generative voices cannot return speech marks, so this mode makes the MP3 only, asks Transcribe when each word
is said, and writes a speech-marks-shaped file that the existing validate, manifest and reader steps read unchanged.

The functions here replace or extend steps in lambdas/worker, lambdas/quality_gate and lambdas/reader_bridge by
loading those files rather than copying them, so the default pipeline's code stays exactly as it is.
"""
import difflib
import hashlib
import importlib.util
import json
import os
import re
import sys

import boto3

HERE = os.path.dirname(os.path.abspath(__file__))
LAMBDAS = os.path.dirname(HERE)
for _dir in ("quality_gate", "worker"):
    if os.path.join(LAMBDAS, _dir) not in sys.path:
        sys.path.insert(0, os.path.join(LAMBDAS, _dir))

import comparison  # noqa: E402  (lambdas/quality_gate)

MIN_ALIGNED = 0.8
SOURCE_TEXT = "Polly generative, timed by Amazon Transcribe"
GAP_SECONDS = 0.3   # spacing used when a missed word has no later neighbor to measure against


class MarksError(ValueError):
    """The recognized words are too far from the written text to time it."""


def _load(name, relative):
    if name not in sys.modules:
        spec = importlib.util.spec_from_file_location(name, os.path.join(LAMBDAS, relative))
        module = importlib.util.module_from_spec(spec)
        sys.modules[name] = module
        spec.loader.exec_module(module)
    return sys.modules[name]


def _worker():
    return _load("worker_handler", "worker/handler.py")


# ---------------------------------------------------------------------------
# Audio only: no speech marks task
# ---------------------------------------------------------------------------
def submit_polly(event, _context):
    worker = _worker()
    audio_id = worker._audio_id(event["title"], event["passageId"])
    event["audioId"] = audio_id
    event["audioKey"] = f"audio/{audio_id}.mp3"
    event["speechMarksKey"] = f"audio/{audio_id}.speechmarks.json"
    task = worker.polly.start_speech_synthesis_task(
        Text=event["normalizedText"],
        VoiceId=worker.VOICE_ID,
        LanguageCode=event["language"],
        OutputS3BucketName=worker.AUDIO_BUCKET,
        Engine=worker.ENGINE,
        OutputFormat="mp3",
        OutputS3KeyPrefix=f"polly/{audio_id}/audio",
    )["SynthesisTask"]
    event["audioTaskId"] = task["TaskId"]
    event["audioTaskUri"] = task["OutputUri"]
    event["pollyStatus"] = "running"
    return event


def check_polly(event, _context):
    worker = _worker()
    task = worker.polly.get_speech_synthesis_task(TaskId=event["audioTaskId"])["SynthesisTask"]
    if task["TaskStatus"] == "failed":
        event["pollyStatus"] = "failed"
        event["pollyFailureReason"] = task.get("TaskStatusReason")
    elif task["TaskStatus"] == "completed":
        event["pollyStatus"] = "completed"
        event["pollyAudioKey"] = worker._key_from_uri(task["OutputUri"])
    else:
        event["pollyStatus"] = "running"
    return event


# ---------------------------------------------------------------------------
# Transcribe -> speech marks
# ---------------------------------------------------------------------------
def _job_name(event):
    # Same name and output key the voice check uses, so that step can read this job instead of starting another.
    return "sound-along-qg-" + hashlib.sha256(event["audioTaskId"].encode()).hexdigest()[:40]


def start_transcription(event, _context):
    job_name = _job_name(event)
    boto3.client("transcribe").start_transcription_job(
        TranscriptionJobName=job_name,
        LanguageCode=event["language"],
        MediaFormat="mp3",
        Media={"MediaFileUri": f"s3://{os.environ['AUDIO_BUCKET']}/{event['pollyAudioKey']}"},
        OutputBucketName=os.environ["AUDIO_BUCKET"],
        OutputKey=f"transcribe/{job_name}.json",
    )
    return {**event, "transcribeJobName": job_name, "transcribeStatus": "running"}


def _has_word(text):
    return any(ch.isalnum() for ch in text)


def build_marks(text, spoken, language="en"):
    """Align Transcribe's words to the written text and return (marks, report).

    `spoken` is [(word, start_seconds, end_seconds)]. Marks look like Polly's: one `word` mark per written
    word that has letters or digits, with byte offsets into `text` and a time in whole milliseconds.
    Raises MarksError when fewer than 80% of the spoken words line up with the written words.
    """
    found = list(re.finditer(r"\S+", text))
    written = [m.group() for m in found]
    heard = [w for w, _, _ in spoken]
    # Numbers are spoken out and hyphens split on both sides, so "12" and "twelve" are the same token.
    a = comparison._tok_pairs(written, language)
    b = comparison._tok_pairs(heard, language)
    if not b:
        raise MarksError("Transcribe returned no words")
    if not a:
        raise MarksError("the passage has no words to time")

    starts = {}
    aligned = 0
    ops = difflib.SequenceMatcher(None, [t for t, _ in a], [t for t, _ in b], autojunk=False).get_opcodes()
    for tag, i0, i1, j0, j1 in ops:
        if tag == "equal":
            aligned += j1 - j0
            for k in range(i1 - i0):
                starts.setdefault(a[i0 + k][1], spoken[b[j0 + k][1]][1])
        elif tag == "replace":
            # A different spelling of a name, or a number said another way. When both sides have the same number
            # of words, take them in order for timing. A capitalized or numeric written word counts as aligned;
            # a changed ordinary word gets its time but does not count toward the 80%.
            mine = sorted({a[i][1] for i in range(i0, i1)})
            theirs = sorted({b[j][1] for j in range(j0, j1)})
            if len(mine) == len(theirs):
                for x, y in zip(mine, theirs):
                    starts.setdefault(x, spoken[y][1])
                    if written[x][:1].isupper() or any(ch.isdigit() for ch in written[x]):
                        aligned += sum(1 for j in range(j0, j1) if b[j][1] == y)
    share = aligned / len(b)
    if share < MIN_ALIGNED:
        raise MarksError(f"only {aligned} of {len(b)} spoken words ({share:.0%}) matched the written text; "
                         f"at least {MIN_ALIGNED:.0%} are needed")

    # A written word Transcribe did not return gets an evenly spaced time between its neighbors.
    need = [i for i, w in enumerate(written) if _has_word(w)]
    times, estimated = {}, 0
    last_end = max((end for _, _, end in spoken), default=0.0)
    run, previous = [], None
    for i in need + [None]:
        if i is not None and i not in starts:
            run.append(i)
            continue
        if run:
            estimated += len(run)
            if previous is None:
                left, right, offset, count = 0.0, starts[i], 0, len(run)
            elif i is None:
                left = times[previous]
                right = left + max(last_end - left, GAP_SECONDS * (len(run) + 1))
                offset, count = 1, len(run) + 1
            else:
                left, right, offset, count = times[previous], starts[i], 1, len(run) + 1
            for k, word in enumerate(run):
                times[word] = left + (right - left) * (k + offset) / count
        if i is not None:
            times[i] = starts[i]
            previous = i
        run = []

    marks, last = [], -1
    for i in need:
        match = found[i]
        at = max(round(times[i] * 1000), last + 1)
        last = at
        marks.append({"time": at, "type": "word",
                      "start": len(text[:match.start()].encode("utf-8")),
                      "end": len(text[:match.end()].encode("utf-8")),
                      "value": match.group()})
    return marks, {"spokenWords": len(b), "alignedWords": aligned, "estimatedWords": estimated}


def _fail(event, reason):
    worker = _worker()
    worker._table().update_item(
        Key={"passageId": event["passageId"], "textHash": event["textHash"]},
        UpdateExpression="SET #s = :s, failureReason = :r, updatedAt = :u",
        ExpressionAttributeNames={"#s": "status"},
        ExpressionAttributeValues={":s": "failed", ":r": reason, ":u": worker._now()},
    )
    return {**event, "transcribeStatus": "failed", "pollyStatus": "failed", "pollyFailureReason": reason}


def check_transcription(event, _context):
    job = boto3.client("transcribe").get_transcription_job(
        TranscriptionJobName=event["transcribeJobName"])["TranscriptionJob"]
    status = job["TranscriptionJobStatus"]
    if status in ("QUEUED", "IN_PROGRESS"):
        return {**event, "transcribeStatus": "running"}
    if status != "COMPLETED":
        return _fail(event, "Speech recognition could not finish: " + str(job.get("FailureReason") or status))

    s3 = boto3.client("s3")
    bucket = os.environ["AUDIO_BUCKET"]
    try:
        with s3.get_object(Bucket=bucket, Key=f"transcribe/{event['transcribeJobName']}.json")["Body"] as body:
            transcript = json.loads(body.read())
        marks, report = build_marks(event["normalizedText"], comparison.transcribe_words(transcript),
                                    event["language"].split("-")[0])
    except Exception as exc:  # noqa: BLE001  (a missing transcript must end the run with a reason, too)
        return _fail(event, "Word times could not be built from speech recognition: " + str(exc))

    marks_key = f"polly/{event['audioId']}/marks/transcribe.json"
    body = "\n".join(json.dumps(mark, ensure_ascii=False) for mark in marks)
    s3.put_object(Bucket=bucket, Key=marks_key, Body=body.encode("utf-8"), ContentType="application/json")
    return {**event, "transcribeStatus": "done", "pollyMarksKey": marks_key, "timingReport": report}


# ---------------------------------------------------------------------------
# Reader bridge: same publish, honest source label
# ---------------------------------------------------------------------------
def bridge(event, context):
    reader = _load("reader_bridge_handler", "reader_bridge/handler.py")
    real = reader._write_json

    def write(s3, bucket, key, value):
        if key == f"data/{event['passageId']}.json":
            for voice in value.get("voices", []):
                if voice.get("text_hash") == event["textHash"]:
                    voice["source"] = SOURCE_TEXT
        real(s3, bucket, key, value)

    reader._write_json = write
    try:
        return reader.handler(event, context)
    finally:
        reader._write_json = real
