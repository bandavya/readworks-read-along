"""Random false starts and rereads, combined: does the word list stay true to the audio, and does every sample go where it should?
  python loops_2026-10-31/l9_human_recorder/stress_edits.py [runs] [seed]

No GPU, no recognizer. Each word is a tone at its own loudness, so after any edits the sound under a word's time says which word it really is. Reports
how often each promise broke. This tests the bookkeeping only: fake voices, exact word times, and clean pauses say nothing about how a real join sounds.
"""
import array
import json
import math
import os
import random
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
EV = os.path.dirname(HERE)
sys.path.insert(0, EV)
import engine  # noqa: E402

R = engine.RATE
TEXT = ("Mia has a red kite today. The wind lifts it very high. She runs past an old tree, and the kite dips low. Up it goes once again! "
        "Ben sees the kite from his room. He waves at Mia and she waves back. They both laugh at the big blue sky.").split()
FULL = TEXT
UID = "11111111-1111-1111-1111-111111111111"


def amp(i):
    return 0.10 + 0.0035 * (i % 60)      # each word's own loudness: 60 distinct levels


def voice(entries, tail=0.5):
    """entries: [(word index, start, end)]. Near-silent room between words, tones during them."""
    total = max(e for _, _, e in entries) + tail
    x = array.array("f", [0.0]) * int(total * R)
    for k in range(len(x)):
        if k % 7 == 0:
            x[k] = 1e-4
    for i, s, e in entries:
        a = amp(i)
        for k in range(int(s * R), min(len(x), int(e * R))):
            x[k] = a * math.sin(k * 0.05)
    return x


def lay_out(indices, t=0.5, gap=0.3, rng=None, pause_after=()):
    """pause_after: positions in `indices` where the reader stops: a person who slips stops before going back."""
    entries, words = [], []
    for at, i in enumerate(indices):
        d = 0.2 + (rng.random() * 0.15 if rng else 0.05)
        entries.append((i, t, t + d))
        words.append([TEXT[i], round(t, 3), round(t + d, 3)])
        t += d + (0.8 if at in pause_after else 0.42 if engine.ends_sentence(TEXT[i]) else gap * 0.3)
    return entries, words


def which_word(samples, word):
    """Loudness in the middle of a word's time -> the index the tone was made for."""
    s, e = word[1], word[2]
    m0, m1 = int((s + (e - s) * 0.3) * R), int((s + (e - s) * 0.7) * R)
    part = samples[m0:m1]
    if len(part) < 200:
        return None
    return max(abs(v) for v in part)


