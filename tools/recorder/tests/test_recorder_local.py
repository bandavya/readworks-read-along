"""The volunteer recorder without a GPU or a microphone (tools/recorder). Needs ffmpeg for the sound steps."""
import array
import json
import math
import os
import shutil
import sys
import tempfile
import uuid

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from kinds import behavior, finish, guard  # noqa: E402
import engine  # noqa: E402
import to_reader  # noqa: E402

def fresh_temp(prefix):
    path = os.path.join(tempfile.gettempdir(), prefix + uuid.uuid4().hex)
    os.mkdir(path)
    return path

R = engine.RATE
DOC = {"uuid": "11111111-1111-1111-1111-111111111111", "title": "The Red Kite", "a": ["Sam Lee"], "lang": "EN",
       "text": "Mia has a red kite. The wind lifts it high.\nMr. Lee runs past a tree, and the kite dips low. Up it goes again!"}
SCRIPT = engine.script_for(DOC)
ALL = SCRIPT["lead"] + SCRIPT["text"]


def spoken_from(words, t=0.5, step=0.35, pause_after=()):
    out = []
    for w in words:
        out.append([w, round(t, 3), round(t + step - 0.05, 3)])
        t += step + (0.5 if w in pause_after else 0)
    return out


def tone_for(spoken, total, level=0.3):
    """Fake speech: a tone wherever a word is, near-silence between, so the seam finder has something real to look at."""
    x = array.array("f", (1e-4 * math.sin(i * 0.9) for i in range(int(total * R))))
    for _, s, e in spoken:
        for i in range(int(s * R), min(len(x), int(e * R))):
            x[i] = level * math.sin(i * 0.05)
    return x


PAUSES = {"Lee", "kite.", "high.", "tree,", "low."}
GOOD = spoken_from(ALL, pause_after=PAUSES)


def marks_for(spoken, accepted=()):
    timing, ok, reasons = engine.compare(spoken, SCRIPT, DOC["uuid"])
    return timing, ok, reasons, engine.word_marks(timing, SCRIPT, accepted)


# --- sentences: guards that hold under any design
starts = engine.sentence_starts(SCRIPT)
guard("sentence: a title-case abbreviation does not end a sentence", SCRIPT["text"].index("Mr.") in starts and SCRIPT["text"].index("Lee") not in starts, str(starts))
guard("sentence: a paragraph start is a sentence start", SCRIPT["paras"][0] in starts, str(starts))

# --- word marks and the shared gate
timing, ok, reasons, marks = marks_for(GOOD)
guard("gate: an exact reading passes the shared check", ok, str(reasons))
guard("marks: an exact reading has no open spots", marks["open"] == 0 and all(w["state"] == "right" for w in marks["words"]))

bad = [list(w) for w in GOOD]
i_kite = len(SCRIPT["lead"]) + SCRIPT["text"].index("kite.")
bad[i_kite][0] = "boat"
timing, ok, reasons, marks = marks_for(bad)
guard("gate: a swapped word is held", not ok)
guard("marks: the swapped word is marked wrong, with what was heard", marks["words"][SCRIPT["text"].index("kite.")]["state"] == "wrong" and marks["words"][SCRIPT["text"].index("kite.")]["heard"] == "boat")
key = marks["flags"][0]["key"]
guard("decision: without a person's decision a swap stays held", engine.decide(timing, ok, reasons, [])["publish"] is False)
d = engine.decide(timing, ok, reasons, [key])
behavior("decision: a reviewer can release a held spot, and the record names the word", d["publish"] and d["person_accepted"][0]["written"] == "kite." and "held" in d["gate"])
guard("decision: the gate's own verdict is not rewritten as a pass", d["gate"] != "passed" and d["reasons"] == reasons)

gone = [w for k, w in enumerate(GOOD) if not (len(SCRIPT["lead"]) + SCRIPT["text"].index("Up") <= k)]
timing, ok, reasons, marks = marks_for(gone)
guard("gate: a dropped sentence is held", not ok)
guard("marks: dropped words are marked missed", marks["words"][SCRIPT["text"].index("again!")]["state"] == "missed")

extra = GOOD[:8] + [["um", 2.0, 2.1]] + GOOD[8:]
timing, ok, reasons, marks = marks_for(extra)
guard("gate: an extra spoken word is held", not ok)
guard("marks: the extra word is reported", any(f["kind"] == "extra" and "um" in f["heard"] for f in marks["flags"]))

other = spoken_from("one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty twentyone twentytwo".split())
timing, ok, reasons, marks = marks_for(other)
d = engine.decide(timing, ok, reasons, [f["key"] for f in marks["flags"]])
guard("decision: marking everything fine cannot publish a different passage", d["publish"] is False, str(d))
empty = engine.compare([], SCRIPT, DOC["uuid"])
guard("decision: nothing heard cannot publish", engine.decide(empty[0], empty[1], empty[2], [])["publish"] is False)

# --- title line
title_kept = GOOD[:3] + GOOD[len(SCRIPT["lead"]):]
timing, ok, reasons, marks = marks_for(title_kept)
guard("lead: a reader who skips the byline is not marked wrong for it", marks["lead_kept"] == "title only" and marks["open"] == 0)
no_lead = GOOD[len(SCRIPT["lead"]):]
timing, _, _, marks = marks_for(no_lead)
x = tone_for(no_lead, no_lead[-1][2] + 0.6)
guard("lead: a title never read keeps its place on the page", marks["lead_kept"] == "none" and marks["lead"][0]["i"] == -len(SCRIPT["lead"]))
guard("checks: a missing title is noticed", any(c["key"] == "title" and not c["good"] for c in engine.checks_for(x, marks, SCRIPT)[0]))

# --- choosing what to reread
timing, _, _, marks = marks_for(GOOD)
total = GOOD[-1][2] + 0.6
x = tone_for(GOOD, total)
frames = engine.levels(x)
i = SCRIPT["text"].index("kite.")
a, b, used = engine.choose_span(i, i + 1, SCRIPT, marks, frames, total)
guard("span: the reread covers the wrong word", a <= i < b)
guard("span: it starts where a sentence starts", a in engine.sentence_starts(SCRIPT), str((a, b)))
guard("span: redoing the first sentence never touches the title", a == 0 and engine.to_row(0, marks) == len(SCRIPT["lead"]), str((a, engine.to_row(0, marks))))
a2, b2, _ = engine.choose_span(-len(SCRIPT["lead"]), -len(SCRIPT["lead"]) + 1, SCRIPT, marks, frames, total)
guard("span: a slip in the title rereads the title line", a2 == -len(SCRIPT["lead"]) and b2 == 0 and engine.span_words(SCRIPT, a2, b2) == SCRIPT["lead"], str((a2, b2)))

