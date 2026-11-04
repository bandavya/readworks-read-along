# Sound Along: build specification

> Note: this spec describes the earlier `sound-along` build (CodeCommit, stack
> `SoundAlong-sandbox`, compiled-only frontend). This repo is the `alex` build, which has the
> Vue source in `frontend-src/`, focused mode, a voice quality gate, generative-voice and
> reader-bridge paths. Treat the architecture, pipeline and data-contract sections as broadly
> accurate for both builds; treat specific file paths, the CI/CD pipeline and the API details as
> belonging to the other build. The authoritative docs for this build are its README, `docs/API.md`
> and `docs/COST.md`.

Status as of 2026-11-04. Describes what is built and deployed in the event sandbox
(region `us-west-2`, stack `SoundAlong-sandbox`).
Source design: `Sound_Along_AWS_Compatible_Technical_Design.docx`.

Statements marked **Verified** were checked against the running system. Statements marked
**Not verified** were not checked. Nothing here has had a child, teacher or ReadWorks reviewer
use it, and no one has judged the sound by ear.

---

## 1. Purpose and scope

A read-along experience for short reading passages: the student sees the text, hears it read
aloud, and sees each word highlighted as it is spoken.

The build has three parts:

1. **Generation pipeline.** A passage JSON uploaded to S3 becomes audio plus word timing, using
   Amazon Polly, orchestrated by Step Functions.
2. **Reader app.** A pre-built Vue app (the "reference" UX) served by CloudFront. Its code is
   compiled; there is no readable source in this repo.
3. **CI/CD.** A push to CodeCommit `main` deploys the stack and the app shell.

### Built

| Area | State |
|---|---|
| CDK stack (S3, CloudFront, DynamoDB, Lambda, Step Functions, API Gateway, CI/CD) | Deployed |
| Passage text to Polly audio and speech marks | Deployed, 4 passages generated |
| Generated passages shown in the reader app (library, highlight, vocab) | Deployed |
| Dedup of unchanged passages | Deployed |
| CodeCommit repo, CodePipeline, CodeBuild | Deployed, push-triggered |
| Browser API (`/passages`, `/access`, `/jobs`, `/generate`) | Deployed, **not used** by the reader app |
| Passage service: IAM-signed `POST /v1/passages` and `GET /v1/passages/{id}` (see `docs/API.md`) | Deployed, tested with signed calls |

### Deferred or out of scope (from the design doc non-goals and later decisions)

Full catalog generation (6,893 passages), ReadWorks production integration, human-audio
alignment, teacher analytics, Spanish support for generation, production identity, an AI
evaluator, and the parts of the kit's passage service that need a publication gate or SNS (section 7.1).

---

## 2. Architecture

```
                      git push
  Developer ─────────────────────► CodeCommit (main)
                                        │ EventBridge
                                        ▼
                                  CodePipeline (V2)
                                        │
                                  CodeBuild: npm ci, tsc, cdk deploy,
                                  publish app shell, invalidate CDN
                                        │
                                        ▼
                        ┌───────────────────────────────┐
                        │      SoundAlong-sandbox       │
                        └───────────────────────────────┘

  passages/<id>.json ─► Content bucket ─► S3 event ─► Trigger Lambda ─► Step Functions
                                                                            │
   LoadPassage ► NormalizeText ► ComputeTextHash ► CheckExistingManifest ─ cached ─► done
        │ new
        ▼
   SubmitPollyAudio (audio task + speech-marks task) ► Wait 5s ► CheckPollyStatus ┐
        ▲                                                           running       │
        └───────────────────────────────────────────────────────────────────────┘
        │ completed
        ▼
   ValidateOutputs ► WriteManifest ► PublishDemoJson ► PublishReaderData ► EmitMetrics

   PublishReaderData ──► Frontend bucket: audio/, data/<uuid>.json, data/index.json
                                  │
   Browser ◄── CloudFront (OAC, HTTPS) ◄──────┘     (Polly output lives in the Audio bucket)
```

---

## 3. Environment and resources

One CDK stack, `SoundAlong-<env>` (`sandbox` by default; `env` context or `SOUND_ALONG_ENV`).
Removal policy is DESTROY for `sandbox` and `local`, RETAIN otherwise. Region comes from
`CDK_DEFAULT_REGION` (default `us-east-1` in code; the sandbox runs in `us-west-2`).

