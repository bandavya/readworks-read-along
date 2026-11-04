"""Everything between a recorded take and the reader that needs no GPU: marking words, choosing a part to reread, finding the
seam, joining, tidying, plain-language checks. Standard library + ffmpeg, so it can move into a Lambda with voice_clean.py.

The word comparison and the publication check are NOT here: they are human.build_timing and common.py, called as the AWS route
calls them. Numbers marked (pencil) are first guesses from the sources named beside them; none has been tuned by ear.
"""
import array
import difflib
import hashlib
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
EV = HERE
import names as namebook  # noqa: E402
import voice_clean  # noqa: E402
from common import HEARD, _tok_pairs, lead_for, paragraphs  # noqa: E402
from human import build_timing, human_gate  # noqa: E402

RATE = 48000
FRAME_S = 0.01
QUIET_BELOW_VOICE_DB = 15.0     # (pencil) was 20; see quiet_line
PAUSE_BLIP_S = 0.12             # (pencil) a sound this short doesn't end a long silence: a breath, a chair, a click
MIN_VISIBLE_S = 0.12            # (pencil) the least time a word stays lit; a real word took as little as 20 ms, which no eye can catch
MAX_NUDGE_S = 0.15              # (pencil) the most a word's highlight may move to get that time
LINE_MAX_WORDS, LINE_MIN_WORDS = 11, 3     # (pencil) breath lines
JOIN_FADE_S = 0.02              # (pencil) crossfade at a join; the join sits in a pause, so this only hides the step in room sound
MAX_MATCH_GAIN_DB = 9.0         # a reread is brought to the level around it, by at most this much
KEEP_BEFORE_S, KEEP_AFTER_S = 0.35, 0.5     # (pencil) quiet kept at the very start and very end
LONG_PAUSE_S = 2.5              # (pencil) a silence longer than this shrinks, nobody has tuned these by ear
PARAGRAPH_PAUSE_S, SENTENCE_PAUSE_S = 1.2, 0.8      # (pencil) to this long at a paragraph break; to this long anywhere else
SLOW_WPM, FAST_WPM = 70, 220    # (pencil) outside what the ReadWorks recordings measured; see README
QUIET_DB = -45.0                # (pencil) under this speech level a nudge appears. A laptop microphone read at -38.8 with 31 dB above the room: not a problem
NOISY_SNR_DB, NOISY_FLOOR_DB = 28.0, voice_clean.NEURAL_FLAG_FLOOR_DBFS   # (pencil) false starts began to be missed below about 28 dB (noise_trial.py); one quiet real take read 31
RESTART_MIN_WORDS = 2           # (pencil) the same opening this long, heard twice, at a written sentence start and with real quiet at both cuts. "It takes... It takes a long time"
RESTART_MAX_WORDS, RESTART_MAX_S = 80, 45.0   # (pencil) about a paragraph: going back further than this is not a slip
RESTART_PAUSE_S = 0.2           # (pencil) the real quiet needed at both cuts
RESTART_KEEP_S = 0.03           # a little room before the voice, so a soft first sound isn't clipped
AUDIT_LOOK_S = 0.4              # (pencil) quiet this long after a word's start means its time is suspect
MAX_REREAD_LEFT_OUT = 2         # (pencil) words at either end of a reread that may be heard differently; the recognizer can mishear one or two
MIN_REREAD_MATCH = 0.6          # (pencil) share of the requested words that must be heard before a reread can be fitted in
CLIP_LEVEL, CLIP_RUN, CLIP_PER_MIN = 0.985, 3, 4     # (pencil) a flat run this long at the ceiling, this many times a minute


# ---------------------------------------------------------------------------------------------------------------------
# Passage shape
# ---------------------------------------------------------------------------------------------------------------------
ABBREV = {"mr.", "mrs.", "ms.", "dr.", "st.", "jr.", "sr.", "vs.", "etc.", "no.", "prof.", "gen.", "sen.", "rep.", "gov.", "capt."}


def join_number_parts(words):
    """The recognizer can split one number: "1" ",200". Put it back, so it's heard, timed and compared as one number."""
    out = []
    for w in words:
        if out and w[0][:1] == "," and w[0][1:2].isdigit() and out[-1][0][-1:].isdigit():
            out[-1] = [out[-1][0] + w[0], out[-1][1], w[2]]
        else:
            out.append(list(w))
    return out


BREATH_BEFORE = {"than", "with", "from", "for", "in", "on", "at", "by", "through", "across", "about", "under", "over"}    # only to shorten a line already long
CONNECTORS = {"and", "but", "or", "so", "because", "when", "while", "where", "who", "which", "that", "if", "as", "before", "after", "until", "though", "although", "since"}


def breath_lines(script):
    """Places on the page where a reader's copy could start a new line: narrators mark their scripts this way. Sentence ends, then commas and dashes,
    then before joining words, never leaving a line too short, and always before one grows too long. Display only: the words stay the same, in the same order."""
    text = script["text"]
    starts = set(sentence_starts(script)) | set(paragraph_starts(script))
    lines = [0]
    for i in range(1, len(text)):
        since = i - lines[-1]
        before = text[i - 1].rstrip("\u201d\"\u2019')]")
        next_start = min((k for k in starts if k > i), default=len(text))
        next_is_end = next_start - i < LINE_MIN_WORDS       # don't strand a word or two at the end of a sentence
        low = text[i].lstrip("\u201c\"\u2018'([").lower().rstrip(".,;:!?")
        if i in starts:
            lines.append(i)
        elif since >= LINE_MIN_WORDS - 1 and before.endswith((",", ";", ":", "\u2014", "--")) and not next_is_end:
            lines.append(i)
        elif since >= 5 and low in CONNECTORS and not next_is_end:
            lines.append(i)
        elif (since >= LINE_MAX_WORDS and not next_is_end) or (since >= 8 and low in BREATH_BEFORE and not next_is_end):
            lines.append(i)
    return lines


