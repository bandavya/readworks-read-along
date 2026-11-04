"""Checks a finished MP3 against its word marks, with no third-party libraries.

Reads the real length from the file's MPEG frames, so a cut-off or silent file can't pass on
size alone. `problems` stop a run. `warnings` go in the QC record for a person to look at.
"""
BITRATES_V1_L3 = (0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320)
BITRATES_V2_L3 = (0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160)
SAMPLE_RATES = {3: (44100, 48000, 32000), 2: (22050, 24000, 16000), 0: (11025, 12000, 8000)}

MARKS_PAST_END_SECONDS = 0.5   # a word timed this far past the end means the audio was cut off
LONGEST_PAUSE_SECONDS = 1.5    # starting values from the validation design
PACE_WORDS_PER_MINUTE = (90, 200)


def _skip_id3(data):
    if data[:3] != b"ID3" or len(data) < 10:
        return 0
    size = (data[6] << 21) | (data[7] << 14) | (data[8] << 7) | data[9]
    return 10 + size


def mp3_duration(data):
    """Seconds of audio in an MP3, or None if it holds no readable frames."""
    at, seconds, frames = _skip_id3(data), 0.0, 0
    while at + 4 <= len(data):
        if data[at] != 0xFF or (data[at + 1] & 0xE0) != 0xE0:
            at += 1
            continue
        version, layer = (data[at + 1] >> 3) & 3, (data[at + 1] >> 1) & 3
        rate_index, sample_index = data[at + 2] >> 4, (data[at + 2] >> 2) & 3
        if version == 1 or layer != 1 or rate_index in (0, 15) or sample_index == 3:
            at += 1
            continue
        table = BITRATES_V1_L3 if version == 3 else BITRATES_V2_L3
        sample_rate = SAMPLE_RATES[version][sample_index]
        per_frame = 1152 if version == 3 else 576
        padding = (data[at + 2] >> 1) & 1
        length = (per_frame // 8) * table[rate_index] * 1000 // sample_rate + padding
        if length < 4:
            at += 1
            continue
        seconds += per_frame / sample_rate
        frames += 1
        at += length
    return round(seconds, 3) if frames else None


def report(duration, word_marks, spoken_words):
    """The QC findings for one recording."""
    problems, warnings = [], []
    starts = [mark["time"] / 1000.0 for mark in word_marks]
    if duration is None:
        problems.append("audio has no readable frames")
    elif starts and starts[-1] > duration + MARKS_PAST_END_SECONDS:
        problems.append(f"last word is timed at {starts[-1]:.1f} s, but the audio is {duration:.1f} s long")
    longest = max((b - a for a, b in zip(starts, starts[1:])), default=0.0)
    if longest > LONGEST_PAUSE_SECONDS:
        warnings.append(f"longest gap between word starts is {longest:.1f} s")
    pace = round(spoken_words / (duration / 60.0)) if duration else None
    if pace is not None and not PACE_WORDS_PER_MINUTE[0] <= pace <= PACE_WORDS_PER_MINUTE[1]:
        warnings.append(f"pace is {pace} words per minute")
    return {"durationSeconds": duration, "wordsPerMinute": pace, "longestGapSeconds": round(longest, 3),
            "wordMarks": len(word_marks), "problems": problems, "warnings": warnings}


# Dollars per million characters, for the cost metric. Check current AWS pricing for the region.
POLLY_PRICE_PER_MILLION = {"standard": 4.0, "neural": 16.0, "long-form": 100.0, "generative": 30.0}


def polly_cost(characters, engine):
    """Audio plus speech marks: both requests are billed per character."""
    rate = POLLY_PRICE_PER_MILLION.get(engine, POLLY_PRICE_PER_MILLION["neural"])
    requests = 1 if engine == "generative" else 2
    return round(characters * requests / 1_000_000 * rate, 6)
