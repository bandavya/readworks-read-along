# Sound Along — project steering

Always-on context for this repo. Keep it short and factual. Full detail is in `docs/SPEC.md`
(final), `README.md`, and the other `docs/`. If something here conflicts with the deployed
system, trust the system and fix this file.

## What this is

A browser read-along reader for short reading passages: the student sees the text, hears it read
aloud, and each word highlights as it is spoken. A pronunciation guide ("Words to know") plays
each vocabulary word by syllable in the same voice as the passage. The reader opens in **focused
mode** (one simple reader in ReadWorks colours/fonts); an **All features** button reveals themes,
extra tools, a paged kid view and a teacher demo.

Hackathon vertical slice for ReadWorks. Greenfield in an empty AWS sandbox; no ReadWorks
production integration.

## Architecture (one line)

`passages/<id>.json` in S3 → S3 event → Step Functions → Amazon Polly (audio) + Amazon Transcribe
(word timing for the generative voice) → reader bridge writes `data/`, `audio/`, `data/index.json`
into the frontend bucket → CloudFront serves the Vue reader.

Stack: AWS CDK v2 (TypeScript). Lambdas: Python 3.12. Frontend: Vue 3 + Vite source in
`frontend-src/`, compiled shell in `frontend/`.

## Repo layout

- `bin/`, `lib/` — CDK app and the single `SoundAlongStack`.
- `lambdas/` — `worker`, `generative_voice`, `quality_gate`, `reader_bridge`, `syllable_audio`,
  `passage_service`, `api`, `trigger` (Python).
- `frontend-src/` — Vue source (edit here). `frontend/` — the built shell + media (media not in git).
- `scripts/` — `build-frontend.js`, `publish-frontend.js`, `seed.js`, `generate.js`.
- `docs/` — `SPEC.md` (final), `API.md`, `COST.md`, `BUILD_PLAN.md`, `EVALUATION_PLAN.md`,
  `PARKING_LOT.md`, `openapi.yaml`.

## Deploy modes (CDK context flags)

- `env` — stack suffix; `SoundAlong-<env>`. The live demo is `env=alex` (`SoundAlong-alex`).
- `generativeVoice=true` — Polly **generative Ruth**, word timing from Transcribe. The live
  `alex` stack runs with this on.
- `qualityGate=true` — Transcribe word-match check; a mismatch holds at `HeldForVoiceCheck`.
- `readerBridge` (default true) — publish generated passages into the reader.
- `syllableAudio` (on with generative) — pronunciation-guide audio in the passage voice. Only
  effective with `generativeVoice`, because it needs the whole `lambdas/` bundle.
- `passageApi=true` — IAM-signed `POST/GET /v1/passages`. Not on the live `alex` stack.

Live deploy command: `npx cdk deploy SoundAlong-alex -c env=alex -c generativeVoice=true`.

## Conventions

- **Edit the Vue source in `frontend-src/`, never the compiled `frontend/assets/`.** After a
  change run `npm run build:frontend`, then publish. Commit the rebuilt shell.
- Lambda code is plain Python 3.12 with boto3; keep third-party imports minimal. `audio_check.py`
  reads MP3 duration by parsing MPEG frames — there is **no ffmpeg layer**; join MP3s by
  concatenating frames.
- Reader data contract: `data/<uuid>.json` with `sa-w` word spans, `voices[].t` timing (the reader
  plays the saved voice, then the human voice, then `voices[0]`), `vocab`, and, when guide generation succeeds, a matching
  `data/syllables/<uuid>.json`.
- uuids are derived from `passageId`; vocab sense IDs must match across the passage HTML, `vocab`,
  and the syllable data or the guide won't connect.

## Gotchas (these have bitten us)

- **Do not run a local `cdk deploy` while a Step Functions generation run or another deploy is in
  progress** — CloudFormation rejects concurrent updates.
- **Regenerating with a different voice can stack it onto the old one** (the bridge replaces a voice with the same ID and keeps others).
  To truly switch voice, delete the passage's generated `data/`, `audio/<pid>/`, syllable files
  and its DynamoDB job rows first, then re-run, so the new voice is `voices[0]`.
- **The library index is not pruned on delete** — entries are replaced per uuid on regeneration.
  Verify the index is consistent after bulk changes.
- **The earlier `sound-along` build (CodeCommit) had a self-deploying CI pipeline that could delete
  itself.** This `alex` build has no such pipeline; don't reintroduce one without the always-on fix.
- CloudFront caches aggressively; invalidate `data/*`, `assets/*` after publishing and expect a
  short settle before changes show.

## Safety and content rules

- **ReadWorks passages and recordings are ReadWorks' material**, used for this prototype. Audio and
  images are gitignored because they're large; they live in S3 (`frontend/audio|data|img|look-art`).
- **Generated audio and pronunciation entries are drafts** ("needs human check"). There is no human
  approval gate before the reader shows them. Never claim a check that didn't happen; say what was
  verified vs not. Browser checks run muted, so audio quality is unverified by ear.
- **Children are the users.** No child testing without ReadWorks' own process; evaluation ratings
  are adults only.
- The CloudFront URL is public with no auth (default-cert TLS 1.0). Treat it as unprotected.
- No secrets in the repo, commits, or chat. Use sandbox credentials only; confirm the account with
  `aws sts get-caller-identity` before anything billable, and say the cost before billable work.

## Git

- Repo: `github.com/bandavya/readworks-read-along`. The current build is on `master`. Never force-push a shared branch.
