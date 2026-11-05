# Publish to reader

*How does checked audio become a voice in the reader?*

Making the audio · Status: built and tested locally

The reader needs more than an MP3. It needs a passage record, a voice entry, a timing row for each displayed word, and an entry in the library list. Once the audio checks pass, Sound Along builds these pieces. It checks that each word marker fits the passage, copies the MP3 to the reader's file store, writes the passage record, and updates the library list before optional pronunciation-guide audio is made.

The index update follows the passage audio and record, but optional guide audio runs afterward. A failed guide clip can leave a visible passage with an empty guide entry. If conversion fails, the job records a publication failure and stops. A later run can reuse the generated audio to retry. Voices already published can stay beside the new one, if the text and word mapping still fit.

The reader labels a generated voice as needing a human check, because automatic publication is not a listening approval.

**Publication means the reader has files and timing it can use. It does not mean a person has heard the narration.**

The library list follows the passage files; optional guide audio comes afterward:

![The MP3, start marks and text are checked to fit, then the sound, passage record and library list are written; optional guide audio follows, and a mismatch records a publication failure](shots/fig-publish-to-reader.svg)

## How it connects

[Word timing](word-timing.md) supplies the rows. [Reader passage record](reader-passage-record.md) describes what gets written, and [Library index](library-index.md) describes how readers find a passage.

## Where it stands

The bridge is on by default. The team reports that five Ruth passages reached the reader through the event AWS deployment, that passage audio and guide audio load through CloudFront, and that a repeated passage avoided regeneration. The live library lists 14 passages: 13 with a Ruth generated voice, including seven that also have a human voice, plus one Spanish passage with only a human voice. The team reports muted browser playback and highlighting without a measured tolerance. A separate muted scripted run tapped a word on the live site. A team member has clicked through the live site by hand many times and listened to a one-minute demo, which sounded good to them. A full listening review isn't recorded. A trial on a target device with sound isn't recorded.

---

## Technical details

`lib/sound-along-stack.ts` includes `PublishToReader` unless `-c readerBridge=false`. The worker first writes `manifests/<id>.json` and `content/<id>.json`. `lambdas/reader_bridge/handler.py` reads the source and normalized marks, verifies UTF-8 offsets, word spellings, ordering, and coverage, and writes `audio/<id>/<digest>.mp3`, `data/<id>.json`, and `data/index.json` in the private frontend bucket. The digest uses the text hash, the reader voice slot name (`generated`, or `generated-<voice>` when a different voice already holds that slot), and the MP3 ETag. The index update retries read/write confirmation six times, but it is not a transaction under concurrent writes. With `SYLLABLE_AUDIO=true`, the bridge then calls `lambdas/syllable_audio/handler.py` to write whole-word, per-syllable, and slow clips plus `data/syllables/<id>.json` in the passage voice. A top-level failure records `syllableAudioError` without failing passage publication. The guide runs before the final job update, so a bridge timeout can mark a live passage as failed. A failed individual word writes an entry with no audio, which can show an empty guide. Clip paths omit the voice and use a one-year cache, so regenerating with a different voice can keep serving old clips. The default Joanna deployment leaves this feature off and uses older guide clips. The team reports it on for the Ruth deployment.

The generated voice has `t` rows, `source`, `review: needs human check`, and `text_hash`. A mismatch sets job status `reader_publish_failed` and `readerFailureReason`; `IsReaderReady` reaches `ReaderPublishFailed`. Cached jobs with missing `readerPublishedAt` can enter `ReaderNeedsPublish` and retry the bridge. `scripts/publish-frontend.js` merges a live `data/index.json` into the local index, but a local `data/<id>.json` with the same ID can still overwrite a generated record; publish local media before generating. Test mapping with `python tests/test_reader_bridge.py` and an authorized deployment with `node scripts/smoke.js --stack <stack> --outputs outputs.json --yes`.

---

Previous: [Heard versus written check](heard-versus-written-check.md) · [Spec home](README.md) · Next: [Send a passage API](send-a-passage-api.md)
