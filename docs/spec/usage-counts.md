# Usage counts

*What reading activity does this prototype count, and where does it go?*

Word help and the classroom · Status: built and tested locally

Teachers and ReadWorks may want to know whether the reading tools get used, without grading a child. Sound Along can count a small set of actions on the browser that opened a passage: opening it, starting or reaching the end of audio, tapping or replaying, opening word help, how much audio played, and an audio error. Only the classic reader and its older younger-reader route count all of these, and the default Younger readers link counts nothing; a separate Reading helper page counts word help openings. The focused reader, the default first view, counts nothing.

These counts stay on the device. The Assign a passage page shows totals per passage, lets someone turn each count off, and can export or delete them. A total has no student identity, and a teacher opening a passage adds to the same total.

A separate class-link path reports activity only after a student picks a name for one assigned passage. Under a child's name the teacher sees a yes or a level, with finer detail only when pooled across a class. The teacher does not receive the word, exact count, minutes, or a reading score.

Audio coverage says what the player ran, not what anyone heard. A tap can mean curiosity as well as trouble. ReadWorks and its counsel decide whether any named reporting belongs in the product.

**These numbers describe tool use and cannot grade reading.**

The device keeps eight tool-use measures, while the optional class report sends only coarse progress:

![A table of eight device counts, the six that can become a yes or a coarse audio level in an assigned class report, and that the default focused reader counts nothing.](shots/fig-usage-counts.svg)

## How it connects

[Teacher dashboard](teacher-dashboard.md) shows the coarse class report. [Class link flow](class-link-flow.md) explains the name choice and its identity limit. [Word meanings](word-meanings.md) describes one of the events counted here.

## Where it stands

The device counts, the local CSV export, and the class reporter are built. The repo's data sheet describes a local end-to-end run with made-up students and a local server, not the event AWS account. No real student, teacher, or ReadWorks person has used this reporting flow, no classroom-device trial or human listening check could be confirmed. The team reports the reader deployed on the event AWS account, with `passageApi` off and student access through the legacy API only; the named class reporter was not verified there. Browser tests used muted sound, so audio coverage does not show anyone listened.

---

## Technical details

`frontend-src/src/dataKit/options.js` is the field list. `usage.js` keeps passage totals under `sa-usage-v1` in local storage and disabled fields under `sa-data-off-v1`; `UsagePanel.vue` presents toggles, deletion, and CSV. A build can restrict fields with `VITE_DATA_OPTIONS`; absent means all listed fields, and an empty value means none. Only valid passage UUIDs are stored. Storage failure falls back to memory. Turning a field off removes its stored totals and stops forwarding its events.

The hooks are called from `views/Passage.vue`, `views/KidView.vue` and `components/KidReader.vue`; `looks/mix/MixReader.vue` (focused) has none. `dataKit/report.js` listens to *new* events, not device totals. It sends `{ assignmentId, studentKey, progress }` for the assigned passage. Fields marked `teacher: 'yes'` become `1`; `playback` is `teacher: 'level'`, with `1` Partway, `2` Significant part, and `3` Nearly all. Its thresholds are any playback, at least half, and at least 95 percent of duration. The browser debounces reports for 3 seconds and retries failures after 30 seconds. Counts such as `play_started` and `reached_end` stay on the device because they have no teacher mark.

`frontend-src/src/dataKit/data_sheet.html` is generated against the options table by `node src/dataKit/make_sheet.mjs` and is checked for drift. It also states the main limit: anyone with the student link can choose another name. Test the kit with `cd frontend-src; node src/dataKit/usage.test.mjs`. The team reports the public site has no sign-in, and the legacy `/generate` route can start paid runs without a credential. The report's yes or level rule is a prototype choice for ReadWorks and its counsel to evaluate before real use.

---

Previous: [Reviewing word help](reviewing-word-help.md) · [Spec home](README.md) · Next: [Teacher dashboard](teacher-dashboard.md)