pa, pb, pused = engine.choose_span(i, i + 1, SCRIPT, marks, frames, total, "paragraph")
guard("span: asking for the paragraph gives the whole paragraph", (pa, pb, pused) == (0, SCRIPT["paras"][0], "paragraph"), str((pa, pb, pused)))
behavior("span: the default is one sentence", used == "sentence" and (a, b) == (0, 5), str((a, b, used)))
reach = SCRIPT["text"].index("The")
wa, wb, wused = engine.choose_span(reach - 1, reach + 1, SCRIPT, marks, frames, total)
guard("span: a mistake across two sentences isn't read as one", wused == "paragraph" and wa <= reach - 1 and wb >= reach + 1, str((wa, wb, wused)))
nopause = tone_for(GOOD, total)
for k in range(int(GOOD[len(SCRIPT["lead"]) + 4][2] * R), int(GOOD[len(SCRIPT["lead"]) + 5][1] * R)):
    nopause[k] = 0.3 * math.sin(k * 0.05)
na, nb, nused = engine.choose_span(i, i + 1, SCRIPT, marks, engine.levels(nopause), total)
guard("span: a sentence with no pause at its edge becomes the paragraph", nused == "paragraph", str((na, nb, nused)))

# --- a reader goes back and starts again: the transcript shows it
FULL = SCRIPT["lead"] + SCRIPT["text"]
def restart_case(words):
    x_ = tone_for(words, words[-1][2] + 0.6)
    return x_, engine.find_restarts(words, FULL, engine.levels(x_))
lead_n = len(SCRIPT["lead"])
said = FULL[:lead_n + 5] + ["The", "wind", "lifts", "up", "high."]        # first try of the sentence, wrong at the end
second = FULL[lead_n + 5:]
tried = spoken_from(said, pause_after=PAUSES | {"up"})
tried[-1][2] += 0
again = spoken_from(second, t=tried[-1][2] + 1.5, pause_after=PAUSES)
take_words = tried + again
x_, cuts = restart_case(take_words)
guard("restart: starting a sentence again is found", len(cuts) == 1 and cuts[0]["removed"].startswith("The wind lifts up"), str(cuts))
out_, new_words, placed = engine.apply_cuts(x_, take_words, cuts)
guard("restart: the kept reading has every written word, and passes the shared check", engine.compare(new_words, SCRIPT, DOC["uuid"])[1], str(engine.compare(new_words, SCRIPT, DOC["uuid"])[2]))
guard("restart: the audio gets shorter by the cut, exactly", abs((len(x_) - len(out_)) / R - (cuts[0]["cut_to"] - cuts[0]["cut_from"] + engine.JOIN_FADE_S)) < 0.002)
before_cut = int((cuts[0]["cut_from"] - 0.05) * R)
guard("restart: audio before the cut is untouched", out_[:before_cut] == x_[:before_cut])
guard("restart: word times still follow the sound", all(max(engine.levels(out_[int(w[1] * R):int(w[2] * R)]) or [-120]) > -30 for w in new_words if w[2] - w[1] > 0.1))
guard("restart: the cut remembers where it landed", abs(placed[0]["new_at"] - cuts[0]["cut_from"]) < 0.001)
d_ = spoken_from(FULL, pause_after=PAUSES)
guard("restart: an exact reading has none", restart_case(d_)[1] == [])
worse = tried[:lead_n + 5] + spoken_from(FULL[lead_n + 5:lead_n + 8] + ["zebra", "high."], t=tried[lead_n + 4][2] + 0.8) + spoken_from(["The", "wind", "lifts", "zebra", "quilt."], t=9.0, pause_after={"quilt."})
guard("restart: a second try that is worse is not chosen over the first", all("lifts it high" not in c["removed"] for c in restart_case(tried[:lead_n + 5] + spoken_from(FULL[lead_n + 5:lead_n + 10], t=tried[lead_n + 4][2] + 0.8, pause_after={"high."}) + spoken_from(["The", "wind", "lifts", "zebra", "quilt."], t=9.0, pause_after={"quilt."}) + spoken_from(FULL[lead_n + 10:], t=12.0, pause_after=PAUSES))[1]))
three = tried + spoken_from(["The", "wind", "lifts", "up"], t=tried[-1][2] + 1.5, pause_after={"up"}) + spoken_from(second, t=tried[-1][2] + 5.0, pause_after=PAUSES)
tx3, c3 = restart_case(three)
guard("restart: three tries keeps the last", engine.compare(engine.apply_cuts(tx3, three, c3)[1], SCRIPT, DOC["uuid"])[1], str(c3))
mid_phrase = FULL[:lead_n + 7] + ["lifts", "it", "up"] + FULL[lead_n + 6:]
mw = spoken_from(mid_phrase, pause_after=PAUSES | {"up"})
guard("restart: going back to mid-sentence isn't cut by itself", restart_case(mw)[1] == [], str(restart_case(mw)[1]))
REFRAIN = {"uuid": DOC["uuid"], "title": "Song", "a": [], "lang": "EN", "text": "Row row row your boat. The river is wide. Row row row your boat. We go home now."}
rs = engine.script_for(REFRAIN)
rw = spoken_from(rs["lead"] + rs["text"], pause_after={"boat.", "wide."})
rx = tone_for(rw, rw[-1][2] + 0.6)
guard("restart: a line the story really repeats is never cut", engine.find_restarts(rw, rs["lead"] + rs["text"], engine.levels(rx)) == [])
stutter = spoken_from(FULL[:lead_n + 2] + FULL[lead_n:], pause_after=PAUSES)
sx = tone_for(stutter, stutter[-1][2] + 0.6)
guard("restart: with no real pause, a repeated opening stays for a person", engine.find_restarts(stutter, FULL, engine.levels(sx)) == [])
two_word = FULL[:lead_n + 5] + FULL[lead_n + 5:lead_n + 7] + FULL[lead_n + 5:]
tw = spoken_from(two_word, pause_after=PAUSES | {FULL[lead_n + 6]})
tw_x, tw_c = restart_case(tw)
guard("restart: two words at a sentence start with a real pause is a false start", len(tw_c) == 1 and tw_c[0]["removed"] == " ".join(FULL[lead_n + 5:lead_n + 7]), str(tw_c))
tight = tried + spoken_from(second, t=tried[-1][2] + 0.0, pause_after=PAUSES)
tx = array.array("f", (0.3 * math.sin(k * 0.05) for k in range(int((tight[-1][2] + 0.2) * R))))
guard("restart: with no real pause to cut at, nothing is cut", engine.find_restarts(tight, FULL, engine.levels(tx)) == [])

