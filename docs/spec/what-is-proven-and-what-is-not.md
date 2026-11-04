# What is proven and what is not

*Which claims have evidence at their actual size?*

The product at a glance · Status: built and tested locally

A working screen is only the start of evidence. The current branch has a complete reader that runs locally, and code for making audio and word times that passes local tests. The browser checks ran with sound muted, so they show layout and scripted behavior, not what a listener hears. A separate local timing exercise on ReadWorks audio turned up difficult words and suspect times. It is useful because it did not pass cleanly.

The research claim is narrow too. The supplied research report supports helping students access grade-level text. It found no ReadWorks study testing this read-along audio against no audio on a learning measure, and none testing lit words. The large descriptive study it cites looked at grade-level assignments and answers, not reading growth or this product. A prototype cannot turn that access rationale into improved reading scores.

**The strongest claim today is a locally working prototype; listening, integration, and learning outcomes remain open.**

## How it connects

[ReadWorks' feedback and our answers](readworks-feedback-and-our-answers.md) records the product response. For the next evidence needed, see [tests and how to run them](tests-and-how-to-run-them.md), [word timing](word-timing.md), and [open questions for ReadWorks](open-questions-for-readworks.md).

## Where it stands

ReadWorks reviewed an earlier themed demo and praised Ruth from an earlier pipeline in a separate account. It has not seen focused mode. No current stack run has been seen in the event AWS account, and no real device, child, teacher, or production ReadWorks trial is recorded. The teacher demo uses made-up students. The evidence table in the technical section is as of November 4, 2026.

---

## Technical details

| Major part or claim | Evidence now | What it does not establish |
|---|---|---|
| Focused reader and long-passage layout | 41 of 41 Edge checks, muted, on The Big Hike and both long passages at six sizes (`frontend-src/tests/focused_browser.mjs`). | Audible sync, real device accessibility, child comprehension, or ReadWorks acceptance. |
| Classic reader | 162 of 162 muted browser checks (`frontend-src/tests/reader_layout_browser.mjs`). | Listening quality or student preference. |
| Word replay and controls | Reader engine and local browser harnesses exercise seeking, play controls, and display states. | That the highlighted word is within an agreed audible tolerance. |
| Long-passage timing | Local WhisperX timed 1,423 of 1,435 words in Grandma's Music and 2,019 of 2,046 in the Jackson excerpt; remaining tokens are punctuation such as `***`, `[...]`, quotes, and dashes. | A clean publish: “Brrrrr-boppppp!” is estimated at about two seconds after recognition heard other words; “8” has a suspect 20 ms. The local hold check would stop both partly because of recognition errors. Audio is outside the repo. |
| Narration synthesis and AWS stack | TypeScript stack builds and synthesis works locally; Ruth ran earlier in a separate test account through an earlier pipeline and ReadWorks liked that voice. | A deploy or end-to-end run of this branch on the event account, or consistent names. |
| Machine validation and optional heard-word gate | `tests/test_audio_check.py`, `tests/test_quality_gate.py`, and `tests/test_reader_bridge.py` cover local rules with fixtures or fake AWS. | A human listening approval or a false-hold rate on the catalog. The gate is off by default. |
| Publication contract | Reader bridge writes audio, document, and index in that order; local fake-service tests cover failures. | Live delivery, cache behavior, and permissions in the event account. |
| Teacher demo | 173 of 173 browser checks on one machine; 172 of 173 on another, where the “Maya 390” standard-reader word-card check missed. Cause unknown; older local media is possible. | Real classroom roles, privacy fit, or reliable behavior on all setups. |
| Cost | The pipeline's cost metric (`lambdas/worker/audio_check.py`) estimates Polly at $16 per million characters for neural, counting the audio and speech marks requests, and $30 for generative. It is an estimate, not a bill. | A measured AWS bill. Transcribe rate in `us-west-2` is unconfirmed; the design doc assumes $0.006/minute and a higher rate is possible. |
| Learning benefit | the team's research report supports grade-level access as a rationale and describes connected-topic routines separately. | Reading growth, comprehension gain from Sound Along, or a benefit from lit words. |

Useful local commands: `npm run build`, `npm run test:frontend`, `python tests/test_audio_check.py`, `python tests/test_quality_gate.py`, and `python tests/test_reader_bridge.py`. Browser scripts require a served site and local licensed media; do not count them as audible tests while sound is muted.

---

Previous: [What published, checked, and draft mean](what-published-checked-and-draft-mean.md) · [Spec home](README.md) · Next: [Open questions for ReadWorks](open-questions-for-readworks.md)