| Resource | Purpose |
|---|---|
| Content bucket | Input passages, mock assignments, manifests, backups |
| Audio bucket | Raw Polly output and canonical MP3 + speech marks |
| Frontend bucket | Everything the browser loads (app shell, data, audio, images) |
| CloudFront distribution | Only public entry point; one origin (Frontend bucket) via OAC |
| DynamoDB table `JobTable` | Job state and the source of truth for the library index |
| 11 worker Lambdas + trigger + API Lambda | Python 3.12, 256 MB, 5 min (trigger 1 min, API 15 s) |
| Step Functions state machine | 15 minute timeout, X-Ray tracing, logs to CloudWatch |
| HTTP API (API Gateway v2) | Legacy browser API, CORS `*` |
| CodePipeline, CodeBuild project, artifact bucket, EventBridge rule | CI/CD |

Stack outputs: `ContentBucketName`, `AudioBucketName`, `FrontendBucketName`,
`DistributionDomain`, `DistributionId`, `ApiUrl`, `StateMachineArn`, `JobTableName`.

### Bucket layout

| Bucket | Prefix | Contents |
|---|---|---|
| Content | `passages/` | Input passage JSON. **Uploading here starts generation.** |
| | `content/` | `assignments.json` (mock student access) and published demo JSON |
| | `manifests/` | One audio manifest per passage |
| | `submissions/<id>/` | Passages saved by the passage service. A prefix with **no** S3 trigger, so a submission starts exactly one run |
| | `products/` | Where a pointer submission may read a record from |
| | `media/` | Backup tarball of the reader media |
| | `downloads/` | Zip downloads shared via presigned URLs (see section 8) |
| Audio | `polly/<audioId>/` | Raw Polly task output |
| | `audio/` | `<audioId>.mp3` and `<audioId>.speechmarks.json` |
| Frontend | `index.html`, `assets/` | Compiled reader app shell |
| | `data/` | `index.json`, `index.base.json`, `<uuid>.json`, plus shipped `gloss/`, `syllables/`, `bundles/`, `kid_audio.json` |
| | `audio/`, `img/`, `look-art/` | Shipped recordings, images, art; plus generated `<uuid>-generated.mp3` |
| | `timing/` | Generated `<uuid>.<digest>.v1.zip` word-timing files for the passage service |

---

## 4. Generation pipeline

**Trigger:** S3 `ObjectCreated` on `passages/*.json` in the Content bucket calls the trigger Lambda,
which starts one execution with `{passageId, key}`. An execution can also be started with
`scripts/generate.js` or `POST /generate`.

**Input passage** (`demo-data/passages/*.json`):

```json
{
  "passageId": "demo-passage-001",
  "title": "A Very Small Garden",
  "gradeBand": "2-3",
  "lexile": 430,
  "language": "en-US",
  "text": "Paragraph one.\n\nParagraph two.",
  "authors": ["optional"],
  "vocabulary": [{"word": "color", "definition": "...", "example": "", "pos": "", "spanish": ""}],
  "questions": [],
  "soundAlong": {"enabled": true, "audioAccess": "assignment"}
}
```

Paragraphs are separated by a blank line. `authors`, and the vocabulary fields other than
`word` and `definition`, are optional.

### States and workers (`lambdas/worker/handler.py`)

| # | State | Function | What it does |
|---|---|---|---|
| 1 | LoadPassage | `load_passage` | Reads the passage JSON; carries title, authors, grade, Lexile, vocabulary |
| 2 | NormalizeText | `normalize_text` | Splits paragraphs; builds `ttsText` (title, optional byline, body) |
| 3 | ComputeTextHash | `compute_hash` | SHA-256 of `ttsText`, voice, engine, language and `FORMAT_VERSION` |
| 4 | CheckExistingManifest | `check_existing_manifest` | Approved record with same hash means skip; else writes a `running` record |
| 5 | SubmitPollyAudio | `submit_polly` | Starts two async Polly tasks: MP3, and JSON speech marks (word + sentence). Retries 4 times, 2 s backoff x2 |
| 6 | WaitForCompletion / CheckPollyStatus | `check_polly` | Polls every 5 s; on completion records Polly output keys |
| 7 | ValidateOutputs | `validate_outputs` | MP3 at least 1000 bytes; at least one word mark; sets `valid` |
| 8 | WriteManifest | `write_manifest` | Copies MP3 to canonical key, stores marks as one JSON array, writes manifest and DynamoDB record (`approved`), drops marks from state |
| 9 | PublishDemoJson | `publish_demo_json` | Writes `content/<id>.json` with the legacy `au` field (used by the legacy API only) |
| 10 | PublishReaderData | `publish_reader_data` | Writes reader audio, passage file, timing ZIP and library index (section 5) |
| 11 | EmitMetrics | `emit_metrics` | CloudWatch namespace `SoundAlong`: `CharactersSubmitted`, `AudioBytes`, `WordMarks`, `GenerationsCompleted`; cost estimate at $4 per million characters |