# --- two listens: what a reader sees, and what the gate still sees
one_bad = [list(w) for w in GOOD]
one_bad[i_kite][0] = "boat"
tA = engine.compare(one_bad, SCRIPT, DOC["uuid"])
tB = engine.compare(GOOD, SCRIPT, DOC["uuid"])
guard("listens: a spot only one listen doubts is left off the reader's page", engine.word_marks(tA[0], SCRIPT, (), tB[0])["open"] == 0)
guard("listens: a spot both doubt is shown", engine.word_marks(tA[0], SCRIPT, (), tA[0])["open"] == 1)
guard("listens: the reviewer still sees every spot, and which is which", [f["both"] for f in engine.word_marks(tA[0], SCRIPT, (), tB[0], show_all=True)["flags"]] == [False])
guard("listens: the shared gate is not changed by it", tA[1] is False and engine.decide(tA[0], tA[1], tA[2], [])["publish"] is False)
guard("listens: with no second opinion nothing is hidden", engine.word_marks(tA[0], SCRIPT)["open"] == 1)
other_word = [list(w) for w in GOOD]
other_word[i_kite + 1][0] = "zebra"
guard("listens: doubts one word apart count as the same spot", engine.word_marks(tA[0], SCRIPT, (), engine.compare(other_word, SCRIPT, DOC["uuid"])[0])["open"] == 1)

secondary = engine.word_marks(tB[0], SCRIPT, (), tA[0], show_all=True)
guard("listens: a slip only the second listen heard still reaches the reviewer", [f.get("second_only") for f in secondary["flags"]] == [True] and secondary["flags"][0]["heard"] == "boat")
guard("listens: it doesn't release or block anything by itself", engine.every_flag(tB[0]) == [] and engine.word_marks(tB[0], SCRIPT, (), tA[0])["open"] == 0)

# --- words the recognizer invents from the name hints
NAMED = {"uuid": DOC["uuid"], "title": "The Ants", "a": [], "lang": "EN", "text": "Then the Ants and the Grasshopper met. The Ants left."}
ns = engine.script_for(NAMED)
heard_ = spoken_from(ns["lead"] + ns["text"])
tail = heard_[-1][2]
echo = heard_ + [["Ants", tail - 0.02, tail], ["Grasshopper", tail, tail + 0.1]]
guard("hints: invented names after the last word are dropped", [w[0] for w in engine.drop_echoed_hints(echo, ns)] == [w[0] for w in heard_])
real_ = heard_[:4] + [["ants", heard_[3][2], heard_[3][2] + 0.2]] + heard_[4:]
guard("hints: a word really said in other spelling stays", len(engine.drop_echoed_hints(real_, ns)) == len(real_))
guard("hints: the written names stay", [w[0] for w in engine.drop_echoed_hints(heard_, ns)] == [w[0] for w in heard_])

# --- a stray word after the end of a reread must not stop it fitting in
r_extra = spoken_from(SCRIPT["text"][5:10], t=0.7)
r_x = tone_for(r_extra, r_extra[-1][2] + 0.7, level=0.15)
overlap = r_extra + [["Stray", r_extra[-1][2] - 0.15, r_extra[-1][2] - 0.1]]
plan_o = engine.plan_join(engine.row_words(marks), frames, total, engine.to_row(5, marks), engine.to_row(10, marks), overlap, engine.levels(r_x), len(r_x) / R, 0, 5)
guard("join: a word overlapping the last one doesn't hide the pause after it", not plan_o["rough"], str(plan_o))

# --- finding the words in a reread, and joining
reread = spoken_from(["so", "um"] + SCRIPT["text"][:5] + ["The", "wind"], t=0.7)
found = engine.find_in_reread(reread, SCRIPT["text"][:5])
guard("reread: starting early or running on still finds the right words", found == (2, 7), str(found))
guard("reread: different words are not found", engine.find_in_reread(spoken_from(["zebra", "quilt"]), SCRIPT["text"][:5]) is None)
guard("reread: one shared common word is not a reread", engine.find_in_reread([["the", 0, 0.2]], "the bright kite flew away".split()) is None)
longer = "she told friends about the storm thanks to mia the neighbors were ready they were able to close their windows".split()
guard("reread: stopping short of the part is noticed", engine.reread_left_out(spoken_from(longer[6:]), longer)[0] == 6 and engine.reread_left_out(spoken_from(longer[:10]), longer)[1] == len(longer) - 10)
guard("reread: the whole part, with extra around it, leaves nothing out", engine.reread_left_out(spoken_from(["so"] + longer + ["and"]), longer) == (0, 0))
five = "the wind lifts it high".split()
guard("reread: stopping two words short is noticed, not forgiven", engine.reread_left_out(spoken_from(five[:3]), five)[1] == 2)
guard("reread: two misheard last words are forgiven", engine.reread_left_out(spoken_from(five[:3] + ["zebra", "quilt"]), five) == (0, 0))
guard("reread: one misheard first word is forgiven", engine.reread_left_out(spoken_from(["he"] + longer[1:]), longer)[0] <= engine.MAX_REREAD_LEFT_OUT)
guard("reread: a reading with one slip still counts", engine.find_in_reread(spoken_from("the bright kite flew off".split()), "the bright kite flew away".split()) == (0, 5))

r_words = spoken_from(SCRIPT["text"][5:10], t=0.7)          # a sentence reread: "The wind lifts it high."
r_x = tone_for(r_words, r_words[-1][2] + 0.7, level=0.15)
row_a, row_b = engine.to_row(5, marks), engine.to_row(10, marks)
plan = engine.plan_join(engine.row_words(marks), frames, total, row_a, row_b, r_words, engine.levels(r_x), len(r_x) / R, 0, 5)
new, new_words, gain = engine.join(x, GOOD, r_x, r_words, plan)
fades = 2 * int(engine.JOIN_FADE_S * R)                     # each crossfade overlaps its two sides
expect = len(x) - int(plan["seam_out"] * R) + int(plan["seam_in"] * R) + int(plan["r_out"] * R) - int(plan["r_in"] * R) - fades
guard("join: the length is exactly old minus replaced plus new", abs(len(new) - expect) <= 1, f"{len(new)} vs {expect}")
guard("join: both seams land in real pauses", not plan["rough"] and engine.levels(x[int(plan["seam_in"] * R):int(plan["seam_in"] * R) + 480])[0] < engine.quiet_line(frames), str(plan))
guard("join: audio before the first seam is untouched", new[:int(plan["seam_in"] * R) - 2000] == x[:int(plan["seam_in"] * R) - 2000])
tail_old = x[int(plan["seam_out"] * R) + 2000:]
guard("join: audio after the last seam is untouched", new[-len(tail_old):] == tail_old)
guard("join: the original's words before and after the reread are kept in order", [w[0] for w in new_words] == ALL, str([w[0] for w in new_words]))
starts_new = [w[1] for w in new_words]
guard("join: word times stay in order", starts_new == sorted(starts_new))
timing2, ok2, reasons2 = engine.compare(new_words, SCRIPT, DOC["uuid"])
guard("join: the joined reading still passes the shared check", ok2, str(reasons2))
behavior("join: a quieter reread is brought up to the level around it", gain > 3, str(gain))

