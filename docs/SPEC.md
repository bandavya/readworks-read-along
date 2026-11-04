# Sound Along: build specification (final)

Status as of 2026-11-04. Describes the build in **this repo** (`readworks-read-along`, the
`alex` line), as deployed to stack **`SoundAlong-alex`** in the event sandbox
(region `us-west-2`). The live address is shared separately.

Source designs: the team's technical and validation design documents, not in this repository.

Statements marked **Verified** were checked against the running system or a test. Statements
marked **Not verified** were not. No child, teacher or ReadWorks reviewer has used it, and
browser checks ran muted, so nobody has judged the sound by ear.

A separate earlier build exists (`sound-along`, CodeCommit, stack `SoundAlong-sandbox`,
compiled-only frontend). It is not this build. Where the two differ, this document describes the
`alex` build only.

---

> A longer page-by-page spec, with pictures, is in `docs/spec/`.

## 1. What this is

A browser read-along reader: a student sees a passage, hears it read aloud, and sees each word
highlighted as it is spoken. Generated audio is produced by Amazon Polly; word timing comes from
Polly speech marks (neural) or Amazon Transcribe (generative). A pronunciation guide ("Words to
know") plays each vocabulary word, by syllable, in the same voice as the passage.

The reader opens in **focused mode**: one simple reader in ReadWorks colours and fonts, with a
speed control, voice, text size and three ways to follow along. An **All features** button reveals
the theme variants, extra reading tools, paged kid view and a teacher demo, for comparing ideas.

### Built and deployed on `SoundAlong-alex`

| Area | State |
|---|---|
| CDK v2 (TypeScript) stack; S3 + CloudFront (OAC) + DynamoDB + Step Functions + Lambda + HTTP API | Deployed |
| Passage text → Polly audio + word timing → reader | Deployed; 5 generated passages live |
| Generative voice (Polly **Ruth**), timing from Amazon Transcribe | Deployed (`-c generativeVoice=true`); all 5 generated passages use it |
| Voice quality gate (Transcribe word check; holds on mismatch) | Deployed (`-c qualityGate=true`) |
| Reader bridge (writes `data/<uuid>.json`, audio, library index) | Deployed |
| Pronunciation-guide audio in the passage voice (whole/slow/per-syllable) | Deployed (`-c syllableAudio`, on with generative) |
| Focused mode + Vue source in `frontend-src/` with a build step | Deployed |
| Passage service: IAM-signed `POST/GET /v1/passages` | In the stack (`-c passageApi=true`); not enabled on the live `alex` stack |
| Legacy browser API (`/passages`, `/jobs`, `/generate`, `/access`) | Deployed |

### Not in this build (hackathon non-goals)

Full catalog generation, ReadWorks production integration, real teacher analytics, full Spanish
support, production identity, an AI evaluator, and image generation (generated passages show a
"Picture unavailable" placeholder).

---

## 2. Architecture

```
passages/<id>.json ─► Content bucket ─► S3 event ─► Trigger Lambda ─► Step Functions
                                                                           │
  LoadPassage ► NormalizeText ► ComputeTextHash ► CheckExistingManifest ─ cached ─► done
       │ new
       ▼
  SubmitPollyAudio ─ generative: MP3 only ─► StartTranscribeWordTimes ► Wait ► CheckWordTimes
       │ neural: MP3 + speech marks                                              (→ speech-marks shape)
       ▼
  ValidateOutputs ► [QualityGate: Transcribe word check] ► WriteManifest ► PublishDemoJson
       │                                 hold on mismatch ─► HeldForVoiceCheck
       ▼
  PublishToReader (reader bridge)  ─► writes to the Frontend bucket:
       │   data/<uuid>.json         (words, html with sa-w spans, voices[].t timing, vocab)
       │   audio/<uuid>/<digest>.mp3 (passage audio)
       │   audio/syl/*.mp3 + data/syllables/<uuid>.json  (pronunciation guide, passage voice)
       │   data/index.json          (library listing, updated with a read-back check)
       ▼
  EmitMetrics ─► CloudWatch (namespace SoundAlong, by Source and Voice)

  Browser ◄── CloudFront (OAC, HTTPS) ◄── Frontend bucket
```

| Layer | Service |
|---|---|
| IaC | AWS CDK v2 (TypeScript) |
| Content / audio / frontend storage | Amazon S3 (private, Block Public Access, OAC) |
| Delivery | Amazon CloudFront |
| TTS orchestration | AWS Step Functions |
| Workers | AWS Lambda (Python 3.12) |
| Text-to-speech | Amazon Polly — neural (Joanna) default, or generative (Ruth) |
| Word timing (generative) | Amazon Transcribe batch |
| Fidelity check | Amazon Transcribe (quality gate) |
| Job state | Amazon DynamoDB |
| Browser API | API Gateway HTTP API + Lambda |
| Metrics | Amazon CloudWatch |

---

## 3. Deploy modes (context flags)

One stack, `SoundAlong-<env>` (`env` context, default `sandbox`; the demo uses `env=alex`).

| Flag | Default | Effect |
|---|---|---|
| `generativeVoice` | false | Switch the voice to Polly generative **Ruth**; time words with Amazon Transcribe (generative returns no speech marks). The live `alex` stack is deployed with this on. |
| `qualityGate` | false | After validation, ask Transcribe what words the MP3 contains; a swap/omission/extra holds at `HeldForVoiceCheck` and never reaches the reader. |
| `readerBridge` | true | Publish generated passages into the reader (`data/`, `audio/`, index). Off with `-c readerBridge=false`. |
| `syllableAudio` | on with generative | Generate the pronunciation-guide audio in the passage voice. Needs the whole `lambdas/` tree, which only the generative bundle ships, so it is effective only with `generativeVoice`. |
| `passageApi` | false | Add IAM-signed `POST/GET /v1/passages`. Not enabled on the live `alex` stack. |

Deploy the live configuration:
```
npx cdk deploy SoundAlong-alex -c env=alex -c generativeVoice=true
```

---

## 4. Generation pipeline

**Trigger:** S3 `ObjectCreated` on `passages/*.json` in the content bucket starts one Step
Functions execution. Can also be started with `scripts/generate.js`.

**Input passage** (`demo-data/passages/*.json`): `passageId`, `title`, `gradeBand`, `lexile`,
`language`, `text` (blank line = new paragraph), optional `authors` and `vocabulary`.

### States (Step Functions)

| State | What it does |
|---|---|
| LoadPassage → NormalizeText → ComputeTextHash | Read the passage's `text` field and collapse its whitespace; SHA-256 hash of that text + voice + engine + language |
| CheckExistingManifest | A job row with the same hash and status `approved` (`generated` with the voice check on) → skip (cache hit). If that row has no `readerPublishedAt`, it publishes to the reader again first. It reads the job row, and doesn't look for the files themselves. |
| SubmitPollyAudio | Neural: async MP3 + word speech marks. Generative: MP3 only |
| StartTranscribeWordTimes → WaitForWordTimes → CheckWordTimes | Generative only: Transcribe batch job; align words to the written text; emit a speech-marks-shaped timing file |
| ValidateOutputs | Real MP3 duration (parsed from MPEG frames, no ffmpeg); last word not timed past the end; pace and longest gap recorded in the job's `qc` field |
| QualityGate (optional) | Transcribe word match; mismatch → `HeldForVoiceCheck`; with generative it reuses the transcription already made |
| WriteManifest → PublishDemoJson | Manifest + ReadWorks-shaped demo JSON (keeps the backward-compatible `au` field) |
| PublishToReader (reader bridge) | Writes `data/<uuid>.json`, `audio/<uuid>/<digest>.mp3`, pronunciation-guide files, and the library index |
| EmitMetrics | CloudWatch namespace `SoundAlong`, dimensions `Source` and `Voice` |

Terminal states: `AlreadyGenerated` (cache hit), `GenerationComplete`, `GenerationFailed`,
`ReaderPublishFailed`, `HeldForVoiceCheck`.

**Review status:** `reviewStatus` is `unreviewed` until a person has listened. With the quality
gate on, a machine-passed take is recorded as `generated` / "needs human check". `approved` means
only that the automatic checks passed. **There is no human approval gate before students could
hear generated audio.**

**Voice / timing:**
- Neural (Joanna): word timing from Polly speech marks.
- Generative (Ruth): timing from Amazon Transcribe. Per `README.md`, the generative path has
  been exercised against fake AWS in `tests/test_generative_voice.py` and now on the live `alex`
  stack (5 passages generated). **Not verified:** audio quality by ear.

---

## 5. Reader data contract (Frontend bucket)

Per passage, the reader loads `data/<uuid>.json`:
- `uuid` (derived from `passageId`), `title`, `grade`, `lexile`, `lang`, `words`
- `html`: `<p>` per paragraph; each word `<span class="sa-w" data-i="N">`; vocab words wrapped with `data-vocab-sense-id`
- `voices[]`: `{id, label, voiceId, audio, lead, t, source, review}`. `t` is `[start_s, end_s]` per body word; `lead` covers title/byline words. **The focused and classic readers play the voice saved in that browser (a class link's assigned voice comes first in the classic reader). With nothing saved, they play the human voice when the passage has one, and otherwise `voices[0]`.**
- `vocab`: `{senseId: {word, definition, example, pos, ...}}`

Library listing: `data/index.json` = one row per published passage. The reader bridge reads the existing
`data/index.json` from S3, adds or replaces this passage's row, writes it, and reads it back to confirm its own row is there. That makes a dropped entry from concurrent runs less likely, but doesn't rule it out.
**Note:** the bridge writes `data/<uuid>.json` and never removes passage files or index rows;
rows are replaced per uuid on regeneration.

### 5.1 Pronunciation guide ("Words to know")

For each vocabulary word, generated in the **same Polly voice as the passage**:
- `audio/syl/<sense>-<uuid>-whole.mp3` — the word once
- `audio/syl/<sense>-<uuid>-s<i>.mp3` — one per syllable
- `audio/syl/<sense>-<uuid>-slow.mp3` — syllables in turn, then the whole word (joined by
  concatenating MP3 frames with short SSML-break silences; no ffmpeg)
- `data/syllables/<uuid>.json` — `word`, `syllables[]`, `stress_index`, `audio{}`,
  `whole_segments[]`, `slow_phases[]`, in the shape `SyllableGuide.vue` reads

Syllabification uses **pyphen** (Hunspell hyphenation; the US English dictionary only,
bundled in the Lambda). It is approximate, so every entry is marked **"needs human check"**.
One-syllable words get only a whole clip; the reader plays those slowly via playback rate, so the
"slow says the word twice" issue does not occur.
**Verified:** on the live stack, opening "Words to know" plays the newly generated clip in the
passage voice; sense IDs match across the passage HTML, vocab and syllable data.

---

## 6. Frontend

- Source in `frontend-src/` (Vue 3 + Vite). `npm run build:frontend` rebuilds the compiled shell
  into `frontend/index.html` + `frontend/assets/`, leaving `frontend/data|audio|img|look-art` alone.
- Served from the Frontend bucket via CloudFront (OAC). The app fetches `data/`, `audio/`, `img/`
  by relative path, so it works from any origin.
- **Media is not in git** (`frontend/audio|data|img|look-art`): large and ReadWorks-licensed.
  It lives in the sandbox bucket and is backed up as a tarball in the content bucket under `media/`.
- Focused mode is the default view; `MixReader.vue` + `looks/mix/mix.css` render it.

---

## 7. Delivery and security

- One CloudFront origin (Frontend bucket) via Origin Access Control; `REDIRECT_TO_HTTPS`;
  compression on.
- All buckets: Block Public Access on, SSL enforced, S3-managed encryption. **Verified** earlier:
  direct S3 access returns 403.
- **The CloudFront URL is public to anyone who has it**, with the default certificate (minimum
  TLS 1.0). No WAF, no auth. `noindex, nofollow` is set, but that is not access control.
- Legacy API routes (`/passages`, `/jobs`, `/generate`, `/access`) have no authorization; `/generate`
  can start Polly runs without credentials. The passage service (`/v1/passages`), when enabled,
  requires AWS IAM signing.
- ReadWorks passages, recordings and images are ReadWorks' own material, used for this prototype.
- Generated audio and pronunciation entries are drafts ("needs human check") until a person approves.

---

## 8. Current live state (`SoundAlong-alex`)

- 14 library passages: 9 shipped ReadWorks passages (original generated + human voices) + 5
  pipeline-generated passages.
- The 5 generated passages use **Ruth (generative)** as their only, default voice, timed by
  Amazon Transcribe. **Verified:** each `data/<uuid>.json` lists one voice, `Ruth`; passage audio
  and pronunciation-guide audio load through CloudFront.
- The library index is internally consistent: every entry resolves to a data file and a playable
  default-voice audio. **Verified.**
- The 9 shipped passages are unchanged (their audio is not ours to re-synthesize).

---

## 9. Verification against the design's tests

| Test | Result |
|---|---|
| T01 Deploy from clean sandbox with CDK | Verified (`SoundAlong-alex` created from CDK) |
| T02 Upload a passage | Verified |
| T03 Generate audio + manifest | Verified |
| T04 Timing references the text | Verified (Transcribe-aligned word times published) |
| T05 Play through the reader | Partly: audio loads and the clock runs in a headless browser. Sound not heard |
| T06 Highlight within tolerance | Partly: highlight follows the timing data word by word. Tolerance not agreed/measured |
| T07 Tap a word to seek | Partly: a muted scripted run with real mouse clicks tapped a word on two passages on the live site, and the highlight moved to it. Not judged by ear |
| T08 Student access | Legacy API only; not wired into the reader |
| T09 Human audio plays | Shipped passages include it; not re-tested here |
| T10 Same passage twice avoids regeneration | Verified (a matching finished job row skips regeneration) |
| T11 Failed job visible/retryable | Verified in the earlier build; the hold/fail paths exist here |
| T12 Keyboard operation | Not verified |
| T13 Private storage denies direct access | Verified earlier (both buckets 403) |
| T14 Compare two voices | Not done (single configured voice per deploy) |

Other checks on this build: generated passages render and play with word highlighting; the
pronunciation guide plays in the passage voice; the image-caption overlap in the focused reader
hero is fixed; the library index is consistent. All **Verified** in a headless browser against
the live site; none judged by ear.

---

## 10. ReadWorks feedback status (see `docs/PARKING_LOT.md`)

| Item | Status |
|---|---|
| Image caption overlaps the layout (focused reader) | **Fixed** and deployed |
| "Words to know" voice differs from the passage voice | **Fixed**: guide now generated in the passage voice (Ruth) |
| "Slow" repeats one-syllable words twice | **Addressed**: one-syllable words play the whole clip slowly |
| Pronunciation consistency (e.g. "Tamara") | Partly: the quality gate carries a names lexicon (`config/names.json`); not demonstrated end to end |
| Focused mode / simpler reader | **Present**: focused mode is the default |
| Underline-plus-highlight distracting | Open: reader uses highlight; the underline concern needs a reader-style decision |
| "Help with a word" confusing | Open |
| Words-to-know layout redundant; Kid view; focus tools unclear | Open (reader UX) |
| Longer ~1,500-word sample | Present: Grandma's Music (1,435 words) and the Jesse Jackson excerpt (2,046 words) are in the live library, with Ruth as their only voice. Not judged by ear. |
| Match ReadWorks product-page styling for integration | Partly: focused mode already uses ReadWorks colours/fonts |

---

## 11. Repository and git

- Repo: `github.com/bandavya/readworks-read-along`. Default branch `main`; teammate branch `alex`;
  this build is on **`master`**.
- Media is gitignored (section 6). `pyphen` is vendored under `lambdas/syllable_audio/` with only the US English dictionary.

---

## 12. Operations

```
npm install
(cd frontend-src && npm install)          # Vite/Vue for the frontend build
npm run build                              # tsc type-check the CDK app
npm run build:frontend                     # rebuild the reader shell from frontend-src
cdk bootstrap                              # first time per account/region
npx cdk deploy SoundAlong-alex -c env=alex -c generativeVoice=true
node scripts/publish-frontend.js --frontend-bucket <FrontendBucket>   # publish shell (needs local media for a full sync)
node scripts/seed.js --bucket <ContentBucket>                          # upload passages; starts generation
npx cdk destroy SoundAlong-alex -c env=alex   # after confirming cleanup is permitted
```

Do not run a local `cdk deploy` while a Step Functions generation run or another deploy is in
progress. Regeneration on the Ruth deploy: delete a passage's generated data/audio and its job
rows, then re-run, so the new voice is the only (default) voice rather than stacked on the old one.

---

## 13. Limitations and risks

1. **No human review gate** before generated audio or pronunciation entries reach the reader.
2. **Public URL** with default-certificate TLS 1.0, no WAF, no auth (section 7).
3. **Syllable splits are hyphenation-based**, not exact phonetic syllables; flagged for review.
4. **Generative path quality not judged by ear**; Transcribe timing may differ from a forced aligner.
5. **Legacy API is unauthenticated**; `/generate` can start billable runs without credentials.
6. **Index rows are not pruned on delete** (replaced per uuid on regeneration); a failed regen could
   leave a stale row. Not observed; the live index is consistent.
7. **Pronunciation-guide audio only runs on the generative deploy** (bundling); the default Joanna
   deploy would still use the older shipped guide clips.
8. **Python 3.12 Lambda runtime** and the Breaking Barriers technical document's **Express/Node API layer** gap
   both still apply.
9. **Estimates and pass bars** in the plan/evaluation docs are proposals, not agreed.

---

## 14. Related documents

- `README.md` — how to build, deploy and run; feature flags.
- `docs/API.md`, `docs/openapi.yaml` — passage service contract.
- `docs/COST.md` — cost model.
- `docs/BUILD_PLAN.md` — phased plan for team review.
- `docs/EVALUATION_PLAN.md` — acceptance evaluation (voice quality, timing, accessibility, cost).
- `docs/PARKING_LOT.md` — ReadWorks feedback captured with triage.
