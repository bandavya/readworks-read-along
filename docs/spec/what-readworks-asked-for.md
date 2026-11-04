# What ReadWorks asked for

*What student problem is Sound Along meant to solve?*

The product at a glance · Status: external

A student may understand a grade-level passage when it is read aloud, yet struggle so hard to sound out words alone that the meaning slips away. ReadWorks already supplies passage audio. It asked for that voice to be tied to the printed words: natural narration, a full-word visual cue as each word is spoken, and a tap that restarts the audio at the chosen word. Staff should not have to mark every word by hand for new passages.

The experience also has to fit ReadWorks' article style, accessibility needs, free service, and small engineering team. Its November 4 feedback favors a simpler focused view, an article-like younger readers view, reliable pronunciation, and consistent voices in word support. These are needs, not evidence that the prototype meets them.

The earlier project brief lists Spanish support, timing for existing human audio, and vocabulary help as stretch work. It places full-catalog generation, production integration, and teacher analytics later. That brief is not in this workspace, so ReadWorks needs to confirm those labels.

**The goal is access to the same passage, with useful support, while a student reads.**

## How it connects

[ReadWorks' feedback and our answers](readworks-feedback-and-our-answers.md) maps its detailed reactions to the current code. To see the mechanism, go to [Sound Along in one picture](sound-along-in-one-picture.md). To see how far the evidence reaches, go to [what is proven and what is not](what-is-proven-and-what-is-not.md).

## Where it stands

ReadWorks reacted to an earlier themed demo and praised the Ruth voice tested in a separate account. It has not reviewed the focused reader. The current reader has local muted browser checks, with no real device or student use recorded. The AWS stack has not been seen running in the event account. The original vision document and its usage figures could not be confirmed here.

---

## Technical details

| Request or constraint | Code path to inspect | Current scope |
|---|---|---|
| Natural narration | `lambdas/worker/handler.py`, `bin/sound-along.ts`, `lambdas/generative_voice/handler.py` | Neural Joanna by default; generative Ruth optional and off by default. Voice quality needs listening. |
| Word cue and replay from a word | `frontend-src/src/soundAlong.js`, `frontend-src/src/engine/input.js`, `frontend-src/src/looks/mix/MixReader.vue` | Implemented for timed voices and covered by local scripted checks. |
| Automatic passage preparation | `lib/sound-along-stack.ts`, `lambdas/reader_bridge/handler.py` | Stack synthesizes locally; no event-account run on this branch. |
| Simpler article view | `frontend-src/src/focused.js`, `frontend-src/src/looks/mix/MixReader.vue` | Default focused mode; younger readers use an article view with larger text. |
| Teacher assignment and analytics | `frontend-src/src/views/Teacher.vue`, `frontend-src/src/teacherDemo/`, `frontend-src/src/dataKit/` | Prototype links and made-up classroom demo, not production identity or outcomes. |

ReadWorks' written feedback is the direct feedback supplied for this batch. The earlier vision page is a lead only. Use `npm run test:frontend` for local reader logic and `node frontend-src/tests/focused_browser.mjs <site-url>` for a served, media-backed browser check.

---

Previous: [Sound Along in one picture](sound-along-in-one-picture.md) · [Spec home](README.md) · Next: [ReadWorks' technical expectations](readworks-technical-expectations.md)
