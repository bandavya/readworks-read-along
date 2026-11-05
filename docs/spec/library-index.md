# Library index

*What list tells the website which stories are available?*

The data · Status: built and tested locally

Before anyone opens a story, the library needs a quick list of what's available. The library index is that list: one short row per story, with its title, grade, length and available voices. Choosing a row loads the story's larger reader record.

A row is added or replaced only after the audio is copied and the story record is written. Later deletion or a failed regeneration does not remove that row, so a stale entry is possible. Updating the website also touches the list. It combines the rows bundled with the site and the rows already online, and an online row wins over a bundled one, so a site update keeps stories generated since.

The index is a small public catalog for the reader. The site is public to anyone with its address and has no sign-in. Assignments, reviews and generation jobs are kept elsewhere.

**The index lists published stories; a stale row can remain after later deletion or failed regeneration.**

The library index is a small catalog row for each published story:

![A demo library index row shows the fields the browser lists, when the publishing step writes it, and how a website update merges rows.](shots/fig-library-index.svg)

## How it connects

Choosing a row opens the story described in [Reader passage record](reader-passage-record.md). To see how the website's storage and the list merge work, read [Website files and media](website-files-and-media.md).

## Where it stands

The index writer and website merge have local tests. The live library listed 14 passages on Nov. 4, 2026: 13 labeled “Generated voice (Ruth),” seven of those also with “Human voice (ReadWorks recording),” and one Spanish passage with only a human voice. A Very Small Garden listed 46 words. The team reports that the reader bridge and library index ran on the event AWS account and that live index entries resolved to reader data and audio. Browser checks ran muted; no classroom-device check, full listening review, or use by a child, teacher, or ReadWorks person was confirmed. This checkout has no seed index file.

---

## Technical details

`lambdas/reader_bridge/handler.py` writes `data/index.json` in the frontend bucket. `frontend-src/src/api.js` fetches it in local static mode. The bridge derives a row from the full reader record:

```json
{"uuid":"demo-passage-001","title":"A Very Small Garden",
 "grade":"2","lexile":430,"lang":"EN","words":46,
 "voices":["generated"]}
```

This is the code's output shape using fields from `demo-data/passages/demo-passage-001.json`; the `generated` voice appears only after successful reader publication.

| Field | Writer | Reader and meaning |
|---|---|---|
| `uuid` | Bridge from source passage ID | Library identity and key for loading `data/<uuid>.json`. |
| `title` | Bridge from source | Library title. |
| `grade`, `lexile`, `lang` | Bridge from source metadata | Library labeling and filters. |
| `words` | Bridge recounts text tokens | Library length display. |
| `voices` | Bridge from full record's voice IDs | Library and reader know which recordings exist. |

The bridge reads the existing list, replaces the matching `uuid` or appends a row, writes, waits briefly, and reads back. It retries up to six times to reduce concurrent write loss, but this is still a read/modify/write list without a transactional lock. It does not remove a row when its reader file is deleted. `scripts/publish-frontend.js` walks `frontend/`. On `data/index.json` it reads the live website index, starts a map with local rows, then inserts live rows by `uuid`, making live rows win; it rejects non-list data and propagates read errors other than a missing key. It uploads all other local files directly. If this checkout has no local index, the merge branch does not run during publication. `frontend-src/src/api.js` also has a separately configured managed mode expecting `document` paths; that is a different index contract.

Run `node tests/test_publish_frontend.cjs` for the merge and `python -m unittest discover -s tests -p 'test_reader_bridge.py'` for index publication.

---

Previous: [Word numbers and timing rows](word-numbers-and-timing-rows.md) · [Spec home](README.md) · Next: [Manifest and job record](manifest-and-job-record.md)
