# Sound Along — AWS vertical slice

A browser-based read-along reading experience, built as a two-day hackathon
vertical slice from `Sound_Along_AWS_Compatible_Technical_Design.docx`.

It generates natural-sounding audio and word-level timing for short passages
with **Amazon Polly**, stores assets privately in **S3**, delivers them through
**CloudFront**, and plays them in a **unified Vue player** with synchronized
word highlighting, tap-to-replay, speed controls, and accessible keyboard
operation. Student-specific access is modeled with mock assignment records.

## Architecture

```
Content JSON (S3) ──► EventBridge/S3 notification ──► Step Functions
                                                          │
   LoadPassage ► NormalizeText ► ComputeTextHash ► CheckExistingManifest
        │ (new)                                             │ (cached → skip)
        ▼
   SubmitPollyAudio + SpeechMarks ► Wait ► CheckStatus ► ValidateOutputs
        │
   WriteManifest ► PublishDemoJson ► EmitMetrics
        │
   Private S3 (MP3 + speech marks) ──► CloudFront (OAC) ──► Vue player
```

| Layer | Service |
|-------|---------|
| IaC | AWS CDK v2 (TypeScript) |
| Content / audio / frontend storage | Amazon S3 (private, OAC) |
| Delivery | Amazon CloudFront |
| TTS orchestration | AWS Step Functions |
| Workers | AWS Lambda (Python 3.12) |
| Text-to-speech | Amazon Polly (async synthesis + speech marks) |
| Job state | Amazon DynamoDB |
| Browser API | API Gateway HTTP API + Lambda |
| Metrics/logs | Amazon CloudWatch |

## Project layout

```
bin/            CDK app entrypoint
lib/            SoundAlongStack (all AWS resources)
lambdas/
  worker/       Step Functions task handlers (Python)
  trigger/      S3 → Step Functions starter
  api/          Browser API handler
frontend/       Compiled Vue 3 app shell and separately managed media
demo-data/      3 public-domain-style passages + mock assignment record
scripts/        seed / generate / publish-frontend helpers
```

## Frontend source and builds

`frontend-src/` is the Vue/Vite source and test harnesses. Run `npm run build:frontend`
from the repo root to rebuild `frontend/index.html` and `frontend/assets/` with relative
URLs; the command replaces stale assets and leaves `frontend/data/`, `audio/`, `img/`,
and `look-art/` alone. Commit the rebuilt shell before running the existing
`scripts/publish-frontend.js`. Run `npm run test:frontend` for local Node harnesses;
checks needing uncommitted ReadWorks media print `SKIP` when it is absent. For a
local preview, serve `frontend/` with your own licensed media linked in.

All Vite settings are optional build-time `VITE_*` environment variables. With
none set, external API features are off and media uses relative paths:

- `VITE_API_BASE`: base URL for optional assignments, feedback, and review API.
- `VITE_HOLDS_API`: base URL for the optional held-narration panel.
- `VITE_PUBLISHED_DATA_BASE`: alternate published passage index/document base.
- `VITE_CONTENT_ASSET_BASE`: alternate audio/timing asset base; otherwise uses the published data base.
- `VITE_DATA_OPTIONS`: comma-separated local usage events to keep; empty keeps none.
- `VITE_BUDDY`: default reading buddy; empty leaves selection to the reader.
- `VITE_SHOWCASE=1`: starts the showcase theme view and hides working notes.
- `VITE_PUBLIC_SAMPLE=1`: uses the silent public sample mode and disables the optional API calls.

## Frontend media (not in git)

The read-along app's media — `frontend/audio/`, `frontend/data/`, `frontend/img/`,
and `frontend/look-art/` — is **not committed to git**. It is large and
ReadWorks-licensed, so it lives only in the sandbox: served to the browser from
the frontend S3 bucket via CloudFront, and backed up as a tarball in the content
S3 bucket under `media/`.

Git tracks only the code and the compiled app shell (`frontend/index.html` +
`frontend/assets/`). To restore the media into a fresh clone, pull it from S3:

```bash
# from the content bucket media backup
aws s3 cp s3://<ContentBucketName>/media/frontend-media.tgz - | tar xz -C frontend
# …or directly from the live frontend bucket
aws s3 sync s3://<FrontendBucketName>/audio frontend/audio
aws s3 sync s3://<FrontendBucketName>/data  frontend/data
aws s3 sync s3://<FrontendBucketName>/img   frontend/img
```

## Prerequisites

- Node.js 18+ (tested on 24), npm
- AWS CDK v2, AWS CLI configured for a sandbox account
- Python 3.12 runtime is used by Lambda (handled by CDK bundling)

