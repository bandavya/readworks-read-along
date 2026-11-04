# Repo map

*Where is each part of Sound Along in this repository?*

Tools for people · Status: built and tested locally

Sound Along has two paths that meet at the reader. One prepares passage audio and word timing, checks them, and publishes passage records. The other is the website, which loads those records and follows the audio as it plays. Separate local tools let a teammate try hold rules or prepare a volunteer recording without touching the deployed system.

That gives a way to find things. For a screen, start with the website's source. For generated audio, start with the audio pipeline code. For the handoff between them, start with the passage data format.

The checked-in website is a build output, and its passage data and media are managed apart from the source. Tests sit beside both the pipeline and the screens. Some use invented data, and others expect ReadWorks media that is kept out of the repository.

**Find the part that owns the behavior first, then follow the linked data pages to its boundary.**

The repository's top folders separate cloud work, reader source, built files, and local tools:

![A drawn repository map shows cloud code, editable reader source, built frontend, local tools, scripts and tests, and example data and docs.](shots/fig-repo-map.svg)

## How it connects

For the product view, start with [Sound Along in one picture](sound-along-in-one-picture.md). The handoffs are described in [The passage file](the-passage-file.md), [Reader passage record](reader-passage-record.md), and [Website files and media](website-files-and-media.md).

## Where it stands

Local tests cover parts of these directories, as detailed in [Tests and how to run them](tests-and-how-to-run-them.md). The team's final build doc reports that the CDK stack was deployed on the event AWS account with Ruth, the quality gate, reader bridge, and syllable audio on; the passage API was off. The default deployment still uses Joanna and older guide clips. The live library lists 14 passages; 13 have a generated Ruth voice, seven of those also have a human recording, and one Spanish passage has only a human voice. The website's muted browser checks say nothing about how audio sounds or how it works on a real device.

---

## Technical details

This map is based on commit `ab6e826`. The root `package.json` builds the cloud stack; `frontend-src/` has its own `package.json` and build.

| Path | Responsibility | Start here |
|---|---|---|
| `bin/`, `lib/`, `cdk.json` | Cloud stack entry, infrastructure, and settings (root `package.json`, `tsconfig.json`) | `bin/sound-along.ts`, `lib/sound-along-stack.ts` |
| `lambdas/trigger/`, `lambdas/api/`, `lambdas/worker/` | Intake and generated audio work | `handler.py` in each directory (`worker/` also has `audio_check.py`) |
| `lambdas/quality_gate/`, `lambdas/generative_voice/` | Audio and word checks, optional generative voice path | `handler.py`, `comparison.py`, `names.py` |
| `lambdas/reader_bridge/`, `lambdas/passage_service/`, `lambdas/syllable_audio/` | Reader records, optional passage service, and guide audio in the passage voice | each `handler.py`; `syllable_audio/syllabify.py` |
| `frontend-src/src/views/` | Routes and whole screens | `Library.vue`, `Passage.vue`, `Focus.vue`, `KidView.vue`, `Holds.vue` |
| `frontend-src/src/components/`, `engine/`, `soundAlong.js` | Player, word help, timing, and display components | `PlayerBar.vue`, `engine/timing.js` |
| `frontend-src/src/kid/`, `character/`, `passage/` | Kid view helpers, reading buddy characters, and word-help and rehearsal logic | `kid/pages.js`, `character/BuddyHost.js` |
| `frontend-src/src/dataKit/`, `teacherDemo/`, `looks/` | Classroom tools, invented teacher demo, and alternate looks | their component and README files |
| `frontend-src/public/` | Source site's static files; this checkout has only an experiment settings file | `experiments.json` |
| `frontend/` | Built site: HTML, hashed assets, and separately managed media | `index.html`, `assets/` |
| `tools/holds-lab/`, `tools/recorder/` | Local policy exploration and volunteer recording | each `README.md` and `serve.py` |
| `tools/passage_client.py` | Signed calls to the passage API (needs `botocore`) | the file's docstring |
| `scripts/` | Build, seed, generate, publish, smoke, and timing-report commands | `build-frontend.js`, `test-frontend.js`, `timing_report.py` |
| `tests/`, `frontend-src/tests/` | Pipeline and UI checks | [Test inventory](tests-and-how-to-run-them.md) |
| `.kiro/steering/` | Project context for a coding agent | `sound-along.md` |
| `demo-data/`, `docs/` | Example passages, the team's build and evaluation documents, plans, and this page spec | `demo-data/passages/`, `docs/SPEC.md`, `docs/BUILD_PLAN.md`, `docs/EVALUATION_PLAN.md`, `docs/PARKING_LOT.md`, `docs/spec/`; verify claims against owning code |

`frontend-src/src/router.js` maps the hash routes. `frontend-src/src/api.js` loads either local `data/index.json` and `data/<id>.json` or a configured managed endpoint. `scripts/build-frontend.js` builds the Vue shell into `frontend/` while preserving media directories. `scripts/publish-frontend.js` uploads that static tree. The `tools/` applications are not wired into the cloud stack. See [Building the reader](building-the-reader.md) for the build sequence.

`lib/sound-along-stack.ts` defaults to Joanna with `generativeVoice`, `qualityGate`, and `passageApi` off, and `readerBridge` on. `syllableAudio` is on only when `generativeVoice=true`, unless `-c syllableAudio=false`; the bridge gets Polly speech permission only with generative voice. `lambdas/reader_bridge/handler.py` writes the library row before guide audio. It records `syllableAudioError` without failing publication if guide generation fails. In this code, a timeout before the final job update could mark a live passage failed; a failed word can leave an empty guide entry; and guide clip addresses omit the voice while using a one-year cache. These risks are unfixed in this checkout. The team's build doc reports that the live site is public without sign-in, the legacy `/generate` route can start paid runs without a credential, and generated audio reaches the reader without human approval. The team's build doc reports guide audio working on the live Ruth deployment, but does not address those cases.

---

Previous: [Tests and how to run them](tests-and-how-to-run-them.md) · [Spec home](README.md) · Next: [Building the reader](building-the-reader.md)
