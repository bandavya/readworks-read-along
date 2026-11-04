"""Speech jobs, run with the WhisperX venv (needs av<16).

  python hear.py serve      jobs as JSON lines on stdin, recognizer kept loaded; exits after IDLE_EXIT_S with no job, which frees the GPU.
                            Loading is most of the wait on a short reading (about 4.6 s of 6 s; see LOOPS_LOG Loop 9).
  python hear.py words <audio> <out.json> [--lang en] [--names "A B"]     what was said, with rough word times (for marking words)
  python hear.py final <audio> <out.json> [--lang en] [--names "A B"]     the same plus finer word times (for the finished file)

Whisper hears WITHOUT being told the passage: a prompt with the text would make a misread sound right. It is told only the
passage's proper names, which it can only guess the spelling of (loops_2026-10-31/l9_human_recorder: false alarms 9 -> 5 on six
real readings, planted misreads still caught). The cost: a misread name is more likely to be heard as the right one.
Exit code 3 means the GPU is busy or out of memory (try again later); anything else non-zero is a real failure.
The caller gives each word list to human.build_timing, the same call the AWS route makes with Amazon Transcribe's words.
"""
import json
import os
import sys
import threading
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", "..", "aws-lab", "pipeline-slice", "lambda"))

MODEL = "small"                      # what align_batch.py uses on this project's 8 GB GPU
SECOND_LISTEN_WORDS = 3              # (pencil) flagged stretches this long get a second listen
IDLE_EXIT_S = 300                    # (pencil) how long the recognizer may sit on the shared GPU unused
BUSY = ("out of memory", "cuda failed", "cublas", "device-side assert")


loaded = None


def listen(path, lang, names=None, uid=None):
    import torch
    os.add_dll_directory(os.path.join(os.path.dirname(torch.__file__), "lib"))
    from faster_whisper import WhisperModel
    global loaded
    if loaded is None:
        loaded = WhisperModel(MODEL, device="cuda", compute_type="float16")
    model = loaded

    def run(hints=names, **extra):
        # Low-confidence words are kept: measured in dropout_trial.py, this drops a little less speech and invents less.
        segments, info = model.transcribe(path, language=lang, word_timestamps=True, condition_on_previous_text=False, hotwords=hints or None,
                                          no_speech_threshold=None, log_prob_threshold=None, **extra)
        import engine
        return engine.join_number_parts([[w.word.strip(), round(w.start, 3), round(w.end, 3)] for s in segments for w in (s.words or []) if w.word.strip()]), info
    words, info = run()
    plain, _ = run(hints=None)          # the second opinion: each listen makes different mistakes (l9_human_recorder/two_listens.py)
    return second_listen(run, words, uid, lang), second_listen(run, plain, uid, lang), round(info.duration, 3)


def second_listen(run, words, uid, lang):
    """Whisper sometimes skips a stretch someone really read. Listen again to just that stretch, still without the text, and keep the
    new words only if more of the written words then match. A word really left out stays left out: the second listen can't hear it either.
    Only for a whole reading: on a short reread nearly the whole story looks missing, and invented names then look like an improvement."""
    if not uid or not words:
        return words
    import engine
    with open(os.path.join(HERE, "..", "data", "passages", uid + ".json"), encoding="utf-8") as f:
        script = engine.script_for(json.load(f))
    language = "es-US" if lang == "es" else "en-US"
    timing, _, _ = engine.compare(words, script, uid, language)
    rows = timing["t"]
    for flag in [f for f in timing["flags"] if not f.get("advisory") and len(f["written"].split()) >= SECOND_LISTEN_WORDS]:
        i, n = flag["word_index"], len(flag["written"].split())
        t0 = rows[i - 1][1] - 0.2 if i > 0 else 0.0
        t1 = rows[i + n][0] + 0.2 if i + n < len(rows) else words[-1][2] + 1.0
        if t1 - t0 < 0.3:
            continue
        again, _ = run(hints=None, clip_timestamps=[max(0.0, t0), t1])    # with hints a short clip can come back as the hints themselves
        better = sorted([w for w in words if not t0 <= (w[1] + w[2]) / 2 < t1] + [w for w in again if t0 <= (w[1] + w[2]) / 2 < t1], key=lambda w: w[1])
        before = engine.compare(words, script, uid, language)[0]["checks"]["text_match"]
        if engine.compare(better, script, uid, language)[0]["checks"]["text_match"] > before:
            words = better
    return words


