# After the hackathon

*What later work do the design documents propose?*

The product at a glance · Status: design only, not built

ReadWorks' small content team would need more than a small live library to run Sound Along across a growing catalog. The two supplied design documents sketch later phases: a stronger check of what the audio says, a way for editors to resolve held takes, a controlled route for volunteer recordings, and classroom settings and reporting tied to real ReadWorks accounts. These are proposals, not commitments. The current quality gate covers part of the proposed check; the full review system is not built.

The validation design's pilot path, called "Balanced," transcribes every generated passage with speech recognition and compares it with the text. It measures timing against hand-marked examples and sends uncertain takes to a person. More expensive checks come only when measured error rates justify them. The teacher design calls for server-held settings, content approvals, and eventually ReadWorks sign-in and assignments. Its hackathon-phase targets are only demonstrated here with made-up people. A pilot with ReadWorks, counting staff time and privacy review, should set the schedule, not the design document.

**The proposed pilot and production systems still need review workflows, decisions, and evidence.**

The design documents propose a pilot, catalog operations, and ReadWorks integration beyond the current live build:

![A live build leads to proposed pilot review, catalog operations, and ReadWorks integration, with deeper checks added only if pilot results justify them.](shots/fig-after-the-hackathon.svg)

## How it connects

[What is proven and what is not](what-is-proven-and-what-is-not.md) shows the starting evidence. [Open questions for ReadWorks](open-questions-for-readworks.md) lists decisions that should shape any pilot. For the smaller optional check already in code, see [heard versus written check](heard-versus-written-check.md).

## Where it stands

The team reports the event-account stack deployed with generative Ruth, the quality gate on, and five pipeline-generated passages. That is not the proposed pilot or catalog operation. The teacher demo is a local prototype, not a production assignment service. No real device, content-team pilot, volunteer consent flow, or student outcome study is recorded. Nobody has judged the live build's sound by ear.

---

## Technical details

| Proposed phase | Idea, not built | Decision or proof needed |
|---|---|---|
| Pilot audio validation (the team's validation design document) | Transcribe and classify every generated passage; retry a suspect take once; use agreed end times; maintain names and vocabulary as editable data; human review queue for holds and samples; hand-marked timing set in continuous tests. | Measure false holds and audible errors, agree timing tolerance and reviewer capacity. The current `qualityGate` is narrower, off by default, but reportedly on in the live Ruth setup. |
| Volunteer track (The team's validation design document) | Upload with consent, instant audio feedback, transcript alignment, sentence repair, trust tiers, and versioned publication. | Confirm whether ReadWorks wants volunteers, rights and withdrawal rules, and who approves takes. The repository's local recorder is a tool, not this AWS route. |
| Catalog operations (the team's validation design document) | Bounded parallel generation, quotas, cost monitoring, and a content queue. | Test service quotas and price in `us-west-2`, plus staff time per passage. The team reports five pipeline generations, not a catalog run. |
| Deeper checks on trigger (The team's validation design document) | Additional pronunciation analysis, a second timing aligner, browser sync checks, and managed review workforce only when pilot metrics justify each. | Define triggers from actual errors; the document's thresholds are proposals. |
| Classroom phase 2 (The team's teacher design document) | Content-team sign-in, server-side word-help approval, co-teacher access, and an event pipeline. | ReadWorks' privacy, identity, and authorization decisions. Existing `frontend-src/src/teacherDemo/` uses made-up data and browser memory. |
| ReadWorks integration phase 3 (The team's teacher design document) | Use ReadWorks' real accounts and assignment system; consider a school admin role only if asked. | Agree API, document format, UX, ownership, and data-retention contract. |

The design documents contain schedules and cost estimates, not measurements from this branch. Recheck any plan with `npm run build`, `npm run test:frontend`, `python tests/test_quality_gate.py`, and a pilot run in the target account before treating it as implemented.

---

Previous: [Open questions for ReadWorks](open-questions-for-readworks.md) · [Spec home](README.md) · Next: [Focused mode](focused-mode.md)