def script_for(doc):
    """The same written script human_prepare.py saves for the AWS route."""
    paras = paragraphs(doc)
    return {"lead": lead_for(doc), "paras": [len(p) for p in paras], "text": [w for p in paras for w in p],
            "title": doc.get("title"), "authors": [a for a in (doc.get("a") or []) if a],
            "text_sha256": hashlib.sha256((doc.get("text") or "").encode()).hexdigest()}


def ends_sentence(word, next_word=None):
    w = word.rstrip("”\"’')]")
    if not w.endswith((".", "!", "?")) or w.lower() in ABBREV or (len(w) == 2 and w[0].isupper()):   # "J." is an initial
        return False
    return next_word is None or not next_word[:1].islower()


def proper_names(script):
    """Words capitalized in mid-sentence (and the title's words that are too): names a recognizer can only guess the spelling of."""
    text = script["text"]
    starts = set(sentence_starts(script))
    found = []
    for i, w in enumerate(text):
        bare = w.strip("“”\"‘’'.,;:!?()—-")
        if i not in starts and bare[:1].isupper() and not bare.isupper() and bare not in found and any(c.isalpha() for c in bare):
            found.append(bare[:-2] if bare.endswith(("'s", "’s")) else bare)
    return found


def sentence_starts(script):
    """Indices into script["text"] where a sentence or paragraph begins."""
    text, starts, para_starts, n = script["text"], {0}, set(), 0
    for count in script["paras"]:
        para_starts.add(n)
        n += count
    starts |= {p for p in para_starts if p < len(text)}
    for i, w in enumerate(text[:-1]):
        if ends_sentence(w, text[i + 1]):
            starts.add(i + 1)
    return sorted(starts)


# ---------------------------------------------------------------------------------------------------------------------
# Sound as numbers
# ---------------------------------------------------------------------------------------------------------------------
def decode(src, dst):
    """Any recording -> mono 48 kHz 32-bit float, the one format everything here works on. An even mix: ffmpeg's plain "-ac 1"
    lifts identical channels by 3 dB (measured here: a -13.2 LUFS file came out at -10.1), which can clip them."""
    mono = voice_clean.mono_filter(voice_clean.probe(src)["channels"])
    voice_clean._ffmpeg(["-i", src, "-af", mono, "-ac", "1", "-ar", str(RATE), "-f", "f32le", dst])


def read_raw(path):
    a = array.array("f")
    with open(path, "rb") as f:
        a.frombytes(f.read())
    return a


def write_raw(path, samples):
    with open(path + ".tmp", "wb") as f:
        samples.tofile(f)
    os.replace(path + ".tmp", path)


def raw_to_wav(raw, wav, codec="pcm_s16le"):
    voice_clean._ffmpeg(["-f", "f32le", "-ar", str(RATE), "-ac", "1", "-i", raw, "-c:a", codec, wav])


def levels(samples):
    """Level of each 10 ms frame in dBFS (every third sample is plenty for a level)."""
    n = int(RATE * FRAME_S)
    out = []
    for i in range(0, len(samples) - n + 1, n):
        part = samples[i:i + n:3]
        out.append(10 * math.log10(max(sum(v * v for v in part) / len(part), 1e-12)))
    return out


def quiet_line(frames):
    """Below this a frame counts as a pause: halfway from the room to the voice, and at least QUIET_BELOW_VOICE_DB under the voice.
    The voice figure sets a limit that sat right on the room's own level in a slightly noisier room (-55 against -55 to -57), so real pauses broke up."""
    if not frames:
        return -60.0
    s = sorted(frames)
    floor, voice = s[int(len(s) * 0.05)], s[int(len(s) * 0.95)]
    return min((floor + voice) / 2, voice - QUIET_BELOW_VOICE_DB)


def quiet_run(frames, line, lo, hi):
    """The longest quiet stretch between lo and hi seconds, as (start, end) seconds; None if under 40 ms."""
    i0, i1 = max(0, int(lo / FRAME_S)), min(len(frames), int(math.ceil(hi / FRAME_S)))
    best, start = None, None
    for i in range(i0, i1 + 1):
        if i < i1 and frames[i] <= line:
            start = i if start is None else start
        elif start is not None:
            if best is None or i - start > best[1] - best[0]:
                best = (start, i)
            start = None
    if best is None or (best[1] - best[0]) * FRAME_S < 0.04:
        return None
    return best[0] * FRAME_S, best[1] * FRAME_S


def pause_around(frames, line, lo, hi, shortest=0.06):
    """The real pause between two moments: the longest quiet stretch, grown to where the voice actually stops and starts.
    The recognizer's word times are rough (a word's start can sit at the end of the pause before it), so they only say where to look."""
    run = quiet_run(frames, line, lo, hi)
    if run is None:
        return None
    i0, i1 = int(run[0] / FRAME_S), int(run[1] / FRAME_S)
    while i0 > 0 and frames[i0 - 1] <= line:
        i0 -= 1
    while i1 < len(frames) and frames[i1] <= line:
        i1 += 1
    return (i0 * FRAME_S, i1 * FRAME_S) if (i1 - i0) * FRAME_S >= shortest else None


def voice_onset(frames, line, t):
    """Where the voice really begins, near a rough start time: forward through any quiet, or back a little if already inside the voice."""
    i = min(max(0, int(t / FRAME_S)), max(0, len(frames) - 1))
    if frames and frames[i] > line:
        floor = max(0, i - 30)
        while i > floor and frames[i - 1] > line:
            i -= 1
        return i * FRAME_S
    while i < len(frames) - 3 and not all(v > line for v in frames[i:i + 3]):
        i += 1
    return i * FRAME_S


def clip_times(samples):
    """Seconds where the sound hit the ceiling and stayed there. A browser recording is not perfectly flat after its codec, so
    this looks for short runs near full scale, not exact 1.0."""
    out, run = [], 0
    for i, v in enumerate(samples):
        if abs(v) >= CLIP_LEVEL:
            run += 1
            if run == CLIP_RUN:
                out.append(i / RATE)
        else:
            run = 0
    return out