# --- sound checks
guard("clip: a clean tone is not called clipped", not engine.clip_times(array.array("f", (0.5 * math.sin(i * 0.05) for i in range(R)))))
hard = array.array("f", (max(-1.0, min(1.0, 5 * math.sin(i * 0.05))) for i in range(R)))
guard("clip: a hard-clipped tone is caught", len(engine.clip_times(hard)) > 10)
checks, nums = engine.checks_for(x, marks, SCRIPT)
behavior("checks: a clean fake reading raises nothing", all(c["good"] for c in checks), str([c["key"] for c in checks if not c["good"]]))
checks = engine.checks_for(array.array("f", (v * 0.001 for v in x)), marks, SCRIPT)[0]
guard("checks: a very quiet reading is noticed", any(c["key"] == "quiet" and not c["good"] for c in checks))
hot = array.array("f", (max(-1.0, min(1.0, v * 8)) for v in x))
guard("checks: a clipped reading is noticed and points at the sentences", any(c["key"] == "clipped" and not c["good"] and c["where"] for c in engine.checks_for(hot, marks, SCRIPT)[0]))
noisy = array.array("f", (v + 0.03 * math.sin(i * 1.7) for i, v in enumerate(x)))
guard("checks: a noisy room is noticed", any(c["key"] == "noisy" and not c["good"] for c in engine.checks_for(noisy, marks, SCRIPT)[0]))
words_text = json.dumps(engine.checks_for(hot, marks, SCRIPT)[0]).lower()
guard("checks: no audio jargon reaches the person", not any(t in words_text for t in ("lufs", "dbfs", "transcript", "alignment", "clipping", "snr")))

# --- tidying
para_y = spoken_from(["Mia", "has"], t=1.0) + [["a", 6.0, 6.3], ["kite", 6.4, 6.7]]
yy = tone_for(para_y, 8.0)
long_a = len(engine.tidy(yy, para_y, [])[0]) / R
long_b = len(engine.tidy(yy, para_y, [6.0])[0]) / R
behavior("tidy: a long silence leaves a longer rest at a paragraph break", long_b - long_a > 0.2, f"{long_a} {long_b}")
pausy = spoken_from(["Mia", "has"], t=2.0) + [["a", 7.0, 7.3], ["kite", 7.4, 7.7]]
y = tone_for(pausy, 10.0)
t_out, notes = engine.tidy(y, pausy)
guard("tidy: quiet at both ends goes", notes["trimmed_start_s"] > 1 and notes["trimmed_end_s"] > 1, str(notes))
guard("tidy: a very long silence is shortened, not removed", notes["shortened_pauses"] and len(t_out) / R < 8 and sum(1 for v in engine.levels(t_out) if v < -40) * engine.FRAME_S > 0.5, str(notes))
guard("tidy: every word's sound survives", engine.speech_level(engine.levels(t_out)) > -15 and sum(1 for v in engine.levels(t_out) if v > -20) * engine.FRAME_S >= 0.25 * 4 - 0.1)
same, n2 = engine.tidy(y, [])
guard("tidy: with nothing heard it changes nothing", same == y and not n2["shortened_pauses"])

# --- a flagged stretch keeps its highlight between its neighbours
crowded = [list(w) for w in GOOD]
row0 = len(SCRIPT["lead"]) + SCRIPT["text"].index("The")
stretch = crowded[row0:row0 + 5]
crowded[row0:row0 + 5] = [["mumble", stretch[0][1], stretch[0][1] + 0.1]]
timing5, _, _ = engine.compare(crowded, SCRIPT, DOC["uuid"])
rows5, moved = engine.even_out_flagged(timing5)
flat = rows5[row0:row0 + 5]
guard("spread: a flagged stretch stays between the words on either side", moved >= 2 and flat[0][0] >= rows5[row0 - 1][1] - 0.001 and flat[-1][1] <= rows5[row0 + 5][0] + 0.001, str(flat))
guard("spread: its words run forward and are not crowded into one moment", all(b[0] >= a[1] - 0.001 and b[1] > b[0] for a, b in zip(flat, flat[1:])) and flat[-1][1] - flat[0][0] > 1.0, str(flat))
guard("spread: nothing else moves", rows5[:row0] == [list(r) for r in timing5["t"][:row0]] and rows5[row0 + 5:] == [list(r) for r in timing5["t"][row0 + 5:]])

# --- findings from the independent check, 2026-11-03
guard("decision: an OK on an old reading does not survive a reread of those words", engine.drop_decisions(["swap|4|five", "extra|9|um", "swap|-2|ride"], 3, 6) == ["extra|9|um", "swap|-2|ride"])
long_word = array.array("f", [0.0]) * (3 * R)
long_word[int(0.5 * R):int(2 * R)] = array.array("f", [0.3]) * int(1.5 * R)
kept, n3 = engine.tidy(long_word, [["word", 0.5, 1.0]])
guard("tidy: a word the recognizer ended too early is not cut", sum(1 for v in kept if v > 0.2) >= int(1.4 * R), str(n3))
late = array.array("f", [0.0]) * (5 * R)
late[int(0.5 * R):int(1 * R)] = array.array("f", [0.3]) * int(0.5 * R)
late[int(2.5 * R):int(3 * R)] = array.array("f", [0.3]) * int(0.5 * R)
kept, n4 = engine.tidy(late, [["word", 0.5, 1.0]])
guard("tidy: a last word the recognizer missed is kept", sum(1 for v in kept if v > 0.2) >= int(0.9 * R), str(n4))
click = array.array("f", [0.0]) * (5 * R)
click[int(0.5 * R):int(2 * R)] = array.array("f", [0.3]) * int(1.5 * R)
click[int(2.3 * R):int(2.33 * R)] = array.array("f", [0.9]) * int(0.03 * R)
kept, n5 = engine.tidy(click, [["word", 0.5, 2.0]])
guard("tidy: the click of the Stop button goes", max(kept) < 0.5, str(n5))
few = {"title": "T", "a": [], "text": "one two three"}
few_script = engine.script_for(few)
few_t, few_ok, _ = engine.compare([["T", 0.0, 0.05], ["by", 0.06, 0.08], ["ReadWorks", 0.08, 0.09], ["one", 0.1, 2], ["two", 1, 1.2], ["three", 1.3, 1.5]], few_script, "x")
_, few_body = engine.reader_rows(few_t, few_script)
guard("reader: overlapping words stay where they were said, not pushed past the file", few_body[-1][1] <= 2.0 and few_body[1][0] == 1 and few_body[2][0] == 1.3, str(few_body))
guard("reader: those rows are still valid for the reader", engine.rows_valid(few_body, 3, False, 2.0), str(few_body))
guard("reader: rows past the end of the file are refused", not engine.rows_valid([[0.1, 0.2, 0], [9.0, 9.1, 0]], 2, False, 2.0))

