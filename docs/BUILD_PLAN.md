# Sound Along: build plan for team review

Draft of November 4, 2026. Estimates are mine and should be corrected by whoever does the work.
Items marked **Decision** need an answer before the work that depends on them starts.

> Status note (2026-11-04): this plan predates the move to the `alex`/`demo-build` line. That build
> already ships several items the plan treated as future work: focused mode, the Transcribe
> voice-quality gate, the generative (Ruth) voice path, the reader bridge, real-audio validation
> with `reviewStatus`, and the pronunciation-guide audio in the passage voice. See `docs/SPEC.md`
> (final) section 1 and 10 for what is actually deployed. Treat the phases below as the remaining /
> proposed work, not a from-scratch plan.

Inputs: `Sound Along — TTS Validation Design Doc.docx` (Nov 3), `docs/SPEC.md` (current
state), the AWS MCP review of the deployed stack (Nov 4), and the request for male and
female voice options.

The evaluation study (voice quality, timing, accessibility, cost, decision rule) is its own
document: `docs/EVALUATION_PLAN.md`. This plan covers what gets built, including the tooling the
evaluation needs.

---

## 1. Where we are

Deployed and working (details in `docs/SPEC.md`):

- A passage uploaded to S3, or sent to the IAM-signed passage API, becomes Polly neural audio
  (Joanna) plus word timing, and appears in the reader app with word highlighting.
- CI/CD: a push to CodeCommit `main` deploys the stack.
- Duplicate runs are skipped, and a failed run can be retried.

Not yet shown, and the reason for this plan:

- **Nobody has listened to the audio**, and the highlight has not been measured against the sound.
- **Every passage is marked approved automatically.** No person sees it before students could.
- **No check that the audio says the right words.** Only structure is checked (file exists, marks map to text).
- **The cost metric is 8 times too low** for neural voices, because it ignores that speech marks are billed too.
- **Open doors found by the MCP review:** an unauthenticated public site, unauthenticated legacy API routes, no alarms, no recovery from deletion.

## 2. Goals and non-goals for this phase

Goals

1. Prove that the audio says the right words and that the highlight matches the sound.
2. Put a person in the loop before generated audio is treated as ready for children.
3. Support the acceptance evaluation with the tooling it needs (the study itself is in `docs/EVALUATION_PLAN.md`).
4. Close the high-severity gaps from the MCP review.
5. Offer a male and a female voice, if the team decides to.

Not in this phase

- The volunteer track, and the Thorough options in the validation doc. They wait for their triggers (doc, "When to escalate").
- The full catalog run (6,893 passages), Spanish, teacher features.
- Plug-in kit pieces 01, 03 and 04. Piece 05 (holds lab) is optional.
- Publishing to GitHub (on hold).

## 3. Decisions needed first

| # | Decision | Who | Blocks |
|---|---|---|---|
| D1 | Timing tolerance. Proposed: p90 onset error at most 150 ms against hand-marked audio, and under 1% of words beyond 300 ms | ReadWorks | L5; evaluation V4 |
| D2 | Must a person approve every Polly passage before children hear it, or is "sampled plus holds" enough? | ReadWorks | L4 |
| D3 | Do unreviewed passages appear in the library (with a draft marker) or only reviewed ones? | Team | L4 |
| D4 | Voices: stay on neural Joanna, add a generative voice, or both? Which male and female pair, what labels, which plays first? | Team | Phase 3, S1 |
| D5 | May we edit the compiled reader code to label voices? It is ReadWorks prototype code. | ReadWorks | P3.2 |
| D6 | How to restrict the public URL (disable when idle, basic auth, IP allowlist, signed URLs) | Team | H1 |
| D7 | Accessibility standard (WCAG 2.2 AA is the usual) and a named tester with a screen reader | ReadWorks | Evaluation V6 |
| D8 | Who are the 8 to 12 adult raters, and when | Team | Evaluation V1 |
| D9 | Is there a volunteer program, and who would review it? Sets the later trust tiers | ReadWorks | Pilot planning |
| D10 | Budget ceiling for catalog generation and validation | ReadWorks | Evaluation V7 |