def peaks(frames, points=800):
    """A small picture of the recording for the page, 0..1."""
    if not frames:
        return []
    step = max(1, len(frames) // points)
    return [round(max(0.0, min(1.0, (max(frames[i:i + step]) + 60) / 60)), 2) for i in range(0, len(frames), step)]


# ---------------------------------------------------------------------------------------------------------------------
# Marking words
# ---------------------------------------------------------------------------------------------------------------------
def compare(spoken, script, uid, language="en-US"):
    """Run the shared check over what was heard. Returns timing (with rows, flags, checks), ok, reasons."""
    info = {"id": uid, "audio_key": "local", "language": language}
    timing, ok, reasons = build_timing([tuple(w) for w in spoken], script, info, names=namebook.load_packaged())
    timing["full_lead_n"] = len(script["lead"])
    return timing, ok, reasons


def shown_index(row, lead_n, full_n):
    """A word's place on the page: 0.. for the story, negative for the title and byline, counted from the full title line, so a
    place means the same thing whichever lead-in was heard."""
    return row - lead_n if row >= lead_n else row - full_n


def flag_key(f, lead_n, full_n):
    """The same slip keeps its key when the words are heard again, even if the recognizer spells it differently."""
    what = f["heard"] if f["kind"] == "extra" else f["written"]
    return f"{f['kind']}|{shown_index(f['word_index'], lead_n, full_n)}|{what}".lower()


def drop_decisions(accepted, a, b):
    """A person's "it's fine" was about one reading of those words. A reread replaces that reading, so the decision goes with it."""
    kept = []
    for key in accepted:
        i = int(key.split("|")[1])
        if not a <= i < b:
            kept.append(key)
    return kept


def drop_echoed_hints(spoken, script, expected=None):
    """The recognizer sometimes repeats back the names it was given, spelled just as it was given them ("now dance. Ants."; a reread
    ending "Ants Grasshopper"). Measured on the first real microphone take: these invented words made every reread of one sentence
    impossible to fit in. A word goes only if it is spelled exactly like a hint, has no gap before it, and the written text has no place for it."""
    bare = lambda w: w.strip("\u201c\u201d\"\u2018\u2019'.,;:!?()\u2014-")   # noqa: E731
    hints = set(proper_names(script)) | {w for a in script["authors"] for w in a.split()}
    expected = _tok_pairs(expected if expected is not None else script["lead"] + script["text"])
    heard = _tok_pairs([w[0] for w in spoken])
    matched = set()
    for m in difflib.SequenceMatcher(None, [t for t, _ in heard], [t for t, _ in expected], autojunk=False).get_matching_blocks():
        matched |= {heard[k][1] for k in range(m.a, m.a + m.size)}
    return [w for k, w in enumerate(spoken) if not (k and k not in matched and bare(w[0]) in hints and w[1] <= spoken[k - 1][2] + 0.02)]


def _match_score(tokens, expected):
    matched = sum(m.size for m in difflib.SequenceMatcher(None, tokens, expected, autojunk=False).get_matching_blocks())
    return matched, len(tokens) - matched


def find_restarts(spoken, expected_words, frames, language="en"):
    """Where a reader went back and read something again. A person who slips naturally returns to the start of the sentence or
    paragraph, so the same opening appears twice with the second try going on correctly. Returns cuts in order, as
    {first, second, cut_from, cut_to, removed, at}: remove spoken[first:second] and audio cut_from..cut_to.

    A cut is made only when all hold, so a repeat that belongs in the story is never touched: the same opening is heard again, and it is
    how a written sentence starts; taking out the first try loses no written word and leaves fewer words the text has no place for; it
    is no longer than a paragraph; and both cuts land in a real pause. The first try's opening pause is kept. When the last try is the
    worse one nothing is cut, and anything else stays marked for a person."""
    pairs = _tok_pairs([w[0] for w in spoken], language)
    written = _tok_pairs(expected_words, language)
    expected = [t for t, _ in written]
    first_of = {}
    for k, (_, w) in enumerate(written):
        first_of.setdefault(w, k)
    openings = set()
    for w in range(len(expected_words)):
        if (w == 0 or ends_sentence(expected_words[w - 1], expected_words[w])) and w in first_of:
            openings.add(tuple(expected[first_of[w]:first_of[w] + RESTART_MIN_WORDS]))
    line = quiet_line(frames)
    cuts, words = [], [list(w) for w in spoken]
    mid = lambda w: (w[1] + w[2]) / 2           # noqa: E731
    while True:
        pairs = _tok_pairs([w[0] for w in words], language)
        toks = [t for t, _ in pairs]
        base = _match_score(toks, expected)
        found = []
        for j in range(RESTART_MIN_WORDS, len(toks) - RESTART_MIN_WORDS + 1):
            for i in range(max(0, j - RESTART_MAX_WORDS), j - RESTART_MIN_WORDS + 1):
                if toks[i:i + RESTART_MIN_WORDS] == toks[j:j + RESTART_MIN_WORDS] and tuple(toks[j:j + RESTART_MIN_WORDS]) in openings:
                    score = _match_score(toks[:i] + toks[j:], expected)
                    if score[0] >= base[0] and score[1] < base[1]:
                        found.append(((score[1], -score[0], j - i), i, j))
        for _, ti, tj in sorted(found):
            i, j = pairs[ti][1], pairs[tj][1]
            before = pause_around(frames, line, mid(words[i - 1]) if i else 0.0, mid(words[i]), RESTART_PAUSE_S)
            again = pause_around(frames, line, mid(words[j - 1]), mid(words[j]), RESTART_PAUSE_S)
            if again is not None and (before is not None or not i) and words[j][1] - words[i][1] <= RESTART_MAX_S:
                cuts.append({"first": i, "second": j, "cut_from": round(max(0.0, (before[1] if before else words[i][1]) - RESTART_KEEP_S), 3),
                             "cut_to": round(again[1] - RESTART_KEEP_S, 3), "removed": " ".join(w[0] for w in words[i:j]), "at": round(words[i][1], 2)})
                words = words[:i] + words[j:]        # times stay on the original recording
                break
        else:
            return cuts                              # nothing left that is safe to cut: a person hears the rest


def move_words(spoken, cuts):
    """Word times after cuts: words inside a cut go; a rough start reaching back through a cut begins where the cut ends."""
    spans = sorted((c["cut_from"], c["cut_to"]) for c in cuts)

    def moved(t):
        shift = 0.0
        for c0, c1 in spans:
            if t >= c1:
                shift += (c1 - c0) + JOIN_FADE_S
            elif t > c0:
                return None
        return round(t - shift, 3)
    words = []
    for w in spoken:
        end = moved(w[2])
        if end is None:
            continue
        begin = moved(w[1])
        if begin is None:
            begin = max(0.0, end - (w[2] - w[1]))
        words.append([w[0], round(min(begin, end), 3), end])
    return words


def apply_cuts(samples, spoken, cuts):
    """Take the cuts out of the recording and the word list, on one timeline. Cuts arrive in the order they were found."""
    spans = sorted((c["cut_from"], c["cut_to"]) for c in cuts)
    out = samples
    for c0, c1 in reversed(spans):
        out = splice(out, c0, c1, array.array("f"))
    placed = []
    for c in cuts:
        before = sum(c1 - c0 + JOIN_FADE_S for c0, c1 in spans if c1 <= c["cut_from"])
        placed.append(dict(c, new_at=round(c["cut_from"] - before, 3)))
    return out, move_words(spoken, cuts), sorted(placed, key=lambda c: c["cut_from"])


def second_opinion(flag, lead_n, full_n, second):
    """Did the other listen also disagree with the text here? One word apart counts as the same spot."""
    i = shown_index(flag["word_index"], lead_n, full_n)
    n = max(1, len(flag["written"].split()))
    lead2, seen = len(second["lead"]), set()
    for g in second["flags"]:
        if not g.get("advisory"):
            k = shown_index(g["word_index"], lead2, full_n)
            seen.update(range(k, k + max(1, len(g["written"].split()))))
    return any(k in seen for k in range(i - 1, i + n + 1))


def repeats_neighbour(flag, lead_n, script):
    """An extra word that repeats what's beside it ("It takes It takes", "planet planet", "impossible Possible"). One listen tends to tidy such a stumble
    away, so the listens disagreeing isn't evidence that it didn't happen."""
    if flag["kind"] != "extra":
        return False
    heard = [t for t, _ in _tok_pairs(flag["heard"].split())]
    i = flag["word_index"] - lead_n
    near = lambda a, b: [t for t, _ in _tok_pairs(script["text"][max(a, 0):max(b, 0)])]   # noqa: E731
    n = len(heard)
    if not n or n > 6:
        return False
    return heard == near(i - n, i) or heard == near(i, i + n) or (n == 1 and any(heard[0] in t for t in near(i - 1, i + 1)))


def word_marks(timing, script, accepted=(), second=None, show_all=False):
    """One entry per word on the page: right / wrong / missed, what was heard, when. Rows follow the lead-in that was kept.

    second: the other listen's timing. A spot both listens doubt is shown; one that only this listen doubts is left off a reader's page,
    which on real readings halves the likely false alarms (LOOPS_LOG Loop 9). show_all keeps every spot and says which is which, for the
    reviewer. This is only about what is shown: the shared gate still sees every flag."""
    lead_n, full_n = len(timing["lead"]), len(script["lead"])
    rows = timing["t"]
    marks = [{"i": i, "w": w, "state": "right", "heard": None, "start": rows[lead_n + i][0], "end": rows[lead_n + i][1],
              "before": None, "ok": False} for i, w in enumerate(script["text"])]
    lead = [{"i": k - full_n, "w": w, "state": "right" if k < lead_n else "unsaid", "heard": None, "ok": False,
             "start": rows[k][0] if k < lead_n else None, "end": rows[k][1] if k < lead_n else None} for k, w in enumerate(script["lead"])]
    accepted = set(accepted)
    open_flags = []
    for f in timing["flags"]:
        if f.get("advisory"):
            continue
        both = second is None or second_opinion(f, lead_n, full_n, second) or repeats_neighbour(f, lead_n, script)
        if not both and not show_all:
            continue
        ok = flag_key(f, lead_n, full_n) in accepted
        count = len(f["written"].split())
        open_flags.append({"kind": f["kind"], "written": f["written"], "heard": f["heard"], "at": f["at"], "key": flag_key(f, lead_n, full_n),
                           "i": shown_index(f["word_index"], lead_n, full_n), "n": max(1, count), "ok": ok, "both": both})
        if f["kind"] == "extra":
            continue
        for row in range(f["word_index"], f["word_index"] + count):
            target = marks[row - lead_n] if row >= lead_n else lead[row]
            target.update(state="wrong" if f["kind"] == "swap" else "missed", heard=f["heard"] if f["kind"] == "swap" else None, ok=ok)
    if show_all and second is not None:      # what only the listen without hints doubted: a wrong name can pass the hinted listen
        lead2 = len(second["lead"])
        mine = {k for f in open_flags for k in range(f["i"], f["i"] + f["n"])}
        for g in second["flags"]:
            i = shown_index(g["word_index"], lead2, full_n)
            n = max(1, len(g["written"].split()))
            if not g.get("advisory") and not any(k in mine for k in range(i - 1, i + n + 1)):
                open_flags.append({"kind": g["kind"], "written": g["written"], "heard": g["heard"], "at": g["at"], "key": "second|" + flag_key(g, lead2, full_n),
                                   "i": i, "n": n, "ok": False, "both": False, "second_only": True})
    return {"words": marks, "lead": lead, "flags": open_flags, "open": sum(1 for f in open_flags if not f["ok"]),
            "lead_kept": timing["lead_kept"], "text_match": timing["checks"].get("text_match"), "lead_n": lead_n}


def row_words(marks):
    """Lead words that were heard, then the story: the order things happen in the recording."""
    return marks["lead"][:marks["lead_n"]] + marks["words"]


def to_row(i, marks):
    """A place on the page -> an index into row_words."""
    return i + marks["lead_n"] if i >= 0 else min(i + len(marks["lead"]), marks["lead_n"])


def names_in(script, a, b):
    part = " ".join(span_words(script, a, b))
    return [n for n in proper_names(script) + script["authors"] if n in part]


def span_words(script, a, b):
    full = script["lead"] + script["text"]
    return full[a + len(script["lead"]):b + len(script["lead"])]


# ---------------------------------------------------------------------------------------------------------------------
# Choosing what to reread, and finding the seam
# ---------------------------------------------------------------------------------------------------------------------
def pause_before(r, words, frames, line, total):
    """The real pause just before row r (r == len(words): after the last word). None if there is no real pause."""
    mid = lambda w: (w["start"] + w["end"]) / 2                 # noqa: E731
    if r >= len(words):
        return pause_around(frames, line, mid(words[-1]) if words else 0, total) or (total, total)
    if r == 0:
        return pause_around(frames, line, 0, mid(words[0])) or (0.0, 0.0)
    return pause_around(frames, line, mid(words[r - 1]), max(mid(words[r]), mid(words[r - 1]) + 0.05))


def paragraph_starts(script):
    out, n = [], 0
    for count in script["paras"]:
        out.append(n)
        n += count
    return out


def choose_span(i0, i1, script, marks, frames, total, scope="sentence"):
    """Which words to reread, as places on the page, for a mistake at i0..i1 (end exclusive). Returns (a, b, scope actually used).

    A sentence by default, or the whole paragraph if asked. Both ends must land in a real pause. A sentence with no pause at an edge,
    or a mistake reaching across sentences, becomes the paragraph; a paragraph with no pause at an edge grows to the next ones that have
    one. A slip in the title or byline rereads that whole line."""
    n, top = len(script["text"]), -len(script["lead"])
    words = row_words(marks)
    line = quiet_line(frames)
    has_pause = lambda k: k in (top, n) or pause_before(to_row(k, marks), words, frames, line, total) is not None   # noqa: E731
    if i0 < 0:
        b = min((s for s in sentence_starts(script) + [n] if s >= max(i1, 0) and has_pause(s)), default=n)
        return top, b, "title"
    paras = paragraph_starts(script)
    para_a = max(p for p in paras if p <= i0)
    para_b = min((p for p in paras if p >= i1), default=n)
    if scope != "paragraph":
        starts = sentence_starts(script)
        a = max(s for s in starts if s <= i0)
        b = min((s for s in starts + [n] if s >= i1 and s > i0), default=n)
        if has_pause(a) and has_pause(b) and (a, b) != (para_a, para_b) and sum(a < s < b for s in starts) == 0:
            return a, b, "sentence"
    a = max((p for p in paras if p <= para_a and has_pause(p)), default=0)
    b = min((p for p in paras + [n] if p >= para_b and has_pause(p)), default=n)
    return a, b, "paragraph"


def find_in_reread(spoken, expected, language="en"):
    """Which heard words are the expected ones: a person may start a little early or run on. Returns (first, last+1) or None."""
    a, b = _tok_pairs([w[0] for w in spoken], language), _tok_pairs(expected, language)
    blocks = [m for m in difflib.SequenceMatcher(None, [t for t, _ in a], [t for t, _ in b], autojunk=False).get_matching_blocks() if m.size]
    if not blocks:
        return None
    if sum(m.size for m in blocks) < max(min(2, len(b)), MIN_REREAD_MATCH * len(b)):     # one shared "the" is not a reread
        return None
    first, last = blocks[0], blocks[-1]
    head = a[max(0, first.a - first.b)][1]                      # expected words before the first match were probably misheard
    tail_tok = min(len(a) - 1, last.a + last.size - 1 + (len(b) - last.b - last.size))
    return head, a[tail_tok][1] + 1


def reread_left_out(spoken, expected, language="en"):
    """How many requested words at the start and at the end of a part the reread never reached. A reread replaces the WHOLE part in the old
    reading, so one that stops short would silently lose words the person read correctly before. One or two words heard differently are
    forgiven, since something was said in their place; words with nothing said in their place are not."""
    a, b = _tok_pairs([w[0] for w in spoken], language), _tok_pairs(expected, language)
    blocks = [m for m in difflib.SequenceMatcher(None, [t for t, _ in a], [t for t, _ in b], autojunk=False).get_matching_blocks() if m.size]
    if not blocks:
        return len(b), len(b)
    head, tail = blocks[0].b, len(b) - blocks[-1].b - blocks[-1].size
    said_before, said_after = blocks[0].a, len(a) - blocks[-1].a - blocks[-1].size
    return (head if head > MAX_REREAD_LEFT_OUT else max(0, head - said_before),
            tail if tail > MAX_REREAD_LEFT_OUT else max(0, tail - said_after))


def fade(samples, seconds, inward):
    n = min(len(samples), int(seconds * RATE))
    for k in range(n):
        g = math.sin((k + 1) / (n + 1) * math.pi / 2)
        if inward:
            samples[k] *= g
        else:
            samples[-1 - k] *= g


def splice(base, at_in, at_out, piece):
    """base[:at_in] + piece + base[at_out:], equal-power crossfaded at both joins (seconds in, samples out)."""
    i0, i1 = int(at_in * RATE), int(at_out * RATE)
    out = array.array("f", base[:i0])
    for part in (array.array("f", piece), base[i1:]):
        m = min(int(JOIN_FADE_S * RATE), len(out), len(part))
        for k in range(m):
            g = (k + 1) / (m + 1) * math.pi / 2
            out[len(out) - m + k] = out[len(out) - m + k] * math.cos(g) + part[k] * math.sin(g)
        out.extend(part[m:])
    return out


def speech_level(frames):
    if not frames:
        return -60.0
    return sorted(frames)[int(len(frames) * 0.9)]


def plan_join(base_words, base_frames, total, a, b, heard, r_frames, r_total, r_first, r_last):
    """Where to cut the old reading and the reread so the pauses around the new part stay as long as they were."""
    line, r_line = quiet_line(base_frames), quiet_line(r_frames)
    rough = []
    pa = pause_before(a, base_words, base_frames, line, total)
    pb = pause_before(b, base_words, base_frames, line, total)
    mid = lambda w: (w[1] + w[2]) / 2                           # noqa: E731
    ra = pause_around(r_frames, r_line, mid(heard[r_first - 1]) if r_first > 0 else 0.0, mid(heard[r_first]), 0.02)
    later = next((w for w in heard[r_last:] if w[1] >= heard[r_last - 1][2] - 0.05), None)
    rb = pause_around(r_frames, r_line, mid(heard[r_last - 1]), mid(later) if later else r_total, 0.02)
    if ra is None:                       # the voice starts at the very start of the file: that edge is clean enough, otherwise it isn't
        ra = (heard[r_first][1], heard[r_first][1])
        if r_first > 0:
            rough.append("start of the new reading")
    if rb is None:
        rb = (heard[r_last - 1][2], heard[r_last - 1][2])
        if later:
            rough.append("end of the new reading")
    r_in = max(ra[0], ra[1] - 0.15)
    r_out = min(rb[1], rb[0] + 0.2)
    if pa is None:
        t = base_words[a]["start"]
        pa = (t, t)
        rough.append("start of the old reading")
    if pb is None:
        t = base_words[b]["start"] if b < len(base_words) else total
        pb = (t, t)
        rough.append("end of the old reading")
    seam_in = max(pa[0], pa[1] - (ra[1] - r_in)) if a > 0 else 0.0
    seam_out = min(pb[1], pb[0] + (r_out - rb[0])) if b < len(base_words) else total
    seam_out = max(seam_out, seam_in)
    return {"seam_in": round(seam_in, 3), "seam_out": round(seam_out, 3), "r_in": round(r_in, 3), "r_out": round(r_out, 3), "r_words": [r_first, r_last], "rough": rough}


def join(base, base_spoken, reread, r_spoken, plan):
    """Apply a plan. Returns (samples, spoken words on the new timeline, gain used). The reread is matched to the level around it."""
    r_part = reread[int(plan["r_in"] * RATE):int(plan["r_out"] * RATE)]
    near = levels(base[int(max(0, plan["seam_in"] - 6) * RATE):int((plan["seam_out"] + 6) * RATE)])
    gain_db = max(-MAX_MATCH_GAIN_DB, min(MAX_MATCH_GAIN_DB, speech_level(near) - speech_level(levels(r_part))))
    g = 10 ** (gain_db / 20)
    r_part = array.array("f", (max(-1.0, min(1.0, v * g)) for v in r_part))
    out = splice(base, plan["seam_in"], plan["seam_out"], r_part)
    return out, joined_words(base_spoken, r_spoken[plan["r_words"][0]:plan["r_words"][1]], plan), round(gain_db, 1)


def joined_words(base_spoken, r_words, plan):
    """The word list on the joined timeline: the old words outside the seams, and the reread's words between them."""
    first_overlap = JOIN_FADE_S if plan["seam_in"] > 0 else 0.0     # each crossfade overlaps its two sides
    shift = plan["seam_in"] - plan["r_in"] - first_overlap
    delta = (plan["r_out"] - plan["r_in"]) - (plan["seam_out"] - plan["seam_in"]) - first_overlap - JOIN_FADE_S
    words = [list(w) for w in base_spoken if w[2] <= plan["seam_in"] + 0.02]     # a word's end is the recognizer's firmest time
    for w in r_words:
        s, e = max(w[1], plan["r_in"]) + shift, min(max(w[2], plan["r_in"]), plan["r_out"]) + shift
        words.append([w[0], round(s, 3), round(max(e, s), 3)])
    for w in base_spoken:
        if w[2] > plan["seam_out"] + 0.02:
            s = max(w[1], plan["seam_out"]) + delta
            words.append([w[0], round(s, 3), round(w[2] + delta, 3)])
    return words


# ---------------------------------------------------------------------------------------------------------------------
# Tidying the finished reading (before the sound cleanup, so the cleanup's checks and the timing see the final length)
# ---------------------------------------------------------------------------------------------------------------------
def sounds(frames, line, shortest=0.2):
    """Every stretch above the quiet line lasting at least `shortest` seconds, as (start, end). Gaps under 50 ms don't break a stretch."""
    out, start, quiet = [], None, 0
    for i, v in enumerate(frames):
        if v > line:
            start = i if start is None else start
            quiet = 0
        elif start is not None:
            quiet += 1
            if quiet > 5:
                if (i - quiet - start + 1) * FRAME_S >= shortest:
                    out.append((start * FRAME_S, (i - quiet + 1) * FRAME_S))
                start, quiet = None, 0
    if start is not None and (len(frames) - quiet - start) * FRAME_S >= shortest:
        out.append((start * FRAME_S, (len(frames) - quiet) * FRAME_S))
    return out


def tidy(samples, spoken, paragraph_times=()):
    """Trim the quiet at both ends (and the click of the Stop button), and shrink very long silences, leaving a longer rest at a paragraph
    break. paragraph_times: when each paragraph's first word starts. Returns (samples, notes)."""
    total = len(samples) / RATE
    frames = levels(samples)
    line = quiet_line(frames)
    if not spoken:
        return samples, {"trimmed_start_s": 0.0, "trimmed_end_s": 0.0, "shortened_pauses": []}
    # Keep every stretch of sound long enough to be speech, even outside what the recognizer heard: it can miss a first or last word.
    # A shorter sound past the last word is taken as the click of the Stop button, and trimmed.
    sound = sounds(frames, line)
    first = min([voice_onset(frames, line, spoken[0][1])] + [r[0] for r in sound])
    last = max([spoken[-1][2]] + [r[1] for r in sound])
    t0, t1 = max(0.0, first - KEEP_BEFORE_S), min(total, last + KEEP_AFTER_S)
    for k in range(int(last / FRAME_S), int(t1 / FRAME_S)):
        if k < len(frames) and frames[k] > line:
            t1 = min(t1, k * FRAME_S)
            break
    cuts, run, loud = [], None, 0
    blip = int(PAUSE_BLIP_S / FRAME_S)
    for k in range(int(first / FRAME_S), min(len(frames), int(last / FRAME_S) + 1)):
        if frames[k] <= line:
            run = k if run is None else run
            loud = 0
        elif run is not None:
            loud += 1
            if loud > blip:
                end = k - loud + 1
                if (end - run) * FRAME_S > LONG_PAUSE_S:
                    cuts.append((run * FRAME_S, end * FRAME_S))
                run, loud = None, 0
    out = array.array("f", samples[int(t0 * RATE):int(t1 * RATE)])
    notes = []
    for c0, c1 in reversed(cuts):                     # remove the middle of the pause, so the voice's edges stay untouched
        keep = PARAGRAPH_PAUSE_S if any(c0 - 0.3 <= t <= c1 + 0.3 for t in paragraph_times) else SENTENCE_PAUSE_S
        extra = (c1 - c0) - keep
        mid = (c0 + c1) / 2 - t0
        out = splice(out, mid - extra / 2, mid + extra / 2, array.array("f"))
        notes.append(round(c1 - c0, 1))
    fade(out, 0.05, True)
    fade(out, 0.08, False)
    return out, {"trimmed_start_s": round(t0, 2), "trimmed_end_s": round(total - t1, 2), "shortened_pauses": list(reversed(notes))}


# ---------------------------------------------------------------------------------------------------------------------
# Plain-language checks. Each says what was noticed and what to do; none blocks anything.
# ---------------------------------------------------------------------------------------------------------------------
def sentence_of(i, starts):
    return max((s for s in starts if s <= i), default=0)


def checks_for(samples, marks, script):
    frames = levels(samples)
    total = len(samples) / RATE
    words = marks["words"]
    out = []

    def add(key, good, title, detail="", action="", where=None):
        out.append({"key": key, "good": good, "title": title, "detail": detail, "action": action, "where": where or []})

    voice = speech_level(frames)
    s = sorted(frames) or [-120.0]
    floor = s[int(len(s) * 0.05)]
    if voice < QUIET_DB:
        add("quiet", False, "Your voice came through quietly", "We can raise it, but any room sound rises with it.",
            "If you can, move closer to the microphone and read it again.")
    else:
        add("quiet", True, "Your voice is loud enough")
    clips = clip_times(samples)
    if len(clips) / max(total / 60, 0.1) >= CLIP_PER_MIN:
        starts = sentence_starts(script)
        hit = sorted({sentence_of(next((w["i"] for w in words if w["end"] >= t), len(words) - 1), starts) for t in clips})
        add("clipped", False, "Some of it was too loud for the microphone", "Very loud moments can crackle, and cleanup can't undo that.",
            "Move back a little, then read those parts again.", hit[:8])
    else:
        add("clipped", True, "Nothing was too loud")
    if voice - floor < NOISY_SNR_DB or floor > NOISY_FLOOR_DB:
        add("noisy", False, "There's a lot of sound in the room", "Cleanup can soften a steady hum or hiss, but not voices or music. False starts may stay in, too.",
            "If you can, move somewhere quieter or get closer to the microphone, then read it again.")
    else:
        add("noisy", True, "The room sounds quiet enough")
    line = quiet_line(frames)
    spoken_s = sum(1 for v in frames if v > line) * FRAME_S
    long_quiet = [i for i in range(len(words) - 1) if words[i + 1]["start"] - words[i]["end"] > LONG_PAUSE_S]
    if long_quiet:
        add("silence", True, "There are some long pauses", "We'll shorten these for you when you finish. No need to do anything.")
    elif total and spoken_s / total < 0.4:
        add("silence", False, "Much of this recording is quiet", "", "That's okay if you were taking your time. If something went wrong, read it again.")
    else:
        add("silence", True, "The pauses sound natural")
    right = sum(1 for w in words if w["state"] == "right")
    span = (words[-1]["end"] - words[0]["start"]) if words else 0
    wpm = round(len(words) / span * 60) if span > 1 and right > len(words) / 2 else None
    if wpm and wpm < SLOW_WPM:
        add("speed", False, "This is slower than most readers", f"About {wpm} words a minute.",
            "It's fine if that's on purpose. For young listeners, a steady pace usually works best.")
    elif wpm and wpm > FAST_WPM:
        add("speed", False, "This is quicker than most readers", f"About {wpm} words a minute.",
            "Young readers follow along more easily if you slow down a little.")
    else:
        add("speed", True, "The pace sounds comfortable" if wpm else "We'll check the pace once more of the words are read")
    if marks["lead_kept"] == "none":
        add("title", False, "We didn't hear the title", "Listeners like to hear what the story is called.", "You can read just the title and we'll add it at the start.",
            [marks["lead"][0]["i"]] if marks["lead"] else [])
    left = marks["open"]
    if left:
        add("words", False, f"{left} {'spot' if left == 1 else 'spots'} to listen to",
            "The computer can mishear names and unusual words, so this may be fine.",
            "Tap a marked word to hear it. Read that part again, or leave it for the team to check.")
    else:
        add("words", True, "The words match the text")
    return out, {"speech_db": round(voice, 1), "floor_db": round(floor, 1), "clip_events": len(clips), "wpm": wpm, "seconds": round(total, 1)}


# ---------------------------------------------------------------------------------------------------------------------
# The gate, with a person's decisions. The machine's verdict is never overwritten; both are recorded.
# ---------------------------------------------------------------------------------------------------------------------
def every_flag(timing):
    """What a reviewer's approval speaks for: every spot the check raised."""
    lead_n, full_n = len(timing["lead"]), timing.get("full_lead_n", len(timing["lead"]))
    return [flag_key(f, lead_n, full_n) for f in timing["flags"] if not f.get("advisory")]


def decide(timing, ok, reasons, accepted):
    """May a reviewer put it in the reader? The shared gate says yes, or every flag it raised was released by the reviewer AND the rest
    of the gate (timing sound, enough of the text matched, nothing else wrong) still passes. Nothing reaches the reader without
    approval either way (serve.approve_session); a volunteer's "it was fine" is a note for the reviewer, not a release."""
    if ok:
        return {"publish": True, "gate": "passed", "reasons": [], "person_accepted": []}
    accepted, lead_n, full_n = set(accepted), len(timing["lead"]), timing.get("full_lead_n", len(timing["lead"]))
    flags = [f for f in timing["flags"] if not f.get("advisory")]
    still = [f for f in flags if flag_key(f, lead_n, full_n) not in accepted]
    done = [{"kind": f["kind"], "written": f["written"], "heard": f["heard"], "at": f["at"]} for f in flags if flag_key(f, lead_n, full_n) in accepted]
    cleared = dict(timing["checks"], filled=0, swapped=0, flag_count=0, spoken_extras=[], written_not_heard=[], swapped_words=[])
    if flags and not still and human_gate(cleared):
        return {"publish": True, "gate": "held, then released by a reviewer", "reasons": reasons, "person_accepted": done}
    return {"publish": False, "gate": "held", "reasons": reasons, "person_accepted": done}


def rows_valid(rows, count, allow_null, duration=None):
    """The reader's own rule (prototype/app/src/compare.js validTiming), plus: nothing past the end of the file."""
    if len(rows) != count:
        return False
    prev = 0
    for r in rows:
        if r is None and allow_null:
            continue
        if r is None or r[1] <= r[0] or r[0] < prev or (duration is not None and r[1] > duration + 0.5):
            return False
        prev = r[1]
    return True


def audit_word_starts(frames, rows, text, seconds=AUDIT_LOOK_S):
    """Does sound follow each published word's start? A word whose start has only quiet for the next moment is probably timed wrongly: the
    highlight would light in silence. Advisory for the reviewer, never a block: it can't tell a right word from a wrong one, and soft sounds
    near the quiet line can trip it. Also reports the longest gaps, so a pause can be found and heard."""
    line = quiet_line(frames)
    n = int(seconds / FRAME_S)
    odd = []
    for i, r in enumerate(rows):
        k = int(r[0] / FRAME_S)
        if k >= len(frames) or all(v <= line for v in frames[k:k + n]):
            odd.append({"i": i, "word": text[i], "at": round(r[0], 2)})
    gaps = sorted(((round(b[0] - a[1], 2), i + 1) for i, (a, b) in enumerate(zip(rows, rows[1:]))), reverse=True)[:5]
    return {"silent_starts": odd, "checked": len(rows), "line_db": round(line, 1),
            "longest_gaps": [{"seconds": g, "before_word": text[i], "at": round(rows[i][0], 2)} for g, i in gaps]}


def even_out_flagged(timing):
    """A flagged stretch of two or more words has no trustworthy time per word: the recognizer's guess can crowd them into one moment
    (measured: up to 12.8 s off on a 7.7-minute reading). Spread them by length between the words on either side, which are trustworthy.
    If a person keeps such a stretch, its highlight is approximate, and the record says how many words."""
    rows = [list(r) for r in timing["t"]]
    moved = 0
    for f in timing["flags"]:
        count = len(f["written"].split())
        if f.get("advisory") or f["kind"] not in ("swap", "missing") or count < 2:
            continue
        i = f["word_index"]
        lo = rows[i - 1][1] if i > 0 else rows[i][0]
        hi = rows[i + count][0] if i + count < len(rows) else max(rows[i + count - 1][1], timing.get("duration") or 0)
        sizes = [max(1, len(w)) for w in f["written"].split()]
        at = lo
        for k, size in enumerate(sizes):
            step = (hi - lo) * size / sum(sizes)
            rows[i + k][:2] = [round(at, 3), round(at + step, 3)]
            at += step
        moved += count
    return rows, moved


def readable_starts(rows):
    """Give every word time to be seen. The reader lights a word until the next one starts, so a 20 ms word is a flicker. Short words borrow from the words after them, moving
    at most MAX_NUDGE_S, and catch up at the next pause. The sound never changes, only when the highlight moves."""
    out = [list(r) for r in rows]
    for k in range(1, len(out)):
        want = out[k - 1][0] + MIN_VISIBLE_S
        if out[k][0] < want:
            limit = rows[k][0] + MAX_NUDGE_S
            out[k][0] = round(min(want, limit), 3)
            out[k][1] = round(max(out[k][1], out[k][0] + 0.01), 3)
        out[k - 1][1] = round(min(out[k - 1][1], max(out[k][0], out[k - 1][0] + 0.01)), 3)
    return out


def reader_rows(timing, script):
    """Timing rows in the shape the reader validates (compare.js): lead with nulls for unsaid words, body always forward and non-empty."""
    lead_n = len(timing["lead"])
    rows = timing["t"]
    lead, last = [], 0.0
    body_start = rows[lead_n][0] if len(rows) > lead_n else 0.0
    for k in range(len(script["lead"])):
        r = rows[k] if k < lead_n else None
        if r and r[2] == HEARD and r[1] > r[0] and r[0] >= last and r[1] <= body_start:   # a lead word may not run into the next one
            lead.append([r[0], r[1], r[2]])
            last = r[1]
        else:
            lead.append(None)
    # A word's start is firm; its end gives way to the next word's start, so nothing is pushed past where it was said.
    starts, prev = [], last
    for r in rows[lead_n:]:
        prev = max(r[0], prev)
        starts.append(prev)
    body = []
    for k, (s, r) in enumerate(zip(starts, rows[lead_n:])):
        nxt = starts[k + 1] if k + 1 < len(starts) else max(r[1], s + 0.01)
        if body and s < body[-1][1]:             # words sharing a start (a word never heard): the smallest step keeps the order
            s = body[-1][1]
        e = min(r[1], nxt) if nxt > s else s + 0.01
        body.append([round(s, 3), round(max(e, s + 0.01), 3), r[2]])
    body = readable_starts(body)
    return lead, body
