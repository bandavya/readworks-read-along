"""Word comparison ported from the prototype pipeline's common.py.

Transcribe supplies word evidence only. Polly speech marks remain the reader timing.
"""
import difflib
import re
import unicodedata
import names as namebook

def norm(s):
    return re.sub(r"[^\w']", "", s.replace("’", "'")).lower()


SAME = {"mr": "mister", "mrs": "missus", "ms": "miss", "dr": "doctor", "enquiries": "inquiries", "learnt": "learned",
        "stephens": "stevens", "sarah": "sara", "protestors": "protesters", "hiccupped": "hiccuped", "lil": "little",
        "childrens'": "children's", "childrens": "children's", "mama": "mamma", "pales": "pails", "what'd": "whatd",
        "hanna": "hannah", "readworks": "reedworks",
        # Interjections spelled two ways for the same sound (gatefix, 2026-11-01). Spelling only: no pair here changes a vowel
        # or a consonant sound. Both the written and the heard side go through tokens(), so one direction covers both.
        "hm": "hmm", "hmmm": "hmm", "pst": "psst", "ahh": "ah", "aah": "ah", "awww": "aww", "ew": "eww", "sh": "shh",
        "shhh": "shh"}
# Units a reader says in full. "1,200 mph" read "miles per hour" is the written text, read correctly.
READ_OUT = {"mph": ["miles", "per", "hour"], "kph": ["kilometers", "per", "hour"]}
# Only spelling variants of the same Spanish word. Accent marks are NOT compared (fold_es below): the recognizer does not
# reliably write them and a voice cannot say them, so 'Después' heard 'Despues' is not a disagreement. Letters that change
# the sound are kept: ñ (año/ano) and ü (pingüino/pinguino).
SAME_ES = {"setiembre": "septiembre", "obscuro": "oscuro"}
ONES_ES = "cero uno dos tres cuatro cinco seis siete ocho nueve diez once doce trece catorce quince dieciséis diecisiete dieciocho diecinueve".split()
TENS_ES = {20: "veinte", 30: "treinta", 40: "cuarenta", 50: "cincuenta", 60: "sesenta",
           70: "setenta", 80: "ochenta", 90: "noventa"}
HUNDREDS_ES = {200: "doscientos", 300: "trescientos", 400: "cuatrocientos", 500: "quinientos",
               600: "seiscientos", 700: "setecientos", 800: "ochocientos", 900: "novecientos"}
ONES = "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen".split()
TENS = "_ _ twenty thirty forty fifty sixty seventy eighty ninety".split()
ORD = {"1st": "first", "2nd": "second", "3rd": "third", "4th": "fourth", "5th": "fifth", "6th": "sixth", "7th": "seventh",
       "8th": "eighth", "9th": "ninth", "10th": "tenth"}
NO_BRITISH = {"our", "ours", "four", "your", "yours", "hour", "hours", "pour", "tour", "flour", "sour", "fourth"}


