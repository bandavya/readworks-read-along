# Passage service v1

This is gpt-6-astra's suggestion, unruled by Alex. It is off by default. `-c passageApi=true` adds an IAM signed REST API without changing the existing browser API or processing path. `-c apiSourceBucket=<bucket-name>` optionally permits a pointer into one other S3 bucket. The API Lambda only writes `api-jobs/<id>.json` and sanitized `passages/<id>.json` in the team's content bucket. The existing S3 notification starts Step Functions.

## Identity and requests

The `PassageApiUrl` stack output ends in `/v1/passages`. Sign every call with AWS Signature Version 4 for `execute-api` and an IAM principal with `execute-api:Invoke` on the two methods. No browser CORS is configured for this API.

`POST /v1/passages` accepts one JSON product record with `uuid` or `passageId`, `title`, and `text`; or `{ "source": { "bucket": "<content-or-configured-source-bucket>", "key": "products/example.json" } }`. `content` HTML is accepted but not retained. A record can be at most 1 MiB and have at most 20,000 whitespace separated words. IDs are 1 to 80 ASCII letters, digits, or hyphens, starting with a letter or digit; `index` is reserved. Language must match the deployed pipeline. The configured voice and engine are fixed. Unknown source buckets, unsafe keys, invalid JSON and fields get 400. A different text or settings at the same ID, an existing direct S3 upload, or `force: true` get 409.

The service allowlists `title`, `text`, `gradeBand`, `lexile`, `wordCount`, and `language`; it also keeps only the reader's `word`, `definition`, and `example` vocabulary fields, or its supported `support.senses` fields. It sets `passageId` and safe `soundAlong` defaults. Line breaks in `text` are retained for reader paragraphs while spacing within lines is normalized. This removes question sets, questions, answers, assessment fields, and arbitrary source metadata before the team worker can copy intake into `content/<id>.json`. Vocabulary definitions and examples are public reader content. This protection applies to API submissions. Existing direct S3 uploads and existing `content/` objects are outside it.

A new call returns 202 with `id`, `status: queued`, `reused: false`, `voice`, `text_sha256`, `words`, and `status_path`. A matching repeat returns 200 with `reused: true`, except a marker left before the S3 trigger object is repaired by a matching repeat after 45 seconds and returns 202. An attempt to replace an existing direct upload is rejected. There is no transactional write across the marker and intake object. `force: true` is unavailable because the team's existing worker skips an approved `(passageId, textHash)` job; pretending to retry would not regenerate audio.

`GET /v1/passages/{id}` returns 404 for an ID this API did not submit. It maps the team's `running` row to `running`, and the team's `approved` manifest plus `content/` object and existing audio assets to `published`. A matching `reader_publish_failed` job row returns `failed` even when those artifacts exist. If the optional quality gate holds a matching job, GET returns `held` with reasons from the matching `review/<id>.json` in the content bucket, falling back to the job row's hold reasons if the review object is missing or stale. All asset links stay null for held jobs, even if older artifacts exist. Without the gate, the existing status behavior applies. Missing artifacts and an old unstarted job return `failed` with `reasons`; inspect Step Functions history before resubmitting. A successful publish is an automatic pipeline result, not a human check. The API does not create SNS notifications.

The status response includes `words` from the normalized input, `voice`, SHA-256 of the submitted text with paragraph breaks, `reasons`, `audio_url`, `timing_url`, and `timing_json_url`. The team's `textHash` uses flattened speech text plus voice, engine, and language and has a `sha256:` prefix; the API keeps that value in its private marker to match the table and manifest. `audio_url` is a 15 minute presigned S3 URL for the private MP3. `timing_json_url` is a 15 minute presigned S3 URL for the team's speech marks JSON array. `timing_url` is always null: this stack has no alignment ZIP or `timing/` object. The marks have Polly word and sentence events; they are not the old service's per word `[start, end, code]` alignment format. A client needing those fields needs a separate conversion and validation step.

The existing `GET /passages` and `GET /passages/{id}` browser routes have open CORS and the latter returns the full public `content/<id>.json`. A teammate should treat every field placed there as public and use the service intake for private product records. The existing `POST /generate` has no sign-in, and `GET /jobs` returns a table scan under open CORS. Those existing routes are unchanged here and should be addressed before using this system with private or real student data.

## First trial

Use a made-up passage from `demo-data/passages/`, for example `demo-passage-001.json`. Its question list is removed by this service. Synthesize with `npx cdk synth -c passageApi=true`, inspect the diff, then deploy only in an authorized sandbox. Read `PassageApiUrl` from that deployment's outputs; no live endpoint is supplied here. With a locally available boto3 profile, use the signed trial client (replace the placeholders with stack output and your authorized profile):

```powershell
python tools/passage_client.py --url '<PassageApiUrl>' --region us-east-1 --profile '<profile>' post demo-data/passages/demo-passage-001.json
python tools/passage_client.py --url '<PassageApiUrl>' --region us-east-1 --profile '<profile>' get demo-passage-001
```

Poll signed GET to `published`, open both returned asset URLs before they expire, and repeat POST to confirm reuse. Verify the content object has no questions or answers. No AWS call was made in preparing this module.