## 4. Phase 1: Lean validation

From the validation doc's hackathon list. All work is on the existing Step Functions pipeline.
Each item has an acceptance test so the team can tell when it is done.

| ID | Work | Files touched | Acceptance test | Est. (hours) |
|---|---|---|---|---|
| L1 | **Stronger ValidateOutputs.** Read the real MP3 duration (needs `mutagen` bundled with the Lambda). Duration ratio within 0.8 to 1.25 of expected. Mark coverage 100% of readable words, interpolated words listed. Longest in-sentence pause. Words per minute against a grade band. Write a QC record | `lambdas/worker/handler.py`, `reader_format.py`, CDK bundling in `lib/sound-along-stack.ts` | A deliberately truncated MP3 fails. The four demo passages pass. QC fields appear on the job record | 3 to 4 |
| L2 | **Fix the cost metric.** Per-engine rate (standard $4, neural $16, long-form $100, generative $30 per million characters), and count both Polly requests | `handler.py` (`emit_metrics`) | The 255-character demo passage reports about $0.0082 on neural | 1 |
| L3 | **Transcribe check and classify.** New states: start a Transcribe batch job with a custom vocabulary from the passage's vocabulary words and capitalised names, poll like the Polly step, align the transcript to the spoken script (word-level edit distance), classify differences using the doc's table, store them in the QC record. Run on every demo passage and a random 10% | 2 new Lambdas, new states and IAM in the stack | Polly run on text with one word changed, checked against the original script, is flagged. A clean passage shows no unexplained difference | 5 to 7 |
| L4 | **Review status.** Use the existing `reviewStatus` field (`unreviewed`, `reviewed`, `held`) and leave `status` alone. It drives dedup, the library index and the passage API. A hold stops publishing; the API reports `held` with reasons. A small script releases or rejects a hold | `handler.py`, state machine, `passage_service.py`, `scripts/` | An unexplained content-word difference produces a held take that students do not see. Releasing it publishes | 2 to 3 |
| L5 | **Timing report.** Compare speech-mark word times with Transcribe word times for all demo passages: median, p90, share beyond 150 ms and 300 ms. Hand-mark word onsets on one passage (about an hour in Audacity) and report against that | script + generated report | Numbers exist for all passages and for the hand-marked one. Closes design test T06 once D1 is set | 2 to 3, plus 1 human hour |
| L6 | **One volunteer-style recording** by a team member, run through Transcribe for timing and loaded as a `human` voice on a test passage | script | The reader plays it and the highlight follows it. Shows the second track is viable | 1 to 2, plus a recording |
| L7 | **Metrics, alarms, dashboard.** Emit gate metrics with `Source` and `Voice` dimensions. One CloudWatch dashboard with the five headline numbers. Alarms on failed executions, Lambda errors and API 5xx (this also closes the MCP finding "no alarms") | stack, `handler.py` | Dashboard shows data from the demo passages. A forced failure raises an alarm | 2 to 3 |

Order: L2 and L1 first (small, independent), then L3, then L4 and L5 (both need L3), then L7. L6 can run in parallel with a human recording.

Total: about 16 to 23 engineering hours, so 2 to 3 working days for one engineer. The validation
doc estimated about 1 day for the Lean list. I think that is tight for all seven items. If time is
short, cut in this order: L6, then L7's dashboard (keep the alarms), then L4's release script.

QC record (proposed), stored on the job item, with long difference lists stored in S3 and
referenced:

```
durationSec, durationRatio, markCoverage, interpolatedWords[], longestPauseSec,
wordsPerMinute, transcribe{ran, vocabulary, wordErrorRate, diffs[]},
timingAgreement{medianMs, p90Ms, pctOver150, pctOver300},
decision (publish | hold | fail), reviewStatus
```

