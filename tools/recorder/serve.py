"""The volunteer recorder: a page, a small local server, one job at a time. Standard library + ffmpeg + the speech venv.

  python tools/recorder/serve.py [--port 8975] [--reader URL] [--site READER_PUBLIC_FOLDER]

Then open http://localhost:8975/ in Chrome or Edge (a microphone needs localhost or HTTPS). Only this computer can reach it.
Recordings, reports and the original takes stay in human_recordings/ (git-ignored). See README.md.
"""
import argparse
import datetime
import functools
import hashlib
import http.server
import json
import mimetypes
import os
import queue
import re
import shutil
import subprocess
import threading
import time
from urllib.parse import parse_qs, urlparse

import engine
import listen_amazon
import to_reader
import voice_clean

HERE = os.path.dirname(os.path.abspath(__file__))
PAGE = os.path.join(HERE, "page")
STORE = os.path.join(HERE, "human_recordings", "sessions")
PASSAGES = os.path.join(HERE, "private", "passages")
SPEECH_PYTHON = os.environ.get("SOUND_ALONG_SPEECH_PYTHON", "")
MAX_UPLOAD = 60 * 1024 * 1024      # human.MAX_RECORDING_BYTES
BUSY_TRIES, BUSY_WAIT_S = 8, 20
SITE = to_reader.DEFAULT_SITE
READER = os.environ.get("SOUND_ALONG_READER_URL", "")
TEST_AUDIO = None                  # only set by --test-audio, so a test can feed a file through the real recorder

JOBS = queue.Queue()
job_state = {}                     # session id -> {"step": plain words, "error": plain words or None, "busy": bool}
lock = threading.RLock()


class Unusable(Exception):
    """A plain-language problem to show the person."""


# ---------------------------------------------------------------------------------------------------------------------
# Sessions
# ---------------------------------------------------------------------------------------------------------------------
def folder(sid):
    if not re.fullmatch(r"[0-9a-f]{8}-\d{8}-\d{6}-\d{3}", sid):
        raise Unusable("That recording could not be found.")
    return os.path.join(STORE, sid)


def load(sid):
    with open(os.path.join(folder(sid), "session.json"), encoding="utf-8") as f:
        return json.load(f)


def save(s):
    path = os.path.join(folder(s["id"]), "session.json")
    with open(path + ".tmp", "w", encoding="utf-8") as f:
        json.dump(s, f, ensure_ascii=False)
    os.replace(path + ".tmp", path)