def run_once(rng):
    starts = [0] + [i + 1 for i, w in enumerate(TEXT[:-1]) if engine.ends_sentence(w, TEXT[i + 1])]
    order, planted, stops = [], [], set()
    for n, a in enumerate(starts):
        b = starts[n + 1] if n + 1 < len(starts) else len(TEXT)
        if b - a >= 5 and rng.random() < 0.5:      # slip: read the opening, stop, go back, read it all
            stop = rng.randint(a + 3, b - 1)
            order += list(range(a, stop))
            planted.append(a)
            stops.add(len(order) - 1)
        order += list(range(a, b))
    entries, words = lay_out(order, rng=rng, pause_after=stops)
    x = voice(entries)
    frames = engine.levels(x)
    cuts = engine.find_restarts(words, FULL, frames)
    out, moved, placed = engine.apply_cuts(x, words, cuts)
    problems = []
    if len(cuts) != len(planted):
        problems.append(f"found {len(cuts)} of {len(planted)} planted restarts")
    if [w[0] for w in moved] != TEXT:
        problems.append("after cuts the word list isn't the story")
    expected_len = len(x) - sum(int(c["cut_to"] * R) - int(c["cut_from"] * R) + int(engine.JOIN_FADE_S * R) for c in cuts)
    if abs(len(out) - expected_len) > 2 * max(1, len(cuts)):
        problems.append(f"length off by {len(out) - expected_len} samples")
    if [w[1] for w in moved] != sorted(w[1] for w in moved):
        problems.append("word times out of order after cuts")
    def sound_wrong(samples, listing):
        bad = 0
        for k, w in enumerate(listing):
            got = which_word(samples, w)
            if got is None or abs(got - amp(k)) > 0.02:
                bad += 1
        return bad
    bad = sound_wrong(out, moved)
    if bad:
        problems.append(f"{bad} words sit on the wrong sound after cuts")
    # rereads, one after another, on top of the cuts. Each word's expected loudness is tracked: a reread changes its own words, on purpose.
    base, base_words = out, moved
    expected = [amp(k) for k in range(len(TEXT))]
    for _ in range(rng.randint(1, 3)):
        n = rng.randrange(len(starts))
        a = starts[n]
        b = starts[n + 1] if n + 1 < len(starts) else len(TEXT)
        r_entries, r_words = lay_out(range(a, b), t=rng.uniform(0.3, 0.9), rng=rng)
        rx = voice(r_entries)
        rf = engine.levels(rx)
        marks = [{"start": w[1], "end": w[2]} for w in base_words]
        bf = engine.levels(base)
        plan = engine.plan_join(marks, bf, len(base) / R, a, b, r_words, rf, len(rx) / R, 0, len(r_words))
        if plan["rough"]:
            problems.append("a clean reread was called rough: " + ", ".join(plan["rough"]))
            continue
        scale = rng.choice((0.5, 0.8, 1.0, 1.5))
        rx2 = array.array("f", (v * scale for v in rx))
        new, new_words, gain = engine.join(base, base_words, rx2, r_words, plan)
        before = base_words
        if [w[0] for w in new_words] != TEXT:
            problems.append(f"after a reread of {a}-{b} the word list isn't the story")
            continue
        if [w[1] for w in new_words] != sorted(w[1] for w in new_words):
            problems.append("word times out of order after a reread")
        unchanged = int((plan["seam_in"] - 0.05) * R)
        if plan["seam_in"] > 0.1 and new[:unchanged] != base[:unchanged]:
            problems.append("audio before a join changed")
        tail_n = len(base) - int((plan["seam_out"] + 0.05) * R)
        if tail_n > 0 and new[-tail_n:] != base[-tail_n:]:
            problems.append("audio after a join changed")
        g = 10 ** (gain / 20) * scale
        expected = [min(1.0, amp(k) * g) if a <= k < b else v for k, v in enumerate(expected)]
        for k, w in enumerate(new_words):
            if abs((which_word(new, w) or 0) - expected[k]) > max(0.02, expected[k] * 0.1):
                problems.append(f"word {k} moved off its sound after a reread of {a}-{b}")
                break
        base, base_words = new, new_words
    said = [["Kite", 0.0, 0.1], ["by", 0.12, 0.2], ["Me", 0.22, 0.3]] + [[w[0], w[1] + 1.0, w[2] + 1.0] for w in base_words]      # the title, ahead of the story
    timing, ok, reasons = engine.compare(said, {"lead": ["Kite", "by", "Me"], "paras": [len(TEXT)], "text": TEXT, "title": "Kite", "authors": ["Me"], "text_sha256": ""}, UID)
    if not ok:
        problems.append("the shared check held the result: " + "; ".join(reasons)[:80])
    return problems


def main():
    runs = int(sys.argv[1]) if len(sys.argv) > 1 else 200
    rng = random.Random(int(sys.argv[2]) if len(sys.argv) > 2 else 20261104)
    t0 = time.time()
    tally, examples, bad_runs = {}, {}, 0
    for n in range(runs):
        p = run_once(rng)
        bad_runs += bool(p)
        for x in p:
            kind = "".join(c for c in x if not c.isdigit())
            tally[kind] = tally.get(kind, 0) + 1
            examples.setdefault(kind, (n, x))
    print(json.dumps({"runs": runs, "runs_with_a_problem": bad_runs, "seconds": round(time.time() - t0), "problems": tally, "examples": examples}, ensure_ascii=False, indent=1))
    return 1 if bad_runs else 0


if __name__ == "__main__":
    sys.exit(main())
