# ReadWorks' technical expectations

*What technical shape did ReadWorks ask the team to fit?*

The product at a glance · Status: external

ReadWorks needs a read-along that its small team can maintain as passages change. The earlier project notes describe a split: prepare the narration and word times once, store the passage and its references in a single document, and let the browser read that document. Large audio files are kept separately. A child's page then never has to generate or guess timing while reading.

The same notes name preferred tools and a single western US cloud region. They are leads, not confirmed requirements, because the original technical brief is not in this workspace. This branch follows the document-based split. It does not include the Node and Express content service the notes describe, and its default programming-language version and cloud region differ from the notes. ReadWorks needs to say which versions and which service design are binding for integration.

**The code shows the document-based split; the exact fit to ReadWorks' stack still needs confirmation.**

The current code prepares audio and word times once, then gives the browser finished files:

![Cloud preparation writes a library list, passage document with word times, and separate audio; the browser reads them, while language version, API design, and region remain integration questions.](shots/fig-readworks-technical-expectations.svg)

## How it connects

[What ReadWorks asked for](what-readworks-asked-for.md) covers the student outcome. For the three sides of the split, see [the passage file](the-passage-file.md), [reader passage record](reader-passage-record.md), and [AWS stack and settings](aws-stack-and-settings.md).

## Where it stands

The infrastructure builds locally and the reader has muted browser checks. The team reports that the CDK stack is deployed in the event AWS account in `us-west-2`, with generative Ruth, the quality gate and reader bridge on, and the passage API off. Audio and guide clips load through CloudFront; direct storage access returned 403 in an earlier check. No real device test or ReadWorks engineering acceptance is recorded.

---

## Technical details

| Earlier technical-brief lead | Current branch evidence | Open fit question |
|---|---|---|
| Document-driven frontend; audio in object storage | `frontend-src/src/api.js` loads `data/index.json` and `data/<id>.json`; `lambdas/reader_bridge/handler.py` writes reader documents and copies audio. | Is this document shape acceptable to ReadWorks? |
| Vue 3 and AWS CDK 2 | `frontend-src/package.json`, root `package.json`, and `lib/sound-along-stack.ts` use these families. | Which locked versions are acceptable? |
| Python 3.14 for production; Node 18 and Express 4 API | `lib/passage-service.ts` and the stack specify Python 3.12 functions; `lambdas/api/handler.py` is Python; no Express server is in this branch. | Are these versions and the API runtime requirements or preferences? |
| Single account in `us-west-2` | `bin/sound-along.ts` falls back to `us-east-1` when no CDK region is set; `scripts/publish-frontend.js` falls back to `us-west-2`. The team reports the live stack in `us-west-2`. | Which region and explicit settings will ReadWorks require for integration? |
| Minimal dependencies | The reader uses Vue/Vite and browser APIs; AWS code uses CDK and SDK packages. | What dependency review is required? |

The lead about versions and region comes from an earlier spec page, not an original ReadWorks brief. Treat it as unconfirmed until ReadWorks supplies the current document. Inspect the present shape with `npm run build` and `npm run synth` from the repo root; neither command is a deployment or an integration test.

---

Previous: [What ReadWorks asked for](what-readworks-asked-for.md) · [Spec home](README.md) · Next: [ReadWorks' feedback and our answers](readworks-feedback-and-our-answers.md)
