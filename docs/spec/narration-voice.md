# Narration voice

*What voice reads the passage, and how is it chosen?*

Making the audio · Status: built and tested locally

A child following along needs a steady voice, and each word has to light up as it is spoken. The default setting asks Amazon's speech service to read the passage in an English voice named Joanna, using its neural (newer, more natural) engine, and to return an MP3 recording. It also returns a marker for when each word and sentence begins. The reader uses those markers to highlight words.

The voice, engine, and language are settings for a whole deployment. They are not chosen per passage. Changing them changes the fingerprint that identifies a recording, so a new voice is never mistaken for an old one. A separate setting selects a different voice, Ruth, which gets its word times another way. The event AWS deployment uses Ruth, while Joanna remains the code default.

In the reader, the generated voice appears beside other compatible voices, labeled with its engine and the source of its word times.

**Joanna is the default voice; whether it sounds good and highlights on time takes listening to check.**

Joanna produces sound and word starts in separate requests:

![The default Joanna neural voice sends cleaned text to separate MP3 and speech-mark tasks, waits for both, and checks their outputs before the reader gets a timed voice.](shots/fig-narration-voice.svg)

## How it connects

[Generative voice setting](generative-voice-setting.md) covers the Ruth alternative. [Word timing](word-timing.md) explains what the markers become, and [Publish to reader](publish-to-reader.md) shows how the voice appears on screen.

## Where it stands

Joanna remains the code's default deployment voice, but the team reports that the event AWS deployment uses Ruth. The live library lists 13 passages with a voice labeled `Generated voice (Ruth)`; seven of those also have a human voice, and one Spanish passage has only a human voice. The team's headless browser checks ran muted, so nobody has judged the generated sound by ear. No target-device trial with sound was confirmed.

---

## Technical details

`cdk.json` sets `soundAlong.voiceId=Joanna`, `engine=neural`, `language=en-US`; `bin/sound-along.ts` has the same fallbacks. `lib/sound-along-stack.ts` passes these to workers. `lambdas/worker/handler.py` submits two asynchronous Polly tasks with identical normalized text: MP3 and JSON speech marks (`word`, `sentence`). The state machine waits five seconds between polls and branches on completed, failed, or still running. `SubmitPollyAudio` retries all errors up to four times (five tries in all) with backoff; the workflow has a 15-minute timeout in the default configuration. `ComputeTextHash` includes voice, engine, and language.

The manifest records `audioProvider: amazon-polly`, `audioType: synthetic`, voice and engine. On the default deployment, the reader record labels the voice `Generated voice (Joanna)` and its source `Polly neural, timed by Polly speech marks`. A different `soundAlong` context can alter the default voice and engine, but compatibility of arbitrary combinations was not confirmed. Use `npm run synth` for a local infrastructure check and `python tests/test_audio_check.py` for the audio check module; neither proves the voice is pleasant or correctly pronounced.

---

Previous: [Passage intake](passage-intake.md) · [Spec home](README.md) · Next: [Generative voice setting](generative-voice-setting.md)
