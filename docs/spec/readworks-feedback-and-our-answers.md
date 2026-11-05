# ReadWorks' feedback and our answers

*What changed in response to each item ReadWorks raised?*

The product at a glance · Status: built and tested locally

ReadWorks reviewed an earlier themed prototype and named places where a child might lose focus: moving underlines, overlapping word help, too many reading effects, and a younger view that felt like a separate e-book. The current branch answers with a simpler, article-like focused mode. Its reading tools offer three ways to follow the voice, and the younger readers link keeps the article shape with larger text. Slow playback now handles one-syllable words differently, and the Spanish translation is labeled.

Other feedback needs more than a screen change. A long passage has to survive timing and layout checks, a name must be spoken the same way each time, and word-help clips should sound like the story voice. On the live Ruth setup, the team reports new word-help clips in the passage voice and a deployed caption fix. A team member has clicked through the live site by hand many times and listened to a one-minute demo, which sounded good to them. A full listening review isn't recorded.

In the table below, "Done" means built, with the local evidence stated. "Partly" means the response is incomplete or unverified.

**Each piece of feedback has a code response, but listening and ReadWorks review are still needed.**

## How it connects

[Focused mode](focused-mode.md) explains the simpler screen. For the sound details that remain open, see [names and pronunciation](names-and-pronunciation.md), [syllable guides and slow](syllable-guides-and-slow.md), and [word timing](word-timing.md).

## Where it stands

ReadWorks' review came before focused mode. The focused reader passed 41 of 41 muted Edge browser checks on a short passage and two long passages at six screen sizes; the classic reader passed 162 of 162. The team reports an event-account deployment with Ruth, a word-help clip check in a muted headless browser, and the caption fix deployed. These do not show that the voice sounds right or that highlights match audible words. No classroom device or child test is recorded.

---

## Technical details

Source: ReadWorks' written feedback. Each row follows its numbered item.

| Item | Status | Code now and remaining check |
|---|---|---|
| 1. Human voice tracking | Partly | `frontend-src/src/soundAlong.js` accepts timed human voices in passage records. Existing prepared media is outside git; this branch has no deployed human-recording alignment route. ReadWorks' favorable check was on the earlier demo. |
| 2. Distracting moving underline | Done | `looks/mix/MixReader.vue` offers word highlight, full-word underline, or sentence highlight with word underline; focused CSS uses stationary cues. Muted browser checks cover the screen, not student preference. |
| 3. Paragraph and line indicator | Done | Focused mode sets the extra voice line and focus effects aside; they remain under All features in `MixReader.vue`. |
| 4. Unclear help button | Partly | Focused `MixReader.vue` shows a word's meaning for marked vocabulary; tap still replays a word. `views/Focus.vue` has a selected-word Meaning button. The two reader routes should be user tested for clarity. |
| 5. Inconsistent name pronunciation | Partly | `lambdas/quality_gate/names.py` and its names list can recognize spelling variants for a held take; they do not guarantee that Polly says a name consistently. The pronunciation field is used only by a local recorder tool; the AWS narration path doesn't load it, so a confirmed pronunciation won't change the AWS voice yet. The quality gate is off by default, but the team reports it on in the live Ruth setup. Names need a listening check. |
| 6. Different word-help voice | Partly | With `SYLLABLE_AUDIO=true` on the Ruth deployment, `lambdas/syllable_audio/handler.py` synthesizes whole-word, per-syllable and slow clips in the passage voice; the team reports they play in a muted headless browser. A default Joanna deployment uses older clips. The syllable splits need human review, and a full listening review of them isn't recorded. |
| 7. One-syllable slow repeats | Done | `components/SyllableGuide.vue` now plays the whole word at a slower playback rate when it has one syllable; multi-syllable words use the prepared slow clip. A test of audible quality isn't recorded here. |
| 8. Redundant Words to Know | Partly | `MixReader.vue` has a Words to Know section and a side meaning card. Translation is labeled “In Spanish.” The repeated meaning can still appear in both places. |
| 9. E-book Kid View | Done | In focused mode, `looks/index.js` routes younger readers to `MixReader.vue` with `kid: true`, an article with larger text. The paged `MixKid.vue` remains in All features. |
| 10. Distracting focus tools | Done | `MixReader.vue` starts focus `off` in focused mode and hides spotlight and line choices until All features. The older two-line effect remains available there. |
| 11. Long, higher-grade passages | Partly | Local WhisperX timing covered 1,423/1,435 words of one long passage and 2,019/2,046 of another; the rest were punctuation. “Brrrrr-boppppp!” is an estimated two-second cue; “8” has a suspect 20 ms. The local hold check would stop both partly for recognition errors. Both passages are live with Ruth as their only voice. Media is not in the repo. Layout checks passed muted. |
| 12. Closer ReadWorks look | Partly | Focused `MixReader.vue` and `mix.css` use an article layout and ReadWorks-like branding. The team reports the hero image-caption overlap fixed and deployed. No integration or UX sign-off from ReadWorks is recorded. |

Run `node frontend-src/tests/focused_browser.mjs <site-url>` for the focused browser path. Use `python tests/test_quality_gate.py` for the optional hold rules; these scripted checks do not replace listening or ReadWorks review.

---

Previous: [ReadWorks' technical expectations](readworks-technical-expectations.md) · [Spec home](README.md) · Next: [What published, checked, and draft mean](what-published-checked-and-draft-mean.md)