Terminal states: `AlreadyGenerated` (cache hit), `GenerationComplete`, `GenerationFailed`
(Polly failed or validation failed).

**Voice:** Amazon Polly `Joanna`, `neural`, `en-US`, set in `cdk.json` context `soundAlong`.

**Dedup rule:** same `ttsText`, voice, engine, language and `FORMAT_VERSION` returns a cache hit and
no Polly call, **provided the record is `approved` and has a `readerUuid`** (the reader files were
published). Changing `FORMAT_VERSION` in `reader_format.py` forces regeneration.
**Verified:** a re-run of a published passage returned `cached: true`.

**Why `readerUuid` is part of the rule:** the record turns `approved` when the manifest is written,
which is before the reader publish step. A run that failed between the two used to be treated as a
cache hit on retry and skipped, so it could never recover. Found by the passage-service failure test and fixed.

**Retry of a failed job:** start a new execution for the passage (`POST` the same request to the
passage service, or `scripts/generate.js`). **Verified:** a job that failed in `PublishReaderData`
re-ran on retry (executions went from 18 to 19) and failed again for the same reason; the same id
with fixed text then published.

**Failure guard:** if fewer than 90% of the words match Polly speech marks, `PublishReaderData`
raises and the execution fails rather than publishing bad timing. **Verified** with text that has no speakable words.

**Step Functions state:** `textSha256` (SHA-256 of the submitted text) is recorded on job records;
the raw text and a normalized copy are not carried in state.

---

## 5. Reader data format

The reader app loads three kinds of file. `reader_format.py` produces them from the passage and
Polly's speech marks. It has no AWS calls.

### 5.1 Identifiers

The app requires a UUID in each passage URL. The UUID is derived, not random:
`uuid5(NAMESPACE_URL, "soundalong:" + passageId)`. Example: `demo-passage-001` becomes
`a3743af1-e0f3-51b0-b8cf-9472ae4d2685`. The original id is kept as `sourceId`.

### 5.2 Text sent to Polly

```
<title>.          (a period is added unless the title already ends in . ? ! :)
by <authors>.     (only if authors are given)
<paragraph 1>

<paragraph 2>
```

Every display word keeps its UTF-8 **byte** range in this string, the same unit Polly uses in
speech marks.

### 5.3 `data/<uuid>.json`

| Field | Value |
|---|---|
| `uuid`, `sourceId`, `title`, `authors`, `lang`, `grade`, `lexile` | From the passage. `grade` is the first part of `gradeBand` (`2-3` gives `2`); `lang` is `EN` for `en-US` |
| `wordcount`, `words` | Body word count |
| `title_words`, `by_words` | The reader builds the title and byline itself from these |
| `html` | `<p>` per paragraph; each word is `<span class="sa-w" data-i="N">` (N starts at 0 in the body) |
| `voices[0]` | `id: "generated"`, label, `audio: "audio/<uuid>-generated.mp3"`, `lead`, `t`, `source` |
| `vocab` | Map of sense id to `{word, definition, example, pos, spanish, say}` |
| `credit` | States the text is synthetic and the audio is unreviewed |

Timing arrays hold `[start_seconds, end_seconds, 0]`. `lead` has one entry per title and byline
word; `t` has one entry per body word. The third value is a flag; the shipped data uses `0` for
almost every word, and so does the generator.

### 5.4 Timing rules

- Each Polly **word** mark is assigned to the display word whose byte range contains the mark's
  start offset. A word's start is its earliest mark.
- Words with no mark (for example a lone `&`) are interpolated between neighbours.
- Fewer than 90% matched raises an error and the execution fails, rather than publishing bad timing.
- End time is the next word's start. The last word ends at the estimated audio length, capped at 1.5 s
  after its start. Audio length is estimated from file size: 48 kbps for neural, generative and
  long-form voices, 32 kbps for standard.
