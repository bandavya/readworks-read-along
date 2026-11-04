# Testing the dashboard at the event So far the dashboard has run only between browser tabs on one computer, against a local copy of the server. It has never run on AWS, on a phone or tablet, or on a school-like network. This list is how to find out.

**Made-up names only.** Anyone with the class link can see every name and report as any of them.

## Before deploying

1. **Check the account.** Run `aws sts get-caller-identity` and confirm it's the event account. The lab API's `app.py` defaults to a personal account, so always pass `-c account=<event account> -c region=<event region>`.
2. **Say the cost.** It adds no hourly-billed resources, only pay-per-request charges, which should be small for a test. Check the event's rules on anything billable.
3. **Run the checks.** `node usage.test.mjs` from the kit, `python -I tests/test_api_local.py` from `aws-lab/labs/api`, and the app's build. Stop if any fails.
4. **Allow your passages.** `aws-lab/labs/api/lambda/passages_allow.json` lists the passages the server accepts; anything else is refused. `tools/make_allowlist.py` is there for this; check how it runs before relying on it.
5. **Deploy, then build the reader** with `VITE_API_BASE` set to the deployed address. The server only accepts browsers from the origins in its stack settings, so `-c live_origin=<your site>` must match where the reader is served.

## The test

Use at least two real devices besides the teacher's computer. Include an iPad or iPhone if you can: Safari hasn't been tried. Keep the sound low.

| # | Do this | You should see |
|---|---|---|
| 1 | Teacher page: pick a passage, enter 3 made-up names, make the link | A student link and an "Open class progress" link |
| 2 | Open the progress link before anyone reads | All three "not opened here" |
| 3 | Device A: open the student link, pick a name | The name list, then the reader with "Reading as ..." and what the teacher sees |
| 4 | On device A, press play for a while, tap a word, hold a word for its meaning | After a few seconds and Refresh: Opened, an audio level, Tapped a word, Used word help |
| 5 | Device B: open the link, pick "I'm not on this list", read | Nothing changes on the dashboard |
| 6 | Device B: open a fresh tab, pick the second name, listen to the end | That row shows "Nearly all" |
| 7 | The third name opens nothing | Still "not opened here" |
| 8 | Device A: tap a word and close the tab straight away | The tap still arrives |
| 9 | Device A: go offline, tap a word, go back online and wait about 30 seconds with the tab open | The tap arrives |
| 10 | Block the audio file (a network block or browser dev tools), then press play | "Audio wouldn't play" for that student, and the text is still readable |
| 11 | Try the progress link with the `k=` part removed | "Couldn't load this class" |
| 12 | Open the kid view from the class link | Reports the same way, and "Reading as" doesn't get in the way |
| 13 | On the venue's network, try a device with content filtering if there is one | Note whatever gets blocked |
| 14 | `#/teacher/class/demo` | Made-up students, marked as mock |

**Also check, by eye:** whether a teacher, or anyone playing one, reads "Partway" as "didn't try". That's the open question most worth answering.

**If something fails:** note the device, browser and what you saw. Reading must keep working even if reporting fails; if it doesn't, turn reporting off by building without `VITE_API_BASE`.

## Afterward

- Update `data_sheet.html`: it says the routes are tested on a local copy and not yet on AWS. Change that only to what really happened.
- Records are set to expire after 14 days, and deletion can lag by a few days. Destroy the stack when finished if nothing else needs it; that deletes its data.
