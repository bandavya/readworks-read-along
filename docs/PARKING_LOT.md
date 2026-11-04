# Parking lot

Captured feedback and ideas. Some items have now been built on the `alex`/`demo-build` line and
deployed to `SoundAlong-alex`; those are marked **DONE** with the date. The rest await a decision.

## Status summary (2026-11-04)

| Item | Status |
|---|---|
| 2. Image caption overlaps the layout | **DONE** — fixed in the focused reader hero, deployed |
| 5. Pronunciation consistency (names) | Partial — quality gate + `config/names.json` lexicon exists; not demonstrated end to end |
| 6. "Words to know" voice ≠ passage voice | **DONE** — guide audio now generated in the passage voice (Ruth) |
| 7. "Slow" repeats one-syllable words | **DONE** — one-syllable words play the whole clip slowly |
| Focused mode / simpler reader | **DONE (already in the build)** — focused mode is the default |
| 1, 3, 9, 12 and the rest | Open — see the triage below |

Details and the original verbatim feedback follow.

The triage notes are mine. They are a first read to help the team decide, not decisions. Some
items concern the reference reader app (compiled code we did not write), some concern our
pipeline, and some are evaluation questions.

---

## ReadWorks feedback — team #51 (received Nov 4, 2026)

From ReadWorks staff, relayed by a teammate: mostly its Content Director, with an integration note
from its Director of IT.

### Framing from ReadWorks

> We recognize that this is a competition and your creativity and tech skills will build
> suggestions and applications that may go beyond what we actually will need/use ... you may
> want to include the ability to turn some extra features on and off, or include a
> "focused-mode" tab/option ... a simpler version.

Triage: a strong steer. A **focused mode** that shows a simpler reader (plain highlight, fewer
tools) alongside the full-featured one would let the demo keep its extras while matching what
ReadWorks says it wants. Affects the reference reader app, which is compiled code. Worth treating
as a theme that several items below feed into.

### Verbatim feedback and triage

1. **Human voice tracking** — "Very cool that they are also tackling human voice tracking - SO
   exciting if that's possible! It seemed to be working pretty well for the one I checked."
   - Triage: positive. The shipped human recordings already play with timing. Our volunteer track
     (L6, and the pilot) extends this. No action; evidence the direction is wanted.

2. **Underline plus highlight is distracting** — the moving underline adds motion and does not
   cover the full word. Suggested alternatives: highlight only; or underline the full word with no
   motion; or highlight the whole sentence and underline each word as said, no motion.
   - Triage: reference reader (CSS and highlight logic in the compiled app). This is the clearest,
     highest-value UX fix and overlaps the focused-mode theme. Needs the reader source or a
     scoped edit to the compiled code (build-plan D5). Candidate for a small spike.

3. **Paragraph and line indicator** — likes it, but unsure it helps students track.
   - Triage: no change requested. Note for the evaluation's reader-behaviour observations.

4. **"Help with a word" is confusing** — is it meant to go beyond vocab words? It does not do that
   reliably, and it is hard to know or control which word it defines.
   - Triage: reference reader behaviour. A real defect in a core tool. Clarify intended behaviour
     with ReadWorks (does it cover all words or only vocab?), then make it predictable. Relates to
     our generated passages having no gloss or syllable data, so word help is thin for them.

5. **Pronunciation consistency** — in "The Big Hike" the automated voice says the name "Tamara"
   more than one way. Can it be consistent?
   - Triage: **our pipeline.** This is exactly what a Polly lexicon fixes (validation doc, Stage 4:
     a name gets one pronunciation catalog-wide). Note: "The Big Hike" is a shipped passage, so its
     generated voice is the shipped generative voice, not our Joanna output; confirm which audio
     she heard. Strong argument for the lexicon work in the pilot.

6. **Vocab voice differs from the text voice** — make them consistent.
   - Triage: reference reader plus data. The vocab or syllable audio comes from the shipped
     `syl/` files, a different voice from the passage. For our generated passages there is no vocab
     audio at all. Decide one voice for both; this ties to the voice-options work (Phase 3) and to
     generating word-level audio.

7. **"Slow" option on one-syllable words** — instead of saying the word slowly, it says it twice
   (e.g. "hike"). Works well on multi-syllable words (e.g. "impatiently").
   - Triage: reference reader plus the shipped `syllables/` data. A defect in the syllable feature.
     Our generated passages do not have this data, so this is about the shipped feature. Log for
     whoever owns the syllable audio.

8. **"Words to Know" layout is redundant** — clicking the top instance shows the same info on the
   left (white background) and in the blue box on the right, plus or minus a cognate/translation.
   - Triage: reference reader layout. A contained UI cleanup.

9. **Kid View** — looks like an attempt at an e-book experience; in her view that is a different
   project with its own text-chunking and layout needs. She would rather see a kid view closer to
   ReadWorks' current student article view, integrating the reading tools.
   - Triage: significant scope signal. Suggests not investing in the current Kid View. Feeds the
     focused-mode theme and the IT note (match ReadWorks' article view). Decision for the team and
     ReadWorks, not a quick fix.

10. **Reading tools are distracting** — in "focus," unclear difference between "highlight" vs
    "spotlight" vs "one line" vs "two line"; the two-line focus is sometimes off-centre and
    distracts.
    - Triage: reference reader. Includes a real bug (off-centre two-line focus). Reinforces
      focused mode: fewer, clearer tools. Candidate for the same reader spike as item 2.

11. **Longer sample text** — try a ~1,500-word, higher-grade passage to see if tracking and layout
    hold. Some samples have onomatopoeia and unusual punctuation she is curious about. Links given:
    "Grandma's Music" and an "Excerpt from Reverend Jesse Jackson's Speech" (URLs not included in
    the relay; request them).
    - Triage: **our pipeline**, and useful for the evaluation. Directly tests our 5,000-word cap,
      the timing on long passages, and punctuation and onomatopoeia handling. Good addition to the
      evaluation materials. Action: get the two passage texts, run them through the pipeline.

12. **IT integration note** — "when we integrate it into ReadWorks we're going to have to do a
    bunch of visual/ux work to make it match. So the closer it comes visually to a ReadWorks
    product page the better." Short of a major redesign on their side.
    - Triage: direction for any UI work. Matching ReadWorks' product-page styling helps launch.
      Points the same way as items 2, 9, 10 and the focused-mode theme.

### Themes across the feedback

- **Focused mode / simplicity:** items 2, 9, 10, 12 and the framing. The single biggest signal.
- **Reference reader polish and bugs:** items 2, 4, 7, 8, 10 — all in the compiled reader we did
  not write; need the source or a decision to edit the compiled build (D5).
- **Our pipeline:** items 5 (lexicon), 6 (shared voice), 11 (long passages) — these map onto work
  already in the build and validation plans.
- **Evaluation inputs:** items 3, 11 — add to the reader-behaviour and materials sections.

### Open questions for ReadWorks (from this feedback)

- Which audio did she hear for "The Big Hike" and the vocab areas (shipped generative voice, or
  our Joanna output)? Item 5 and 6 depend on this.
- Intended behaviour of "Help with a word": all words, or vocab only? (item 4)
- The two long-passage URLs for item 11.
- Appetite for a focused mode and for matching ReadWorks' product-page style now, versus after the
  evaluation.