- Before a pause (last word of the title, byline or a paragraph, or a word ending in `. ! ?`),
  the end is capped at `start + 0.12 s + 0.07 s per letter`, so the highlight does not hold through silence.
- Start times are forced to be non-decreasing.

### 5.5 Vocabulary

Each vocabulary word links to its **first** occurrence (exact match, or plus `s` / `es`), by
wrapping the word span in `data-vocab-sense-id`. Trailing punctuation is placed outside the
span. Vocabulary words that never appear in the body are left out.
The sense id is derived from `sha1(uuid:word)` so it is stable across regenerations.

### 5.6 `data/index.json` (library)

Entry: `{uuid, title, grade, lexile, lang, words, voices: ["generated"]}`.

The pipeline owns this file. It is built as:

> shipped catalog (`data/index.base.json`) + every approved passage with an `indexEntry` in DynamoDB

- `index.base.json` is saved automatically from the first `index.json` it finds.
- Newest record wins per uuid; generated entries replace shipped ones with the same uuid.
- Concurrent executions: after writing, each execution re-reads DynamoDB and the S3 file and rewrites
  if its published entries are missing, up to 4 attempts, otherwise the execution fails.
  **Verified:** three executions started together produced 13 entries (9 shipped + 4 generated), none lost.

### 5.7 Caching

Generated JSON and audio are written with `Cache-Control: public, max-age=60`, so new or
regenerated passages appear within about a minute. Shipped hashed assets use a one-year
immutable cache; `index.html` is `no-cache`.

### 5.8 What generated passages do not have

No `gloss/`, `syllables/`, `bundles/` or cover image. The app fetches these optionally and
falls back, so each load logs 403 responses for them. **Verified:** no page errors; the
affected features are simply absent. **Not verified:** Kid view, word-help popups, tapping a
word to seek, and the human voice option for generated passages (there is none).

---

## 6. Delivery (CloudFront)

- One origin: the Frontend bucket, through Origin Access Control (SigV4). Default behavior only.
- `REDIRECT_TO_HTTPS`; `CACHING_OPTIMIZED` policy (default TTL 1 day, honours origin `Cache-Control`); compression on.
- Default root object `index.html`. No custom 403/404 error pages, so a missing file returns a real error.
- All three buckets: Block Public Access on, SSL enforced, S3-managed encryption.
  **Verified:** direct S3 requests to the Audio and Frontend buckets return 403.

---

## 7. Browser API (legacy)

HTTP API at the `ApiUrl` output. Not called by the current reader app; it served the earlier
custom player and remains deployed.

| Route | Behavior |
|---|---|
| `GET /passages` | Lists `content/*.json` (skips `assignments.json`) |
| `GET /passages/{id}` | Returns one published demo JSON plus `cdnDomain` |
| `GET /passages/{id}/access?student=` | Reads `content/assignments.json`; returns `allowed` |
| `GET /jobs` | Scans up to 100 DynamoDB job records |
| `POST /generate` | Starts an execution for `{passageId}` |

The routes above have no authorization; CORS allows every origin. Student identity is mock data.
**Verified:** `student-001` allowed and `student-002` denied for `demo-passage-001`.
The reader app does not use this check, so student-level gating is **not** in effect in the UI.

### 7.1 Passage service (IAM-signed)

| Route | Behavior |
|---|---|
| `POST /v1/passages` | Validates a ReadWorks-shaped record (or a `products/` pointer), saves it under `submissions/<id>/<fingerprint>.json`, starts the state machine. Returns 202 queued, 200 for a request already running or an identical published take (`reused: true`), 400, or 409 |
| `GET /v1/passages/{id}` | Status `queued`, `running`, `published` or `failed` (`held` is reserved, never returned), the word list, and audio / timing / reader links once published |

Full contract, field rules and differences from the kit: `docs/API.md` and `docs/openapi.yaml`.
Client: `scripts/passage-client.sh`. Stack output: `PassageApiUrl`.

- **Auth:** API Gateway IAM authorizer on these two routes only. Callers need `execute-api:Invoke`.
- **Status source:** Step Functions `DescribeExecution`, then a check that the MP3, timing ZIP and reader data exist,
  the voice matches, and the reader word count equals the submitted text. A mismatch is reported as `failed`.