def passage(uid):
    if not re.fullmatch(r"[0-9a-fA-F-]{36}", uid):
        raise Unusable("That story could not be found.")
    try:
        with open(os.path.join(PASSAGES, uid + ".json"), encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        raise Unusable("That story is not in the configured passage folder.")


def language_of(doc):
    return "es-US" if str(doc.get("lang") or "").upper().startswith("ES") else "en-US"


def new_session(uid):
    doc = passage(uid)
    while True:                        # two tabs at the same moment must never share a folder
        now = datetime.datetime.now()
        sid = f"{uid[:8]}-{now:%Y%m%d-%H%M%S}-{now.microsecond // 1000:03d}"
        try:
            os.makedirs(folder(sid))
            break
        except FileExistsError:
            time.sleep(0.01)
    s = {"id": sid, "uid": uid, "title": doc.get("title"), "language": language_of(doc), "created": time.time(), "takes": 0,
         "current": None, "revs": {}, "candidate": None, "accepted": [], "span": None, "finish": None, "submission": None, "review": None, "published": None, "pending": None}
    save(s)
    return s


def latest_session(uid):
    if not os.path.isdir(STORE):
        return None
    names = sorted(n for n in os.listdir(STORE) if n.startswith(uid[:8] + "-"))
    return load(names[-1]) if names else None


def rev_file(s, rev, ext="f32"):
    return os.path.join(folder(s["id"]), f"rev{rev}.{ext}")


def add_rev(s, samples, spoken, note):
    rev = max([int(k) for k in s["revs"]] + [0]) + 1
    engine.write_raw(rev_file(s, rev), samples)
    engine.raw_to_wav(rev_file(s, rev), rev_file(s, rev, "wav"))
    frames = engine.levels(samples)
    s["revs"][str(rev)] = {"spoken": spoken, "note": note, "seconds": round(len(samples) / engine.RATE, 3), "peaks": engine.peaks(frames)}
    return rev


def view(s):
    """What the page needs to draw one screen."""
    doc = passage(s["uid"])
    script = engine.script_for(doc)
    out = {k: s[k] for k in ("id", "uid", "title", "language", "takes", "current", "candidate", "span", "pending", "published", "submission", "review")}
    out["starts"] = engine.sentence_starts(script)
    out["lines"] = engine.breath_lines(script)
    out["text_issues"] = s.get("text_issues") or []
    out["paras"], out["lead"], out["text"] = script["paras"], script["lead"], script["text"]
    out["job"] = job_state.get(s["id"])
    if s["pending"] and not out["job"]:   # the server stopped partway through: the recording is safe, so offer to carry on
        out["job"] = {"step": None, "error": "We were interrupted, but your recording is saved. Press Try again to carry on.", "busy": False}
    out["reader"] = READER
    out["replaces"] = any(v == "human" for v in _voices(s["uid"]))
    for name, rev in (("now", s["current"]), ("cand", s["candidate"])):
        if rev is None:
            continue
        r = s["revs"][str(rev)]
        timing, _, _ = engine.compare(r["spoken"], script, s["uid"], s["language"])
        second = engine.compare(r["plain"], script, s["uid"], s["language"])[0] if r.get("plain") is not None else None
        out[name] = {"rev": rev, "seconds": r["seconds"], "peaks": r["peaks"], "note": {k: v for k, v in r["note"].items() if k != "heard"}, "url": f"/files/{s['id']}/rev{rev}.wav",
                     "marks": engine.word_marks(timing, script, s["accepted"], second), "checks": r.get("checks"), "numbers": r.get("numbers")}
    f = s["finish"]
    if f:
        timing = f["timing"]
        second = engine.compare(f["plain"], script, s["uid"], s["language"])[0] if f.get("plain") is not None else None
        decision = engine.decide(timing, f["gate_ok"], f["gate_reasons"], s["accepted"])
        out["finish"] = {k: f[k] for k in ("before_url", "after_url", "numbers", "stages", "cleaned", "refused", "warnings", "tidy", "agreement", "seconds", "rev")}
        out["finish"]["audit"] = f.get("audit")
        out["finish"].update(decision=decision, marks=engine.word_marks(timing, script, s["accepted"], second), lead=timing["lead"],
                             review_marks=engine.word_marks(timing, script, s["accepted"], second, show_all=True),
                             can_approve=engine.decide(timing, f["gate_ok"], f["gate_reasons"], engine.every_flag(timing))["publish"],
                             gate_ok=f["gate_ok"], gate_reasons=f["gate_reasons"])
        _, shown = engine.reader_rows(timing, script)         # the before-and-after lights words exactly as the reader will
        for w, row in zip(out["finish"]["marks"]["words"], shown):
            w["start"], w["end"] = row[0], row[1]
    return out


def _voices(uid):
    try:
        with open(os.path.join(SITE, "data", uid + ".json"), encoding="utf-8") as f:
            return [v["id"] for v in json.load(f)["voices"]]
    except OSError:
        return []


# ---------------------------------------------------------------------------------------------------------------------
# The one heavy step
# ---------------------------------------------------------------------------------------------------------------------
amazon = None                      # listen_amazon.Settings when started with --listener amazon; otherwise the on-device listener runs
speech = None                      # the kept-loaded recognizer; it exits by itself when idle, and comes back on the next job


def speech_job(job):
    """One job on the kept-loaded recognizer. Returns (code, error text): 0 done, 3 GPU busy, anything else a real failure."""
    global speech
    for _ in range(2):                 # it may have just exited for being idle: start a new one and try once more
        if speech is None or speech.poll() is not None:
            speech = subprocess.Popen([SPEECH_PYTHON, os.path.join(HERE, "hear.py"), "serve"], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                      stderr=subprocess.DEVNULL, text=True, encoding="utf-8", errors="replace")
        watchdog = threading.Timer(1800, speech.kill)
        watchdog.start()
        try:
            speech.stdin.write(json.dumps(job) + "\n")
            speech.stdin.flush()
            for line in speech.stdout:
                if line.startswith("@@done "):
                    reply = json.loads(line[7:])
                    return reply["code"], reply.get("error", "")
        except OSError:
            pass
        finally:
            watchdog.cancel()
    return 1, "the speech checker stopped unexpectedly"


def hear(s, mode, path, script, names=None):
    """Run one speech job. If the GPU is busy, wait and try again, and say so; if it stays busy, fail out loud."""
    if not amazon and not os.path.isfile(SPEECH_PYTHON):
        raise Unusable("Set SOUND_ALONG_SPEECH_PYTHON to the speech environment's Python, or pass --speech-python. Your recording is saved.")
    out = path + f".{mode}.json"
    job = {"mode": mode, "path": path, "out": out, "lang": s["language"][:2], "passage": s["uid"], "names": " ".join(engine.proper_names(script) + script["authors"])}
    if names is not None:              # a short reread: only the names in that part, and no second listen against the whole story
        job.update(passage=None, names=" ".join(names))
    for attempt in range(BUSY_TRIES):
        code, error = listen_amazon.speech_job(amazon, job) if amazon else speech_job(job)
        if code == 0:
            with open(out, encoding="utf-8") as f:
                return json.load(f)
        if code != 3:
            raise RuntimeError("speech job failed: " + error)
        step(s, "The computer is busy with another job. Trying again in a moment…", busy=True)
        time.sleep(BUSY_WAIT_S)
    raise Unusable("The computer stayed too busy to check your reading. Your recording is saved. Please try again in a few minutes.")


def step(s, words, busy=False):
    job_state[s["id"]] = {"step": words, "error": None, "busy": busy}


def worker():
    while True:
        sid, fn, args = JOBS.get()
        try:
            with lock:
                s = load(sid)
            fn(s, *args)
            job_state.pop(sid, None)
        except Unusable as error:
            job_state[sid] = {"step": None, "error": str(error), "busy": False}
        except Exception as error:   # noqa: BLE001  (a real failure stays visible: log it and show it)
            print("JOB FAILED", sid, repr(error), flush=True)
            job_state[sid] = {"step": None, "error": "Something went wrong on our side. Your recording is saved, so you can try again.", "busy": False, "detail": repr(error)[:400]}
        finally:
            JOBS.task_done()


def queue_job(s, words, fn, *args):
    step(s, words)
    JOBS.put((s["id"], fn, args))


# ---------------------------------------------------------------------------------------------------------------------
# Jobs
# ---------------------------------------------------------------------------------------------------------------------
def take_job(s, name):
    """A reading arrived: make it readable, hear it, then either start the reading or make a candidate that replaces a part."""
    d = folder(s["id"])
    src = os.path.join(d, name)
    raw = src + ".f32"
    try:
        engine.decode(src, raw)
    except voice_clean.FfmpegError:
        raise Unusable("That recording could not be read. Please try recording it again.")
    samples = engine.read_raw(raw)
    frames = engine.levels(samples)
    if not frames or max(frames) < -70:
        s["pending"] = None
        save(s)
        raise Unusable("We couldn't hear anything in that recording. Check that the right microphone is chosen, then try again.")
    wav = src + ".wav"
    engine.raw_to_wav(raw, wav)
    step(s, "Listening to your reading…")
    script = engine.script_for(passage(s["uid"]))
    span = s["span"]
    heard = hear(s, "words", wav, script, engine.names_in(script, span["a"], span["b"]) if span else None)
    spoken, plain = heard["words"], heard.get("plain")
    if not spoken and not plain:
        s["pending"] = None
        save(s)
        raise Unusable("We could hear sound, but couldn't make out any words. Move closer to the microphone or somewhere quieter, then try again.")
    with lock:
        s = load(s["id"])
        if not span:
            s["finish"] = None
            s["current"] = whole_reading(s, script, name, samples, frames, spoken, plain)
        else:
            rev = make_candidate(s, script, name, samples, frames, spoken, span, plain)
            add_checks(s, rev, engine.read_raw(rev_file(s, rev)), script)
        s["pending"] = None
        save(s)
    forget_working_audio(s, name)


def whole_reading(s, script, name, samples, frames, spoken, plain=None):
    """A whole take: take out false starts automatically. The take itself is kept as it was, and any cut can be put back."""
    raw = add_rev(s, samples, engine.drop_echoed_hints(spoken, script), {"take": name})
    s["revs"][str(raw)]["plain"] = plain
    add_checks(s, raw, samples, script)
    cuts = engine.find_restarts(spoken, script["lead"] + script["text"], frames, s["language"][:2])
    if not cuts:
        return raw
    return with_cuts(s, script, raw, samples, spoken, cuts)


def with_cuts(s, script, raw, samples, spoken, cuts):
    out, words, placed = engine.apply_cuts(samples, spoken, cuts)
    rev = add_rev(s, out, engine.drop_echoed_hints(words, script), {"take": s["revs"][str(raw)]["note"]["take"], "raw": raw, "cuts": placed, "heard": spoken})
    raw_plain = s["revs"][str(raw)].get("plain")
    s["revs"][str(rev)]["plain"] = engine.move_words(raw_plain, cuts) if raw_plain is not None else None
    add_checks(s, rev, out, script)
    return rev


def put_back(s, script, index):
    """Undo one automatic cut, from the original take. Only before any reread, since a reread is joined onto the edited reading."""
    note = s["revs"][str(s["current"])]["note"]
    cuts = note.get("cuts")
    if not cuts or not 0 <= index < len(cuts):
        raise Unusable("That can't be put back any more.")
    raw = note["raw"]
    samples = engine.read_raw(rev_file(s, raw))
    keep = [c for k, c in enumerate(cuts) if k != index]
    old = s["current"]
    s["current"] = with_cuts(s, script, raw, samples, note["heard"], keep) if keep else raw
    drop_rev(s, old)
    s["finish"], s["submission"] = None, None


def make_candidate(s, script, name, r_samples, r_frames, r_spoken, span, r_plain=None):
    a, b = span["a"], span["b"]
    expected = engine.span_words(script, a, b)
    r_cuts = engine.find_restarts(r_spoken, expected, r_frames, s["language"][:2])     # a stumble inside the reread itself
    if r_cuts:
        r_plain = engine.move_words(r_plain, r_cuts) if r_plain is not None else None
        r_samples, r_spoken, r_cuts = engine.apply_cuts(r_samples, r_spoken, r_cuts)
        r_frames = engine.levels(r_samples)
    r_spoken = engine.drop_echoed_hints(r_spoken, script, expected)
    found = engine.find_in_reread(r_spoken, expected, s["language"][:2])
    if not found:
        s["pending"] = None
        save(s)
        raise Unusable("We didn't hear those words in the new reading. Please try that part again.")
    if max(engine.reread_left_out(r_spoken, expected, s["language"][:2])) > 0:
        s["pending"] = None
        save(s)
        raise Unusable("Your recordings are saved. That didn't reach all of the highlighted part. Please read from its first word to its last.")
    cur = s["revs"][str(s["current"])]
    base = engine.read_raw(rev_file(s, s["current"]))
    timing, _, _ = engine.compare(cur["spoken"], script, s["uid"], s["language"])
    marks = engine.word_marks(timing, script)
    plan = engine.plan_join(engine.row_words(marks), engine.levels(base), len(base) / engine.RATE, engine.to_row(a, marks), engine.to_row(b, marks), r_spoken, r_frames,
                            len(r_samples) / engine.RATE, found[0], found[1])
    if plan["rough"]:                  # never cut through speech: keep the old reading, and offer a bigger piece rather than a dead end
        s["pending"] = None
        if span.get("scope") == "sentence":
            samples = engine.levels(base)
            pa, pb, scope = engine.choose_span(span["i0"], span["i1"], script, marks, samples, len(base) / engine.RATE, "paragraph")
            s["span"] = dict(span, a=pa, b=pb, scope=scope)
            save(s)
            raise Unusable("Your recordings are saved. We couldn't join that sentence smoothly, so let's read the whole paragraph instead.")
        save(s)
        raise Unusable("Your recordings are saved. We couldn't join that smoothly. Try once more with a short pause before you start and after you finish, or keep the earlier reading.")
    samples, spoken, gain = engine.join(base, cur["spoken"], r_samples, r_spoken, plan)
    rev = add_rev(s, samples, spoken, {"take": name, "span": [a, b], "plan": plan, "gain_db": gain, "from": s["current"], "cuts_in_reread": r_cuts})
    if cur.get("plain") is not None and r_plain is not None:
        inside = [w for w in r_plain if plan["r_in"] <= (w[1] + w[2]) / 2 < plan["r_out"]]
        s["revs"][str(rev)]["plain"] = engine.joined_words(cur["plain"], inside, plan)
    if s["candidate"] is not None:
        drop_rev(s, s["candidate"])
    s["candidate"] = rev
    return rev


def forget(*paths):
    for path in paths:
        try:
            os.remove(path)
        except OSError:
            pass


def forget_working_audio(s, name=None):
    """Keep what a person might need: every original take as recorded, the reading in use with the take its cuts came from, and the finished
    files. Everything else can be made again, and a one-minute story used about 100 MB without this. Word lists and notes are kept."""
    d = folder(s["id"])
    fresh = load(s["id"])
    keep = {str(fresh["current"]), str(fresh["candidate"])}
    for rev in (fresh["current"], fresh["candidate"]):
        if rev is not None:
            raw = fresh["revs"].get(str(rev), {}).get("note", {}).get("raw")
            if raw is not None:
                keep.add(str(raw))
    for rev in fresh["revs"]:
        if rev not in keep:
            forget(rev_file(fresh, rev), rev_file(fresh, rev, "wav"))
    if name:
        forget(os.path.join(d, name + ".f32"), os.path.join(d, name + ".wav"))


def drop_rev(s, rev):
    s["revs"].pop(str(rev), None)
    for ext in ("f32", "wav"):
        try:
            os.remove(rev_file(s, rev, ext))
        except OSError:
            pass


def add_checks(s, rev, samples, script):
    r = s["revs"][str(rev)]
    timing, _, _ = engine.compare(r["spoken"], script, s["uid"], s["language"])
    second = engine.compare(r["plain"], script, s["uid"], s["language"])[0] if r.get("plain") is not None else None
    r["checks"], r["numbers"] = engine.checks_for(samples, engine.word_marks(timing, script, s["accepted"], second), script)


def finish_job(s):
    """Tidy, clean, then time the words on the file that will actually play, and run the shared check on that same file."""
    d = folder(s["id"])
    t0 = time.time()
    rev = s["current"]
    r = s["revs"][str(rev)]
    script = engine.script_for(passage(s["uid"]))
    step(s, "Trimming the quiet at the start and end…")
    timing_now, _, _ = engine.compare(r["spoken"], script, s["uid"], s["language"])
    words_now = engine.word_marks(timing_now, script)["words"]
    tidy_samples, notes = engine.tidy(engine.read_raw(rev_file(s, rev)), r["spoken"], [words_now[p]["start"] for p in engine.paragraph_starts(script) if p])
    raw = os.path.join(d, "final_input.f32")
    engine.write_raw(raw, tidy_samples)
    before_full = os.path.join(d, "final_input.wav")
    engine.raw_to_wav(raw, before_full, "pcm_f32le")
    before_mp3 = os.path.join(d, "before.mp3")
    voice_clean._ffmpeg(["-i", before_full, "-c:a", "libmp3lame", "-b:a", "128k", before_mp3])
    step(s, "Making your voice clear and even…")
    final = os.path.join(d, "after.mp3")
    rep = voice_clean.clean(before_full, final, workdir=d)
    with open(os.path.join(d, "cleanup_report.json"), "w", encoding="utf-8") as f:
        json.dump(rep, f, indent=1)
    if not rep["ok"]:                # the cleanup refused its own result: keep the person's sound as it was
        shutil.copyfile(before_mp3, final)
    step(s, "Matching each word to the moment you said it…")
    heard = hear(s, "final", final, script)
    # The gate sees every word heard, invented or not. An echoed hint only one listen heard stays off the reader's page, and the reviewer decides.
    timing, ok, reasons = engine.compare(heard["words"], script, s["uid"], s["language"])
    timing["audio"] = "after.mp3"
    timing["t"], timing["spread_evenly_words"] = engine.even_out_flagged(timing)
    timing["duration"] = round(voice_clean.probe(final)["seconds"], 3)
    decoded = final + ".f32"
    engine.decode(final, decoded)
    lead_n = len(timing["lead"])
    audit = engine.audit_word_starts(engine.levels(engine.read_raw(decoded)), timing["t"][lead_n:], script["text"])
    forget(decoded)
    before, after = rep["before"], rep["after"]
    numbers = {k: {"before": before.get(k), "after": after.get(k)} for k in ("lufs", "tp", "lra", "floor", "snr", "seconds")}
    with lock:
        s = load(s["id"])
        forget(os.path.join(d, "final_input.f32"), os.path.join(d, "final_input.wav"))
        s["finish"] = {"rev": rev, "timing": timing, "plain": heard.get("plain"), "gate_ok": ok, "gate_reasons": reasons, "tidy": notes, "cleaned": rep["ok"], "refused": rep["reasons"],
                       "warnings": rep.get("warnings", []), "stages": stage_names(rep), "numbers": numbers,
                       "before_url": f"/files/{s['id']}/before.mp3", "after_url": f"/files/{s['id']}/after.mp3",
                       "agreement": agreement(timing, heard, script), "unaligned": heard.get("unaligned"), "audit": audit,
                       "seconds": round(time.time() - t0, 1), "lag": rep.get("verify", {}).get("lag")}
        s["pending"] = None
        save(s)


def stage_names(rep):
    plan = rep["plan"]
    names = ["Took out low rumble"]
    if plan.get("notch"):
        names.append("Took out electrical hum")
    if plan.get("denoise"):
        names.append("Softened background sound")
    names += ["Evened out loud and soft words", "Set the overall volume to match the other stories"]
    return names if rep["ok"] else []


def agreement(timing, heard, script):
    """An independent look at the timing: Whisper's own word times against the aligner's, for words both agree on. Disagreement between methods, not ground truth."""
    lead_n = len(timing["lead"])
    rows = timing["t"][lead_n:]
    lang = "es" if timing.get("language", "").startswith("es") else "en"
    target = [engine._tok_pairs([w], lang)[0][0] if engine._tok_pairs([w], lang) else "" for w in script["text"]]
    pos, diffs = 0, []
    for w, s, _ in heard.get("whisper_words", []):
        toks = engine._tok_pairs([w], lang)
        if not toks:
            continue
        hit = next((j for j in range(pos, min(pos + 12, len(target))) if target[j] == toks[0][0]), None)
        if hit is not None:
            pos = hit + 1
            diffs.append(abs(rows[hit][0] - s))
    diffs.sort()
    if not diffs:
        return None
    return {"compared": len(diffs), "median_ms": round(1000 * diffs[len(diffs) // 2]), "p90_ms": round(1000 * diffs[int(len(diffs) * 0.9)])}


def report_text_issue(s, i, should_say):
    """A reader thinks the story's words are wrong. Their reading isn't changed and neither is the story: this goes to the reviewer, and on to ReadWorks."""
    script = engine.script_for(passage(s["uid"]))
    combined = script["lead"] + script["text"]
    at = i + len(script["lead"])
    if not 0 <= at < len(combined):
        raise Unusable("That word could not be found.")
    issue = {"i": i, "around": " ".join(combined[max(0, at - 5):at + 6]), "word": combined[at], "should_say": (should_say or "").strip()[:200] or None,
             "at": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")}
    s["text_issues"] = [x for x in s.get("text_issues") or [] if x["i"] != i] + [issue]
    save(s)
    with open(os.path.join(os.path.dirname(STORE), "text_issues.jsonl"), "a", encoding="utf-8") as f:
        f.write(json.dumps({"story": s["uid"], "title": s["title"], "session": s["id"], "text_sha256": script["text_sha256"], **issue}, ensure_ascii=False) + "\n")


def audio_sha(s):
    with open(os.path.join(folder(s["id"]), "after.mp3"), "rb") as fh:
        return hashlib.sha256(fh.read()).hexdigest()[:12]


def submit_session(s, name, heard_after_s):
    """The volunteer is done. This saves the reading for a reviewer and changes nothing in the reader."""
    f = s["finish"]
    if not f or f["rev"] != s["current"]:
        raise Unusable("Please finish the reading again before sending it.")
    s["submission"] = {"at": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"), "sha": audio_sha(s),
                       "narrator": (name or "").strip()[:80] or None, "played_after_seconds": round(float(heard_after_s or 0), 1)}
    s["review"] = None
    save(s)


def approve_session(s, reviewer, listened, note, played_seconds, seen_sha):
    """The only way a volunteer's reading reaches the reader: a named person says they listened, to this exact file."""
    f, sub = s["finish"], s["submission"]
    reviewer = (reviewer or "").strip()[:80]
    if not f or not sub or s["published"]:
        raise Unusable("This reading isn't waiting for review.")
    if not reviewer:
        raise Unusable("Please add your name, so the record shows who checked this.")
    if listened is not True:
        raise Unusable("Please listen to the whole reading first, then tick the box.")
    sha = audio_sha(s)
    if sha != sub["sha"] or seen_sha != sha:     # seen_sha: the file this reviewer's page was showing
        raise Unusable("The recording has changed since you opened it. Please go back to the list and open it again.")
    decision = engine.decide(f["timing"], f["gate_ok"], f["gate_reasons"], engine.every_flag(f["timing"]))
    if not decision["publish"]:
        raise Unusable("This can't go in the reader: too little of it matches the story, or its word timing is broken. Please send it back.")
    d = folder(s["id"])
    final = os.path.join(d, "after.mp3")
    script = engine.script_for(passage(s["uid"]))
    lead, body = engine.reader_rows(f["timing"], script)
    duration = voice_clean.probe(final)["seconds"]
    if not engine.rows_valid(body, len(script["text"]), False, duration) or not engine.rows_valid(lead, len(script["lead"]), True, duration):
        raise Unusable("The word timing did not come out cleanly, so this can't go in the reader. Please send it back.")
    now = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")
    voice = {"id": "human", "label": "Human voice (volunteer recording)", "lead": lead, "t": body,
             "source": "Volunteer recording, cleaned, then timed on the cleaned file by our forced aligner", "review": "checked by a person"}
    if sub["narrator"]:
        voice["narrator"] = sub["narrator"]
    record = {"uuid": s["uid"], "session": s["id"], "published_at": now, "sha": sha, "narrator": sub["narrator"],
              "review": {"state": "checked by a person", "reviewer": reviewer, "at": now, "said_they_listened": True, "note": (note or "").strip()[:500] or None,
                         "reviewer_played_seconds": round(float(played_seconds or 0), 1), "volunteer_played_seconds": sub["played_after_seconds"],
                         "means": "One named person said they listened. The word and timing checks are a recognizer's opinion, separate from this."},
              "gate": decision["gate"], "gate_reasons": decision["reasons"], "reviewer_released": decision["person_accepted"], "volunteer_said_fine": s["accepted"],
              "checks": f["timing"]["checks"], "cleanup": {"used": f["cleaned"], "refused_because": f["refused"], "numbers": f["numbers"], "warnings": f["warnings"]},
              "tidy": f["tidy"], "timing_agreement": f["agreement"], "timing_audit": f.get("audit"), "text_issues": s.get("text_issues") or [], "words_spread_evenly": f["timing"].get("spread_evenly_words"),
              "joins": [r["note"].get("plan") for r in s["revs"].values() if r["note"].get("plan")],
              "automatic_cuts": [{k: c[k] for k in ("removed", "cut_from", "cut_to")} for r in s["revs"].values() for c in (r["note"].get("cuts") or []) if r is s["revs"][str(s["current"])] or s["revs"][str(s["current"])]["note"].get("from")],
              "text_sha256": script["text_sha256"], "original_takes": sorted(n for n in os.listdir(d) if n.startswith("take") and not n.endswith((".f32", ".wav", ".json")))}
    audio = to_reader.publish(SITE, s["uid"], final, sha, voice, record, os.path.join(os.path.dirname(STORE), "published"))
    s["published"] = {"audio": audio, "at": now, "gate": decision["gate"], "sha": sha, "reviewer": reviewer}
    s["review"] = {"state": "approved", "reviewer": reviewer, "at": now}
    save(s)


def send_back(s, reviewer, note):
    if s["published"]:
        raise Unusable("This reading is already in the reader. It can be taken out with to_reader.py undo.")
    s["review"] = {"state": "sent back", "reviewer": (reviewer or "").strip()[:80] or None, "note": (note or "").strip()[:500] or None,
                   "at": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")}
    s["submission"], s["finish"] = None, None
    save(s)


def waiting_for_review():
    out = []
    for name in sorted(os.listdir(STORE)) if os.path.isdir(STORE) else []:
        s = load(name)
        if s.get("submission") and not s["published"]:
            f = s["finish"]
            script = engine.script_for(passage(s["uid"]))
            second = engine.compare(f["plain"], script, s["uid"], s["language"])[0] if f.get("plain") is not None else None
            out.append({"id": s["id"], "title": s["title"], "sent": s["submission"]["at"], "seconds": round(f["timing"]["duration"]),
                        "spots": len(engine.word_marks(f["timing"], script, (), second, show_all=True)["flags"])})
    return out


# ---------------------------------------------------------------------------------------------------------------------
# HTTP
# ---------------------------------------------------------------------------------------------------------------------
class Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        if "/api/" in self.path and "POST" in str(args[:1]):
            print(fmt % args, flush=True)

    def _send(self, code, body, ctype="application/json", extra=None):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _json(self, value, code=200):
        self._send(code, json.dumps(value, ensure_ascii=False).encode())

    def _file(self, path):
        """A file with byte ranges, so the audio player can jump to a tapped word."""
        if not os.path.isfile(path):
            return self._json({"error": "not found"}, 404)
        size = os.path.getsize(path)
        ctype = {".mjs": "text/javascript", ".js": "text/javascript", ".mp3": "audio/mpeg", ".wav": "audio/wav"}.get(os.path.splitext(path)[1]) \
            or mimetypes.guess_type(path)[0] or "application/octet-stream"
        m = re.fullmatch(r"bytes=(\d*)-(\d*)", self.headers.get("Range", ""))
        lo, hi, code = 0, size - 1, 200
        if m and (m[1] or m[2]):
            lo, hi = (int(m[1] or 0), int(m[2]) if m[2] else size - 1) if m[1] else (max(0, size - int(m[2])), size - 1)
            hi, code = min(hi, size - 1), 206
        with open(path, "rb") as f:
            f.seek(lo)
            body = f.read(hi - lo + 1)
        extra = {"Accept-Ranges": "bytes"}
        if code == 206:
            extra["Content-Range"] = f"bytes {lo}-{hi}/{size}"
        self._send(code, body, ctype, extra)

    def _allowed(self):
        """Only this computer's own pages may post: a website elsewhere can't reach the recorder through the person's browser."""
        host = self.headers.get("Host", "")
        origin = self.headers.get("Origin")
        local = host.split(":")[0] in ("localhost", "127.0.0.1")
        return local and (origin is None or urlparse(origin).netloc == host)

    def _body(self, limit=1 << 20):
        n = int(self.headers.get("Content-Length") or 0)
        if n > limit:
            raise Unusable("That recording is too long to save here.")
        return self.rfile.read(n)

    def do_GET(self):
        try:
            self._get()
        except Unusable as error:
            self._json({"error": str(error)}, 400)
        except (FileNotFoundError, KeyError):
            self._json({"error": "That could not be found."}, 404)

    do_HEAD = do_GET

    def _get(self):
        if not self._allowed():
            return self._json({"error": "local use only"}, 403)
        url = urlparse(self.path)
        p = url.path
        if p in ("/", "/index.html"):
            return self._file(os.path.join(PAGE, "index.html"))
        if p.startswith("/page/") and re.fullmatch(r"/page/[\w.-]+", p):
            return self._file(os.path.join(PAGE, p[6:]))
        if p == "/review":
            return self._file(os.path.join(PAGE, "review.html"))
        if p == "/api/review":
            with lock:
                return self._json(waiting_for_review())
        if p == "/api/passages":
            try:
                with open(os.path.join(SITE, "data", "index.json"), encoding="utf-8") as f:
                    rows = json.load(f)
            except FileNotFoundError:
                rows = []
            return self._json([{"uid": r["uuid"], "title": r["title"], "grade": r.get("grade"), "words": r["words"], "lang": r.get("lang"),
                                "has_person": "human" in r.get("voices", []), "session": (latest_session(r["uuid"]) or {}).get("id")} for r in rows
                               if os.path.exists(os.path.join(PASSAGES, r["uuid"] + ".json"))])
        m = re.fullmatch(r"/api/session/([\w-]+)", p)
        if m:
            with lock:
                return self._json(view(load(m[1])))
        m = re.fullmatch(r"/files/([\w-]+)/([\w.-]+)", p)
        if m:
            return self._file(os.path.join(folder(m[1]), m[2]))
        m = re.fullmatch(r"/test-audio/([\w.-]+)", p)
        if m and TEST_AUDIO:
            return self._file(os.path.join(TEST_AUDIO, m[1]))
        self._json({"error": "not found"}, 404)

    def do_POST(self):
        try:
            if not self._allowed():
                return self._json({"error": "local use only"}, 403)
            self._post()
        except Unusable as error:
            self._json({"error": str(error)}, 400)
        except (FileNotFoundError, KeyError):
            self._json({"error": "That could not be found."}, 404)

    def _post(self):
        url = urlparse(self.path)
        if url.path == "/api/session":
            body = json.loads(self._body() or b"{}")
            s = None if body.get("fresh") else latest_session(body["uid"])
            if not s or s["published"]:           # a finished reading stays as it is; reading the story again starts a new one
                s = new_session(body["uid"])
            return self._json(view(s))
        m = re.fullmatch(r"/api/session/([\w-]+)/([a-z]+)", url.path)
        if not m:
            return self._json({"error": "not found"}, 404)
        sid, action = m[1], m[2]
        data = self._body(MAX_UPLOAD) if action == "take" else self._body()
        with lock:
            s = load(sid)
            if (job_state.get(sid) or {}).get("step") and action in ("take", "finish", "retry"):
                raise Unusable("Still working on the last step. One moment.")
            if action == "take":
                if len(data) < 100:
                    raise Unusable("That recording came through empty. Please try again.")
                s["takes"] += 1
                query = parse_qs(url.query)
                ext = "webm" if "webm" in (query.get("type") or ["webm"])[0] else "ogg" if "ogg" in query["type"][0] else "m4a"
                name = f"take{s['takes']}.{ext}"
                with open(os.path.join(folder(sid), name), "wb") as f:
                    f.write(data)
                s["pending"] = {"kind": "take", "file": name}
                save(s)
                queue_job(s, "Saving your reading…", take_job, name)
            elif action == "retry":
                job_state.pop(sid, None)
                if s["pending"] and s["pending"]["kind"] == "finish":
                    queue_job(s, "Trying again…", finish_job)
                elif s["pending"]:
                    queue_job(s, "Trying again…", take_job, s["pending"]["file"])
            elif action == "dismiss":
                job_state.pop(sid, None)
                s["pending"] = None
                save(s)
            elif action == "span":
                body = json.loads(data)
                i0, i1 = int(body["i0"]), int(body["i1"])
                wanted = "paragraph" if body.get("scope") == "paragraph" else "sentence"
                script = engine.script_for(passage(s["uid"]))
                r = s["revs"][str(s["current"])]
                timing, _, _ = engine.compare(r["spoken"], script, s["uid"], s["language"])
                marks = engine.word_marks(timing, script)
                samples = engine.read_raw(rev_file(s, s["current"]))
                a, b, scope = engine.choose_span(i0, i1, script, marks, engine.levels(samples), len(samples) / engine.RATE, wanted)
                s["span"] = {"a": a, "b": b, "scope": scope, "i0": i0, "i1": i1, "wanted": wanted}
                save(s)
            elif action == "cancelspan":
                s["span"] = None
                if s["candidate"] is not None:
                    drop_rev(s, s["candidate"])
                    s["candidate"] = None
                save(s)
            elif action == "keep":
                body = json.loads(data)
                if s["candidate"] is None:
                    raise Unusable("There's no new reading to choose.")
                if body.get("choice") == "new":
                    span = s["revs"][str(s["candidate"])]["note"]["span"]
                    s["accepted"] = engine.drop_decisions(s["accepted"], span[0], span[1])
                    s["current"], s["finish"], s["submission"] = s["candidate"], None, None
                else:
                    drop_rev(s, s["candidate"])
                s["candidate"], s["span"] = None, None
                save(s)
                forget_working_audio(s)
            elif action == "fine":
                body = json.loads(data)
                key = str(body["key"])
                s["accepted"] = [k for k in s["accepted"] if k != key] + ([key] if body.get("ok") else [])
                save(s)
            elif action == "finish":
                if s["current"] is None:
                    raise Unusable("Please read the story first.")
                s["span"], s["published"], s["submission"] = None, None, None
                s["pending"] = {"kind": "finish"}
                save(s)
                queue_job(s, "Getting started…", finish_job)
            elif action == "submit":
                body = json.loads(data)
                submit_session(s, body.get("name"), body.get("heard_after_s"))
            elif action == "approve":
                body = json.loads(data)
                approve_session(s, body.get("reviewer"), body.get("listened"), body.get("note"), body.get("played_seconds"), body.get("sha"))
            elif action == "sendback":
                body = json.loads(data)
                send_back(s, body.get("reviewer"), body.get("note"))
            elif action == "textissue":
                body = json.loads(data)
                report_text_issue(s, int(body["i"]), body.get("should_say"))
            elif action == "putback":
                put_back(s, engine.script_for(passage(s["uid"])), int(json.loads(data)["index"]))
                save(s)
            elif action == "reopen":
                s["finish"], s["submission"] = None, None
                save(s)
            elif action == "restart":
                s = new_session(s["uid"])
            else:
                return self._json({"error": "not found"}, 404)
            return self._json(view(s))


def main():
    global SITE, READER, TEST_AUDIO, STORE, PASSAGES, SPEECH_PYTHON, amazon
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8975)
    ap.add_argument("--reader", default=READER, help="address of the running reader, for the link at the end")
    ap.add_argument("--site", default=SITE, help="the reader's public folder")
    ap.add_argument("--store", default=STORE, help="where sessions are kept (a test keeps its own)")
    ap.add_argument("--passages", default=PASSAGES, help="local passage JSON folder")
    ap.add_argument("--speech-python", default=SPEECH_PYTHON, help="speech environment Python; also SOUND_ALONG_SPEECH_PYTHON")
    ap.add_argument("--listener", choices=("device", "amazon"), default="device", help="who listens: this computer's GPU (default), or Amazon Transcribe, which is billed and needs the three settings below")
    ap.add_argument("--aws-profile")
    ap.add_argument("--aws-region")
    ap.add_argument("--aws-bucket", help="an existing bucket; uploads are removed after each job")
    ap.add_argument("--test-audio", default=None, help="a folder a test may play through the real recorder with ?test=<file>")
    args = ap.parse_args()
    SITE, READER, TEST_AUDIO, STORE = os.path.abspath(args.site), args.reader, args.test_audio, os.path.abspath(args.store)
    PASSAGES, SPEECH_PYTHON = os.path.abspath(args.passages), args.speech_python
    if args.listener == "device" and (not SPEECH_PYTHON or not os.path.isfile(SPEECH_PYTHON)):
        print("Speech checker missing: set SOUND_ALONG_SPEECH_PYTHON or --speech-python. Recordings can be saved, but word checks need it.", flush=True)
    if args.listener == "amazon":
        if not (args.aws_profile and args.aws_region and args.aws_bucket):
            ap.error("--listener amazon needs --aws-profile, --aws-region and --aws-bucket")
        amazon = listen_amazon.Settings(args.aws_profile, args.aws_region, args.aws_bucket)
    voice_clean._find("ffmpeg"), voice_clean._find("ffprobe")      # a broken tool is loud at the start, not in the middle of someone's reading
    os.makedirs(STORE, exist_ok=True)
    threading.Thread(target=worker, daemon=True).start()
    server = http.server.ThreadingHTTPServer(("127.0.0.1", args.port), functools.partial(Handler))
    print(f"http://localhost:{args.port}/", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
