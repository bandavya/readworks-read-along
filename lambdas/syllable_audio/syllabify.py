"""English syllable splitting for the pronunciation guide.

Uses Pyphen (Hunspell hyphenation dictionaries, offline, bundled with the Lambda) to split a
written word into syllable-like chunks. Hyphenation points are not always exact linguistic
syllables, so every produced entry is still marked "needs human check", like the shipped data.
The split only chunks the word for the guide; it never changes what the voice says.

    split_syllables("impatiently") -> (["im", "pa", "tient", "ly"], stress_index)

One-chunk words (["hike"]) are left whole; the reader plays the whole clip slowly for those.
"""
import re

try:
    import pyphen
    _DIC = pyphen.Pyphen(lang="en_US")
except Exception:  # pragma: no cover - pyphen missing; fall back to the rough splitter
    _DIC = None

_VOWELS = "aeiouy"


def estimate_stress(syllables):
    """Approximate stressed syllable (flagged for human review).
    1 syllable -> 0; 2 -> first; 3+ -> antepenult."""
    n = len(syllables)
    if n <= 2:
        return 0
    return max(0, n - 3)


def _rough_split(letters):
    """Fallback when pyphen is unavailable: split on vowel-group boundaries (approximate)."""
    groups = re.findall(r"[aeiouy]+|[^aeiouy]+", letters.lower())
    chunks, cur = [], ""
    seen_vowel = False
    for g in groups:
        is_v = g[0] in _VOWELS
        if is_v and seen_vowel:
            chunks.append(cur)
            cur = g
            seen_vowel = True
        else:
            cur += g
            seen_vowel = seen_vowel or is_v
    if cur:
        chunks.append(cur)
    return chunks or [letters]


def split_syllables(word):
    """Return (syllables, stress_index). Chunks preserve the original word's letters/casing."""
    letters = re.sub(r"[^A-Za-z]", "", word)
    if len(letters) <= 2:
        return [word], 0

    if _DIC is not None:
        hyph = _DIC.inserted(letters)
        chunks = [c for c in hyph.split("-") if c]
    else:
        chunks = _rough_split(letters)

    if len(chunks) <= 1:
        return [word], 0

    # Map letter-chunks back onto the original word so punctuation/casing is preserved.
    out, pos = [], 0
    for idx, chunk in enumerate(chunks):
        if idx == len(chunks) - 1:
            out.append(word[pos:])
            break
        take, got, start = len(chunk), 0, pos
        while pos < len(word) and got < take:
            if word[pos].isalpha():
                got += 1
            pos += 1
        out.append(word[start:pos])
    out = [p for p in out if p.strip()] or [word]
    return out, estimate_stress(out)
