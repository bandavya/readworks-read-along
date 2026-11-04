# Manifest and job record

*Where do generation results and review state live?*

The data · Status: built and tested locally

After Sound Along makes a recording, two records show what happened. The manifest is a receipt for one passage's recording: the text and voice settings used, where the audio and word-timing files are kept, and a status. The job row is the working record that changes while work runs, and notes when a result is held or fails. Both carry the passage ID and a fingerprint of normalized text, voice, engine, and language, so changed settings change the lookup.

A recording that generated successfully is not a recording a person approved. In the checked path the manifest says the voice was generated and needs a human check. The publishing step can still make a reader copy after the automated checks. A held result records its reasons and does not move on. The status a submitter sees (queued, running, held, failed or published) is read from these records.

**The manifest names the media; the job row tracks the work and its outcome.**

A manifest and a job row hold overlapping fields for one generated take:

![A table shows which fields the manifest file and the job row each hold for the demo passage, who writes and reads them, and what the human review state means.](shots/fig-manifest-and-job-record.svg)

## How it connects

The fingerprint is taken from the text in [The passage file](the-passage-file.md). To see how checked media becomes a story, read [Publish to reader](publish-to-reader.md); to see how a submitter sees status, read [Send a passage API](send-a-passage-api.md).

## Where it stands

Both record writers and status lookup have local tests with stand-in services. The team reports that the Ruth pipeline ran on the event AWS account with the voice check on and generated five passages; a repeated passage avoided regeneration. Its checked results have `status=generated` and `reviewStatus=needs human check`, which does not mean a person approved them. The default Joanna deployment has the check off and writes `approved` and `unreviewed`. The team reports no real-device check, human listening review, or use by a child, teacher, or ReadWorks person.

---

## Technical details

`lambdas/worker/handler.py` writes `manifests/<passageId>.json` to the content bucket and a job item to DynamoDB. With the quality gate enabled, `lambdas/quality_gate/handler.py` writes the checked variant. `lib/sound-along-stack.ts` creates a job table keyed by `passageId` and `textHash`, plus a `byStatus` index. `lambdas/passage_service/handler.py` reads the manifest, job row, published content, and media objects for API status.

| Manifest field | Writer | Reader and meaning |
|---|---|---|
| `passageId`, `textHash` | Worker/hash step | Intake matches exact submission; job key uses both. |
| `audioId`, `audioProvider`, `audioType` | Worker | Names the generated audio and its source. |
| `voiceId`, `engine`, `language` | Worker | Intake checks voice; operators inspect generation settings. |
| `audioKey`, `speechMarksKey` | Worker | Reader bridge and intake locate audio and timing marks in the audio bucket. |
| `status`, `reviewStatus` | Worker or quality gate | Ungated writer sets `approved`/`unreviewed`; checked writer sets `generated`/`needs human check`. Neither value proves a person listened. |
| `qc`, `createdAt` | Ungated worker | Operators inspect automated audio checks and creation time; checked writer omits `qc` from its manifest. |

An abbreviated checked manifest shape is `{"passageId":"demo-passage-001","textHash":"sha256:<digest>","audioKey":"audio/A_Very_Small_Garden_v1_demo-passage-001.mp3","speechMarksKey":"audio/A_Very_Small_Garden_v1_demo-passage-001.speechmarks.json","status":"generated","reviewStatus":"needs human check"}`. The keys are derived by code from the demo title and ID; the digest depends on actual settings.

| Job field | Writer | Reader and meaning |
|---|---|---|
| `passageId`, `textHash` | Initial worker | DynamoDB primary key and deduplication lookup. |
| `status`, `updatedAt` | Worker, quality gate, reader bridge | API and operators see `running`, `held`, `generated`, `approved`, or `reader_publish_failed`. |
| `voiceId`, `engine`, `charCount` | Worker | Generation settings and measured normalized character count. |
| `audioKey`, `speechMarksKey` | Worker | Cached media and publication retry. |
| `reviewStatus` | Worker or quality gate | `unreviewed` (ungated) or `needs human check` (checked); also `qcWarnings` in the ungated row. |
| `reviewKey`, `holdReasons` | Quality gate | On a hold: the `review/<id>.json` object in the content bucket and the reasons. |
| `readerPublishedAt`, `readerFailureReason` | Reader bridge | Distinguishes a media result from reader publication. |

When enabled, the signed intake writes `api-jobs/<id>.json` with `id`, `text_sha256`, `pipeline_hash`, `voice`, `submitted_at`, and `words` (the list of passage words, not a count), as well as `passages/<id>.json` to start the workflow. The live Ruth setup leaves this intake off; the legacy `/generate` route can start paid runs without a credential. The job row gets `readerPublishedAt` only after the bridge has written the index and attempted guide audio. A guide failure records `syllableAudioError` and continues; a timeout before that final update could mark a live passage failed. There is no human approval gate before generated audio reaches the reader. Run `python -m unittest discover -s tests -p 'test_quality_gate.py'` and `python -m unittest discover -s tests -p 'test_passage_service.py'` for local behavior.

---

Previous: [Library index](library-index.md) · [Spec home](README.md) · Next: [Website files and media](website-files-and-media.md)
