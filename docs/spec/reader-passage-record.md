# Reader passage record

*What JSON does the reader load for one passage?*

The data · Status: built and tested locally

When a child opens a story, the website needs a prepared copy that can show the article and follow the recording word by word. This reader record is that copy. It joins the passage's title and text with display formatting, vocabulary, voice choices and time ranges. The original passage stays the written source; the record is shaped for playback.

Every spoken word in the article gets a number, and the same number picks that word's time range for a voice. That link lets the reader light the word being spoken. Each voice also points to an audio file, and a passage with several recordings gives each voice its own time ranges. The library holds only a short summary of each story; the full record loads when the story opens.

The conversion refuses a source whose formatted words differ from its plain text, so that mismatch does not reach the reader through the normal publication route.

**The numbered article words and each voice's list of time ranges are what the reader needs to play a story along.**

The reader loads one record that joins the article and its recording:

![A reader JSON record shows story fields, numbered article words matched to timing slots, and the audio path, with the browser's use of each part.](shots/fig-reader-passage-record.svg)

## How it connects

The record is built from the writing in [The passage file](the-passage-file.md). To see how a word number finds its moment in the audio, read [Word numbers and timing rows](word-numbers-and-timing-rows.md).

## Where it stands

The conversion code writes this shape and local tests exercise it. The team reports five Ruth passages generated on the event AWS account, with reader records and audio loading through the site delivery network. In muted headless browser checks, audio loaded and the clock ran, but highlight tolerance was not measured and a live word tap was not verified. The live library listed 14 passages on Nov. 4, 2026: 13 labeled “Generated voice (Ruth),” seven of those also with a human voice, and one Spanish passage with only a human voice. No human listening review, real-device check, or use by a child, teacher, or ReadWorks person was confirmed.

---

## Technical details

`lambdas/reader_bridge/handler.py` writes `data/<passageId>.json` to the frontend bucket. `frontend-src/src/api.js` fetches that path in local mode. `frontend-src/src/engine/timing.js` uses a voice's `t` and `lead` arrays. The demo source `demo-data/passages/demo-passage-001.json` yields this abbreviated *shape* when converted; the numbers below illustrate timing, not measured audio. The actual `t` array needs 46 slots, not just the two shown:

```json
{"uuid":"demo-passage-001","title":"A Very Small Garden","grade":"2",
 "lexile":430,"lang":"EN","words":46,
 "html":"<p><span class=\"sa-w\" data-i=\"0\">The</span> ...</p>",
 "voices":[{"id":"generated","audio":"audio/demo-passage-001/<digest>.mp3",
            "lead":[null,null,null,null],"t":[[0.1,0.4], [0.4,0.8]],
            "review":"needs human check"}],
 "vocab":{"v0":{"word":"color","definition":"the quality seen when light is reflected"}}}
```

| Field | Writer | Reader and meaning |
|---|---|---|
| `uuid`, `title`, `authors` | Bridge from source ID, title, and `a` | Library and reader identify and label story. |
| `lang`, `grade`, `lexile`, `wordcount`, `words` | Bridge; counts recomputed from whitespace words | Library filters and reader metadata; `words` fixes timing length. |
| `title_words`, `by_words` | Bridge | Reader lead display; generated bridge leaves `by_words` empty. |
| `html` | Bridge annotator from source `content` or paragraphs | Reader renders article; `data-i` is the timing index. |
| `voices[]` | Bridge, retaining compatible existing voices | Reader offers recordings; each entry has `id`, `label`, `voiceId`, `audio`, `lead`, `t`, `source`, `review`, `text_hash`. |
| `vocab`, `credit` | Bridge from source vocabulary; bridge sets `credit` empty | Word help and article credit display. |

The bridge validates all timing and markup before its first reader write, then copies audio, writes the record, and updates `data/index.json`. On the deployed Ruth setup, it then tries to write `audio/syl/*.mp3` and `data/syllables/<id>.json` for Words to know before the final job update. A guide failure records `syllableAudioError` without failing publication; a failed word can leave an empty guide. A timeout before the final update could mark an already listed passage failed. Guide clip paths omit the voice and have a one-year cache, so regeneration in another voice can serve old clips. An existing voice survives only when word mapping and timing length still fit. For the long ReadWorks-shaped source, `vocab.support.senses` becomes reader `vocab`; the entire source record is not copied. The code sets a generated voice's `source` label to Polly speech marks even on the Ruth path, where timing actually comes from speech recognition; the code's label is misleading. Run `python -m unittest discover -s tests -p '*reader_bridge*'` to check the bridge where available.

---

Previous: [The passage file](the-passage-file.md) · [Spec home](README.md) · Next: [Word numbers and timing rows](word-numbers-and-timing-rows.md)