## 5. Phase 2: Evaluation support (tooling)

The study itself (workstreams V1 to V8, materials, methods, pass criteria and decision rule) is in
`docs/EVALUATION_PLAN.md`. This phase builds only what that study needs and cannot get from Phase 1.

| ID | Work | Detail | Acceptance test | Est. (hours) |
|---|---|---|---|---|
| S1 | Comparison set generator | Run the evaluated ReadWorks passages (seven English passages with both a generated and a human voice, see the evaluation plan) through our pipeline under separate ids (for example `eval-<uuid>`) so they do not mix with the library. Excerpt long passages to 60 to 90 seconds. Produce clips for each candidate voice and a sealed code-to-voice key | Every clip plays; the key maps each random code to one voice; the library index is unchanged | 3 to 4 |
| S2 | Blind listening page | A static page that plays clips in random order per rater with no voice names, and collects the rating fields listed in the evaluation plan (6.1). Exports a CSV keyed by rater code, with no names | A test rater completes one passage and the CSV has every field. Order differs between two raters | 3 to 4 |
| S3 | Gold-set tooling | Convert Audacity label files (hand-marked onsets) into the timing format and compare against our timing; report p90 and the share beyond 150 and 300 ms | Run on one hand-marked passage and produce the numbers | 2 |

S1 and S2 depend on D4 (which voices). S3 pairs with L5. ReadWorks material stays on the event AWS
account and out of any public repository.

## 6. Phase 3: Voice options (male and female)

Starts after D4 and D5. Better after L1 to L3, so every voice gets validated.

| ID | Work | Notes |
|---|---|---|
| P3.1 | Pipeline: a list of voices instead of one | Each voice gets its own Polly audio, its own speech marks and its own timing, since timing differs by voice. A Map state over voices around the synthesis steps, then one publish step that writes all voices into the passage file. Existing passages regenerate to add the second voice |
| P3.2 | Reader labels | The player's voice buttons only know "Human" and "Generated", so two generated voices would both read "Generated". Fix: a find-and-replace in the compiled reader (3 places in the main file, 2 in another, plus the library badge). Needs D5. A fresh copy from ReadWorks would overwrite it |
| P3.3 | Passage API | Keep `voice` as the default voice; add a `voices` list to the response |
| P3.4 | Validation per voice | QC records carry the `Voice` dimension (from L7); Transcribe checks run per voice |

Estimate: 12 to 16 hours (mine). Cost: Polly roughly doubles for each added voice (a neural
voice with speech marks is about $640 per voice for the full catalog; ignores free tier).

Acceptance: switching voice mid-passage keeps the reader's place; both voices highlight
correctly; labels are distinct; the cost report shows both voices.

## 7. Phase 4: Hardening (from the MCP review)

| ID | Work | Why | Size |
|---|---|---|---|
| H1 | Restrict the public site (D6) | Anyone with the URL can read licensed material; default CloudFront certificate allows TLS 1.0 | S to M |
| H2 | Put legacy routes behind IAM or remove them; add stage throttling and access logs | `POST /generate` can start Polly runs with no credentials | S |
| H3 | Pipeline: add a test stage (type check, Python compile, the validators) and an approval step | A push to `main` deploys with administrator rights today | M |
| H4 | S3 versioning on audio and frontend buckets; copy media to a second place; point-in-time recovery on the table once it holds data worth keeping | No recovery from overwrite or delete | S |
| H5 | Scope the two avoidable IAM wildcards; turn on Lambda tracing; set CodeBuild log retention; move CodeBuild to Node 22 | Housekeeping | S |
| H6 | Passage API: throttling, a finished-job notice (SNS), an atomic claim for concurrent submissions | Cost and correctness under load | M |
| H7 | Delete `downloads/sound-along-full.zip` (licensed media, presigned links issued) once saved elsewhere | Licensed content sitting in a bucket | XS |