# --- what the reader gets, and taking it back
timing, ok, reasons, marks = marks_for(GOOD)
lead, body = engine.reader_rows(timing, SCRIPT)


def valid(rows, count, allow_null):
    """The rule in prototype/app/src/compare.js validTiming."""
    if len(rows) != count:
        return False
    prev = 0
    for r in rows:
        if r is None and allow_null:
            continue
        if r is None or r[1] <= r[0] or r[0] < prev:
            return False
        prev = r[1]
    return True


guard("reader: story rows are valid for the reader", valid(body, len(SCRIPT["text"]), False))
guard("reader: lead rows are valid and stop before the story", valid(lead, len(SCRIPT["lead"]), True) and lead[-1][1] <= body[0][0])
timing3, _, _, _ = marks_for(gone)
lead3, body3 = engine.reader_rows(timing3, SCRIPT)
guard("reader: rows stay valid when words were never heard", valid(body3, len(SCRIPT["text"]), False) and valid(lead3, len(SCRIPT["lead"]), True))
timing4, _, _, _ = marks_for(no_lead)
lead4, body4 = engine.reader_rows(timing4, SCRIPT)
guard("reader: a title never read becomes empty rows, not invented times", all(r is None for r in lead4) and valid(body4, len(SCRIPT["text"]), False))

tmp = fresh_temp(prefix="recorder_guard_")
try:
    site = os.path.join(tmp, "site")
    os.makedirs(os.path.join(site, "data"))
    os.makedirs(os.path.join(site, "audio"))
    uid = DOC["uuid"]
    earlier = {"id": "human", "label": "Human voice (ReadWorks recording)", "audio": f"audio/{uid}-human.mp3", "lead": [], "t": []}
    generated = {"id": "generated", "label": "Generated", "audio": f"audio/{uid}-generated.mp3", "lead": [], "t": []}
    with open(os.path.join(site, "data", uid + ".json"), "w", encoding="utf-8") as f:
        json.dump({"uuid": uid, "voices": [generated, earlier]}, f)
    with open(os.path.join(site, "data", "index.json"), "w", encoding="utf-8") as f:
        json.dump([{"uuid": uid, "voices": ["generated", "human"]}, {"uuid": "other", "voices": ["generated"]}], f)
    with open(os.path.join(site, "audio", f"{uid}-human.mp3"), "wb") as f:
        f.write(b"their recording")
    src = os.path.join(tmp, "a.mp3")
    with open(src, "wb") as f:
        f.write(b"new")
    root = os.path.join(tmp, "published")
    rel = to_reader.publish(site, uid, src, "abc", {"id": "human", "label": "Human voice (volunteer recording)", "lead": lead, "t": body, "review": "needs human check"}, {"uuid": uid}, root)
    doc = json.load(open(os.path.join(site, "data", uid + ".json"), encoding="utf-8"))
    guard("publish: the reading is voice id human, marked as needing a person's check", [v["id"] for v in doc["voices"]] == ["generated", "human"] and doc["voices"][1]["review"] == "needs human check" and doc["voices"][1]["audio"] == rel)
    guard("publish: the generated voice is untouched", doc["voices"][0] == generated)
    with open(os.path.join(site, "audio", f"{uid}-human.mp3"), "rb") as f:
        guard("publish: an earlier recording's audio file is not overwritten", f.read() == b"their recording" and rel != f"audio/{uid}-human.mp3")
    rec = json.load(open(os.path.join(root, uid + ".json"), encoding="utf-8"))
    guard("publish: the record keeps what it replaced", rec["replaced_voice"] == earlier)
    guard("publish: no identity is invented", "narrator" not in rec["voice"])
    named = {"id": "human", "label": "theirs", "audio": "audio/x-readworks-volunteer.mp3", "lead": [], "t": []}
    site2 = os.path.join(tmp, "site2")
    os.makedirs(os.path.join(site2, "data"))
    os.makedirs(os.path.join(site2, "audio"))
    with open(os.path.join(site2, "data", uid + ".json"), "w", encoding="utf-8") as f:
        json.dump({"uuid": uid, "voices": [named]}, f)
    with open(os.path.join(site2, "data", "index.json"), "w", encoding="utf-8") as f:
        json.dump([{"uuid": uid, "voices": ["human"]}], f)
    root2 = os.path.join(tmp, "published2")
    to_reader.publish(site2, uid, src, "abc", {"id": "human", "label": "new", "lead": lead, "t": body}, {"uuid": uid}, root2)
    guard("publish: undo returns a voice even if its file name says volunteer", to_reader.undo(site2, uid, root2) == named)
    rel2 = to_reader.publish(site, uid, src, "def", {"id": "human", "label": "second", "lead": lead, "t": body}, {"uuid": uid}, root)
    rec = json.load(open(os.path.join(root, uid + ".json"), encoding="utf-8"))
    guard("publish: a second volunteer take still remembers the original", rec["replaced_voice"] == earlier and rel2 != rel)
    with open(os.path.join(site, "data", uid + ".json"), "w", encoding="utf-8") as f:
        json.dump({"uuid": uid, "voices": [generated]}, f)
    guard("publish: reapply restores a reading after the data was rebuilt", to_reader.reapply(site, root) == [uid] and any(v["id"] == "human" and v["label"] == "second" for v in json.load(open(os.path.join(site, "data", uid + ".json"), encoding="utf-8"))["voices"]))
    to_reader.undo(site, uid, root)
    doc = json.load(open(os.path.join(site, "data", uid + ".json"), encoding="utf-8"))
    guard("publish: undo puts back what was there", next(v for v in doc["voices"] if v["id"] == "human") == earlier)
    idx = json.load(open(os.path.join(site, "data", "index.json"), encoding="utf-8"))
    guard("publish: the library list only changes for this passage", idx[1]["voices"] == ["generated"] and "human" in idx[0]["voices"])

    # --- real sound through ffmpeg
    if shutil.which("ffmpeg"):
        import subprocess
        stereo = os.path.join(tmp, "stereo.wav")
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=300:duration=1", "-ac", "2", stereo], check=True)
        mono = os.path.join(tmp, "stereo.wav.mono")
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", stereo, "-af", "pan=mono|c0=c0", "-ar", str(R), "-f", "f32le", mono], check=True)
        engine.decode(stereo, stereo + ".f32")
        a_ = engine.speech_level(engine.levels(engine.read_raw(mono)))
        b_ = engine.speech_level(engine.levels(engine.read_raw(stereo + ".f32")))
        guard("decode: two identical channels do not get louder", abs(a_ - b_) < 0.2, f"{a_} vs {b_}")
