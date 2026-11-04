"""Generate the "Words to know" pronunciation guide audio in the passage's own voice.

For each vocabulary word the reader can open, this synthesizes, with the SAME Polly voice and
engine used for the passage:
  - a "whole" clip (the word said once),
  - one clip per syllable,
  - a "slow" clip (each syllable in turn, then the whole word), assembled by joining the
    per-syllable clips and the whole clip with short silences.
It then writes audio/syl/*.mp3 and data/syllables/<uuid>.json in the shape the reader reads,
so the pronunciation guide matches the passage voice instead of the older shipped clips.

No ffmpeg: MP3 frames are self-contained, so clips are joined by concatenating bytes (all
clips share one Polly voice/format). Clip lengths are read from the MP3 frames directly.

Everything here produces DRAFT audio: entries are marked "needs human check", and syllable
splits come from a hyphenation dictionary, so a person should review before students rely on it.
"""
import json
import os

import sys

# Make sibling modules importable whether this runs as a package (lambdas/ bundled together,
# so "syllable_audio.handler") or standalone in tests (folder on the path).
_HERE = os.path.dirname(__file__)
for _p in (_HERE, os.path.join(_HERE, "..", "worker")):
    if _p not in sys.path:
        sys.path.append(_p)

try:
    from .syllabify import split_syllables
except Exception:  # pragma: no cover - standalone import
    from syllabify import split_syllables

# Reuse the pure-Python MP3 duration reader from the worker (no ffmpeg needed).
from audio_check import mp3_duration

GAP_SECONDS = 0.35  # silence between parts in the slow clip


def _silence_mp3(polly, voice_id, engine, language):
    """A short silent MP3 in the same format, from an SSML break, to pad the slow clip."""
    kwargs = dict(VoiceId=voice_id, OutputFormat="mp3", LanguageCode=language,
                  TextType="ssml", Text=f'<speak><break time="{int(GAP_SECONDS*1000)}ms"/></speak>')
    if engine:
        kwargs["Engine"] = engine
    # Generative voices reject some SSML; fall back to a plain tiny space if needed.
    try:
        return polly.synthesize_speech(**kwargs)["AudioStream"].read()
    except Exception:
        kwargs.update(TextType="text", Text=" ")
        kwargs.pop("Engine", None)  # neutral engine for the tiny pad
        return polly.synthesize_speech(VoiceId=voice_id, OutputFormat="mp3",
                                       LanguageCode=language, Text=" ")["AudioStream"].read()


def _say(polly, text, voice_id, engine, language):
    kwargs = dict(VoiceId=voice_id, OutputFormat="mp3", LanguageCode=language, Text=text)
    if engine:
        kwargs["Engine"] = engine
    return polly.synthesize_speech(**kwargs)["AudioStream"].read()


def build_word(polly, s3, frontend_bucket, uuid_, sense_id, word, voice_id, engine, language):
    """Synthesize all clips for one word, upload them, and return the syllable entry."""
    letters_word = word.strip()
    syllables, stress = split_syllables(letters_word)

    base = f"audio/syl/{sense_id}-{uuid_}"
    cache = "public, max-age=31536000, immutable"

    def put(key, data, ctype="audio/mpeg"):
        s3.put_object(Bucket=frontend_bucket, Key=key, Body=data, ContentType=ctype, CacheControl=cache)

    whole_bytes = _say(polly, letters_word, voice_id, engine, language)
    whole_key = f"{base}-whole.mp3"
    put(whole_key, whole_bytes)
    whole_dur = mp3_duration(whole_bytes) or 0.0

    syl_keys, syl_bytes, syl_durs = [], [], []
    if len(syllables) > 1:
        for i, syl in enumerate(syllables):
            b = _say(polly, syl, voice_id, engine, language)
            k = f"{base}-s{i}.mp3"
            put(k, b)
            syl_keys.append(k)
            syl_bytes.append(b)
            syl_durs.append(mp3_duration(b) or 0.0)

    # whole_segments: split the whole clip across syllables, weighted by letter count.
    segments = []
    if syllables:
        weights = [max(1, len(s)) for s in syllables]
        total = sum(weights)
        t = 0.0
        for w in weights:
            seg = whole_dur * w / total
            segments.append({"start": round(t, 3), "end": round(t + seg, 3)})
            t += seg
        if segments:
            segments[-1]["end"] = round(whole_dur, 3)

    # slow clip + slow_phases: join syllable clips (each lit in turn), then the whole word.
    slow_key = None
    slow_phases = []
    if len(syllables) > 1:
        gap = _silence_mp3(polly, voice_id, engine, language)
        gap_dur = mp3_duration(gap) or GAP_SECONDS
        parts, t = [], 0.0
        for i, (b, d) in enumerate(zip(syl_bytes, syl_durs)):
            parts.append(b)
            slow_phases.append({"kind": "syllable", "index": i, "start": round(t, 3), "end": round(t + d, 3)})
            t += d
            parts.append(gap)
            t += gap_dur
        parts.append(whole_bytes)
        slow_phases.append({"kind": "whole", "start": round(t, 3), "end": round(t + whole_dur, 3)})
        slow_key = f"{base}-slow.mp3"
        put(slow_key, b"".join(parts))

    audio = {"whole": whole_key}
    if syl_keys:
        audio["syllables"] = syl_keys
    if slow_key:
        audio["slow"] = slow_key

    entry = {
        "word": letters_word,
        "lang": language.split("-")[0].upper(),
        "syllables": syllables,
        "stress_index": stress,
        "review": "needs human check",
        "uncertainty": "",
        "audio": audio,
        "whole_segments": segments,
        "slow_phases": slow_phases,
    }
    return entry


def build_passage_syllables(polly, s3, frontend_bucket, uuid_, vocab, voice_id, engine, language):
    """vocab: {senseId: {word, ...}}. Returns the data/syllables/<uuid>.json dict."""
    out = {}
    for sense_id, v in (vocab or {}).items():
        word = (v or {}).get("word")
        if not word or not any(ch.isalpha() for ch in word):
            continue
        try:
            out[str(sense_id)] = build_word(polly, s3, frontend_bucket, uuid_, sense_id, word,
                                            voice_id, engine, language)
        except Exception as exc:  # one bad word must not fail the whole passage
            out[str(sense_id)] = {"word": word, "error": str(exc)[:200], "review": "needs human check"}
    return out


def publish_syllables(polly, s3, frontend_bucket, uuid_, vocab, voice_id, engine, language):
    data = build_passage_syllables(polly, s3, frontend_bucket, uuid_, vocab, voice_id, engine, language)
    if data:
        s3.put_object(Bucket=frontend_bucket, Key=f"data/syllables/{uuid_}.json",
                      Body=json.dumps(data, ensure_ascii=False).encode("utf-8"),
                      ContentType="application/json; charset=utf-8", CacheControl="public, max-age=60")
    return data
