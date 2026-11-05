# Website files and media

*Which files make up the website, and where is generated media kept?*

The data · Status: built and tested locally

The reader is a website built from two kinds of files. The shell is the page, scripts and styles that draw the interface. Passage data, pictures and audio are content that the shell loads when needed. Keeping them apart lets the interface be rebuilt without replacing every passage or recording.

A build produces the shell and leaves separately managed media folders alone. Publishing uploads everything to a private website storage area, reached through a public web delivery address. The generation pipeline keeps source passages and audio in two other private storage areas. When a story is ready, a publishing step copies its recording into the website's storage and writes its reader record and library row there. On the live Ruth setup, it also writes Words to know audio in the passage voice. Those copies let the reader load media by short relative paths.

The publisher treats the library list specially: it combines the local list with the one already online and keeps online rows when IDs overlap.

**The browser reads website copies; generation keeps its sources and working media in separate storage.**

The repo contains the site shell; the stores hold the generated story files:

![A location map separates the frontend files present in the repo from the website, content, and audio stores and names their writers and readers.](shots/fig-website-files-and-media.svg)

## How it connects

The story files stored here are described in [Reader passage record](reader-passage-record.md), and the list in [Library index](library-index.md). For how the storage and delivery are set up, read [AWS stack and settings](aws-stack-and-settings.md).

## Where it stands

The shell build, upload script, and library-list merge have local tests. The team reports that the Ruth setup was deployed on the event AWS account, that passage and guide audio load through the site delivery network, and that the focused reader's image-caption fix is deployed. Direct access to the private storage returned 403 in an earlier check. The live library listed 14 passages on Nov. 4, 2026. Browser checks ran muted; no classroom-device check, full listening review, or use by a child, teacher, or ReadWorks person was confirmed.

---

## Technical details

`scripts/build-frontend.js` runs the Vite build from `frontend-src/`, replaces `frontend/index.html`, `frontend/assets/`, and `frontend/experiments.json`, and leaves other directories under `frontend/` in place. In this checkout `frontend/` has the rebuilt shell, assets, and experiments file, but no `data/`, `audio/`, or `img/` seed directories. The live website's library and media were checked through the delivery network, not by reading the private bucket here.

| Location or key | Writer | Reader and purpose |
|---|---|---|
| `frontend/index.html`, `frontend/assets/*`, `frontend/experiments.json` | Build script | Browser app shell, code, styles, and experiment settings. |
| `frontend/data/*` (including `data/bundles/<name>.json`, short clips packed as base64 that `api.js` loads), `frontend/audio/*`, `frontend/img/*` when present | Content tooling or manually managed files | Publisher uploads them; browser loads relative content paths. |
| Content bucket `passages/<id>.json` | Direct upload or passage intake | Worker and reader bridge read source text. |
| Content bucket `manifests/<id>.json`, `content/<id>.json` | Pipeline | Intake API and other service endpoints read generation and published content metadata. |
| Audio bucket `audio/*.mp3`, `audio/*.speechmarks.json` | Pipeline | Bridge and status service read private generated media. |
| Website bucket `data/<id>.json`, `data/index.json`, `audio/<id>/<digest>.mp3` | Reader bridge | Static reader loads the record, library, and copied audio. |
| Website bucket `data/syllables/<id>.json`, `audio/syl/*.mp3` | Reader bridge when `SYLLABLE_AUDIO=true` | Words to know loads the guide and its whole-word, syllable, and slow clips. |

`scripts/publish-frontend.js` recursively uploads every regular file in `frontend/` using its relative path. It sets content types by extension. Hashed `assets/` get a one-year immutable cache; `index.html` and `data/` use `no-cache`; other files get five minutes. For `data/index.json` only, it reads the current website bucket list, makes a map of local rows by `uuid`, then inserts live rows so they replace matching local rows. A missing live index is treated as empty; other read errors stop publication. It does not merge passage JSON, audio, images, or arbitrary data files. `tests/test_publish_frontend.cjs` checks live-row precedence and missing/error behavior.

`frontend-src/src/api.js` loads local `data/index.json` and `data/<id>.json` unless `VITE_PUBLISHED_DATA_BASE` configures a separate managed source. In managed mode it fetches `managed/index.json` (or `passages` when the base path ends in `/api/`) and expects a versioned `document` field and may use `VITE_CONTENT_ASSET_BASE` for audio or timing assets. The stack's normal frontend origin in `lib/sound-along-stack.ts` is the private website bucket; the content and audio buckets remain separate. Run `node tests/test_publish_frontend.cjs` for the merge. `npm run build:frontend` rebuilds the shell, but it mutates `frontend/`, so use it only in a working copy of the base repository.

---

Previous: [Manifest and job record](manifest-and-job-record.md) · [Spec home](README.md) · Next: [Volunteer recorder](volunteer-recorder.md)
