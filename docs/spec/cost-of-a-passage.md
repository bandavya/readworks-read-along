# Cost of a passage

*What does one new narrated passage cost to generate?*

Making the audio · Status: built and tested locally

The cost of a passage depends mostly on how many characters the voice service reads and which voice engine is used. The default path makes two requests for the same text, one for the MP3 and one for word marks. The Ruth path makes one request for the MP3, then uses speech recognition for word times, because that voice returns no marks. The optional heard-versus-written check also uses speech recognition. Reusing an identical finished passage avoids a new voice request.

The code records an estimate for the voice service only. Storage, computing, workflow steps, speech recognition, and delivery can add cost. The estimate the smoke script prints covers a single audio request, so it understates the default path. A content team should measure real passage lengths and review time before budgeting a catalog.

**Count both requests on the default path, and add speech recognition and delivery separately where they apply.**

Voice cost scales with characters, and speech recognition adds a separate line:

```mermaid
flowchart LR
  A["Characters"] -->|x 2 requests x $16/M| B["Default voice cost"]
  A -->|x 1 request x $30/M| C["Ruth voice cost"]
  C -->|MP3 minutes| D["Speech recognition, added"]
  B -->|only if the word check is on| D
```

## How it connects

[Narration voice](narration-voice.md) defines the default two-request path. [Generative voice setting](generative-voice-setting.md) and [Heard versus written check](heard-versus-written-check.md) explain when speech recognition is added.

## Where it stands

The formula is implemented in the local code and can be unit tested. No actual bill or event AWS run was confirmed. The voice prices used here match AWS's Polly pricing page as read on Nov. 4, 2026: $4 per million characters for standard, $16 for neural, $30 for generative and $100 for long-form. `docs/COST.md` still calls them unverified, and the README's figure of about $4 for neural is out of date. The speech-recognition rate for `us-west-2` could not be confirmed. Human listening and review time have not been measured for this stack. No target-device trial with sound and a reader was confirmed.

---

## Technical details

`lambdas/worker/audio_check.py` calculates `characters × requests × rate / 1,000,000`, rounded to six decimals. It uses $16 per million characters for neural, $30 for generative, $4 for standard, and $100 for long-form. Neural, standard, and long-form use two requests; generative uses one. `EmitMetrics` sends the estimate as `EstimatedCostUsd` only after a fresh successful publication path. Its default request count includes the speech-marks task. `scripts/smoke.js` instead prints an audio-only provisional estimate and explicitly excludes any second request. `docs/COST.md` is older and calls its rates unverified; the neural and generative prices used here are published Polly rates.

For 2,900 normalized characters, default neural Polly is `2,900 × 2 × $16 / 1,000,000 = $0.0928`. Generative Polly is `2,900 × $30 / 1,000,000 = $0.087`; its Transcribe timing job is additional. With the design document's unconfirmed $0.006 per audio minute and an assumed 3.2-minute recording, one Transcribe job would add $0.0192. The default path with `qualityGate=true` adds one such job; generative with the gate reuses its timing transcript, so it still starts one job. These examples exclude retries, S3, Lambda, Step Functions, DynamoDB, CloudFront, transfer, and human review. The real regional Transcribe rate and any pricing minimums could not be confirmed from this repo. Run `python tests/test_audio_check.py` to check the implemented formula; use actual AWS billing to validate a deployed estimate.

---

Previous: [Deploy and smoke test](deploy-and-smoke-test.md) · [Spec home](README.md) · Next: [The passage file](the-passage-file.md)
