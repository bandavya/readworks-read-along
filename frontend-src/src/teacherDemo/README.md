# Class 4B demo This is a fictional browser session with no sign-in, API calls, or real student data. A hand-edited reader link can bypass its settings; a real assignment needs server enforcement.

From the repository root, run `npm run build:frontend`, then `cd frontend-src` and `npx vite preview --outDir ../frontend --port 8992 --strictPort --configLoader native`. Open `http://localhost:8992/#/class-demo`. The preview server supports byte ranges for audio seeking. Audio starts only after a person presses Play. For the presenter walk, open Maya's story while class read aloud is on; tap “determined” for an immediate word card. Return to Ms. Rivera through the presenter switcher, turn class read aloud off, then open Diego and Jordan. Jordan's read-aloud setting stays on. Assignment shows coarse sample status, Class words shows pooled words, and Priya has a separate content queue.

`classData.js` holds the invented class and pooled words. `resolve.js` applies ReadWorks defaults, class, group, student, student choice, and accommodation locks in that order. `session.js` keeps class settings and student choices in memory across hash routes. The demo uses the real passage reader and the data kit dashboard; sample status does not change when someone reads.

The team's `demo-data/assignments.json` and `/passages/{id}/access` route are a separate mock access record; this browser demo does not call or change them.

If the local passage JSON is missing, the demo remains open, says that the sample passage is unavailable, and hides links that would open it.

## Remove

Delete `frontend-src/src/teacherDemo/` and the two teacher demo tests. In `App.vue`, remove the `TeacherDemo` and `reader.css` imports, the `demoRoute` and `showPick` declarations, and the demo route branch, then revert the `demoRoute` and `showPick` guards on the ordinary shell elements. Remove the `class-demo` route lines from `router.js`, the `td` fields from `linkSettings.js`, and the conditional `assigned.demo` branches in `Passage.vue`, `KidView.vue`, `Review.vue`, `useAutoWordCards.js`, `VocabCard.vue`, `SyllableGuide.vue`, and `TeacherDashboard.vue`. Remove `teacher_demo_harness.mjs` from `scripts/test-frontend.js` and rebuild. The reader files have no imports from the demo folder.

## Checks

Run `npm run test:frontend` from the root. With a byte-range capable server for `frontend/`, run `node frontend-src/tests/teacher_demo_browser.mjs http://localhost:8992`. The browser script starts installed Edge in muted, private mode and checks phone and desktop widths. Media for the assigned passage must be linked into `frontend/data` and `frontend/audio` locally; it is never committed.