- **Timing file:** `timing/<uuid>.<digest>.v1.zip` containing `timing.v1.json` (`schema_version`, `text`, `lead`, `paras`,
  `t` rows with code 0 heard or 1 filled, `duration`, `checks`, `timing_source`, `text_sha256`).
- **Submission record:** a row in `JobTable` with sort key `api-job` holding the text fingerprint, execution ARN and submission key.
- **Fields kept from a record:** `uuid`, `title`, `text`, `lang` (EN only), `a` / `authors`, `gradeBand` / `grade`, `lexile`, `vocabulary`.
  All else, including `content`, `soundAlong`, `questionSets`, `answers`, `answerHashes`, `answerMapA`, is discarded.
- **Limits:** 1 MiB body, 5,000 words (the kit allows 20,000; this pipeline's state limit is lower).

### DynamoDB `JobTable`

Key: `passageId` (hash) + `textHash` (range). Index `byStatus` on `status` + `updatedAt`.
Attributes: `status` (`running` or `approved`), `voiceId`, `engine`, `charCount`, `textSha256`, `updatedAt`,
`reviewStatus`, `audioKey`, `speechMarksKey`, and after publishing `readerUuid`, `indexEntry` and `timingKey`.
The passage service adds one row per id with `textHash = "api-job"` (status `queued`, `textSha256`, `executionArn`,
`submissionKey`, `submittedAt`). On-demand billing.

---

## 8. Security and access

| Topic | State |
|---|---|
| Private storage | All buckets private; CloudFront is the only reader of the Frontend bucket |
| **Public app URL** | **The CloudFront URL is open to anyone who has it.** `noindex, nofollow` is set, but there is no authentication. Options discussed: disable the distribution, basic auth via CloudFront Function, IP allowlist with WAF, signed URLs. None applied |
| IAM | Per-function grants from CDK. Polly actions use resource `*` (Polly has no resource-level scoping for these); `cloudwatch:PutMetricData` is `*` |
| CI/CD role | Can assume `cdk-*` bootstrap roles, `cloudformation:DescribeStacks`, read/write the Frontend bucket, create CloudFront invalidations |
| Secrets | None in the repo. Git auth uses the instance role through the CodeCommit credential helper |
| ReadWorks content | Shipped passages, recordings and images are ReadWorks material "used only in a private prototype" (per the data's credit line). Kit guidance: fine on the event AWS account, ask before putting in a public repo |
| Media in zips | `downloads/sound-along-full.zip` in the Content bucket contains the licensed media and has had presigned URLs issued (7 day expiry). Delete it when no longer needed |
| Generated audio review | The pipeline marks output `approved` / `sampled` automatically. There is **no human approval gate**; treat generated audio as a draft |

---

## 9. CI/CD

```
CodeCommit sound-along / main ─(EventBridge)─► CodePipeline "SoundAlong-sandbox" (V2)
   Source ─► BuildAndDeploy (CodeBuild, STANDARD_7_0, SMALL, 30 min)
```

`buildspec.yml`: install (Node 20, Python 3.12, `npm ci`), `tsc --noEmit`, `cdk deploy`,
`publish-frontend.js`, then invalidate `/index.html` and `/assets/*` only if the build succeeded.

- **The pipeline is always part of the stack.** The pipeline deploys its own stack. If it is left
  out of a synthesis, the deploy deletes the pipeline mid-run. This happened once and is why
  the pipeline is unconditional.
- **Code only:** the repo has no media, so CI publishes only `index.html` and `assets/`. Media,
  `data/` and generated files in the bucket are never overwritten or deleted by CI.
- **Do not run a local `cdk deploy` while a pipeline run is in progress.** CloudFormation rejects
  concurrent updates.
- **Not in git, so not in CI:** a deploy from CI reflects only what is pushed. Local, unpushed
  stack changes are reverted by the next CI deploy.
- **Verified:** manual start, and push-triggered runs, both succeeded.
- Pipeline artifacts expire after 30 days.

---

## 10. Source control and media

- Repo: CodeCommit `sound-along`, branch `main`, private to the account. Local remote name `codecommit`;
  credential helper configured in the repo's local config.
- Tracked: CDK (`bin/`, `lib/`), Lambdas, scripts, demo data, `buildspec.yml`, app shell
  (`frontend/index.html`, `frontend/assets/`), docs.
- Not tracked (`.gitignore`): `node_modules/`, `cdk.out/`, and `frontend/audio|data|img|look-art/`
  (about 52 MB of licensed media). It is served from the Frontend bucket and backed up at
  `s3://<ContentBucket>/media/frontend-media.tgz`. The README explains how to restore it.
- Restoring a fresh environment: deploy the stack, restore media into the Frontend bucket, then generate
  passages; the first generation saves `index.base.json` from the restored `index.json`.

---

## 11. Operations

```bash
npm install
npm run build                    # tsc type-check
cdk bootstrap                    # first time per account/region
npm run deploy                   # cdk deploy --all
node scripts/seed.js --bucket <ContentBucket>              # uploads passages; starts generation
node scripts/generate.js --arn <StateMachineArn> --passage demo-passage-001
node scripts/publish-frontend.js --frontend-bucket <FrontendBucket>   # needs local media; skips an existing data/index.json
npm run destroy                  # only after confirming cleanup is permitted
```

Logs: CloudWatch (Lambda, Step Functions, CodeBuild). Metrics: namespace `SoundAlong`.
Cost model: about $4 per million characters for Polly (from the design doc; confirm current pricing).
Each demo passage is 200 to 400 characters.

---

## 12. Verification status against the design's tests

| Test | Result |
|---|---|
| T01 Deploy from clean sandbox with CDK | Verified (no console configuration) |
| T02 Upload mock passage | Verified |
| T03 Generate audio and manifest | Verified |
| T04 Speech marks reference the text | Verified (all words matched in 4 of 4 passages) |
| T05 Play through the unified player | Partly: the reader app loaded the audio and its clock ran 0:00 to 0:13 in a headless browser. Sound not heard |
| T06 Highlight within tolerance | Partly: highlight advanced word by word following the timing data. Tolerance not agreed or measured against the sound |
| T07 Tap a word to replay | Not verified in the reader app |
| T08 Student-specific access | API verified; not wired into the reader app |
| T09 Existing human audio | Shipped passages include human voices in the reader; not tested by this work |
| T10 Same passage twice avoids regeneration | Verified |
| T11 Failed job visible and retryable | Verified through the passage service: a failing job shows `failed` with a reason, and a retry re-runs (see section 4). This test found and fixed a dedup bug |
| T12 Keyboard operation | Not verified |
| T13 Private storage denies direct access | Verified for Audio and Frontend buckets |
| T14 Compare two voices | Not done (single voice configured) |

Other checks: generated file schema matches a shipped passage file (same keys plus `sourceId`);
HTML word spans, `t` and `lead` counts agree; timings are non-decreasing; CloudFront serves the
data and audio with correct content types; the live library lists all 14 passages (13 plus the passage-service
sample); no page errors when opening and playing a generated passage.

### Passage service checks (signed calls from the sandbox role)

| Check | Result |
|---|---|
| Unsigned `POST` and `GET` | 403 from API Gateway. Legacy routes still return 200 |
| Submit the kit's `sample-red-kite` record | 202, then `queued`, `running`, `published`. MP3, timing ZIP and reader data all returned 200 with correct content types |
| Timing ZIP | Contains `timing.v1.json`; digest in the URL matches the file; rows equal lead plus text words (7 + 26); fingerprint matches the POST |
| Same request again | 200 with `reused: true`; Step Functions execution count unchanged |
| Different text or `force` while running | 409. Same text while running: 200, current job |
| Text changed after publish | New run, republished; the word list changed |
| Pointer submission (`products/` key) | Published. Other bucket, key outside `products/`, or `..`: 400 |
| Validation | 400 for missing title, reserved id, non-English, invalid JSON, non-boolean `force`; 404 for an unknown id |
| Failing job, then retry | `failed` with the error code and message; the retry re-ran and failed the same way |
| Status never goes backward | A bug where `running` fell back to `queued` near the end was found and fixed |

Validation rules were also checked in isolation (27 cases). **Not verified:** a caller other than the sandbox role,
IAM denial for a principal without `execute-api:Invoke`, concurrent POSTs for one id, and passages near the 5,000 word cap.
Test passages other than the kit sample were deleted afterwards.

---

## 13. Limitations and risks

1. **Timing precision.** Polly gives word starts only; ends are derived. The shipped generated voice
   was timed with Amazon Transcribe forced alignment, which may be tighter.
2. **Public app URL** (section 8).
3. **No review gate** for generated audio or vocabulary definitions.
4. **Reader app is compiled.** Changes to the reader (the kit's "reader streamlining" and "data kit") would need the
   original Vue source, which this repo does not have.
5. **Generated passages are missing optional features** (section 5.8), and the 403 log noise on every load.
6. **State size.** Step Functions state is limited to 256 KB. Speech marks are dropped from state after saving, which
   covers passages of a few thousand words; very long texts have not been tested.
7. **Single voice and engine**, both fixed per deployment. Changing them changes the hash and regenerates.
8. **Legacy API** (the five `/passages`, `/jobs`, `/generate` routes) is unauthenticated, lists published demo JSON (which still contains the older, separate format), and is not used by the UI. `POST /generate` can start a run without credentials.
9. **Passage service limits.** No throttling or quota; each non-reused run is billed by Polly and `force` repeats it. Concurrent POSTs for one id are not atomic.
    `held` and SNS notices are not built. The job record for a run that failed after the manifest stays `approved` in the table (the API ignores that flag).
    Records' own HTML (`content`) is ignored, so ReadWorks formatting and images do not carry into the reader.
10. **Runtime versions.** CodeBuild pins Node 20; the AWS SDK warns that releases after early January 2027 require Node 22 or newer.
   CodeCommit is closed to new AWS customers; this account has existing access.
11. **Passage text must be plain text.** Words are split on whitespace; HTML in the input is escaped, not interpreted.

---

## 14. Decisions

| Decision | Reason |
|---|---|
| Reuse the reference reader app rather than rebuild | A polished, working UX already existed; rebuilding was not wanted |
| Serve everything from one CloudFront origin | The app fetches `audio/`, `data/`, `img/` by relative path from one base |
| Keep media out of git, in S3 | 52 MB of licensed binaries; the app needs them but git does not |
| CodeCommit for the repo | Stays inside the account; IAM-controlled; no external accounts |
| Pipeline always part of the stack | A pipeline-driven deploy otherwise deletes the pipeline |
| Library index rebuilt from DynamoDB with a re-check | Several executions finish at once; a plain read-modify-write loses entries |
| Title is read aloud and timed as `lead` | The reader highlights title words from `lead`, matching the shipped generated voice |
| Derived UUID per passage | The app validates ids as UUIDs; derived ids are stable across regeneration |
| Short cache (60 s) on generated files | Avoids the default one-day CloudFront cache hiding new passages |

### Plug-in kit evaluation (`sound-along-plug-in-kit.zip`)

| Piece | Outcome |
|---|---|
| 01 Reader streamlining | Not applicable (needs Vue source) |
| 02 Passage service (`POST /v1/passages`) | **Ported**: same two endpoints, request and response shapes, status values and timing file, reimplemented on this pipeline (section 7.1, `docs/API.md`). Not applied as a patch |
| 03 Data kit | Not applicable; has a known privacy gap |
| 04 Volunteer recorder | Not applicable here (needs a GPU and WhisperX) |
| 05 Holds lab | Applies cleanly (dry run only); optional |

---

## 15. Suggested next steps

1. A human approval gate before generated audio is shown (this would also give `held` a meaning in the passage service).
2. Restrict the public URL, and put the legacy unauthenticated routes (`/generate` especially) behind IAM or remove them.
3. Passage service hardening: throttling, a finished-job notice (SNS), and an atomic claim for concurrent POSTs.
4. Load-time work: compress the large `data/bundles/` JSON and confirm bundles load on demand.
5. Incremental frontend publish and narrower CloudFront invalidations.
6. Holds lab, if the heard-versus-written check matters for the demo.
7. Move CodeBuild to Node 22.

---

## 16. Repository layout

```
bin/sound-along.ts            CDK app entry (env, voice settings, pipeline repo)
lib/sound-along-stack.ts      All application resources
lib/pipeline-construct.ts     CodePipeline + CodeBuild
buildspec.yml                 CI build steps
lambdas/worker/handler.py     Step Functions task handlers
lambdas/worker/reader_format.py  Passage + speech marks to reader format (pure Python)
lambdas/trigger/handler.py    S3 event to Step Functions
lambdas/api/handler.py        Browser API routes (legacy + passage service routing)
lambdas/api/passage_service.py  Passage service: validation, submit, status
frontend/                     Compiled reader app (media not tracked)
demo-data/                    4 passages + mock assignments
scripts/                      seed.js, generate.js, publish-frontend.js, passage-client.sh
docs/SPEC.md                  This document
docs/API.md, docs/openapi.yaml  Passage service contract
```