def align(path, words, lang):
    """Finer times for what Whisper heard: one forced-alignment block over the whole file (the spike showed windows can slide).
    Digits have no sounds the aligner knows, so they are spelled out first with the pipeline's own number rules. A word the
    aligner could not time keeps Whisper's time, and is counted."""
    import whisperx
    from common import tokens
    audio = whisperx.load_audio(path)
    model, meta = whisperx.load_align_model(language_code=lang, device="cuda")
    said = []
    for w, s, e in words:
        spelled = tokens(w, lang) if any(c.isdigit() for c in w) else [w]
        step = (e - s) / max(1, len(spelled))
        said += [[t, s + step * k, s + step * (k + 1)] for k, t in enumerate(spelled)]
    block = [{"start": 0.0, "end": len(audio) / 16000, "text": " ".join(w for w, _, _ in said)}]
    result = whisperx.align(block, model, meta, audio, "cuda", return_char_alignments=False)
    aligned = [w for seg in result["segments"] for w in seg.get("words", [])]
    plain = lambda s: "".join(c for c in s.lower() if c.isalnum())   # noqa: E731
    out, j, unaligned = [], 0, 0
    for w, s, e in said:                 # map by text, not position: the aligner's sentence splitter can cut a token in two
        want, got, first, last, k = plain(w), "", None, None, j
        while k < len(aligned) and len(got) < len(want):
            got += plain(aligned[k].get("word", ""))
            if aligned[k].get("start") is not None:
                first = first if first is not None else aligned[k]
                last = aligned[k]
            k += 1
        if want and got == want and first is not None:
            j = k
            out.append([w, round(float(first["start"]), 3), round(float(last["end"]), 3)])
        else:
            if want and got == want:
                j = k
            unaligned += 1
            out.append([w, round(s, 3), round(e, 3)])
    return out, unaligned


def run_job(mode, path, dst, lang="en", names=None, uid=None):
    t0 = time.time()
    words, plain, duration = listen(path, lang, names, uid)
    result = {"words": words, "plain": plain, "duration": duration, "model": MODEL, "seconds_listening": round(time.time() - t0, 1)}
    if mode == "final":
        result["whisper_words"] = words
        result["words"], result["unaligned"] = align(path, words, lang) if words else ([], 0)
        import torch
        torch.cuda.empty_cache()     # the aligner only sits on the GPU for the job that needs it
    result["seconds"] = round(time.time() - t0, 1)
    with open(dst + ".tmp", "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False)
    os.replace(dst + ".tmp", dst)


def is_busy(error):
    return any(b in str(error).lower() for b in BUSY)


def serve_jobs():
    global loaded
    idle = None
    for line in sys.stdin:
        if idle:
            idle.cancel()
        job = json.loads(line)
        try:
            run_job(job["mode"], job["path"], job["out"], job["lang"], job.get("names"), job.get("passage"))
            reply = {"code": 0}
        except Exception as error:   # noqa: BLE001
            if is_busy(error):
                loaded = None        # let go of the GPU while waiting to try again
            reply = {"code": 3 if is_busy(error) else 1, "error": repr(error)[-800:]}
        print("@@done " + json.dumps(reply), flush=True)
        idle = threading.Timer(IDLE_EXIT_S, os._exit, [0])
        idle.daemon = True
        idle.start()


def main():
    if sys.argv[1] == "serve":
        return serve_jobs()
    mode, path, dst = sys.argv[1:4]
    arg = lambda name, default=None: sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default   # noqa: E731
    run_job(mode, path, dst, arg("--lang", "en"), arg("--names"), arg("--passage"))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:   # noqa: BLE001
        print(repr(error), file=sys.stderr)
        sys.exit(3 if is_busy(error) else 1)
