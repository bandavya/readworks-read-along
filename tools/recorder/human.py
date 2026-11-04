"""Pure helpers for the volunteer-recording route of the Sound Along pipeline (no AWS calls here, so they test locally).

The route: a passage + a person's recording -> S3 -> Amazon Transcribe (word times) -> the SAME reconcile / checks / passes as
the generated-voice route (common.py: called here, not rewritten) -> a timing bundle whose voice is "human".

Where it differs from a generated take, on purpose (see human_audio_2026-10-31/README.md):
  * The lead-in comes from what the reader actually SAID. All 13 sampled readers said the title; one did not say
    "by ReadWorks". So we try the full lead-in, the title alone, and no lead-in, and keep the one with the fewest
    unheard (filled) words. Display stays exact; nothing is guessed.
  * Real people pause. common.checks() uses LONG_GAP_LIMIT_S; a first-grade reader had two. Pauses up to
    HUMAN_PAUSE_OK_S between two HEARD words are real silence in the recording (Transcribe timed both words), so they are
    listed for an editor but do not by themselves hold the recording. A longer gap still holds it.
  * Nothing here claims the recording is right or the pronunciation verified: an automatic pass means "checks passed".
"""
import difflib
import re

from common import LONG_GAP_LIMIT_S, _tok_pairs, checks, lead_for, passes, reconcile, word_reasons

AUDIO_EXTENSIONS = (".mp3", ".m4a", ".mp4", ".wav", ".flac", ".ogg", ".webm", ".amr")   # what Amazon Transcribe accepts
MAX_RECORDING_BYTES = 60 * 1024 * 1024    # ~60 min of 128 kbps MP3; ReadWorks passages run 1-8 min. A cost/abuse guard.
TRANSCRIBE_LANGUAGES = ("en-US", "es-US")  # the two the prototype has recordings for
HUMAN_PAUSE_OK_S = 6.0                     # provisional; tune against more recordings
MIN_TEXT_MATCH = 0.85                      # share of written words found, in order, as the same word in the recording
                                           # (measured: a clean reading 0.99; a different passage 0.12). Provisional.
HOLD_PREFIX = "review/"                    # held bundles share the review queue with the generated route (fix-gate, 2026-10-31)
MIN_UNHEARD_FOR_REASON = 3
UNHEARD_REASON_DIVISOR = 50


def safe_id(s):
    """Transcribe job names allow only [0-9a-zA-Z._-]."""
    return re.sub(r"[^0-9A-Za-z._-]", "-", s)[:80] or "passage"


def validate_request(req):
    """Check an upload request (human-requests/<id>.json). Returns a clean dict, or raises ValueError with a plain reason.

    {"passage":   "human/<id>/passage.json"    ReadWorks-shaped passage JSON (NOT under passages/: that would also start
                                                the generated-voice workflow and spend Polly money)
     "recording": "human/<id>/<file>.mp3"      the volunteer's audio
     "language":  "en-US" | "es-US"            optional, default en-US
     "narrator":  free text, optional          who read it, as the volunteer/ReadWorks wants it shown
     "provenance": free text, optional         e.g. "ReadWorks volunteer recording; reuse OK'd by <person> on <date>"}
    """
    if not isinstance(req, dict):
        raise ValueError("The request file must be a JSON object.")
    out = {}
    for field, prefix, exts in (("passage", "human/", (".json",)), ("recording", "human/", AUDIO_EXTENSIONS)):
        v = req.get(field)
        if not isinstance(v, str) or not v:
            raise ValueError(f'The request is missing "{field}".')
        if not v.startswith(prefix) or ".." in v or v.startswith("/") or not v.lower().endswith(exts):
            raise ValueError(f'"{field}" must be a key under {prefix} ending in {" / ".join(exts)}: got {v!r}.')
        out[field] = v
    lang = req.get("language") or "en-US"
    if lang not in TRANSCRIBE_LANGUAGES:
        raise ValueError(f'"language" must be one of {", ".join(TRANSCRIBE_LANGUAGES)}: got {lang!r}.')
    out["language"] = lang
    for field in ("narrator", "provenance"):
        v = req.get(field)
        out[field] = str(v)[:300] if v else None
    return out


def lead_candidates(doc, language="en-US"):
    """Lead-ins a human reader might have used, most complete first (ties keep the earlier one).
    common.lead_for is English ("by"); a Spanish reader says "<title> por <author>" (human_audio README)."""
    title = (doc.get("title") or "").split()
    if language.startswith("es"):
        authors = [a for a in (doc.get("a") or []) if a] or ["ReadWorks"]
        full = title + ["por"] + " y ".join(authors).split()
    else:
        full = lead_for(doc)
    out = [full]
    if title and title != full:
        out.append(title)
    out.append([])
    return out


def pick_lead(spoken, doc, words, language="en-US", names=None, scope=None):
    """Try each lead-in; keep the one that leaves the fewest written words unheard. Returns (lead, rows, report, index)."""
    best = None
    for k, lead in enumerate(lead_candidates(doc, language)):
        # only the full lead-in has a byline; the title alone, or nothing, has none to excuse
        byline_from = len((doc.get("title") or "").split()) if k == 0 else len(lead)
        rows, rep = reconcile(spoken, lead, words, names, scope, language.split("-", 1)[0].lower(), byline_from)
        filled = sum(1 for r in rows if r[2] == 1)
        if best is None or filled < best[0]:
            best = (filled, lead, rows, rep, k)
    return best[1], best[2], best[3], best[4]


