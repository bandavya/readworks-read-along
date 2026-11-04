# Word timing

*How does each written word get a playback time?*

Making the audio · Status: built and tested locally

For a child to follow along, the reader must know when each word begins. The speech service supplies start marks. Sound Along checks and stores them, then turns each into a start and end time for every word on screen. A slot holding only punctuation has no sound and gets no highlight.

End times are inferred. Most words end when the next word starts, and the last word gets a short estimate added. The highlight is usable, but no one has listened to confirm each end. With the optional Ruth voice, speech recognition supplies the starts instead, and written words it missed get estimated positions.

A count of timed words is not enough to judge a passage. An interjection can fill a long guessed span while a short numeral gets an implausibly brief one.

**A timing row drives the highlight; it does not show that the word was spoken correctly.**

Each end comes from the next word's start, and the last word gets an estimate:

![A spoken sentence with a start mark at each word, and the table those marks become: each end is the next word's start, and the last word gets its start plus 0.4 seconds](shots/fig-word-timing.svg)

## How it connects

[Audio and pace checks](audio-and-pace-checks.md) confirm the basic length and order. [Publish to reader](publish-to-reader.md) turns the rows into what the reader reads, and [Word numbers and timing rows](word-numbers-and-timing-rows.md) describes their shape.

## Where it stands

The conversion is built with local tests. In a local test with speech-recognition software (WhisperX) on ReadWorks' current audio, 1,423 of 1,435 words in *Grandma's Music* and 2,019 of 2,046 in a Jesse Jackson excerpt received times. The remaining slots were punctuation such as `***`, `[...]`, quotes, and dashes. `Brrrrr-boppppp!` was lit for about two seconds from estimated recognition, and `8` got 20 ms. That audio is not in the repo, and the test does not cover this AWS path. Muted browser checks cover display behavior, not audible synchronization. No event AWS run was confirmed. No target-device trial with sound and a reader was confirmed.

---

## Technical details

`lambdas/worker/handler.py` parses newline-delimited Polly marks; `WriteManifest` stores a JSON array at `audio/<audioId>.speechmarks.json`. `lambdas/reader_bridge/handler.py` normalizes source whitespace, maps UTF-8 byte offsets to whitespace-delimited words, rejects out-of-order times, missing alphanumeric word marks, offsets outside words, and ordinary spelling mismatches. It permits numeric spelling differences. Each non-silent row is `[startSeconds,endSeconds]`; a punctuation-only word is `null`. The end is the following word's start, or final start plus 0.4 seconds. This may cross a pause or run beyond the MP3; the bridge itself does not recheck the derived final end against duration. `scripts/smoke.js` does check rows against the MP3 length.

The generative module writes the same mark shape but derives it from Transcribe; its report counts spoken, aligned, and estimated words. `python scripts/timing_report.py --marks <marks> --transcribe <transcript> --hand <csv>` can compare sources when those files are available. A timing tolerance accepted by ReadWorks remains an open decision.

---

Previous: [Generative voice setting](generative-voice-setting.md) · [Spec home](README.md) · Next: [Audio and pace checks](audio-and-pace-checks.md)
