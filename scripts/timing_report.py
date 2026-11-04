#!/usr/bin/env python3
"""Compare word timings: Polly speech marks against Transcribe, and optionally a hand-marked passage.

  python scripts/timing_report.py --marks marks.json --transcribe transcribe.json [--hand hand.csv]

marks.json is Polly's speech marks (a JSON array or one object per line). transcribe.json is a Transcribe
job's output. hand.csv has one `word,seconds` row per word, in reading order. Starting targets are a median
within 50 ms and 90% within 150 ms. Two machines agreeing is not proof, which is why the hand-marked
comparison matters more.
"""
import argparse
import csv
import difflib
import json
import re
import statistics


def key(word):
    return re.sub(r"[^\w]+", "", word.lower())


def read_marks(path):
    text = open(path, encoding="utf-8").read().strip()
    rows = json.loads(text) if text.startswith("[") else [json.loads(line) for line in text.splitlines() if line.strip()]
    return [(key(row["value"]), row["time"] / 1000.0) for row in rows if row.get("type") == "word"]


def read_transcribe(path):
    items = json.load(open(path, encoding="utf-8"))["results"]["items"]
    return [(key(item["alternatives"][0]["content"]), float(item["start_time"]))
            for item in items if item.get("type") == "pronunciation"]


def read_hand(path):
    with open(path, encoding="utf-8", newline="") as handle:
        return [(key(row[0]), float(row[1])) for row in csv.reader(handle) if len(row) >= 2 and row[1].strip()[:1].isdigit()]


def differences(first, second):
    """Onset differences in milliseconds for the words both sources agree on, in order."""
    matcher = difflib.SequenceMatcher(None, [w for w, _ in first], [w for w, _ in second], autojunk=False)
    out = []
    for block in matcher.get_matching_blocks():
        for n in range(block.size):
            out.append(abs(first[block.a + n][1] - second[block.b + n][1]) * 1000)
    return out


def summary(diffs, total):
    if not diffs:
        return {"matched": 0, "of": total}
    ordered = sorted(diffs)
    return {"matched": len(ordered), "of": total, "median_ms": round(statistics.median(ordered)),
            "p90_ms": round(ordered[min(len(ordered) - 1, int(len(ordered) * 0.9))]),
            "share_over_300_ms": round(sum(d > 300 for d in ordered) / len(ordered), 3)}


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--marks", required=True)
    parser.add_argument("--transcribe")
    parser.add_argument("--hand")
    args = parser.parse_args()
    marks = read_marks(args.marks)
    result = {}
    if args.transcribe:
        result["speech_marks_vs_transcribe"] = summary(differences(marks, read_transcribe(args.transcribe)), len(marks))
    if args.hand:
        result["speech_marks_vs_hand_marked"] = summary(differences(marks, read_hand(args.hand)), len(marks))
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
