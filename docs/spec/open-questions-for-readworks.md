# Open questions for ReadWorks

*Which product and operating decisions belong to ReadWorks?*

The product at a glance · Status: external

Sound Along can demonstrate a read-along, but ReadWorks must decide what makes it suitable for students and sustainable for its content team. The most urgent decisions are about sound: how large a timing error is acceptable when checked against a person-marked recording, how many generated passages someone should hear before publication, and who corrects a name that is pronounced inconsistently. The two long sample passages show why a held take needs a practical review path.

Other decisions concern the student experience. The focused view responds to ReadWorks' feedback but has not been reviewed by them. They can choose the default follow-along cue, whether a word card opens only for marked vocabulary, and whether the article-like younger view fits the current site. For later classroom features, ReadWorks decides which student data may be recorded and whether a named teacher dashboard fits its privacy terms. A demo with made-up students cannot settle those.

**These decisions belong to ReadWorks because they set the acceptance bar and the ongoing human work.**

## How it connects

[What is proven and what is not](what-is-proven-and-what-is-not.md) explains the missing evidence. For possible later work, go to [after the hackathon](after-the-hackathon.md). Integration questions are in [ReadWorks' technical expectations](readworks-technical-expectations.md).

## Where it stands

The focused reader has local muted Edge checks, but ReadWorks saw only the earlier themed demo. The event-account stack, real devices, live classes, and content-team review workflow are untested. Ruth's earlier separate-account trial does not show how this branch will run. No response to these questions is recorded in the supplied files.

---

## Technical details

| Decision for ReadWorks | Why it matters | Current evidence or proposed test |
|---|---|
| What audible word-onset tolerance is acceptable? | Determines whether timing rows may publish. | The team's validation design document proposes a p90 error of at most 150 ms against hand-marked audio; it is an idea, not an agreed threshold. |
| Must a person hear every generated passage, or can staff review holds and samples? | Sets review cost and the meaning of publication. | Current default writes `approved`/`unreviewed`; optional gate writes `generated`/`needs human check` (`lambdas/worker/handler.py`, `lambdas/quality_gate/handler.py`). |
| Who owns names, pronunciation, and word-help approval? | The current name list accepts recognition variants but cannot guarantee a consistent spoken name, and the AWS narration path doesn't use its pronunciation field yet. | Review Tamara and the two long passages with a content editor; define a correction and recheck process. |
| Which focused cue and word-help behavior should be the default? | ReadWorks objected to motion and overlapping meanings. | `frontend-src/src/looks/mix/MixReader.vue` offers three cues; ReadWorks has not reviewed this mode. |
| Is the younger article view close enough to the current student page? | Determines integration work. | Local layouts exist; get ReadWorks UX and accessibility review on real devices. |
| Which exact stack versions, region, API form, and passage document does integration require? | Current Python 3.12 and `us-east-1` defaults differ from earlier technical-brief leads. | Compare `bin/sound-along.ts`, `lib/passage-service.ts`, and `frontend-src/src/api.js` with ReadWorks' current technical brief. |
| May teachers see named activity, and under what terms? | The classroom demo cannot establish privacy permission. | Decide identity, retention, authorization, and whether simple yes-or-level measures are acceptable before any real data. |
| Are volunteer voices planned? | Consent, withdrawal, review capacity, and correction rules depend on this. | The team's validation design document proposes a track; it is not deployed by this branch. |

For a local evidence package, run `npm run test:frontend` and `node frontend-src/tests/focused_browser.mjs <site-url>` with licensed local media, then record an audible review separately. No command in the repo answers these policy and acceptance questions by itself.

---

Previous: [What is proven and what is not](what-is-proven-and-what-is-not.md) · [Spec home](README.md) · Next: [After the hackathon](after-the-hackathon.md)
