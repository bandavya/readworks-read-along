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
frontend/       Static Vue 3 app (no build step)
demo-data/      3 public-domain-style passages + mock assignment record
scripts/        seed / generate / publish-frontend helpers
```

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

# seed passages (uploading passages/*.json auto-starts generation)
node scripts/seed.js --bucket <ContentBucketName>

# (optional) manually (re)generate one passage
node scripts/generate.js --arn <StateMachineArn> --passage demo-passage-001

# publish the frontend with real, environment-specific config
node scripts/publish-frontend.js \
  --frontend-bucket <FrontendBucketName> \
  --api <ApiUrl> \
  --cdn <DistributionDomain>

# open https://<DistributionDomain>/
```

## Destroy (after confirming cleanup is permitted)

```bash
npm run destroy          # cdk destroy --all
```

## Local preview (no backend)

Serve the `frontend/` folder with any static server. With no `apiBaseUrl`
configured, `mock-data.js` renders the UI, access gating, and controls so you
can validate the experience before deploying. Audio playback requires a real
generation run.

## How the design maps to the code

- **Deterministic hashing + dedup (T10):** `compute_hash` + `check_existing_manifest`.
- **Async Polly + speech marks (6.3):** `submit_polly` / `check_polly` with retry/backoff.
- **Backward-compatible `au` field (5.3):** `publish_demo_json` writes `au`.
- **Unified player (7):** `frontend/player.js` — one component for human + synthetic audio.
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