finally:
    shutil.rmtree(tmp, ignore_errors=True)

def _refused(name):
    try:
        serve.folder(name)
        return False
    except serve.Unusable:
        return True


# --- when the GPU is busy or the checker is missing, say so plainly and keep trying; never pretend
import serve  # noqa: E402


class Done:
    def __init__(self, code, err=""):
        self.returncode, self.stderr = code, err


real_job, real_sleep, real_python = serve.speech_job, serve.time.sleep, serve.SPEECH_PYTHON
calls = []
out_dir = fresh_temp(prefix="recorder_guard_")
audio = os.path.join(out_dir, "x.wav")
serve.SPEECH_PYTHON = sys.executable
serve.time.sleep = lambda s: None
try:
    def busy_then_ok(job):
        calls.append(job)
        if len(calls) < 3:
            return 3, "CUDA out of memory"
        with open(job["out"], "w", encoding="utf-8") as f:
            json.dump({"words": []}, f)
        return 0, ""
    serve.speech_job = busy_then_ok
    sess = {"id": "guard", "uid": DOC["uuid"], "language": "en-US"}
    got = serve.hear(sess, "words", audio, SCRIPT)
    guard("busy: a busy GPU is retried, and the person is told", got == {"words": []} and len(calls) == 3 and serve.job_state["guard"]["busy"])
    calls.clear()
    serve.speech_job = busy_then_ok
    calls.extend([None, None])
    serve.hear(sess, "words", audio, SCRIPT, ["Lee"])
    guard("hearing: a short reread gets only its own names, and no second listen against the whole story", calls[-1]["passage"] is None and calls[-1]["names"] == "Lee")
    calls[:] = [c for c in calls if c]
    guard("hearing: the recognizer is given only names, never the story text", all(" ".join(SCRIPT["text"]) not in json.dumps(c) and "text" not in c for c in calls) and "names" in calls[0])
    serve.speech_job = lambda job: (3, "CUDA out of memory")
    try:
        serve.hear(sess, "words", audio, SCRIPT)
        guard("busy: if it stays busy the failure is out loud", False)
    except serve.Unusable as error:
        guard("busy: if it stays busy the failure is out loud", "saved" in str(error))
    serve.speech_job = lambda job: (1, "boom")
    try:
        serve.hear(sess, "words", audio, SCRIPT)
        guard("broken: a real failure is not retried as busy", False)
    except RuntimeError as error:
        guard("broken: a real failure is not retried as busy", "boom" in str(error))
    serve.SPEECH_PYTHON = os.path.join(out_dir, "nothing.exe")
    try:
        serve.hear(sess, "words", audio, SCRIPT)
        guard("missing: no checker on this computer is said plainly", False)
    except serve.Unusable as error:
        guard("missing: no checker on this computer is said plainly", "saved" in str(error))
finally:
    serve.speech_job, serve.time.sleep, serve.SPEECH_PYTHON = real_job, real_sleep, real_python
    shutil.rmtree(out_dir, ignore_errors=True)
guard("server: session names cannot leave the store", all(_refused(n) for n in ("../x", "a/b", "..", "8827e66c-20261103-14563")))
real_store, real_passage = serve.STORE, serve.passage
serve.STORE, serve.passage = fresh_temp(prefix="recorder_guard_"), lambda uid: DOC
try:
    ids = {serve.new_session(DOC["uuid"])["id"] for _ in range(20)}
    guard("server: new sessions never share a folder", len(ids) == 20)
finally:
    shutil.rmtree(serve.STORE, ignore_errors=True)
    serve.STORE, serve.passage = real_store, real_passage

# --- from the second real session
guard("numbers: a number split in two is put back", engine.join_number_parts([["more", 1, 2], ["1", 2, 2.2], [",200", 2.2, 3], ["miles", 3, 4]]) == [["more", 1, 2], ["1,200", 2, 3], ["miles", 3, 4]])
guard("numbers: words beginning with a comma elsewhere are left alone", engine.join_number_parts([["1", 0, 1], [",", 1, 1.1]]) == [["1", 0, 1], [",", 1, 1.1]])
UNITS = {"uuid": DOC["uuid"], "title": "T", "a": [], "lang": "EN", "text": "Winds reach 1,200 mph (2,000 kph). They stop."}
us = engine.script_for(UNITS)
read_out = spoken_from(us["lead"] + "Winds reach 1,200 miles per hour, 2,000 kilometers per hour. They stop.".split())
guard("units: mph and kph read aloud in full match the text", engine.compare(read_out, us, DOC["uuid"])[1], str(engine.compare(read_out, us, DOC["uuid"])[2]))
wrong_unit = spoken_from(us["lead"] + "Winds reach 1,200 feet per hour, 2,000 kilometers per hour. They stop.".split())
guard("units: a different unit is still caught", engine.compare(wrong_unit, us, DOC["uuid"])[1] is False)
doubled = spoken_from(FULL[:lead_n + 8] + FULL[lead_n + 7:lead_n + 8] + FULL[lead_n + 8:], pause_after=PAUSES)
td, _, _ = engine.compare(doubled, SCRIPT, DOC["uuid"])
guard("listens: a repeated word stays on the page even if the other listen tidied it away", engine.word_marks(td, SCRIPT, (), engine.compare(GOOD, SCRIPT, DOC["uuid"])[0])["open"] >= 1)
vis = engine.readable_starts([[1.0, 1.02, 0], [1.02, 1.3, 0], [1.3, 1.34, 0], [1.34, 1.36, 0], [1.36, 1.8, 0], [3.0, 3.2, 0]])
guard("highlight: words stay lit long enough to see, within a limit", all(b[0] - a[0] >= engine.MIN_VISIBLE_S - 0.001 for a, b in zip(vis[:2], vis[1:3])))
raw_vis = [[1.0, 1.02, 0], [1.02, 1.3, 0], [1.3, 1.34, 0], [1.34, 1.36, 0], [1.36, 1.8, 0], [3.0, 3.2, 0]]
guard("highlight: nothing moves more than the limit, or out of order, and a pause resets it", all(abs(a[0] - b[0]) <= engine.MAX_NUDGE_S + 0.001 for a, b in zip(vis, raw_vis)) and [v[0] for v in vis] == sorted(v[0] for v in vis) and vis[-1] == raw_vis[-1])
guard("highlight: rows stay valid for the reader", engine.rows_valid(vis, 6, False, 4.0))
bl = engine.breath_lines(SCRIPT)
guard("lines: every sentence and paragraph starts a line", set(engine.sentence_starts(SCRIPT)) <= set(bl))
guard("lines: they stay in order, and in the text", bl == sorted(set(bl)) and bl[0] == 0 and bl[-1] < len(SCRIPT["text"]))
longtext = engine.script_for({"title": "T", "a": [], "lang": "EN", "text": " ".join(["word"] * 40)})
ll = engine.breath_lines(longtext)
guard("lines: no line runs past the limit", all(b - a <= engine.LINE_MAX_WORDS for a, b in zip(ll, ll[1:])))
ends = engine.script_for({"title": "T", "a": [], "lang": "EN", "text": "One two three four five six seven eight nine ten eleven twelve thirteen to eat. Next one here now."})
el_ = engine.breath_lines(ends)
guard("lines: a sentence's last word or two aren't stranded on their own line", all(not (b - a < 2 and b in engine.sentence_starts(ends)) for a, b in zip(el_, el_[1:])), str(el_))

