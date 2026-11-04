# Human recordings

*How does an approved volunteer reading become a reader voice?*

Tools for people · Status: built and tested locally

A volunteer reading gives a passage a second voice choice besides the synthesized one. This page covers what happens when a reading is approved.

The recorder prepares a cleaned audio file and matches each written word to its time in that file, so the word highlight follows the speaker. A reviewer always holds the recording, even when the automated checks pass. The reviewer sees the submitted version, listens, and approves it or sends it back. The volunteer's own “sounds fine” note publishes nothing.

Approval adds a human voice to the passage and to the library's list of voices. If a human voice was already there, it is saved so it can be restored, and the earlier audio file stays in place. A record keeps the approved file's fingerprint (a hash) and the reviewer's typed name. Rebuilding the reader's data can drop the human voice, so a reapply command reads the record and adds it back.

**The approval record names the exact audio file placed in the reader and makes undo possible.**

Approval changes three reader files and saves enough to undo the change:

![A locally reviewed exact MP3 is approved into reader audio and data; the publication record saves its hash and the earlier human voice for undo or reapply.](shots/fig-human-recordings.svg)

## How it connects

Recording and the review screen are in [Volunteer recorder](volunteer-recorder.md). For what an approved voice looks like in the data, see [Reader passage record](reader-passage-record.md); [Website files and media](website-files-and-media.md) shows where the audio file lands.

## Where it stands

Local tests with invented data checked approval, replacement, undo, and reapply, and the recorder suite passed 156 guard rules. No person has listened to a real recording through this path, no child or ReadWorks person has tried it, and this volunteer approval path has not run on the event AWS account or a real student device. The team reports that the separate generated-audio pipeline has run there. The reviewer name is typed, with no sign-in.

---

## Technical details

`tools/recorder/serve.py` stores a session and submission under `tools/recorder/human_recordings/sessions/`. `approve_session` requires a pending submission, a reviewer name, a listening acknowledgment, a matching submitted SHA and page SHA, and `engine.decide(...)["publish"]`. Approval is refused if too little of the take matches the story or its word timing is broken, even when a reviewer releases word flags. It writes a record under `human_recordings/published/<uuid>.json`; the runtime folders are ignored by git. The approval path calls `tools/recorder/to_reader.py`.

`to_reader.publish` copies the approved MP3 to `audio/<uuid>-volunteer-<sha>.mp3` inside the configured site. It replaces only voice ID `human` in `data/<uuid>.json` and updates that passage's `voices` list in `data/index.json`. It keeps the prior human voice entry in `replaced_voice`; a second volunteer publication still retains the original. It does not delete the older file. `undo` restores that entry and renames the publication record `.undone`; `reapply` restores entries from active records after a data rebuild.

The default site is `tools/recorder/private/reader/`, which needs `data/index.json` and matching passage JSON. Use `python tools/recorder/to_reader.py undo UUID --site PATH` or `python tools/recorder/to_reader.py reapply --site PATH`. Test with `python -I tools/recorder/tests/test_recorder_local.py`; it uses synthetic audio and no AWS. The reader's live file serving and listening quality with a real voice remain to be checked.

---

Previous: [Volunteer recorder](volunteer-recorder.md) · [Spec home](README.md) · Next: [Holds lab](holds-lab.md)
