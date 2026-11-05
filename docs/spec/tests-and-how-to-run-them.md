# Tests and how to run them

*Which checks exist, how do I run each, and what does each need?*

Tools for people · Status: built and tested locally

Sound Along has automated checks, and they differ in what they need. Some run on a bare copy of the code. Others need ReadWorks passage files that are kept out of the repository, or a browser. A teammate taking over should know which is which before trusting a pass.

The small offline checks cover the audio pipeline, the recorder, and the reader's behavior. Browser checks open a local copy of the site with passage data in a headless browser (one with no visible window), with sound muted. A green result there shows that layout and clicks work under those conditions. It doesn't show that the narration sounds right to a listener.

Tests also come in two kinds. Guard rules can fail the run. Behavior reports describe current behavior and can change without failing it.

**Check what a result needed and what it counted before treating a pass as evidence.**

The reported muted browser runs have different suite sizes and one missed check:

![Four scaled bars show reported focused reader 41/41 per passage, classic reader 162/162, and teacher demo 173/173 and 172/173 on two machines.](shots/fig-tests-and-how-to-run-them.svg)

## How it connects

To find the code behind these checks, see [Repo map](repo-map.md). The frontend build is in [Building the reader](building-the-reader.md), and [What is proven and what is not](what-is-proven-and-what-is-not.md) pulls the wider evidence together.

## Where it stands

Against the live site on Nov. 4, `frontend-src/tests/focused_browser.mjs` passed 42 of 42 guard rules, muted. That test has no tap-a-word guard; a separate scripted run covered it. Local runs: the recorder passed 156 guards; the holds lab passed 15 and skipped two private checks; the quality gate passed 12 tests; the passage service passed eight; generative voice passed 15 with one skip. The frontend aggregate ran some harnesses but failed overall because the Vue package isn't installed, and harnesses needing private fixtures skipped. The audio check's 11-test run had one temp-file permission error in the sandbox. The reader bridge had one failure because the root AWS SDK packages are absent. The build team's Nov. 4 muted Edge runs reported 41/41 focused checks on each of three passages at six sizes, 162/162 classic checks, and teacher demo 173/173 on one machine and 172/173 on another; those were not rerun. The team's final build doc reports that deployment, passage upload, generation, and timing ran on the event AWS account. In a muted headless browser, audio loaded and the clock ran; highlight tolerance was not measured. Tap a word, keyboard use, and comparing two voices were not verified. No classroom-device use or full listening review is recorded.

---

## Technical details

Run commands from the repository root unless a row says to use `frontend-src/`. `npm run test:frontend` runs the listed Node harnesses, but a full run needs the frontend packages (`npm ci` in `frontend-src/`) and several ignored ReadWorks fixtures; the commands below let you isolate one check. Use Python 3, Node, and installed dependencies where named. `python -I` keeps Python imports isolated. The following are the executable test files under `tests/` and the tool trees; the new `lambdas/syllable_audio/` has no separate test entry point in this checkout:

| Check | Command from root | Needs |
|---|---|---|
| Audio and timing | `python -I tests/test_audio_check.py` | Writable Python temp directory; no AWS |
| Generative voice | `python -I tests/test_generative_voice.py` | No live AWS; optional case skips without its fixture |
| Passage service | `python -I tests/test_passage_service.py` | No live AWS |
| Quality gate | `python -I tests/test_quality_gate.py` | No live AWS |
| Reader bridge | `python -I tests/test_reader_bridge.py` | `demo-data/`, built `frontend/assets/`, and Node root packages for the nested publish test |
| Frontend publish | `node tests/test_publish_frontend.cjs` | Root `npm ci`; mocked S3 |
| Smoke | `node tests/test_smoke.js` | Root `npm ci`; mocked services |
| Compiled reader path | `node tests/reader_path.cjs < fixture.json` | Built `frontend/assets/` and JSON on stdin with `index` and `doc`; this is a fixture contract, not a standalone no-input command |
| Holds policy | `python -I tools/holds-lab/test_policy.py` | Public sample; private guards skip without `private/sample.json` |
| Recorder | `python -I tools/recorder/tests/test_recorder_local.py` | Invented text, synthetic sound; no microphone or AWS |