def text_match(spoken, words, language="en-US"):
    """Share of written comparable tokens found in order in the recording: 0..1.

    An independent check beside common.reconcile, which spreads a heard stretch over any written words it does not match
    word for word and then counts them as "heard", so a recording of the wrong passage can fill every row. This one counts
    only normalized agreement (it is not a pronunciation or accuracy score: a recognizer's own errors lower it too)."""
    language = language.split("-", 1)[0].lower()
    a = [token for token, _ in _tok_pairs([w for w, _, _ in spoken], language)]
    b = [token for token, _ in _tok_pairs(words, language)]
    if not b:
        return 0.0
    m = difflib.SequenceMatcher(None, a, b, autojunk=False)
    return round(sum(blk.size for blk in m.get_matching_blocks()) / len(b), 3)


def human_gate(c):
    """The generated route's gate (common.passes), except that a pause between two heard words up to HUMAN_PAUSE_OK_S is
    a person pausing, not a fault. The ordinary gate is CALLED, not copied, so it stays the one definition."""
    return (passes(dict(c, long_gap_count=int(c["max_long_gap"] > HUMAN_PAUSE_OK_S)))
            and isinstance(c.get("text_match"), (int, float)) and c["text_match"] >= MIN_TEXT_MATCH)


def hold_reasons(c, rep=None):
    """Plain reasons a bundle was held, for the editor, naming the words (rep = reconcile's report). Falls back to a generic
    line if the gate has grown new rules."""
    why = []
    if c["backwards_steps"]:
        why.append(f'{c["backwards_steps"]} word(s) timed earlier than the word before them')
    if not c["in_bounds"]:
        why.append("some word times fall outside the recording")
    if c["filled"] > max(MIN_UNHEARD_FOR_REASON, c["words"] // UNHEARD_REASON_DIVISOR):
        why.append(f'{c["filled"]} of {c["words"]} written words were not heard in the recording '
                   "(a different passage, a missing section, or a very unclear recording)")
    if c.get("text_match", 1.0) < MIN_TEXT_MATCH:
        why.append(f'only {round(c["text_match"] * 100)}% of the written words match the words spoken, in order '
                   f"(needs {round(MIN_TEXT_MATCH * 100)}%): probably a different passage or a very unclear recording")
    if c["max_long_gap"] > HUMAN_PAUSE_OK_S:
        why.append(f"a silence of {c['max_long_gap']} s between two words (longer than the {HUMAN_PAUSE_OK_S:g} s a pause may last)")
    return why + word_reasons(rep) or ["the pipeline's checks did not pass (see the checks in this file)"]


def build_timing(spoken, script, info, names=None):
    """Spoken words (Transcribe) + the written script -> (timing dict, ok, reasons).

    script: {"lead": [...], "paras": [...], "text": [...], "text_sha256": ...} as the Prepare step saved it
    info:   what the Prepare step returned (audio_key, language, narrator, provenance, recording_key ...)
    names:  the names list (names.load), optional; entries scoped to this passage (info["id"]) or "*" apply
    """
    doc = {"title": script.get("title"), "a": script.get("authors") or []}
    lead, rows, rep, k = pick_lead(spoken, doc, script["text"], info.get("language") or "en-US", names, info.get("id"))
    duration = max((e for _, _, e in spoken), default=0.0)
    c = checks(rows, duration, rep)
    c.update({"spoken_extras": rep["extras"], "written_not_heard": rep["unheard"],
              "text_match": text_match(spoken, script["text"], info.get("language") or "en-US"),
              "accepted_name_count": len(rep["accepted_names"])})
    pauses = sorted(round(b[0] - a[1], 2) for a, b in zip(rows, rows[1:])
                    if LONG_GAP_LIMIT_S < b[0] - a[1] <= HUMAN_PAUSE_OK_S and a[2] == 0 and b[2] == 0)
    ok = human_gate(c)
    timing = {"lead": lead, "paras": script["paras"], "text": script["text"], "t": rows, "duration": round(duration, 3),
              "audio": info["audio_key"], "voice": "human", "engine": "recording",
              "timing_source": "amazon-transcribe + reconcile (volunteer recording)", "language": info.get("language"),
              "checks": c, "accepted_names": rep["accepted_names"], "pauses_kept": pauses, "text_sha256": script["text_sha256"],
              # every swap / missing / extra with its time and context, the same fields the generated route saves, so a reviewer
              # can find the spot (lead-in ones are marked advisory)
              "flags": rep["flags"], "flag_summary": rep["summary"],
              "narrator": info.get("narrator"), "provenance": info.get("provenance") or "not stated",
              "source_recording": info.get("recording_key"),
              "lead_kept": ("full", "title only", "none")[k],
              "review": {"state": "needs human check",
                         "note": "Checks passed means the words and times agree with a speech recognizer. "
                                 "Nobody has listened to this recording against the text yet."}}
    return timing, ok, ([] if ok else hold_reasons(c, rep))


def sound_along_block(info, timing, timing_key, now_iso):
    """The doc["soundAlong"] block the reader loads (same shape the generated route writes)."""
    return {"audio": info["audio_key"], "timing": timing_key, "voice": "human", "engine": "recording",
            "billed_chars": 0, "checks": timing["checks"], "generated_at": now_iso,
            "narrator": timing["narrator"], "provenance": timing["provenance"], "review": timing["review"]}
