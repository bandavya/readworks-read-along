# Sound Along data kit Counts how a read-along gets used, and lets a teacher see which students opened an assignment and used the tools. For a person: open [data_sheet.html](data_sheet.html) to see exactly what's gathered, where it goes and why.

**Made-up students only until ReadWorks decides otherwise.** Names and per-student records are sensitive, and this hasn't had a privacy, legal or security review.

| Layer | Files | Needs | Take it if |
|---|---|---|---|
| Counts on the device | `options.js`, `usage.js`, `UsagePanel.vue` | Vue 3 for the panel only | You want usage counts |
| Report to a teacher | `report.js`, `TeacherDashboard.vue` | A server (contract below) | You want the dashboard and have your own sign-in |
| Ready-made class flow | `classroom/` | `src/usage.js` and `src/apiClient.js` | You have no sign-in: students pick a name from the teacher's list |

## Plug it in

1. **Copy this folder** to `src/dataKit/`, and keep its files together: they import each other by relative path. Replace any older `usage.js` and panel with imports from here, rather than moving these files out.
2. **Check it:** `node usage.test.mjs` from the folder. No install. Exit code 0 means it's fine.
3. **Make one instance** in `src/usage.js`, so all readers share it:
   ```js
   import { DATA_OPTIONS } from './dataKit/options.js'
   import { createUsage } from './dataKit/usage.js'

   export const usage = createUsage({ options: DATA_OPTIONS, limit: import.meta.env?.VITE_DATA_OPTIONS })
   export const { record, trackPlayback } = usage
   ```
   `limit` is optional. Outside Vite, pass a comma-separated string or leave it out.
4. **Add the hooks** to your readers:

   | Call | Where |
   |---|---|
   | `record('opened', passageId)` | A passage has loaded |
   | `record('play_started', passageId)` | The narration audio's `play` event; skip one-word snippets |
   | `record('reached_end', passageId)` | Narration ended; skip one-word snippets |
   | `trackPlayback(audioElement, passageId)` | Once, right after the narration audio element is created. It also reports audio failures |
   | `record('word_tap', passageId)` | A tap or key press starts playback from a word |
   | `record('replay', passageId)` | A reader replays a sentence or restarts the story |
   | `record('word_card_opened', passageId)` | A reader asks for a meaning. Never for automatic cards |

   `passageId` must be a UUID; anything else is ignored. If one audio element also plays one-word snippets, those small stretches count toward the audio level; that's accepted, since the levels are coarse. A missing hook just means that count stays at zero.
5. **Show the device panel** (optional), on a staff or teacher page, not a child's reading screen: import `./dataKit/UsagePanel.vue`, then `<UsagePanel :usage="usage" />`.
6. **Run your app's build.** The kit's own check can't catch a wrong import path.

## Add the teacher dashboard

**With the ready-made flow.** Students open one class link, pick a name and read; the teacher opens a private link.

1. Have `src/apiClient.js` export `apiBase` and `apiRequest(path, { method, body })`.
2. Add a server with the contract below.
3. In `App.vue`, import from `./dataKit/classroom/`: `StudentPick.vue`, `TeacherClass.vue` and `{ readingAs, needsPick, notMe }` from `classLink`. Show `<StudentPick v-if="needsPick" />` before your router views, and `<TeacherClass :id="id" />` on a route like `#/teacher/class/<id>?k=<teacherKey>`. Show a line when `readingAs` is set, naming the student and saying what the teacher sees, with a button calling `notMe`.
4. On the page that makes an assignment, send `students` (a list of names) with it. Add `&a=<id>` to the student link, and give the teacher `#/teacher/class/<id>?k=<teacherKey>`.

`#/teacher/class/demo` shows made-up students, with no server.

**With your own sign-in.** Skip `classroom/`, and after sign-in call:
```js
import { createReporter } from './dataKit/report.js'
const reporter = createReporter({ options: DATA_OPTIONS, assignmentId, passageId, studentKey, send })
usage.listen(reporter.note)
```
`send(body)` returns a promise that rejects on failure; it then retries. Show `<TeacherDashboard :options="DATA_OPTIONS" :students="rows" />`, where `rows` is `[{ name, progress }]`.

## Server contract

- `POST /api/assignments` takes `{ passageId, className, soundOn, voice, view, students: [names] }`. Returns the assignment with `id`, `students: [{ key, name }]` and `teacherKey`.
- `GET /api/assignments/{id}` returns the same **without** `teacherKey`.
- `POST /api/progress` takes `{ assignmentId, studentKey, progress: { field: number } }`. Refuse an unknown student, and any field not in `options.js` with a `teacher` mark. Merge by keeping the highest value, since a student's device resends its whole state.
- `POST /api/class-progress` takes `{ assignmentId, teacherKey }`. Returns `{ className, passageId, students: [{ name, progress }] }`. Compare the key in constant time, and never return student keys.

Expire these records. A working Python version is in `server.patch`, beside this folder in the package, for the lab API (`aws-lab/labs/api/lambda/handler.py`). `reader-wiring.patch`, also beside it, shows every hook and route in one real reader.

**Known limit:** with name picking, the name list holds each student's key, and anyone with the class link can get it, so they can report as another student. That's fine for a demo with made-up students. Real use needs real sign-in, with the server taking the student's identity from it rather than from the request.

## Adding or removing a count

- **For good:** add or delete a line in `options.js`, then run `node make_sheet.mjs` and `node usage.test.mjs`. Recording, panel, CSV and data sheet follow. A new count needs one new `record('its_id', passageId)` hook.
- **Send it to the teacher, or stop:** add or remove `teacher: 'yes'` and `teacherLabel` on that line, and update the server's allowed fields. The dashboard follows.
- **For one build:** set `VITE_DATA_OPTIONS=opened,playback`. Empty keeps nothing. Stored data for anything not allowed is deleted at the next page load.
- **On one device:** the panel's checkboxes. Turning one off also deletes what it kept, and stops sending it.

## What it touches

- Browser storage: `sa-usage-v1` (counts), `sa-data-off-v1` (options turned off), and in the class flow `sa-reading-as-v1` in session storage (who's reading, this tab only). Rename them if they clash.
- Network: only `report.js`'s `send` and `classroom/`. `usage.js` and `options.js` have none, and a check fails if that changes.
- To take it out: remove the hooks and the folder, then those keys and the server routes.

## Rules worth keeping

- These count tool use, not reading, learning or a judgment of a child. Don't show them as one.
- Don't send a word, minutes, a time or a score to a teacher, or report library reading, without ReadWorks deciding to. Checks fail if a stored value isn't a number, or if a report gains fields.
- The student's screen must say what the teacher sees.
- `usage.test.mjs` ends with a `SUMMARY guards_passed=..` line for this project's check runner. Elsewhere, the exit code is enough.