def say_number(n):
    """0-9999 as spoken words; 1100-1999 (not round hundreds) the way a year is said ('nineteen ninety'). None if too big."""
    if n < 20:
        return [ONES[n]]
    if n < 100:
        return [TENS[n // 10]] + ([ONES[n % 10]] if n % 10 else [])
    if n < 1000:
        return [ONES[n // 100], "hundred"] + (say_number(n % 100) if n % 100 else [])
    if n < 10000:
        if 1100 <= n <= 1999 and n % 100:
            return say_number(n // 100) + (["oh", ONES[n % 100]] if n % 100 < 10 else say_number(n % 100))
        return [ONES[n // 1000], "thousand"] + (say_number(n % 1000) if n % 1000 else [])
    return None


def say_number_es(n):
    """Spanish cardinal 0–9999 as comparable spoken tokens; no guessed treatment of years or ordinals."""
    if n < 20:
        return [ONES_ES[n]]
    if n < 30:
        return ["veinte"] if n == 20 else ["veinti" + ("dós" if n == 22 else "trés" if n == 23 else
                                                 "séis" if n == 26 else ONES_ES[n - 20])]
    if n < 100:
        return [TENS_ES[n // 10 * 10]] + (["y"] + say_number_es(n % 10) if n % 10 else [])
    if n < 1000:
        if n == 100:
            return ["cien"]
        return (["ciento"] if n < 200 else [HUNDREDS_ES[n // 100 * 100]]) + (say_number_es(n % 100) if n % 100 else [])
    if n < 10000:
        return (["mil"] if n < 2000 else say_number_es(n // 1000) + ["mil"]) + (say_number_es(n % 1000) if n % 1000 else [])
    return None


def fold_es(s):
    """Spanish for comparison only: accent marks off (á é í ó ú, also grave/circumflex), but ñ and ü kept, because those
    letters change the sound (año is not ano). Display text is never folded; only the comparable tokens are."""
    out = []
    for ch in unicodedata.normalize("NFD", s):
        if unicodedata.combining(ch):
            base = out[-1] if out else ""
            if (ch == "\u0303" and base in ("n", "N")) or (ch == "\u0308" and base in ("u", "U")):
                out.append(ch)               # n + tilde, u + diaeresis: a different letter, keep it
            continue
        out.append(ch)
    return unicodedata.normalize("NFC", "".join(out))


def _base(s, language="en", keep_accents=False):
    s = s.replace("’", "'").replace("‘", "'")
    if language == "es":
        s = unicodedata.normalize("NFC", s) if keep_accents else fold_es(s)
    else:
        s = "".join(c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c))
    return re.sub(r"[^\w']", "", s).lower().strip("'")


def tokens(word, language="en", keep_accents=False):
    """One written or recognized word -> comparable tokens: hyphens/dashes split, numbers spoken, Mr. -> mister,
    British -our -> -or, sound-alike spellings mapped. Applied to BOTH sides, so a number written '12' and heard 'twelve'
    (or the reverse) compare equal. Spanish: accent marks are folded away for the comparison; keep_accents=True gives the same
    tokens with their accents, one for one, so reconcile can report an accent-only difference."""
    if language == "es":
        out = []
        for piece in re.split(r"[-‐-―…]+|\.\.\.", word):
            b = _base(piece, "es", keep_accents)
            if b.isdigit() and say_number_es(int(b)):
                out += [t if keep_accents else fold_es(t) for t in say_number_es(int(b))]
            elif b:
                out.append(SAME_ES.get(fold_es(b), b))
        return out
    if word.strip() == "&":
        return ["and"]
    out = []
    for piece in re.split(r"[-‐-―…]+|\.\.\.", word):
        b = _base(piece)
        if not b:
            continue
        if len(b) > 4 and b not in NO_BRITISH:
            b = re.sub(r"our(s|ed|ing|'s)?$", r"or\1", b)
        if b in READ_OUT:
            out += READ_OUT[b]
        elif b in ORD:
            out.append(ORD[b])
        elif b.isdigit() and say_number(int(b)):
            out += say_number(int(b))
        else:
            out.append(SAME.get(b, b))
    if word.rstrip(".,;:!?)”\"'").endswith("%") and out:
        out.append("percent")
    return out


def _tok_pairs(words, language="en", keep_accents=False):
    """[(token, index of the word it came from)] with 'a'/'one' dropped before hundred/thousand/million, so 'a hundred'
    and '100' (= 'one hundred') compare equal. A dropped 'a' leaves its word with no tokens (nothing left to hear)."""
    pairs = [(t, i) for i, w in enumerate(words) for t in tokens(w, language, keep_accents)]
    if language == "es":
        return pairs
    return [p for k, p in enumerate(pairs)
            if not (p[0] in ("a", "one") and k + 1 < len(pairs) and pairs[k + 1][0] in ("hundred", "thousand", "million"))]


HEARD, FILLED, SWAPPED = 0, 1, 2     # the third number in every timing row
LEAD_EXTRA_HEARD = 1     # words a single lead-in flag may hear beyond the lead-in words it replaces (see reconcile)
LONG_GAP_LIMIT_S = 2.0
MAX_REPORTED_GAPS = 10


def _context(words, i0, i1, n=6):
    """A readable window: a few words before, the block marked [[like this]], a few words after."""
    mid = ["[[" + " ".join(words[i0:i1]) + "]]"] if i1 > i0 else ["[[ ]]"]
    return " ".join(words[max(0, i0 - n):i0] + mid + words[i1:i1 + n])


def _summary(flags):
    """The same flags grouped for a reviewer: a name misheard 22 times is one line with a count and the first place it occurs."""
    groups = {}
    for f in flags:
        g = groups.setdefault((f["kind"], f["written"].lower(), f["heard"].lower(), bool(f.get("advisory"))),
                              {"kind": f["kind"], "written": f["written"], "heard": f["heard"], "similar": f["similar"],
                               "advisory": bool(f.get("advisory")),
                               "count": 0, "first_at": f["at"], "first_context": f["written_context"]})
        g["count"] += 1
    return sorted(groups.values(), key=lambda g: (g["first_at"]))


def _clean(s):
    """A word or phrase for a sentence: edge punctuation off ('Ludington.' -> Ludington)."""
    return s.strip(" .,;:!?\"“”‘’()[]—-")


def _name_index(names, scope, language="en"):
    """The names list -> [(entry, written tokens, heard tokens)], one per known spelling, for entries in scope for this passage.
    Tokens are made the same way as for the passage and the recognizer output, so spellings compare like for like. Each pair
    also has a possessive twin ("Shamel's" heard "chamel's"): the written name and the heard spelling must both have the 's or neither."""
    out = []
    for e in namebook.in_scope(names, scope):
        wt = [t for w in e["written"].split() for t in tokens(w, language)]
        for h in e.get("heard_as") or []:
            ht = [t for w in h.split() for t in tokens(w, language)]
            if wt and ht and ht != wt:
                out.append((e, wt, ht))
                out.append((e, wt[:-1] + [wt[-1] + "'s"], ht[:-1] + [ht[-1] + "'s"]))
    return out


def _find_name(book, A, B, a0, a1, b0, b1, lo=0, hi=0):
    """Within a stretch where heard (A[a0:a1]) and written (B[b0:b1]) disagree, the first listed name that is WRITTEN there and
    HEARD there as one of its known spellings. A name may start in the `lo` tokens before the stretch or end in the `hi` tokens
    after it (the parts of a name that were heard right: 'Caitlyn Meagher' heard 'Caitlin Meagher'), but must overlap the stretch
    on both sides, so a name that was simply read correctly is never touched.
    Returns (entry, written start, written length, heard start, heard length) or None."""
    best = None
    for e, wt, ht in book:
        n, m = len(wt), len(ht)
        for i in range(max(0, b0 - lo), min(len(B), b1 + hi) - n + 1):
            if B[i:i + n] != wt or not (i < b1 and i + n > b0):
                continue
            p = next((p for p in range(max(0, a0 - lo), min(len(A), a1 + hi) - m + 1)
                      if A[p:p + m] == ht and p < a1 and p + m > a0), None)
            if p is not None and (best is None or i < best[1]):
                best = (e, i, n, p, m)
    return best


BYLINE_WORD = {"en": "by", "es": "por"}


def byline_start(lead, language="en"):
    """Index in `lead` where the byline ('by', then the author) begins: the LAST 'by' ('por' in Spanish), because a title may
    contain one ('Stand by Me by Ana Sol'). No such word: len(lead), meaning no byline, so the whole lead-in is title."""
    marker = BYLINE_WORD.get(language, "by")
    at = [i for i, w in enumerate(lead) if w.lower() == marker]
    return at[-1] if at else len(lead)


def reconcile(spoken, lead, words, names=None, scope=None, language="en", byline_from=None):
    """Pin every displayed word to a time using what was actually heard, and KEEP every disagreement as its own flag.

    spoken: [(word, start_s, end_s)] from speech recognition (Amazon Transcribe), in order
    lead:   lead-in words (title, 'by', author): aligned if spoken, never displayed as passage text
    words:  displayed passage words, in order
    names:  the names list (names.load), optional. scope: this passage's id, so entries scoped to it apply (entries
            scoped "*" always apply). A swap where the written word is a listed name and the recognizer spelled it one of
            its known ways counts as heard and is reported in report["accepted_names"]; every other swap, miss and
            extra is judged exactly as without a list.
    Returns (rows for lead+words as [start, end, flag], report).
      flag 0 = heard as written (exactly, or by a normalized equivalent: number words, Mr./mister, hyphens, -our/-or)
      flag 1 = not heard at all: time filled from the neighbours
      flag 2 = a different word was heard in its place ('found' heard as 'felt'): the time is where the voice said
               SOMETHING, but it is not the written word
    report["flags"] lists every swap / missing / extra with written and heard text, time, row index and context.
    A same-length replacement is a swap, never "heard".
    Byline (gatefix, 2026-11-01): a disagreement that lies wholly inside the spoken BYLINE ("by" and the author; it starts at
    byline_from, default byline_start(lead)) is still listed in report["flags"], marked "advisory": true with
    "advisory_reason": "lead-in", but it is NOT counted in flag_count / extras / unheard / swapped, so it cannot hold the passage
    by itself. The TITLE is never excused: a missing or wrong title word is an ordinary flag, and the byline is excused only if
    every title word was heard exactly as written (and there is a title). A flag that touches even one passage word, or an
    extra word heard right where the passage text begins, is a passage flag exactly as before. One more condition keeps
    chatter from hiding in a byline: one flag may hear at most one more word than the byline words it replaces
    (LEAD_EXTRA_HEARD), so 'by ReadWorks' heard 'I read works' qualifies but a sentence of chatter does not.
    Spanish accents (gatefix): accent marks are not compared, but where a heard word and its written word differ ONLY by accent
    ('papá' / 'papa': a different stress and sometimes a different word) the pair is reported as a non-blocking flag of kind
    "accent", advisory_reason "accent-only", so a reviewer can see it. The timing rules still cover every row.
    """
    target = lead + words
    s_tok = _tok_pairs([w for w, _, _ in spoken], language)
    t_tok = _tok_pairs(target, language)
    A, B = [t for t, _ in s_tok], [t for t, _ in t_tok]
    bf = byline_start(lead, language) if byline_from is None else byline_from
    if language == "es":                    # the same tokens with their accents, one for one, to report accent-only differences
        A_raw = [t for t, _ in _tok_pairs([w for w, _, _ in spoken], language, True)]
        B_raw = [t for t, _ in _tok_pairs(target, language, True)]
    else:
        A_raw = B_raw = None
    state = [[] for _ in target]          # per written word: (kind, (start, end) or None) for each of its tokens
    flags = []
    heard_words = [w for w, _, _ in spoken]

    def span(a0, a1):
        ws = [spoken[s_tok[k][1]] for k in range(a0, a1)]
        return min(w[1] for w in ws), max(w[2] for w in ws)

    def owners(pairs, lo, hi):
        seen = []
        for k in range(lo, hi):
            if pairs[k][1] not in seen:
                seen.append(pairs[k][1])
        return seen

    def flag(kind, b0, b1, a0, a1, at, accent=False):
        w_idx, s_idx = owners(t_tok, b0, b1), owners(s_tok, a0, a1)
        if w_idx:
            i0, i1 = w_idx[0], w_idx[-1] + 1
        else:                              # an extra word sits just before the written word that follows it
            i0 = i1 = t_tok[b0][1] if b0 < len(t_tok) else len(target)
        # candidate for "inside the byline": written words all byline words (never a title word); an extra heard between the
        # title and the end of the byline (not before the title, not at the seam where the passage text starts, which could be
        # the reader's first passage words); and not much more heard than written. Confirmed only after the whole alignment is
        # known (the title must have been heard, below).
        inside = (w_idx[0] >= bf and i1 <= len(lead)) if w_idx else (0 < bf <= i0 < len(lead))
        lead_only = inside and (a1 - a0) <= (b1 - b0) + LEAD_EXTRA_HEARD
        written, said = " ".join(target[i] for i in w_idx), " ".join(heard_words[i] for i in s_idx)
        flags.append({"kind": kind, "written": written, "heard": said, "at": round(at, 2), "word_index": i0,
                      # spelled almost the same ('Shamel'/'Chamel', 'shape'/'shaped'): often the recognizer's spelling of a
                      # name or an ending, not a different word. Still held: a person should hear it.
                      "_lead_only": lead_only, "_accent": accent,
                      "similar": kind == "swap" and difflib.SequenceMatcher(None, norm(written), norm(said)).ratio() >= 0.75,
                      "written_context": _context(target, i0, i1),
                      "heard_context": _context(heard_words, s_idx[0], s_idx[-1] + 1) if s_idx else ""})

    book = _name_index(names, scope, language)
    accepted = []

    def spread(a0, a1, b0, b1, kind):
        t0, t1 = span(a0, a1)
        n = b1 - b0
        for k in range(n):
            state[t_tok[b0 + k][1]].append((kind, (t0 + (t1 - t0) * k / n, t0 + (t1 - t0) * (k + 1) / n)))
        return t0

    def differ(a0, a1, b0, b1):
        """Heard tokens a0..a1 against written tokens b0..b1, with nothing in the names list to excuse them."""
        if a1 > a0 and b1 > b0:                                      # a different word was heard in its place
            same_sound = "".join(A[a0:a1]) == "".join(B[b0:b1])      # 'seat belts' heard as 'seatbelts'
            t0 = spread(a0, a1, b0, b1, HEARD if same_sound else SWAPPED)
            if not same_sound:
                flag("swap", b0, b1, a0, a1, t0)
        elif a1 > a0:                                                # heard, not written
            flag("extra", b0, b0, a0, a1, span(a0, a1)[0])
        elif b1 > b0:                                                # written, not heard
            for k in range(b0, b1):
                state[t_tok[k][1]].append((FILLED, None))
            flag("missing", b0, b1, a0, a0, span(a0 - 1, a0)[1] if a0 > 0 else 0.0)

    def replaced(a0, a1, b0, b1, lo=0, hi=0):
        """A stretch where heard and written disagree (lo / hi: how many tokens right before / after it already agree). A listed
        name (in scope) that the recognizer spelled one of its known ways is the same name, heard: it is reported as
        accepted_name, never silently dropped. Whatever else is in the stretch is judged exactly as before."""
        hit = _find_name(book, A, B, a0, a1, b0, b1, lo, hi) if a1 > a0 and b1 > b0 else None
        if not hit:
            return differ(a0, a1, b0, b1)
        e, i, n, p, m = hit
        wb0, wb1, ha0, ha1 = max(i, b0), min(i + n, b1), max(p, a0), min(p + m, a1)    # the part inside this stretch
        replaced(a0, ha0, b0, wb0, lo, 0)
        t0 = spread(ha0, ha1, wb0, wb1, HEARD)
        w_idx, s_idx = owners(t_tok, i, i + n), owners(s_tok, p, p + m)
        written, said = " ".join(target[k] for k in w_idx), " ".join(heard_words[k] for k in s_idx)
        accepted.append({"written": written, "heard": said, "at": round(t0, 2), "word_index": w_idx[0],
                         "name": e["written"], "status": e["status"],
                         "note": f"{_clean(written)}: heard as '{_clean(said)}', accepted by names list "
                                 f"({'pronunciation confirmed' if namebook.is_confirmed(e) else 'pronunciation not confirmed'})",
                         "written_context": _context(target, w_idx[0], w_idx[-1] + 1),
                         "heard_context": _context(heard_words, s_idx[0], s_idx[-1] + 1)})
        replaced(ha1, a1, wb1, b1, 0, hi)

    ops = difflib.SequenceMatcher(None, A, B, autojunk=False).get_opcodes()
    for n_op, (op, a0, a1, b0, b1) in enumerate(ops):
        prev_equal = ops[n_op - 1][2] - ops[n_op - 1][1] if n_op and ops[n_op - 1][0] == "equal" else 0
        next_equal = ops[n_op + 1][2] - ops[n_op + 1][1] if n_op + 1 < len(ops) and ops[n_op + 1][0] == "equal" else 0
        if op == "equal":
            for k in range(b1 - b0):
                state[t_tok[b0 + k][1]].append((HEARD, span(a0 + k, a0 + k + 1)))
                if A_raw and len(A_raw) == len(A) and len(B_raw) == len(B) and A_raw[a0 + k] != B_raw[b0 + k] \
                        and not (flags and flags[-1]["kind"] == "accent" and flags[-1]["word_index"] == t_tok[b0 + k][1]):
                    flag("accent", b0 + k, b0 + k + 1, a0 + k, a0 + k + 1, span(a0 + k, a0 + k + 1)[0], accent=True)
        elif op == "replace":
            replaced(a0, a1, b0, b1, lo=min(prev_equal, 4), hi=min(next_equal, 4))
        elif op in ("delete", "insert"):
            differ(a0, a1, b0, b1)
    accepted.sort(key=lambda r: r["word_index"])

    title_heard = bf > 0 and all(all(k == HEARD for k, _ in state[i]) for i in range(bf))     # every title word, exactly as written
    for f in flags:
        accent, lead_only = f.pop("_accent"), f.pop("_lead_only")
        f["advisory"] = bool(accent or (lead_only and title_heard))
        f["advisory_reason"] = "accent-only" if accent else ("lead-in" if f["advisory"] else None)

    times, kinds = [], []
    for sts in state:
        timed = [t for _, t in sts if t]
        times.append((min(t[0] for t in timed), max(t[1] for t in timed)) if timed else None)
        if not sts:
            kinds.append(None)                                       # no letters at all (a lone dash): nothing to hear
        elif all(k == HEARD for k, _ in sts):
            kinds.append(HEARD)
        elif all(k == FILLED for k, _ in sts):
            kinds.append(FILLED)
        else:
            kinds.append(SWAPPED)
    rows = []
    for i, t in enumerate(times):
        if kinds[i] in (HEARD, SWAPPED) and t:
            rows.append([round(t[0], 3), round(t[1], 3), kinds[i]])
            continue
        prev = next((times[j] for j in range(i - 1, -1, -1) if times[j]), None)
        nxt = next((times[j] for j in range(i + 1, len(times)) if times[j]), None)
        s = prev[1] if prev else (nxt[0] if nxt else 0.0)
        e = nxt[0] if nxt else s
        rows.append([round(s, 3), round(max(s, e), 3), HEARD if kinds[i] is None else FILLED])
    first10 = lambda xs: [x for x in xs if x][:10]          # noqa: E731
    blocking = [f for f in flags if not f["advisory"]]       # the passage-text flags: these decide
    return rows, {
        "extras": first10(f["heard"] for f in blocking if f["kind"] == "extra"),
        "unheard": first10(f["written"] for f in blocking if f["kind"] in ("missing", "swap")),
        "swapped": first10(f"{f['written']} -> {f['heard']}" for f in blocking if f["kind"] == "swap"),
        "flag_count": len(blocking), "advisory_count": len(flags) - len(blocking), "lead_words": len(lead),
        "flags": flags, "summary": _summary(flags),      # every flag is kept: nothing is cut off for a reviewer
        "accepted_names": accepted}


def _items(items, limit=6, width=70):
    items = [i if len(i) <= width else i[:width - 1] + "…" for i in items]
    return ", ".join(items[:limit]) + (f", and {len(items) - limit} more" if len(items) > limit else "")


def _count(n, noun):
    return f"{n} {noun}" + ("" if n == 1 else "s")


def word_reasons(rep):
    """Plain-English lines naming the words a passage was held for, from reconcile's flags, e.g.
    "1 word not confirmed: 'Ludington' (heard as 'luddington')". Empty if nothing disagreed."""
    flags = [f for f in ((rep or {}).get("flags") or []) if not f.get("advisory")]    # lead-in flags never hold a passage
    why = []
    swaps = [f for f in flags if f["kind"] == "swap"]
    if swaps:
        why.append(f"{_count(sum(len(f['written'].split()) for f in swaps), 'word')} not confirmed: "
                   + _items([f"'{_clean(f['written'])}' (heard as '{_clean(f['heard'])}')" for f in swaps]))
    missing = [f for f in flags if f["kind"] == "missing"]
    if missing:
        why.append(f"{_count(sum(len(f['written'].split()) for f in missing), 'word')} not heard in the recording: "
                   + _items([f"'{_clean(f['written'])}'" for f in missing]))
    extra = [f for f in flags if f["kind"] == "extra"]
    if extra:
        why.append(f"{_count(sum(len(f['heard'].split()) for f in extra), 'spoken word')} that are not in the text: "
                   + _items([f"'{_clean(f['heard'])}'" for f in extra]))
    return why


def structure_reasons(c):
    why = []
    if c.get("backwards_steps"):
        why.append(f'{c["backwards_steps"]} word(s) timed earlier than the word before them')
    if not c.get("in_bounds", True):
        why.append("some word times fall outside the audio")
    if c.get("long_gaps"):
        why.append(f"a silence of {max(c['long_gaps'])} s between two words (the limit is {LONG_GAP_LIMIT_S:g} s)")
    return why


def held_because(c, rep=None):
    """Why a passage was not published, in plain words, naming the words. Never empty."""
    return structure_reasons(c) + word_reasons(rep) or ["the pipeline's checks did not pass (see the checks in this file)"]


def transcribe_words(transcript_json):
    """Amazon Transcribe output -> [(word, start, end)] (punctuation items carry no times and are skipped)."""
    out = []
    for it in transcript_json["results"]["items"]:
        if it.get("type") == "pronunciation":
            out.append((it["alternatives"][0]["content"], float(it["start_time"]), float(it["end_time"])))
    return out
