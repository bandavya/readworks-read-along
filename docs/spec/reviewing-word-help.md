# Reviewing word help

*How does a person check generated meanings, guides, and clips before trusting them?*

Word help and the classroom · Status: built and tested locally

Computer-made word help can sound sure of itself while being wrong for a sentence or saying a word oddly. The review screen lays out each generated meaning, syllable guide, and spoken recording in reading order. A grown-up reads the short context, listens, and either approves the item or marks it as needing a fix, with a note. Unchecked help keeps a draft label in the classic and younger readers; the focused reader shows none.

An approval counts as checked in that browser only. The plan is to export the choices and apply them to the passage data. The script for that step is named in the code but is not in this repo, so it couldn't be confirmed. If the text or audio changes later, the earlier approval stops counting.

ReadWorks' own written definition counts as source material, but the generated speech that reads it is a separate item to review. A label records that someone checked, not that the item is correct. The team reports that new guide clips on the live Ruth deployment use the passage voice; default Joanna and shipped guides use older clips. A reviewer should hear each guide in context. ReadWorks' content team decides its own approval process.

**A review decision belongs to the exact text and audio that were checked.**

A review choice stays tied to the exact help that was checked:

![A made-up review row shows a word in its sentence, generated meaning, parts guide and clips, and approve or needs-a-fix; the choice is saved in this browser with fingerprints and can be exported.](shots/fig-reviewing-word-help.svg)

## How it connects

[Word meanings](word-meanings.md) and [Syllable guides and slow](syllable-guides-and-slow.md) show the items being checked. [What published, checked, and draft mean](what-published-checked-and-draft-mean.md) separates whether a reader can see something from whether anyone reviewed it.

## Where it stands

The local review screen and its browser storage are built, as a prototype with no sign-in. The Nov. 4 browser runs checked reader layouts with sound muted, so they do not show that anyone listened to the review recordings. Use of this version by a ReadWorks content reviewer isn't recorded, and no classroom-device trial or human listening check could be confirmed. The team reports guide audio deployed with Ruth on the event AWS account, but no human review or approval gate before students could hear generated audio. The review screen itself was not verified on that deployment.

---

## Technical details

The generated guide entries are marked `needs human check`; a failed word can leave an empty guide. `frontend-src/src/views/Review.vue` serves `#/review/<passage-id>`. It loads the passage, generated gloss, syllable data, and kid-audio map, then calls `itemsForPassage` in `frontend-src/src/review.js`. Items have a stable key, kind, passage ID, text, clip paths, content hash, file review label, and any approved audio versions. The screen filters draft, fix, done, or all, and shows nearby story words for gloss entries. `Approve` first fetches and fingerprints every clip; a failed fetch prevents approval. `Needs a fix` records a note without granting approval.

Local choices live under `soundAlong.review.v1` in local storage. States are `draft`, `fix`, `checked` on this device, and `approved` from data. The content hash covers the item text and clip paths; verified audio versions include byte length and hash. `reviewOf` drops an approval when its hash or clip bytes no longer match. `buildExport` writes `sound-along-review/1` JSON. The code comments say `tools/apply_reviews.py` applies matching decisions to data files; that script is not in this repo, couldn't confirm. The screen also has a send-to-server button (`POST /api/reviews`, via `apiClient.js`); that route is not in this repo's `lambdas/api/handler.py`, so couldn't confirm what receives it. A local choice alone does not publish anything to other browsers. `frontend-src/src/helpPolicy.js` offers `?help=source` and `?help=reviewed`; the default `current` still displays draft help with labels in those readers; the focused reader does not read `?help`.

The review page has no real sign-in. Test its behavior with `cd frontend-src; node tests/fixhelp_harness.mjs` and by opening a review route, listening to clips, changing an item, and checking that its old decision is invalidated. In this workspace, that harness skipped because private ReadWorks fixtures are absent. A human content review has not been confirmed.

---

Previous: [Hear words in parts or slowly](syllable-guides-and-slow.md) · [Spec home](README.md) · Next: [Usage counts](usage-counts.md)