# --- the word-by-word audit
au = spoken_from(["one", "two", "three"], t=0.5)
ax = tone_for(au, 3.0)
af = engine.levels(ax)
rows_ok = [[w[1], w[2], 0] for w in au]
guard("audit: words starting on sound aren't flagged", engine.audit_word_starts(af, rows_ok, ["one", "two", "three"])["silent_starts"] == [])
late = [list(r) for r in rows_ok]
late[2] = [2.2, 2.4, 0]
guard("audit: a word timed in silence is flagged", [x["word"] for x in engine.audit_word_starts(af, late, ["one", "two", "three"])["silent_starts"]] == ["three"])
guard("audit: a word timed past the end of the file is flagged", [x["word"] for x in engine.audit_word_starts(af, [[0.5, 0.8, 0], [9.0, 9.1, 0]], ["one", "two"])["silent_starts"]] == ["two"])
guard("audit: the longest gap is named", engine.audit_word_starts(af, rows_ok, ["one", "two", "three"])["longest_gaps"][0]["seconds"] >= 0)

# --- cuts and rereads combined at random: full run in loops_2026-10-31/l9_human_recorder/stress_edits.py

import random  # noqa: E402
import stress_edits  # noqa: E402
rng_s = random.Random(7)
problems_s = [p_ for _ in range(4) for p_ in stress_edits.run_once(rng_s)]
guard("stress: random cuts and rereads keep the word list on its own sound, and leave other audio alone", problems_s == [], str(problems_s[:3]))

# --- the Amazon listener is a drop-in, off by default, and leaves nothing behind
import listen_amazon  # noqa: E402
guard("listener: the on-device listener is the default", serve.amazon is None)
base_a = fresh_temp(prefix="recorder_guard_")
real_aws = listen_amazon.aws
try:
    src = os.path.join(base_a, "take.wav")
    with open(src, "wb") as f:
        f.write(b"sound")
    calls_a = []
    TRANSCRIPT = {"results": {"items": [{"type": "pronunciation", "start_time": "0.5", "end_time": "0.9", "alternatives": [{"content": "Mia"}]},
                                        {"type": "punctuation", "alternatives": [{"content": "."}]}]}}

    def fake_aws(settings, *cmd):
        calls_a.append(cmd)
        if cmd[:2] == ("transcribe", "get-transcription-job"):
            return json.dumps({"TranscriptionJob": {"TranscriptionJobStatus": fake_aws.status, "FailureReason": "bad audio"}})
        if cmd[:2] == ("s3", "cp") and cmd[2].startswith("s3://"):
            with open(cmd[3], "w", encoding="utf-8") as f:
                json.dump(TRANSCRIPT, f)
        return "{}"
    fake_aws.status = "COMPLETED"
    listen_amazon.aws = fake_aws
    settings = listen_amazon.Settings("p", "r", "b")
    job_a = {"mode": "words", "path": src, "out": src + ".words.json", "lang": "en", "names": "Mia", "passage": "x"}
    guard("listener: Amazon gives the same word list shape", listen_amazon.speech_job(settings, job_a) == (0, "") and json.load(open(job_a["out"], encoding="utf-8"))["words"] == [["Mia", 0.5, 0.9]])
    verbs = [" ".join(c[:2]) for c in calls_a]
    guard("listener: Amazon removes its upload, output and job", verbs.count("s3 rm") == 2 and "transcribe delete-transcription-job" in verbs)
    guard("listener: Amazon needs no name hints or second listen to fit", "plain" not in json.load(open(job_a["out"], encoding="utf-8")))
    calls_a.clear()
    fake_aws.status = "FAILED"
    code, err = listen_amazon.speech_job(settings, job_a)
    verbs = [" ".join(c[:2]) for c in calls_a]
    guard("listener: a failed job is reported and still cleaned up", code == 1 and "bad audio" in err and verbs.count("s3 rm") == 2 and "transcribe delete-transcription-job" in verbs)
    t_a = engine.compare([["Mia", 0.5, 0.9]], SCRIPT, DOC["uuid"])
    guard("listener: with one listen, every spot is shown rather than hidden", engine.word_marks(t_a[0], SCRIPT)["open"] == len([f for f in t_a[0]["flags"] if not f.get("advisory")]))
finally:
    listen_amazon.aws = real_aws
    shutil.rmtree(base_a, ignore_errors=True)

