# Hear words in parts or slowly

*How can a reader hear a word in parts or more slowly?*

Word help and the classroom · Status: built and tested locally

Some words are easier to take one beat at a time. A syllable guide shows a word's parts in order, marks a guessed strong beat, and lets the reader tap any part to hear it. The speaker button plays the whole word while the parts light up, timed by an estimate from letter counts. The slow button plays a slower version, showing each part and then the whole word. A one-part word is played slowly from its whole-word recording instead.

The guide appears with word help and in vocabulary views whenever prepared guide data exists for the word. A guide belongs to one vocabulary entry, or is shared from a common word bank when the same word appears elsewhere.

In slow mode the lighting follows the clip lengths. It is a visual aid to the sound and does not make up a new pronunciation on demand. The team reports that the live Ruth deployment makes new guide clips in the passage voice. The default Joanna deployment and shipped guides still use older clips in a different voice. A person still needs to review pronunciation and pacing, especially for words with more than one possible pronunciation.

**The guide lets a reader hear a word piece by piece; it does not replace a listening review.**

The guide lights the word parts from recorded audio:

![A made-up two-part word shows part and slow playback; a one-part word plays its whole clip at reduced speed without lit parts.](shots/fig-syllable-guides-and-slow.svg)

## How it connects

[Words to know](words-to-know.md) places guides beside vocabulary entries. [Reviewing word help](reviewing-word-help.md) explains how a person checks a guide's text and recordings. [Narration voice](narration-voice.md) describes the story audio that the Ruth deployment uses for its new guides.

## Where it stands

The controls are built into the local reader. The Nov. 4 focused reader run passed 41 of 41 browser checks across three passages and six screen sizes, with sound muted. A muted run cannot confirm that the recordings match the story voice or pronounce words well. Listening by a child, teacher, or ReadWorks person isn't recorded for this version, and no classroom-device trial or full listening review could be confirmed. The team reports new guide clips loading through CloudFront and playing in a muted headless browser on the Ruth deployment in the event AWS account. A team member heard one slow clip in a one-minute demo.

---

## Technical details

`lambdas/syllable_audio/` carries the pyphen library with its US English dictionary only. `syllabify.py` guesses stress from the number of parts alone: the first part for one or two parts, and third from last for three or more. The parts come from written hyphenation and each is synthesized separately, so a person needs to check them. `lib/sound-along-stack.ts` sets `SYLLABLE_AUDIO=true` only with `generativeVoice=true`, unless `-c syllableAudio=false`; the bridge gets Polly permission only then. The default deployment uses Joanna with `generativeVoice=false`, `qualityGate=false`, and `passageApi=false`. The team reports the event deployment uses Ruth with `generativeVoice=true` and `qualityGate=true`, while `passageApi` is off. `lambdas/syllable_audio/handler.py` generates whole-word, per-part, and slow clips for the Ruth deployment and writes `data/syllables/<uuid>.json`. It uses vendored pyphen through `syllabify.py` for approximate written splits and marks each entry `needs human check`. `lambdas/reader_bridge/handler.py` calls it only when `SYLLABLE_AUDIO=true`, after updating the library list; a failure records `syllableAudioError` without failing publication. A timeout there could mark a live passage failed. `frontend-src/src/components/SyllableGuide.vue` expects an entry shaped like `{ word, syllables, stress_index, audio: { whole, slow, syllables }, whole_segments, slow_phases }`. `frontend-src/src/kidAudio.js` loads `data/syllables/<passage>.json`; `frontend-src/src/defs.js` may use shared word-help data if the passage has no local guide for that word. Each part is a button with an accessible label that names its place and whether it has the strong beat. The speaker and slow buttons expose their pressed state.

The component uses one `Audio` object. The whole-word mode locates the active part from `whole_segments`; slow mode reads `slow_phases`; a single-part mode lights the tapped part. A one-part slow playback has no timing phases, so it does not light the part. `requestAnimationFrame` and `timeupdate` drive the light from `currentTime`. For a word with more than one part, the slow control plays the separate slow clip at normal rate. For a one-part word it plays the whole-word clip at `SLOW_WORD_RATE = 0.6` with pitch preserved (falling back to the slow clip if there is no whole clip). Starting a guide pauses the passage through the parent callback. `guideBus.js` lets one guide claim playback so competing guide audio stops.

`review.js` constructs a review item from the text, stress mark, and all clip paths; it verifies clip bytes before treating approval as current. Missing guide data means no guide button. A failed word can produce an entry with no playable guide. Clip paths omit the voice and are cached for a year, so regeneration in another voice can keep serving old clips. A clip failure leaves the reader without that sound, so test with actual audio. The code-level check is `cd frontend-src; node tests/focused_browser.mjs <base-url>` against a running frontend (needs installed Edge); a listening check remains open.

---

Previous: [Words to know](words-to-know.md) · [Spec home](README.md) · Next: [Reviewing word help](reviewing-word-help.md)
