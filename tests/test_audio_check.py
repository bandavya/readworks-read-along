"""Checks for the audio QC, the cost metric and the timing report. Run: python tests/test_audio_check.py"""
import importlib.util
import json
import os
import pathlib
import subprocess
import sys
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "lambdas" / "worker"))
import audio_check  # noqa: E402

spec = importlib.util.spec_from_file_location("timing_report", ROOT / "scripts" / "timing_report.py")
timing_report = importlib.util.module_from_spec(spec)
spec.loader.exec_module(timing_report)


def mpeg2_frames(seconds, kbps=48, sample_rate=24000):
    """Silent-looking MPEG-2 Layer III frames, the format Polly writes by default."""
    frame_seconds = 576 / sample_rate
    length = 72 * kbps * 1000 // sample_rate
    rate_index = audio_check.BITRATES_V2_L3.index(kbps)
    sample_index = audio_check.SAMPLE_RATES[2].index(sample_rate)
    header = bytes([0xFF, 0xF3, (rate_index << 4) | (sample_index << 2), 0xC4])
    return (header + b"\x00" * (length - 4)) * round(seconds / frame_seconds)


def word_marks(count, step_ms=400):
    return [{"time": i * step_ms, "type": "word", "start": i, "end": i + 1, "value": "w"} for i in range(count)]


class Duration(unittest.TestCase):
    def test_reads_real_length_not_file_size(self):
        self.assertAlmostEqual(audio_check.mp3_duration(mpeg2_frames(10)), 10, delta=0.1)

    def test_skips_an_id3_tag(self):
        tag = b"ID3\x04\x00\x00\x00\x00\x02\x00" + b"\x00" * 256
        self.assertAlmostEqual(audio_check.mp3_duration(tag + mpeg2_frames(3)), 3, delta=0.1)

    def test_no_frames_is_none(self):
        self.assertIsNone(audio_check.mp3_duration(b"not audio at all" * 200))


class Report(unittest.TestCase):
    def test_clean_recording(self):
        found = audio_check.report(8.5, word_marks(20), 20)
        self.assertEqual((found["problems"], found["warnings"]), ([], []))
        self.assertEqual(found["wordsPerMinute"], 141)

    def test_cut_off_audio_stops_the_run(self):
        found = audio_check.report(3.0, word_marks(20), 20)
        self.assertIn("audio is 3.0 s long", found["problems"][0])

    def test_unreadable_audio_stops_the_run(self):
        self.assertTrue(audio_check.report(None, word_marks(3), 3)["problems"])

    def test_long_gap_and_odd_pace_only_warn(self):
        marks = word_marks(3) + [{"time": 5000, "type": "word", "start": 3, "end": 4, "value": "w"}]
        found = audio_check.report(5.5, marks, 4)
        self.assertEqual(found["problems"], [])
        self.assertEqual(len(found["warnings"]), 2)


class Cost(unittest.TestCase):
    def test_neural_counts_both_requests(self):
        self.assertEqual(audio_check.polly_cost(1_000_000, "neural"), 32.0)

    def test_generative_has_no_speech_marks_request(self):
        self.assertEqual(audio_check.polly_cost(1_000_000, "generative"), 30.0)


class Timing(unittest.TestCase):
    def test_matching_words_only(self):
        first = [("the", 0.0), ("garden", 0.5), ("was", 1.0), ("small", 1.4)]
        second = [("the", 0.04), ("gardens", 0.5), ("was", 1.1), ("small", 1.8)]
        found = timing_report.summary(timing_report.differences(first, second), len(first))
        self.assertEqual(found["matched"], 3)
        self.assertEqual(found["median_ms"], 100)
        self.assertEqual(found["share_over_300_ms"], round(1 / 3, 3))

    def test_runs_on_real_file_shapes(self):
        with tempfile.TemporaryDirectory() as folder:
            marks, job, hand = [os.path.join(folder, n) for n in ("m.json", "t.json", "h.csv")]
            open(marks, "w").write('{"time":0,"type":"word","start":0,"end":3,"value":"The"}\n{"time":500,"type":"word","start":4,"end":7,"value":"cat"}\n')
            json.dump({"results": {"items": [
                {"type": "pronunciation", "start_time": "0.05", "alternatives": [{"content": "The"}]},
                {"type": "punctuation", "alternatives": [{"content": "."}]},
                {"type": "pronunciation", "start_time": "0.60", "alternatives": [{"content": "cat"}]}]}}, open(job, "w"))
            open(hand, "w").write("word,seconds\nThe,0.02\ncat,0.52\n")
            out = subprocess.run([sys.executable, str(ROOT / "scripts" / "timing_report.py"), "--marks", marks, "--transcribe", job, "--hand", hand],
                                 capture_output=True, text=True, check=True).stdout
        result = json.loads(out)
        self.assertEqual(result["speech_marks_vs_transcribe"]["matched"], 2)
        self.assertEqual(result["speech_marks_vs_hand_marked"]["median_ms"], 20)


if __name__ == "__main__":
    unittest.main(verbosity=1)