# --- nothing reaches the reader without a named person's approval, to this exact file
if shutil.which("ffmpeg"):
    import subprocess
    real = (serve.STORE, serve.SITE, serve.passage)
    base = fresh_temp(prefix="recorder_guard_")
    try:
        serve.STORE, serve.SITE = os.path.join(base, "store", "sessions"), os.path.join(base, "site")
        serve.passage = lambda uid: DOC
        os.makedirs(os.path.join(serve.SITE, "data"))
        os.makedirs(os.path.join(serve.SITE, "audio"))
        uid = DOC["uuid"]
        doc_path, idx_path = os.path.join(serve.SITE, "data", uid + ".json"), os.path.join(serve.SITE, "data", "index.json")
        with open(doc_path, "w", encoding="utf-8") as f:
            json.dump({"uuid": uid, "voices": [{"id": "generated", "audio": "a"}]}, f)
        with open(idx_path, "w", encoding="utf-8") as f:
            json.dump([{"uuid": uid, "voices": ["generated"]}], f)

        def finished(spoken):
            s = serve.new_session(uid)
            s["language"] = "en-US"
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=300:duration=30", "-b:a", "64k", os.path.join(serve.folder(s["id"]), "after.mp3")], check=True)
            timing, ok, reasons = engine.compare(spoken, SCRIPT, uid)
            timing["duration"] = 30.0
            s["revs"]["1"] = {"spoken": spoken, "note": {}, "seconds": 30, "peaks": []}
            s["current"] = 1
            s["finish"] = {"rev": 1, "timing": timing, "gate_ok": ok, "gate_reasons": reasons, "tidy": {}, "cleaned": True, "refused": [], "warnings": [], "numbers": {}, "agreement": None}
            serve.save(s)
            return s

        def refused(fn, *args):
            try:
                fn(*args)
                return False
            except serve.Unusable:
                return True

        reader_voices = lambda: [v["id"] for v in json.load(open(doc_path, encoding="utf-8"))["voices"]]   # noqa: E731
        s = finished(GOOD)
        guard("hold: a clean reading can't be approved before it is sent", refused(serve.approve_session, s, "Pat", True, "", 30, s["submission"] and s["submission"]["sha"]))
        serve.submit_session(s, "", 12)
        guard("hold: sending a clean reading does not touch the reader", reader_voices() == ["generated"] and s["published"] is None)
        guard("hold: approval needs a person's name", refused(serve.approve_session, s, "  ", True, "", 30, s["submission"]["sha"]))
        guard("hold: approval needs the reviewer to say they listened", refused(serve.approve_session, s, "Pat", False, "", 30, s["submission"]["sha"]) and reader_voices() == ["generated"])
        with open(os.path.join(serve.folder(s["id"]), "after.mp3"), "ab") as f:
            f.write(b"changed")
        guard("hold: a file changed after sending can't be approved", refused(serve.approve_session, s, "Pat", True, "", 30, s["submission"] and s["submission"]["sha"]) and reader_voices() == ["generated"])
        s = finished(GOOD)
        serve.submit_session(s, "", 12)
        guard("hold: nobody's name is invented", s["submission"]["narrator"] is None)
        guard("hold: a reviewer whose page shows another version can't approve this one", refused(serve.approve_session, s, "Pat", True, "", 30, "not-this-file") and refused(serve.approve_session, s, "Pat", True, "", 30, None))
        serve.approve_session(s, "Pat", True, "sounds good", 30, s["submission"]["sha"])
        guard("hold: an approved reading can't then be sent back", refused(serve.send_back, s, "Pat", ""))
        guard("hold: approval puts it in the reader", "human" in reader_voices() and s["published"]["reviewer"] == "Pat")
        rec = json.load(open(os.path.join(base, "store", "published", uid + ".json"), encoding="utf-8"))
        guard("hold: the record names who approved and which file", rec["review"]["reviewer"] == "Pat" and rec["sha"] == serve.audio_sha(s) and rec["gate"] == "passed")
        guard("hold: a reading can't be approved twice", refused(serve.approve_session, s, "Pat", True, "", 30, s["submission"] and s["submission"]["sha"]))
        to_reader.undo(serve.SITE, uid, os.path.join(base, "store", "published"))
        s = finished(bad)
        s["accepted"] = [f["key"] for f in engine.word_marks(s["finish"]["timing"], SCRIPT)["flags"]]
        serve.submit_session(s, "", 0)
        guard("hold: a volunteer's own 'fine' puts nothing in the reader", reader_voices() == ["generated"] and s["published"] is None)
        serve.approve_session(s, "Pat", True, "", 30, s["submission"]["sha"])
        rec = json.load(open(os.path.join(base, "store", "published", uid + ".json"), encoding="utf-8"))
        guard("hold: a held reading a reviewer released says so", "human" in reader_voices() and "released by a reviewer" in rec["gate"] and rec["gate_reasons"] and rec["reviewer_released"])
        to_reader.undo(serve.SITE, uid, os.path.join(base, "store", "published"))
        s = finished(other)
        serve.submit_session(s, "", 0)
        guard("hold: even a reviewer can't approve a different passage", refused(serve.approve_session, s, "Pat", True, "", 30, s["submission"] and s["submission"]["sha"]) and reader_voices() == ["generated"])
        guard("hold: it is waiting in the review list until sent back", any(w["id"] == s["id"] for w in serve.waiting_for_review()))
        serve.send_back(s, "Pat", "wrong story")
        guard("hold: sent back leaves the review list and keeps the reason", not any(w["id"] == s["id"] for w in serve.waiting_for_review()) and s["review"]["note"] == "wrong story")
        s = finished(GOOD)
        s["finish"].update(before_url="b", after_url="a", stages=[], seconds=1, tidy={}, numbers={}, agreement=None)
        shown_v = serve.view(s)
        guard("view: a finished reading opens, and its before-and-after uses the rows the reader will", [w["start"] for w in shown_v["finish"]["marks"]["words"]] == [r[0] for r in engine.reader_rows(s["finish"]["timing"], SCRIPT)[1]])
        s = finished(GOOD)
        serve.report_text_issue(s, 3, "a red kite")
        issues = open(os.path.join(os.path.dirname(serve.STORE), "text_issues.jsonl"), encoding="utf-8").read()
        guard("text mistake: it is saved, for the reviewer and for ReadWorks", s["text_issues"][0]["should_say"] == "a red kite" and "a red kite" in issues and DOC["uuid"] in issues)
        guard("text mistake: reporting it changes neither the story nor the reader", reader_voices() == ["generated"] and engine.script_for(serve.passage(uid))["text"] == SCRIPT["text"])
        guard("text mistake: a reader's name isn't asked for or kept", "narrator" not in issues and "name" not in issues)
        s = finished(GOOD)
        d_ = serve.folder(s["id"])
        for name in ("take1.webm", "take1.webm.f32", "take1.webm.wav", "rev1.f32", "rev1.wav", "rev2.f32", "rev2.wav", "rev3.f32", "rev3.wav", "after.mp3"):
            open(os.path.join(d_, name), "ab").close()
        s["current"], s["candidate"] = 3, None
        s["revs"]["2"], s["revs"]["3"] = {"note": {}}, {"note": {"raw": 1}}
        serve.save(s)
        serve.forget_working_audio(s, "take1.webm")
        left = set(os.listdir(d_))
        guard("disk: the original take and finished file are never removed", {"take1.webm", "after.mp3"} <= left)
        guard("disk: the reading in use and the take its cuts came from stay", {"rev3.f32", "rev3.wav", "rev1.f32", "rev1.wav"} <= left)
        guard("disk: readings nobody can reach go", not {"rev2.f32", "rev2.wav", "take1.webm.f32", "take1.webm.wav"} & left)
        s = finished(GOOD)
        s["finish"], s["pending"] = None, {"kind": "take", "file": "take1.webm"}
        guard("restart: saved work with no running job offers to carry on", serve.view(s)["job"]["error"] and not serve.view(s)["job"]["step"])
    finally:
        serve.STORE, serve.SITE, serve.passage = real
        shutil.rmtree(base, ignore_errors=True)

finish()
