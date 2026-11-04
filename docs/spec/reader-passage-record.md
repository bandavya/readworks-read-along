# Reader passage record

*What JSON does the reader load for one passage?*

The data · Status: built and tested locally

When a child opens a story, the website needs a prepared copy that can show the article and follow the recording word by word. This reader record is that copy. It joins the passage's title and text with display formatting, vocabulary, voice choices and time ranges. The original passage stays the written source; the record is shaped for playback.

Every spoken word in the article gets a number, and the same number picks that word's time range for a voice. That link lets the reader light the word being spoken. Each voice also points to an audio file, and a passage with several recordings gives each voice its own time ranges. The library holds only a short summary of each story; the full record loads when the story opens.

The conversion refuses a source whose formatted words differ from its plain text, so a child never hears one version while following another.

**The numbered article words and each voice's list of time ranges are what the reader needs to play a story along.**

```mermaid
flowchart LR
  A["Source passage"] -->|"words and article"| B["Reader conversion"]
  C["Audio and word times"] -->|"timing"| B
  B -->|"reader record"| D["Reader"]
```

## How it connects

The record is built from the writing in [The passage file](the-passage-file.md). To see how a word number finds its moment in the audio, read [Word numbers and timing rows](word-numbers-and-timing-rows.md).

## Where it stands

The conversion code writes this shape and local tests exercise it. Browser checks in Edge with sound muted passed 41 of 41 for the focused reader (The Big Hike and both long passages, at six screen sizes) and 162 of 162 for the classic reader. They show layout and interaction at those sizes, not audible sync. No output from this branch ran on the event AWS account or was heard by a person, and no real-device check was confirmed.

---

## Technical details

`lambdas/reader_bridge/handler.py` writes `data/<passageId>.json` to the frontend bucket. `frontend-src/src/api.js` fetches that path in local mode. `frontend-src/src/engine/timing.js` uses a voice's `t` and `lead` arrays. The demo source `demo-data/passages/demo-passage-001.json` yields this abbreviated *shape* when converted; the numbers below illustrate timing, not measured audio. The actual `t` array needs 52 slots, not just the two shown:

```json
{"uuid":"demo-passage-001","title":"A Very Small Garden","grade":"2",
 "lexile":430,"lang":"EN","words":52,
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

The bridge validates all timing and markup before its first reader write, then copies audio, writes the record, and updates `data/index.json` last. An existing voice survives only when word mapping and timing length still fit. For the long ReadWorks-shaped source, `vocab.support.senses` becomes reader `vocab`; the entire source record is not copied. Run `python -m unittest discover -s tests -p '*reader_bridge*'` to check the bridge where available.

---

Previous: [The passage file](the-passage-file.md) · [Spec home](README.md) · Next: [Word numbers and timing rows](word-numbers-and-timing-rows.md)
