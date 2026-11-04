# The reader engine

*How does narration stay connected to words on the page?*

The reader · Status: built and tested locally

For a read-along to help, the lit word must match the word being spoken. The engine does this by checking the recording's clock. Each voice comes with a list of start and end times, one per numbered word in the passage. As the audio plays, the engine finds the latest word whose start time has passed and lights it.

A reader can tap a word to start there, drag through the recording, change the pace, or switch voices. After a voice switch, the reader tries to resume at the same word.

The engine also scrolls to keep the lit word in view above the player, and it pauses that scrolling briefly after the reader scrolls by hand. One-word playback powers the hear-it buttons, and a bounded stretch of audio powers sentence practice elsewhere in the prototype.

The highlight is only as good as its timing data. If the recording and the text disagree, a plausible highlight can still be wrong.

**The recording's clock drives the highlight, and the timing data sets how accurate it is.**

This follows one tick of the clock to a lit word:

![The recording's clock at one tick, the timing list finding the latest word whose start has passed, and that word lit on the page; dragging, pace, voice and taps all act on the clock](shots/fig-reader-engine.svg)

## How it connects

[Word numbers and timing rows](word-numbers-and-timing-rows.md) defines the timing list used here, and [Word timing](word-timing.md) covers how it is produced. [The passage reader](the-passage-reader.md) is the screen that shows the result.

## Where it stands

The build team's Nov. 4 browser runs passed 41 of 41 focused checks and 162 of 162 classic reader checks, with Edge muted. Those show browser behavior on the tested passages and sizes, not that a person heard accurate alignment.

A speech-recognition tool run locally (WhisperX) timed 1,423 of 1,435 words in Grandma's Music and 2,019 of 2,046 in the Jesse Jackson excerpt. The remaining tokens were punctuation forms. The timing for "Brrrrr-boppppp!" lasts about two seconds because recognition heard other words. The excerpt's "8" has a suspect 20 ms duration. A local version of the timing check would hold both passages, partly because of those recognition errors. The ReadWorks audio is outside the repo.

The engine has not run on the event AWS account or a real device, and no child, teacher, or ReadWorks reviewer has heard it.

---

## Technical details

`frontend-src/src/soundAlong.js` owns one `Audio` element and a reactive player state. `attach` collects narrated `.sa-w:not(.sa-unread)` spans in DOM order. `frontend-src/src/engine/timing.js` reads each span's `data-l` from `voice.lead` or `data-i` from `voice.t`, builds a start-time-sorted lookup, and selects the current word by binary search. Untimed words remain in the article and in the engine's word list; a tap on one seeks to the next timed word, or the previous one if none follows. The last highlight clears after the timing end plus a short grace period.

`frontend-src/src/engine/dom.js` applies `sa-now`, roving keyboard focus, and conditional scrolling. The scroll helper waits 2.5 seconds after user scrolling and respects a safe bottom supplied by the view. `frontend-src/src/engine/input.js` delegates click and keyboard activation; arrows move among words, with up and down choosing a nearby word on the next rendered line. A tapped word seeks at most 20 ms before its start and pins its highlight until playback reaches it (a pin that makes no progress is dropped after half a second). The engine also handles pending seeks while audio metadata loads, switching voices by word index, retrying failed audio, and stopping one-word snippets.

For a local browser check, start Vite in `frontend-src` with `npm run dev -- --host 127.0.0.1 --port 8992`, then, from the repo root, run `node frontend-src/tests/focused_browser.mjs http://127.0.0.1:8992`. Inspect timing against the actual recording by ear before publishing a passage; the muted browser check cannot do that.

---

Previous: [All features and themes](all-features-and-themes.md) · [Spec home](README.md) · Next: [Word meanings](word-meanings.md)
