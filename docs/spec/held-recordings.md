# Held recordings

*What would a reviewer see when a take is held for uncertain words?*

Tools for people · Status: built, off by default

Sometimes a check can't tell whether a voice said the written words. That take is held, and a person has to decide. The reviewer panel is built for a content reviewer, not a child, and works through one flagged spot at a time.

For each spot it shows the written word, what the recognizer heard, and the sentence around it. The reviewer can play the word or sentence, compare an older take when one exists, mark “Sounds right” or “Sounds wrong,” and leave a note. After the last flag, the panel says what remains unresolved and offers the fitting next step: clear the hold, publish the take, ask for a new generated take, or put back the older take.

Each answer is tied to the exact take it was given about. If the take changes, pending answers are dropped instead of landing on the wrong audio. Showing a flagged word, or leaving it unanswered, never counts as approving it.

**An answer belongs to one particular take, and publishing needs a separate decision.**

A held take moves from listening to a decision, and the answers carry the take's fingerprint:

![A held take, a reviewer listening and answering sounds right or sounds wrong, and the steps offered after the last flag, depending on the answers](shots/fig-held-recordings.svg)

## How it connects

To compare possible hold rules without changing anything, use [Holds lab](holds-lab.md). [What published, checked, and draft mean](what-published-checked-and-draft-mean.md) explains the review states, and [Volunteer recorder](volunteer-recorder.md) has a separate review flow for human recordings.

## Where it stands

The panel's front-end helpers passed 76 guard rules in a local test harness. The holds screen is hidden unless a server address is configured, and it is off in the public sample build. This checkout contains the panel and its client contract, but no matching server for it was found in the cloud code, so an end-to-end hold decision could not be confirmed. A run of this panel on the event AWS account, on a classroom device, or in a person's listening session isn't recorded. The team reports that the separate generated-audio pipeline has run on the event account. Its build doc lists the voice quality gate as deployed, though its deploy command doesn't turn that on.

---

## Technical details

`frontend-src/src/views/Holds.vue` owns the flow; `frontend-src/src/holdsApi.js` owns API configuration, session storage, clipping, summaries, and queue logic. `frontend-src/src/router.js` enables `#/holds`, `#/holds/all`, and `#/holds/<id>/<generated|human>` only when `holdsBase` is set. `VITE_HOLDS_API` is a build-time HTTP(S) base URL; unset is the default. `PUBLIC_SAMPLE` forces it off. A typed passcode is sent in the `/api/holds/login` POST body and is not stored; a returned session token lives in `sessionStorage` and goes in an Authorization header.

The client requests `/api/holds`, per-take detail, flag answers, `clear` or `publish`, `restore` (put back an older take), and `generated/new-take`. Each flag answer carries a fingerprint, flag key, answer, and optional note. The final action sends a decision fingerprint. A stale-take refusal removes queued answers for that version. The panel gives a missing word a surrounding clip because it has no spoken word time; other clips use their own word boundaries with a little padding. Its speed line appears only when every timed answer came from a person, rather than a scripted run.

Run `node frontend-src/tests/holds_panel_harness.mjs` from the repo root, or `node tests/holds_panel_harness.mjs` from `frontend-src/`. It needs Node and no server. The backend contract and authorization behavior require a future server check before enabling this panel.

---

Previous: [Holds lab](holds-lab.md) · [Spec home](README.md) · Next: [Names and pronunciation](names-and-pronunciation.md)
