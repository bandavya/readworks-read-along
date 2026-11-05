# AWS stack and settings

*What cloud pieces and switches make up the audio pipeline?*

Making the audio · Status: built and tested locally

Sound Along runs as one package in Amazon's cloud. It holds a store for passages, a store for recordings, the reader website, a job table, and the audio workflow. When a file lands in the passage store, a chain of small tasks runs. They read the text, check whether its audio already exists, make a new recording if needed, check it, and publish the result. The passage and recording stores stay private. The reader site is served through a public delivery network.

The ordinary setup uses the Joanna voice and publishes to the reader. Optional switches add the Ruth voice, a check of heard words, pronunciation-guide clips in the passage voice, and a signed submission service. The voice and check switches change the workflow itself. The submission service changes only how a passage can enter. A cached job can skip generation, and a held or failed job stops before publishing.

It helps to record which switches each deployment used, so a content teammate can tell how a passage was made.

**The switches are deployment choices, and the default path is neural audio, structural checks, and reader publication.**

Follow the blue line for the default path. Each dashed box is added by a switch:

![The audio workflow left to right, with dashed boxes for the switches, an amber box where a take waits for a person, and gray boxes for other endings](shots/fig-aws-stack.svg)

## How it connects

[Passage intake](passage-intake.md) is where the workflow starts. [Generative voice setting](generative-voice-setting.md), [Heard versus written check](heard-versus-written-check.md), and [Publish to reader](publish-to-reader.md) each explain one of the branches.

## Where it stands

The team reports that `SoundAlong-alex` was deployed from CDK to the event AWS account in `us-west-2`, with Ruth (`generativeVoice=true`), `qualityGate` and the reader bridge on, and `passageApi` off. The team reports five passages generated through the pipeline, CloudFront delivery, and a repeated passage that avoided regeneration. Direct S3 access returned 403 in an earlier check. The site is public to anyone with its address, the legacy `/generate` route can start paid runs without credentials, and there is no human approval before generated audio can reach students. A team member has clicked through the live site by hand many times and listened to a one-minute demo, which sounded good to them. A full listening review isn't recorded. A trial on a target device with sound isn't recorded.

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
| `syllableAudio` | on only with `generativeVoice` | Exact context string `false` turns off passage-voice Words to know audio; the default Joanna bundle uses older clips. |
| `readerBridge` | on | Exact context string `false` removes reader publication. |
| `passageApi` | off | String `true` or boolean true adds signed REST intake. |
| `apiSourceBucket` | unset | Optional extra source bucket, used with passage API. |
| AWS account | `CDK_DEFAULT_ACCOUNT` | Account from CDK environment; no account is fixed in code. |
| AWS region | `CDK_DEFAULT_REGION` or `us-east-1` | Stack deployment region. |

The team's build doc describes guide audio as on with generative voice. The code also grants Polly permission to the bridge whenever `generativeVoice` is on, even if `-c syllableAudio=false`; permission therefore outlasts that switch. The default workflow timeout is 15 minutes; quality gate or generative voice makes it 30. Polly is polled every five seconds; Transcribe every ten. The browser API has open CORS, including `/generate` and `/jobs`; the team reports that `/generate` can start paid runs without a credential. The site has no sign-in, while direct S3 access returned 403 in an earlier check. The validation design's volunteer track, approval console, and catalog-scale distributed map are ideas, not part of this stack. Run `npm run build` and `npm run synth` locally to check types and template generation.

---

Previous: [Send a passage API](send-a-passage-api.md) · [Spec home](README.md) · Next: [Deploy and smoke test](deploy-and-smoke-test.md)
