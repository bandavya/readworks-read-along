# AWS stack and settings

*What cloud pieces and switches make up the audio pipeline?*

Making the audio · Status: built and tested locally

Sound Along runs as one package in Amazon's cloud. It holds a store for passages, a store for recordings, the reader website, a job table, and the audio workflow. When a file lands in the passage store, a chain of small tasks runs. They read the text, check whether its audio already exists, make a new recording if needed, check it, and publish the result. The passage and recording stores stay private. The reader site is served through a public delivery network.

The ordinary setup uses the Joanna voice and publishes to the reader. Optional switches add the Ruth voice, a check of heard words, and a signed submission service. The voice and check switches change the workflow itself. The submission service changes only how a passage can enter. A cached job can skip generation, and a held or failed job never reaches normal completion.

It helps to record which switches each deployment used, so a content teammate can tell how a passage was made.

**The switches are deployment choices, and the default path is neural audio, structural checks, and reader publication.**

Follow the default path down the left, and see where each switch adds a branch:

```mermaid
flowchart TD
  A["Passage upload"] -->|ID and file location| B["Load text, clean, fingerprint, check for existing audio"]
  B -->|"found, reader current"| Z["Already generated"]
  B -->|"found, reader missing"| R["Publish to reader"]
  B -->|new| C["Submit audio request"]
  C -->|failed| F["Generation failed"]
  C -->|"done, default voice"| V["Check outputs"]
  C -->|"done, Ruth voice on"| T["Recognize speech for word times"]
  T -->|failed| F
  T -->|timed marks| V
  V -->|invalid| F
  V -->|"valid, word check off"| M["Write job record and passage copy"]
  V -->|"valid, word check on"| Q["Recognize and compare words"]
  Q -->|held| H["Held for voice check"]
  Q -->|clear| M
  M -->|"reader publishing on"| R
  M -->|"reader publishing off"| E["Record metrics, done"]
  R -->|failed| RF["Publication failure recorded"]
  R -->|new audio| E
  R -->|existing audio| G["Done, no metrics"]
```

## How it connects

[Passage intake](passage-intake.md) is where the workflow starts. [Generative voice setting](generative-voice-setting.md), [Heard versus written check](heard-versus-written-check.md), and [Publish to reader](publish-to-reader.md) each explain one of the branches.

## Where it stands

The stack builds and its cloud template generates locally. No deployment or run of this version has been seen on the event AWS account, and no person has heard its output there. Local unit tests use stand-in AWS services. The muted reader browser checks cover the site, not this deployed workflow. No target-device trial with sound and a reader was confirmed.

---

## Technical details

`bin/sound-along.ts` creates `SoundAlong-<env>`; `lib/sound-along-stack.ts`, `lib/quality-gate.ts`, and `lib/passage-service.ts` define the resources. The stack includes three private S3 buckets, CloudFront with origin access control for the frontend bucket, a DynamoDB job table, Python Lambdas, Step Functions, an HTTP browser API, and a CloudWatch validation dashboard. `passageApi=true` adds a separate IAM REST API. The source-file notification is S3 to Lambda to Step Functions, despite the README architecture sketch's EventBridge wording.

| Setting | Default | Effect |
| --- | --- | --- |
| `env` / `SOUND_ALONG_ENV` | `sandbox` | Stack name and removal policy; `local`/`sandbox` destroyable, other names retain buckets and table. |
| `soundAlong.voiceId` | `Joanna` | Default Polly voice and hash input. |
| `soundAlong.engine` | `neural` | Polly engine and cost rate. |
| `soundAlong.language` | `en-US` | Language and hash input. |
| `generativeVoice` | off | Exact context string `true` selects Ruth/generative and Transcribe timing; requires `en-US`. |
| `qualityGate` | off | Exact context string `true` adds heard-word check and hold path. |
| `readerBridge` | on | Exact context string `false` removes reader publication. |
| `passageApi` | off | String `true` or boolean true adds signed REST intake. |
| `apiSourceBucket` | unset | Optional extra source bucket, used with passage API. |
| AWS account | `CDK_DEFAULT_ACCOUNT` | Account from CDK environment; no account is fixed in code. |
| AWS region | `CDK_DEFAULT_REGION` or `us-east-1` | Stack deployment region. |

The default workflow timeout is 15 minutes; quality gate or generative voice makes it 30. Polly is polled every five seconds; Transcribe every ten. The browser API has open CORS, including `/generate` and `/jobs`; production identity and private content access are not built. The validation design's volunteer track, approval console, and catalog-scale distributed map are ideas, not part of this stack. Run `npm run build` and `npm run synth` locally to check types and template generation.

---

Previous: [Send a passage API](send-a-passage-api.md) · [Spec home](README.md) · Next: [Deploy and smoke test](deploy-and-smoke-test.md)