From `frontend-src/`, run `node tests/<name>.mjs` for each row below. `npm run test:frontend` from root invokes every row except the browser runners and ribbon test; it also invokes `node src/dataKit/usage.test.mjs`. `npm ci` in `frontend-src/` supplies Vue for harnesses that import it.

| Check | Command from `frontend-src/` | Needs |
|---|---|---|
| `apiclient_harness.mjs` | `node tests/apiclient_harness.mjs` | Node; no server or private media |
| `crisp_shared_harness.mjs` | `node tests/crisp_shared_harness.mjs` | Frontend `npm ci`; optional browser mode is listed below |
| `engine_harness.mjs` | `node tests/engine_harness.mjs` | Node; mocked media and clock |
| `fixhelp_harness.mjs` | `node tests/fixhelp_harness.mjs` | Ignored ReadWorks passage and gloss fixtures |
| `guide_sharing_harness.mjs` | `node tests/guide_sharing_harness.mjs` | Frontend `npm ci` |
| `holds_panel_harness.mjs` | `node tests/holds_panel_harness.mjs` | Node; no server |
| `kid_lead_render_harness.mjs` | `node tests/kid_lead_render_harness.mjs` | Node; synthetic text |
| `kid_units_harness.mjs` | `node tests/kid_units_harness.mjs` | Ignored ReadWorks passage fixture |
| `look_lazy_harness.mjs` | `node tests/look_lazy_harness.mjs` | Frontend `npm ci` |
| `reading_head_harness.mjs` | `node tests/reading_head_harness.mjs` | Node; synthetic word positions |
| `rehearsal_harness.mjs` | `node tests/rehearsal_harness.mjs` | Ignored ReadWorks `public/data/index.json` and passage data |
| `review_harness.mjs` | `node tests/review_harness.mjs` | Ignored ReadWorks word-help fixtures and review write-back tool |
| `teacher_demo_harness.mjs` | `node tests/teacher_demo_harness.mjs` | Frontend `npm ci`; invented class data |
| `teacher_preview_harness.mjs` | `node tests/teacher_preview_harness.mjs` | Ignored ReadWorks index and kid audio fixtures |
| `word_help_shared_harness.mjs` | `node tests/word_help_shared_harness.mjs` | Node; no server |
| Usage counts | `node src/dataKit/usage.test.mjs` | Node; no server |
| Sound ribbon | `node src/looks/sound/ribbon.test.mjs` | Node; no server |

Browser commands, from `frontend-src/` with a local Vite server (`npm run dev -- --host 127.0.0.1 --port 8992`) and passage data in the served site:

| Browser check | Command | Needs |
|---|---|---|
| Focused mode | `node tests/focused_browser.mjs http://127.0.0.1:8992` | Installed Edge, passage data; optional shot folder and passage ID |
| Classic reader | `node tests/reader_layout_browser.mjs http://127.0.0.1:8992 PASSAGE_ID` | Edge and that passage's data |
| Teacher demo | `node tests/teacher_demo_browser.mjs http://127.0.0.1:8992` | Edge, local site and relevant data |
| Kid calm | `node tests/run_kid_calm.mjs http://127.0.0.1:8992` | Chrome, local site and its kid passage media; this runner loads `kid_calm_harness.mjs` in the browser |
| Crisp shared browser option | `node tests/crisp_shared_harness.mjs --browser http://127.0.0.1:8992/#/kid/PASSAGE_ID` | Chrome, frontend packages, local site and media |

`_kinds.mjs`, `tools/recorder/tests/kinds.py`, and `stress_edits.py` are support modules, not separate test entry points. `ribbon.test.mjs` and `usage.test.mjs` pass. Other harness results depend on the prerequisites in the tables; dependency and fixture gaps were not repaired for this run.

---

Previous: [Names and pronunciation](names-and-pronunciation.md) · [Spec home](README.md) · Next: [Repo map](repo-map.md)
