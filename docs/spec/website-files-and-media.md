# Website files and media

*Which files make up the website, and where is generated media kept?*

The data · Status: built and tested locally

The reader is a website built from two kinds of files. The shell is the page, scripts and styles that draw the interface. Passage data, pictures and audio are content that the shell loads when needed. Keeping them apart lets the interface be rebuilt without replacing every passage or recording.

A build produces the shell and leaves separately managed media folders alone. Publishing uploads everything to a private website storage area, reached through a web delivery address. The generation pipeline keeps source passages and audio in two other private storage areas. When a story is ready, a publishing step copies its recording into the website's storage and writes its reader record and library row there. That copy lets the reader load the recording by a short relative path.

The publisher treats the library list specially: it combines the local list with the one already online and keeps online rows when IDs overlap.

**The browser reads website copies; generation keeps its sources and working media in separate storage.**

```mermaid
flowchart LR
  A["Website source"] -->|"build shell"| B["Built shell"]
  B -->|"upload files"| C["Website storage"]
  D["Audio storage"] -->|"copy recording"| C
  E["Passage storage"] -->|"convert passage"| C
  C -->|"page, data, media"| F["Browser"]
```

## How it connects

The story files stored here are described in [Reader passage record](reader-passage-record.md), and the list in [Library index](library-index.md). For how the storage and delivery are set up, read [AWS stack and settings](aws-stack-and-settings.md).

## Where it stands

The shell build and upload scripts exist, and the library-list merge has a local test. The cloud setup builds locally. No deployment of this branch on the event AWS account was confirmed, so live storage contents and the delivery path weren't observed. Muted Edge browser checks passed 41 of 41 (focused reader) and 162 of 162 (classic reader); they don't show that a person heard the media or used a real device.

---

## Technical details

`scripts/build-frontend.js` runs the Vite build from `frontend-src/`, replaces `frontend/index.html`, `frontend/assets/`, and `frontend/experiments.json`, and leaves other directories under `frontend/` in place. In this checkout `frontend/` has the shell, assets, and experiments file, but no `data/`, `audio/`, or `img/` seed directories. Their deployed contents could not be inspected here.

| Location or key | Writer | Reader and purpose |
|---|---|---|
| `frontend/index.html`, `frontend/assets/*`, `frontend/experiments.json` | Build script | Browser app shell, code, styles, and experiment settings. |
| `frontend/data/*` (including `data/bundles/<name>.json`, short clips packed as base64 that `api.js` loads), `frontend/audio/*`, `frontend/img/*` when present | Content tooling or manually managed files | Publisher uploads them; browser loads relative content paths. |
| Content bucket `passages/<id>.json` | Direct upload or passage intake | Worker and reader bridge read source text. |
| Content bucket `manifests/<id>.json`, `content/<id>.json` | Pipeline | Intake API and other service endpoints read generation and published content metadata. |
| Audio bucket `audio/*.mp3`, `audio/*.speechmarks.json` | Pipeline | Bridge and status service read private generated media. |
| Website bucket `data/<id>.json`, `data/index.json`, `audio/<id>/<digest>.mp3` | Reader bridge | Static reader loads the record, library, and copied audio. |

`scripts/publish-frontend.js` recursively uploads every regular file in `frontend/` using its relative path. It sets content types by extension. Hashed `assets/` get a one-year immutable cache; `index.html` and `data/` use `no-cache`; other files get five minutes. For `data/index.json` only, it reads the current website bucket list, makes a map of local rows by `uuid`, then inserts live rows so they replace matching local rows. A missing live index is treated as empty; other read errors stop publication. It does not merge passage JSON, audio, images, or arbitrary data files. `tests/test_publish_frontend.cjs` checks live-row precedence and missing/error behavior.

`frontend-src/src/api.js` loads local `data/index.json` and `data/<id>.json` unless `VITE_PUBLISHED_DATA_BASE` configures a separate managed source. In managed mode it fetches `managed/index.json` (or `passages` when the base path ends in `/api/`) and expects a versioned `document` field and may use `VITE_CONTENT_ASSET_BASE` for audio or timing assets. The stack's normal frontend origin in `lib/sound-along-stack.ts` is the private website bucket; the content and audio buckets remain separate. Run `node tests/test_publish_frontend.cjs` for the merge. `npm run build:frontend` rebuilds the shell, but it mutates `frontend/`, so use it only in a working copy of the base repository.

---

Previous: [Manifest and job record](manifest-and-job-record.md) · [Spec home](README.md) · Next: [Volunteer recorder](volunteer-recorder.md)
