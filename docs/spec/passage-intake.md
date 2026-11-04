# Passage intake

*How does a passage enter audio generation?*

Making the audio · Status: built and tested locally

ReadWorks' content staff need a way to turn a finished reading passage into a narrated one without hand work for each. Sound Along starts from the passage text. It gives the passage a stable ID and starts making the narration when the passage file arrives.

The usual route is a file upload. A separate signed submission service can be switched on for systems that send passages automatically. Both routes lead to the same audio steps.

Those steps close up extra spacing in the text, then make a short fingerprint of the cleaned text plus the voice, engine, and language. If a finished recording with the same fingerprint exists, it is reused, so an identical upload does not produce a second recording.

The routes filter differently. The signed service removes fields the reader should not show. A directly uploaded file can carry other fields into the public version, so it should hold only content meant to be public.

**A passage's text and ID start the run, and a directly uploaded file should hold only what may become public.**

Both intake routes write the same passage file:

![A direct upload or optional signed submission writes the same passage JSON file; its arrival starts the audio workflow, whose fingerprint decides whether finished audio is reused.](shots/fig-passage-intake.svg)

## How it connects

[Narration voice](narration-voice.md) explains what the workflow makes. To send passages from another system, see [Send a passage API](send-a-passage-api.md); the fields a passage carries are in [The passage file](the-passage-file.md).

## Where it stands

The team reports that the stack ran on the event AWS account in `us-west-2`: passage upload, generation, and a repeated passage that avoided regeneration were verified. The live library lists 14 passages, including two long passages with Ruth as their only voice. Direct S3 access returned 403 in an earlier check. No child, teacher, or ReadWorks person has tried this intake, and no target-device trial with sound was confirmed.

---

## Technical details

`lib/sound-along-stack.ts` attaches an S3 object-created notification only to `passages/*.json`. `lambdas/trigger/handler.py` starts the state machine. `lambdas/worker/handler.py` loads `text`, requires a nonempty string, takes `passageId` or `uuid` or the event ID, and defaults `title` to the ID and language to the configured language. It collapses whitespace for `normalizedText` and computes `sha256(normalizedText|voiceId|engine|language)`. A job row keyed by passage ID and hash is reused when its status is `approved` by default or `generated` with the quality gate. A failed reader publish can be retried from stored audio.

The direct S3 route does not enforce the signed service's 1 MiB, 20,000-word, or allowlist checks. `PublishDemoJson` copies the source object before adding audio fields; therefore only content intended for that derivative should enter `passages/` directly. `node scripts/seed.js --bucket <ContentBucketName> --region <region>` uploads bundled demo files and starts generation. `node scripts/generate.js --arn <StateMachineArn> --passage <id> --region <region>` starts one existing file manually. See [Deploy and smoke test](deploy-and-smoke-test.md) before trying either against AWS.

---

Previous: [Class link flow](class-link-flow.md) · [Spec home](README.md) · Next: [Narration voice](narration-voice.md)