## Deploy (sandbox)

```bash
npm install
npm run build            # type-check the CDK app
cdk bootstrap            # first time in the account/region
npm run deploy           # cdk deploy --all

# capture outputs: ContentBucketName, FrontendBucketName, ApiUrl, DistributionDomain, StateMachineArn

# publish the frontend with real, environment-specific config
node scripts/publish-frontend.js \
  --frontend-bucket <FrontendBucketName> \
  --api <ApiUrl> \
  --cdn <DistributionDomain>

# seed passages (uploading passages/*.json auto-starts generation)
node scripts/seed.js --bucket <ContentBucketName>

# (optional) manually (re)generate one passage
node scripts/generate.js --arn <StateMachineArn> --passage demo-passage-001

# open https://<DistributionDomain>/
```

## Reader bridge (optional)

On a fresh deployment, deploy with `npx cdk deploy -c readerBridge=true --all`,
publish the static frontend with
`node scripts/publish-frontend.js --frontend-bucket <FrontendBucketName>`, then
seed or generate passages. The `PublishToReader` task
copies validated Polly audio and writes `data/<id>.json` and `data/index.json`
after `PublishDemoJson`; the default stack omits this task. A failed word match
stops at `ReaderPublishFailed`, with the reason in the job table. To disable it,
deploy without `-c readerBridge=true`. A later frontend publish merges live
`data/index.json` rows into a local index. Older local `data/<id>.json` files
can still replace generated documents, so publish local media before generation.

## Voice quality gate (optional)

GPT-6's suggestion, unruled by Alex: use `npx cdk synth -c readerBridge=true -c qualityGate=true`
to inspect the gate, or deploy with both flags when authorized. The gate is off by
default. After `ValidateOutputs`, it asks Amazon Transcribe what words the new
MP3 contains. A clean word match continues to publishing; a swap, omission, or
extra phrase ends at `HeldForVoiceCheck`. Polly speech marks still supply all
reader timing. A held take never reaches `PublishToReader`, so an existing reader
voice stays in place.

Read a hold's reasons in `s3://<ContentBucketName>/review/<passageId>.json` or
the job table's `holdReasons` and `reviewKey` fields. A passed machine check is
recorded as `generated` with `needs human check`; it does not imply a person
listened. A review object records the last held take; after a rerun, check the
job row's current status before acting on an older hold. To accept a known
recognition spelling for a name, upload a complete
`{"names":[{"written":"Mira","heard_as":["Meera"],"scope":"<passageId>"}]}`
list to `config/names.json` in the content bucket, then rerun generation. The
packaged list is empty. There is no release action in this lane: a person fixes
the names list or reruns the passage. Disable the gate by omitting
`-c qualityGate=true`; removing `lib/quality-gate.ts` and
`lambdas/quality_gate/` then removes its implementation.

## Destroy (after confirming cleanup is permitted)

```bash
npm run destroy          # cdk destroy --all
```

## Local preview (no backend)

Serve `frontend/` with a static server and local passage data linked in. With no
`VITE_API_BASE` set, the Vue reader renders the UI and controls for a local
preview. Audio playback requires a real generation run.

## How the design maps to the code

- **Deterministic hashing + dedup (T10):** `compute_hash` + `check_existing_manifest`.
- **Async Polly + speech marks (6.3):** `submit_polly` / `check_polly` with retry/backoff.
- **Backward-compatible `au` field (5.3):** `publish_demo_json` writes `au`.
- **Unified player (7):** `frontend-src/src/soundAlong.js` and `frontend-src/src/components/PlayerBar.vue` share the player for human and synthetic audio.
- **Tap-to-replay (7.1 / T07):** `replayFromWord` seeks to the word's speech-mark time.
- **Student access (7.2 / T08):** `/passages/{id}/access` reads the mock assignment record.
- **Private delivery (9 / T13):** S3 Block Public Access + CloudFront OAC; origins stay private.
- **No hard-coded prod URLs (5.3 / 10):** frontend config is generated at deploy time.

## Cost model (section 13)

Metrics are emitted to CloudWatch namespace `SoundAlong`
(`CharactersSubmitted`, `AudioBytes`, `WordMarks`, `GenerationsCompleted`).
The workflow estimates cost at ~$4 / million characters as a hackathon input —
verify current Amazon Polly pricing before any production commitment.

## Not included (hackathon non-goals)

Full catalog generation, ReadWorks production integration, teacher analytics,
full Spanish support, production identity, and an AI evaluator agent.
```
