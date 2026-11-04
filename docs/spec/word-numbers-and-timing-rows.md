# Word numbers and timing rows

*How does a written word point to its moment in audio?*

The data · Status: built and tested locally

To follow a story aloud, each word on screen must point to its moment in the recording. The reader numbers the article's words from zero. Each number picks a slot in the voice's list of time ranges, and each slot holds that word's start and end seconds. As the audio plays, the browser finds the range containing the current time and highlights that word.

Some items are only punctuation, such as a row of asterisks or a lone dash. They keep their number but have no spoken time. A child still sees them, and the reader skips past them when jumping to a spoken word. Title words use their own separate list, since they sit outside the numbered article.

The default Joanna setup uses the speech engine's word markers. The live Ruth setup uses speech recognition to align audio with text. Both give the browser times for highlighting and navigation, but no person has listened to judge their match on the live build.

**One article word number points to one slot in each voice's timing list.**

Each article word number selects the same slot in a voice’s timing list:

![The first four demo passage words carry data-i numbers that point to matching timing slots; punctuation can have a null slot.](shots/fig-word-numbers-and-timing-rows.svg)

## How it connects

The numbered words and timing lists sit inside the [Reader passage record](reader-passage-record.md). To learn how the times are produced, read [Word timing](word-timing.md); to see how the reader uses them, read [The reader engine](the-reader-engine.md).

## Where it stands

The mapping and reader engine have local tests. Two long passages were aligned locally against ReadWorks' current audio with WhisperX, an open speech-alignment tool: 1,423 of 1,435 words for Grandma's Music and 2,019 of 2,046 for the 2,046-word excerpt received timings. The remaining tokens were largely punctuation. That audio is not stored in the repo. Both passages were live with Ruth as their only voice on Nov. 4, 2026. The team reports that the Ruth pipeline ran on the event AWS account and published timing data. Muted headless browser checks showed audio loading, the clock running, and word highlighting, but no highlight tolerance was measured and a live word tap was not verified. The team reports no real-device check, human listening review, or use by a child, teacher, or ReadWorks person.

---

## Technical details

`lambdas/reader_bridge/handler.py` counts `\S+` tokens in `text`, normalizes whitespace for speech-mark byte offsets, and writes `<span class="sa-w" data-i="0">The</span>` inside `html`. It writes `voices[].t` as an array with exactly `words` slots. On the live Ruth setup, `lambdas/generative_voice/` makes speech-mark-shaped timing from speech recognition; Joanna's default setup uses Polly speech marks. `frontend-src/src/engine/timing.js` reads `data-i` into `voice.t[index]` and `data-l` into `voice.lead[index]`. Each non-null row is `[startSeconds,endSeconds]`.

| Piece | Writer | Reader and rule |
|---|---|---|
| `data-i` | Bridge HTML annotator | Reader selects a word's timing slot; zero based and follows source whitespace words. |
| `voices[].t[i]` | Bridge from word speech marks | Reader seeks and highlights; `[start,end]` uses seconds. |
| `null` timing | Bridge for punctuation-only token | Reader preserves the slot and seeks to a nearby timed word. |
| `title_words`, `by_words` | Bridge | Lead display; generated voice's `lead` has matching length and currently contains `null` entries. |
| `data-l`, `voices[].lead[i]` | Lead display and voice record | Reader can time spoken lead words for a compatible voice. |

For the demo source `demo-passage-001.json`, article token 0 is `The`, token 1 is `garden`, and the bridge requires 46 timing slots because it recounts 46 whitespace words. The long `Grandma's Music` source includes `***`, which keeps a numbered slot but receives `null` when it has no word mark. Speech marks carry millisecond `time` and UTF-8 byte `start`/`end`; the bridge rejects marks outside a token, missing marks on spoken tokens, and non-increasing times. It uses the next marked word's start as the current end; the final end is a 0.4 second estimate.

Local alignment exposed cases for listening review: `Brrrrr-boppppp!` was lit as one word for about two seconds with estimated timing because recognition heard other words; `8` in the 2,046-word excerpt got 20 ms and looks wrong. A local check would hold both passages partly for recognition errors. Test the conversion with `python -m unittest discover -s tests -p 'test_reader_bridge.py'`; browser behavior is exercised by `node frontend-src/tests/focused_browser.mjs` and `node frontend-src/tests/reader_layout_browser.mjs` in the configured browser environment.

---

Previous: [Reader passage record](reader-passage-record.md) · [Spec home](README.md) · Next: [Library index](library-index.md)
