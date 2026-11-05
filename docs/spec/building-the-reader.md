# Building the reader

*How does the editable reader source become the static website?*

Tools for people · Status: built and tested locally

The reader is the part students see. A teammate edits it as source code, and a build step turns that into a static website, a set of files a browser can load without any server logic. The site then fetches a library list, a passage record, and media such as narration audio and images.

The build replaces only the website's shell. Passage recordings and images are managed separately and stay where they are. A new interface build doesn't recreate the recordings, and a media update doesn't change the interface.

The build works in a scratch folder first and checks that the expected main page and supporting files came out. Only then does it swap them in. A separate publishing step can upload the finished site to hosting. Publishing is an outside action: it needs the intended storage location and a check that the live site works.

**The build produces the shell, and passage data and audio are separate inputs to what a person sees and hears.**

The build swaps in the reader shell while passage files remain separate:

![Vue source becomes a checked staged shell, then the built frontend; passage data and media remain in place for browser fetches, with a separate optional upload.](shots/fig-building-the-reader.svg)

## How it connects

To see where the source and output sit, use [Repo map](repo-map.md). The file layout the site expects is in [Website files and media](website-files-and-media.md), and the steps that touch the cloud are in [Deploy and smoke test](deploy-and-smoke-test.md).

## Where it stands

The checked-in built site contains a main page, supporting files, and an experiment settings file; it includes the focused reader image-caption fix from `frontend-src/src/looks/mix/mix.css`. The build team's muted Edge checks reported 41 of 41 focused reader checks on each of The Big Hike and two long passages at six screen sizes, and 162 of 162 classic reader checks. Those checks were not rerun, and no fresh build was made because the base checkout is read-only. The team's final build doc reports that the CDK stack and rebuilt reader are deployed on the event AWS account, including the focused reader caption fix. The live library lists 14 passages, including two long passages of 1,435 and 2,046 words with Ruth as their only voice; another passage lists 46 words to know. No classroom-device listening test is recorded.

---

## Technical details

`frontend-src/package.json` supplies Vite and Vue. From the repository root, install frontend packages with `npm ci --prefix frontend-src`, then run `npm run build:frontend`. The root command calls `scripts/build-frontend.js`, which runs Vite with `--configLoader native` and stages output in a temporary folder under the repo. It requires `index.html` and `assets/`; if that check fails, it does not install the staged output. On success it replaces `frontend/assets/` and copies `index.html` and `experiments.json`. The script explicitly leaves separately managed media directories in `frontend/` in place. Its cleanup removes its staging and backup directories.

For local development, `cd frontend-src` and `npm run dev`; the site uses files under `frontend-src/public/` when present. `frontend-src/src/router.js` maps library, passage, focused, kid, teacher, review, and optional holds views. `frontend-src/src/api.js` fetches local `data/index.json` and `data/<uuid>.json` by default; configured managed publication changes that route. `VITE_PUBLIC_SAMPLE=1` makes a public sample build and disables the holds panel. `VITE_HOLDS_API` enables the holds route only outside that sample.

Run `npm run test:frontend` for the offline UI harnesses after installing packages and any needed ignored fixtures. Browser commands are listed in [Tests and how to run them](tests-and-how-to-run-them.md). The root `scripts/publish-frontend.js` uploads the static `frontend/` tree to a named frontend bucket, preserves live library rows when uploading the index, and sets "always revalidate" (`no-cache`) for `index.html` and `data/`, a one-year cache for hashed `assets/`, and a five-minute cache for other files. The team's final build doc reports that the rebuilt shell was deployed and its caption fix checked in a muted headless browser. A local build by itself does not verify an upload or the hosted reader.

---

Previous: [Repo map](repo-map.md) · [Spec home](README.md)
