"""The listening step on Amazon Transcribe: the same job in, the same word list out, no GPU. Off unless serve.py is started with --listener amazon.

NOT YET RUN ON AWS. Tested only against a stand-in, so expect to adjust it on the event account. It uses an existing bucket, and creates no other resource.
Differences from the on-device listener: one listen, so a reader sees every spot it raises rather than only those two listens agree on; no name hints; each
check is a whole-file job, so marks will be slower. Billed per audio minute: say the cost before running it (see loops_2026-10-31/l9_human_recorder/transcribe_compare.py).
"""
import hashlib
import json
import os
import subprocess
import time

from common import transcribe_words

LANGUAGE = {"en": "en-US", "es": "es-US"}


class Settings:
    def __init__(self, profile, region, bucket):
        self.profile, self.region, self.bucket = profile, region, bucket


def aws(settings, *cmd):
    out = subprocess.run(["aws", *cmd, "--profile", settings.profile, "--region", settings.region], capture_output=True, text=True, timeout=300)
    if out.returncode:
        raise RuntimeError("AWS refused: " + out.stderr[-600:])
    return out.stdout


def run_job(settings, path, language, poll_seconds=5):
    """Upload, transcribe, fetch the result to <path>.transcribe.json, and always remove the upload, the output and the job."""
    with open(path, "rb") as f:
        sha = hashlib.sha256(f.read()).hexdigest()[:12]
    ext = os.path.splitext(path)[1]
    key, out_key, job = f"recorder-listen/{sha}{ext}", f"recorder-listen/{sha}.json", f"recorder-{sha}-{int(time.time())}"
    aws(settings, "s3", "cp", path, f"s3://{settings.bucket}/{key}", "--only-show-errors")
    try:
        aws(settings, "transcribe", "start-transcription-job", "--transcription-job-name", job, "--language-code", language,
            "--media", f"MediaFileUri=s3://{settings.bucket}/{key}", "--output-bucket-name", settings.bucket, "--output-key", out_key)
        try:
            while True:
                state = json.loads(aws(settings, "transcribe", "get-transcription-job", "--transcription-job-name", job))["TranscriptionJob"]
                if state["TranscriptionJobStatus"] in ("COMPLETED", "FAILED"):
                    break
                time.sleep(poll_seconds)
            if state["TranscriptionJobStatus"] == "FAILED":
                raise RuntimeError("Transcribe failed: " + str(state.get("FailureReason")))
            local = path + ".transcribe.json"
            aws(settings, "s3", "cp", f"s3://{settings.bucket}/{out_key}", local, "--only-show-errors")
            return local
        finally:
            aws(settings, "transcribe", "delete-transcription-job", "--transcription-job-name", job)
    finally:
        for k in (key, out_key):
            try:
                aws(settings, "s3", "rm", f"s3://{settings.bucket}/{k}", "--only-show-errors")
            except RuntimeError:
                pass


def speech_job(settings, job):
    """Same contract as serve.speech_job: writes job["out"], returns (code, error text)."""
    try:
        t0 = time.time()
        local = run_job(settings, job["path"], LANGUAGE.get(job["lang"], "en-US"))
        with open(local, encoding="utf-8") as f:
            words = [list(w) for w in transcribe_words(json.load(f))]
        result = {"words": words, "duration": max((w[2] for w in words), default=0.0), "model": "amazon-transcribe", "seconds": round(time.time() - t0, 1)}
        with open(job["out"] + ".tmp", "w", encoding="utf-8") as f:
            json.dump(result, f, ensure_ascii=False)
        os.replace(job["out"] + ".tmp", job["out"])
        return 0, ""
    except (RuntimeError, OSError, ValueError, KeyError, subprocess.TimeoutExpired) as error:
        return 1, repr(error)[-800:]