H1, H2 and H7 are cheap and could go first. They are listed last only because the team asked to
pause build work while the evaluation is defined.

## 8. After Phase 1: the pilot (Balanced)

Not planned in detail. The validation doc gives the shape: Transcribe and classify on every Polly
passage with one automatic re-synthesis, lexicon and vocabulary managed as data, a review page
with a Step Functions task token, volunteer upload with audio checks and trust tiers, a gold set
checked in CI, and a Distributed Map for catalog runs capped below Polly and Transcribe quotas.
Estimate in the doc: 1 to 2 weeks. Plan it in detail once Phase 1 and 2 results and D2 and D9 are in.

## 9. Sequence

```
Week 1   D1..D9 answered          L2 L1 -> L3 -> L4 L5 -> L7        (L6 in parallel)
         H1 H2 H7 (if approved)
Week 2   S1 S2 S3, then the study       P3.* (if D4 and D5 say yes)
         (see docs/EVALUATION_PLAN.md)
         H3 H4 H5 H6
Then     review results, set gate thresholds, plan the pilot
```

Assumes one engineer and reviewers available in week 2. Nothing here is committed to a date.

## 10. Verification

- Each item's acceptance test is run and the result recorded in the pull request or commit message.
- Changes are deployed through the pipeline, never while a run is in progress.
- The five headline numbers from the validation doc start being measured on the demo passages:
  auto-publish rate, escape rate (needs the audit, so later), timing accuracy against the gold
  passage, reviewer minutes per passage, cost per passage.
- What this plan cannot prove: how the audio sounds, or whether a child can use the reader.
  That is the people-based evaluation in `docs/EVALUATION_PLAN.md`.

## 11. Cost

| Item | Estimate | Basis |
|---|---|---|
| Transcribe check, per passage processed | about $0.02 | $0.006 per minute (AWS page, US East; confirm the us-west-2 rate) x 3.2 minutes (validation doc) |
| Transcribe, whole catalog at 100% | about $130 | Validation doc; the arithmetic checks |
| Lean at a 10% sample | about $0.002 per passage on average | Same basis |
| Extra neural voice, whole catalog | about $640 | $16 per million characters x 20 million x 2 requests (speech and marks), from AWS's Polly page |
| Demo and evaluation (a few dozen passages) | cents to a few dollars | Same rates |

Reviewer time is the larger cost: the validation doc estimates 5 to 10 hours for Lean's audit
only, and 20 to 30 hours for Balanced across the catalog. Replace with pilot measurements.

## 12. Risks

| Risk | Mitigation |
|---|---|
| Transcribe and Polly disagree on harmless differences (numbers, names) and cause false holds | Equivalence list and custom vocabulary from the start; track the false-hold rate |
| Step Functions state limit (256 KB) with long difference lists | Keep diffs in S3 and the QC record, not in state |
| `mutagen` needs bundling, and the stack has no bundling step today | Use a CDK Python bundling asset or a layer; CodeBuild already has pip |
| Changing the state machine while a pipeline run is in progress | Deploy only when idle; the pipeline stays part of the stack |
| Edits to the compiled reader conflict with later copies from ReadWorks | Keep the edit as a small, documented patch (D5) |
| A hold hides the only version of a passage | Students keep the last good version; a first-time passage is simply not listed |
| Rater availability and sample size | Covered in `docs/EVALUATION_PLAN.md` (D8; report spread and preference share, not only averages) |
| Estimates are mine | Team re-estimates in review |

## 13. What the team is asked to do

1. Answer D1 to D9, or say which can wait.
2. Confirm the Phase 1 list and the cut order if time is short.
3. Say whether Phase 3 (voices) and Phase 4 (hardening) start now or after the evaluation.
4. Correct any estimate or assumption above.
