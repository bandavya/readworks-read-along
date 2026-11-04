# Library index

*What list tells the website which stories are available?*

The data · Status: built and tested locally

Before anyone opens a story, the library needs a quick list of what's available. The library index is that list: one short row per story, with its title, grade, length and available voices. Choosing a row loads the story's larger reader record.

A row is added or replaced only after the audio is copied and the story record is written, so a child never sees a library entry whose story is missing. Updating the website also touches the list. It combines the rows bundled with the site and the rows already online, and an online row wins over a bundled one, so a site update keeps stories generated since.

The index is a small public catalog for the reader. Assignments, reviews and generation jobs are kept elsewhere.

**The index announces which stories are ready; the reader record holds each story's content.**

```mermaid
flowchart LR
  A["Publishing step"] -->|"summary row"| B["Library list"]
  C["Website publisher"] -->|"merge online rows"| B
  B -->|"story list"| D["Library"]
  D -->|"selected ID"| E["Full passage record"]
```

## How it connects

Choosing a row opens the story described in [Reader passage record](reader-passage-record.md). To see how the website's storage and the list merge work, read [Website files and media](website-files-and-media.md).

## Where it stands

The index writer and the website merge are built, with a local test for the merge. Library checks were part of the 41 of 41 muted Edge browser checks at six screen sizes, and the classic reader passed 162 of 162. These are local browser results, not an event AWS deployment, real-device test or listening test. This checkout has no seed index file to inspect.

---

## Technical details

`lambdas/reader_bridge/handler.py` writes `data/index.json` in the frontend bucket. `frontend-src/src/api.js` fetches it in local static mode. The bridge derives a row from the full reader record:

```json
{"uuid":"demo-passage-001","title":"A Very Small Garden",
 "grade":"2","lexile":430,"lang":"EN","words":52,
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

The bridge reads the existing list, replaces the matching `uuid` or appends a row, writes, waits briefly, and reads back. It retries up to six times to reduce concurrent write loss, but this is still a read/modify/write list without a transactional lock. `scripts/publish-frontend.js` walks `frontend/`. On `data/index.json` it reads the live website index, starts a map with local rows, then inserts live rows by `uuid`, making live rows win; it rejects non-list data and propagates read errors other than a missing key. It uploads all other local files directly. If this checkout has no local index, the merge branch does not run during publication. `frontend-src/src/api.js` also has a separately configured managed mode expecting `document` paths; that is a different index contract.

Run `node tests/test_publish_frontend.cjs` for the merge and `python -m unittest discover -s tests -p 'test_reader_bridge.py'` for index publication.

---

Previous: [Word numbers and timing rows](word-numbers-and-timing-rows.md) · [Spec home](README.md) · Next: [Manifest and job record](manifest-and-job-record.md)
