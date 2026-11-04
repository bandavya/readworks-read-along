// Self-contained checks for the data kit. Run: node usage.test.mjs  (no install, no browser)
// Prints the SUMMARY line this project's check runner reads; any other project can rely on the exit code.
import { readFileSync } from 'node:fs'
import { DATA_OPTIONS } from './options.js'
import { createUsage, display } from './usage.js'
import { createReporter } from './report.js'
import { sheetWithOptions } from './make_sheet.mjs'

let passed = 0
let failed = 0
const G = (ok, name) => { if (ok) passed++; else { failed++; console.log(`  FAIL  ${name}`) } }

const here = (file) => readFileSync(new URL(file, import.meta.url), 'utf8')
const store = new Map()
globalThis.localStorage = {
  getItem: (key) => store.get(key) ?? null,
  setItem: (key, value) => store.set(key, String(value)),
}
const fresh = (options = DATA_OPTIONS, limit) => { store.clear(); return createUsage({ options, limit }) }
const ID = '11111111-2222-4333-8444-55555a555555'
const rowOf = (usage) => usage.summary().find((r) => r.passageId === ID)
const playback = DATA_OPTIONS.find((o) => o.id === 'playback')
const top = playback.levels.length - 1

// A stand-in for an audio element: plays a list of [start, end] stretches and fires its timeupdate listener.
function tracked(usage, duration) {
  const listeners = []
  const audio = { duration, played: { length: 0 }, addEventListener: (_, fn) => listeners.push(fn) }
  audio.play = (...stretches) => {
    audio.played = { length: stretches.length, start: (i) => stretches[i][0], end: (i) => stretches[i][1] }
    listeners.forEach((fn) => fn())
  }
  usage.trackPlayback(audio, ID)
  return audio
}

// Nothing leaves the device, and the kit stands alone
for (const file of ['usage.js', 'options.js', 'report.js']) {
  G(!/\b(fetch|XMLHttpRequest|sendBeacon|WebSocket|EventSource)\b|https?:\/\/|import\s/.test(here(file)), `${file} has no network call, address or import`)
}
G(!/\bfetch\b|XMLHttpRequest|sendBeacon|https?:\/\//.test(here('UsagePanel.vue')), 'the panel has no network call or address')
G(!/from '\.\.\//.test(here('UsagePanel.vue') + here('TeacherDashboard.vue')), 'the screens import nothing outside the kit')
G(!/\bfetch\b|https?:\/\//.test(here('TeacherDashboard.vue')), 'the dashboard has no network call or address; its host loads the data')

// Nothing about a child
let usage = fresh()
usage.record('opened', ID)
tracked(usage, 10).play([0, 1])
const kept = JSON.parse(store.get('sa-usage-v1'))
G(Object.keys(kept).join() === ID, 'storage is keyed only by passage id')
G(Object.keys(kept[ID]).every((k) => k === 'passageId' || DATA_OPTIONS.some((o) => o.id === k)), "storage holds only the table's options")
G(Object.values(kept[ID]).every((v) => v === ID || Number.isInteger(v)), 'every stored value is a number')
usage.record('opened', 'not-a-passage')
G(usage.summary().length === 1, 'an invalid passage id records nothing')
const before = rowOf(usage).playback
usage.record('playback', ID)
G(rowOf(usage).playback === before, 'playback cannot be raised by a plain event')

// Turning options off, deleting
usage = fresh()
usage.record('word_tap', ID)
G(rowOf(usage)?.word_tap === 1, 'an option that is on records')
usage.setRecording('word_tap', false)
usage.record('word_tap', ID)
G(!usage.activeOptions().some((o) => o.id === 'word_tap'), 'an option that is off leaves the active list')
G(!rowOf(usage), 'an option that is off shows nothing')
G(!store.get('sa-usage-v1').includes(ID), 'turning off the only data removes the passage from storage')
usage.setRecording('word_tap', true)
usage.record('word_tap', ID)
G(rowOf(usage)?.word_tap === 1, 'turning it back on starts from nothing')
usage.clear()
G(usage.summary().length === 0 && store.get('sa-usage-v1') === '{}', 'clear deletes every count')
usage.setRecording('word_tap', false)
G(!createUsage({ options: DATA_OPTIONS }).activeOptions().some((o) => o.id === 'word_tap'), 'an option turned off stays off on the next visit')

// Build limit and table changes
const [first, second] = DATA_OPTIONS.map((o) => o.id)
G(fresh(DATA_OPTIONS, `${first}, ${second}`).allowedOptions().length === 2, 'a build can narrow the list')
G(fresh(DATA_OPTIONS, '').allowedOptions().length === 0, 'an empty build list keeps nothing')
G(fresh(DATA_OPTIONS, 'not_real').allowedOptions().length === 0, 'an unknown id adds nothing')
usage = fresh()
usage.record(first, ID)
const narrowed = createUsage({ options: DATA_OPTIONS, limit: second })
G(!store.get('sa-usage-v1').includes(`"${first}"`), 'loading a narrower build deletes what it no longer allows')
G(narrowed.summary().length === 0, 'a narrower build shows nothing it does not allow')
const noPlayback = DATA_OPTIONS.filter((o) => o !== playback)
usage = fresh(noPlayback)
let removedOk = true
try { usage.record('opened', ID); usage.record('playback', ID); tracked(usage, 10).play([0, 10]) } catch { removedOk = false }
G(removedOk && !('playback' in rowOf(usage)), 'removing the playback line breaks nothing and keeps no playback')
usage = fresh([...DATA_OPTIONS, { id: 'new_count', label: 'New' }])
usage.record('new_count', ID)
G(rowOf(usage)?.new_count === 1, 'adding a line to the table records it with no other change')

// Playback comes from what the browser says played
usage = fresh()
tracked(usage, 100).play()
G(!rowOf(usage), 'nothing played records nothing')
tracked(usage, NaN).play([0, 5])
G(!rowOf(usage), 'an unknown length claims nothing')
const jumped = tracked(usage, 100)
jumped.play([98, 100])
const afterJump = rowOf(usage).playback
G(afterJump < top, 'a jump to the end does not count as playing it all')
jumped.play([98, 100])
G(rowOf(usage).playback === afterJump, 'replaying one stretch does not raise the level')
jumped.play([0, 100])
G(rowOf(usage).playback === top, 'everything played reaches the top level')
tracked(usage, 100).play([0, 5])
G(rowOf(usage).playback === top, 'a later, shorter reading does not lower the level')
usage.setRecording('playback', false)
usage.setRecording('playback', true)
jumped.play([0, 100])
G(rowOf(usage)?.playback === top, 'playback records again after being turned off and on')

// Bad or blocked storage
usage = fresh()
store.set('sa-usage-v1', '{broken')
G(usage.summary().length === 0, 'broken stored data shows nothing and does not throw')
store.set('sa-usage-v1', JSON.stringify({ [ID]: { opened: 1, word_tap: -4, playback: 99 } }))
G(rowOf(usage)?.word_tap === 0, 'an impossible stored count becomes zero')
G(rowOf(usage)?.playback === 0 && display(playback, 0) === playback.levels[0], 'an impossible stored level is not kept')
store.set('sa-usage-v1', JSON.stringify({ [ID]: { playback: 99 } }))
G(!rowOf(usage), 'a passage with only an impossible level shows nothing')
const realStorage = globalThis.localStorage
Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('blocked') } })
let blockedOk = true
try {
  const blocked = createUsage({ options: DATA_OPTIONS })
  blocked.record('opened', ID)
  blockedOk = rowOf(blocked)?.opened === 1
} catch { blockedOk = false }
Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: realStorage })
G(blockedOk, 'blocked storage keeps working in memory and does not throw')

// The table is complete, and the sheet shows exactly the table
G(new Set(DATA_OPTIONS.map((o) => o.id)).size === DATA_OPTIONS.length, 'option ids are unique')
G(DATA_OPTIONS.every((o) => o.label && o.hook && o.from && o.helps && o.cannotTell), 'every option says what it is, where it comes from, what it helps and what it cannot tell')
G(here('data_sheet.html') === sheetWithOptions(here('data_sheet.html'), DATA_OPTIONS), 'the data sheet matches the table (run: node make_sheet.mjs)')

// What reaches the teacher
{
  const sent = []
  const reporter = (over = {}) => createReporter({ options: DATA_OPTIONS, assignmentId: 'a1', passageId: ID, studentKey: 's1', wait: 0, send: async (body) => { sent.push(body) }, ...over })
  const settle = () => new Promise((r) => setTimeout(r, 5))
  const r = reporter()
  r.note('opened', 1, ID); r.note('opened', 1, ID); r.note('word_card_opened', 1, ID); r.note('playback', 2, ID)
  await settle()
  const last = sent.at(-1)
  G(Object.keys(last).sort().join() === 'assignmentId,progress,studentKey', 'a report holds only the assignment, a student key and progress')
  G(last.progress.opened === 1 && last.progress.word_card_opened === 1 && last.progress.playback === 2, 'a report carries what happened')
  sent.length = 0
  r.note('opened', 1, ID)
  await settle()
  G(sent.length === 0, 'nothing new means nothing sent')
  r.note('reached_end', 1, ID); r.note('play_started', 1, ID)
  await settle()
  G(sent.length === 0, 'an option with no teacher mark never leaves the device')
  r.note('word_tap', 1, 'aaaaaaaa-2222-4333-8444-55555a555555')
  await settle()
  G(sent.length === 0, 'reading a different passage is not reported')
  r.note('playback', 1, ID)
  await settle()
  G(sent.length === 0, 'a lower audio level is not sent')
  r.note('word_tap', 'erupt', ID)
  await settle()
  G(sent.at(-1)?.progress.word_tap === 1, 'a yes field sends 1 whatever it is given, so a word cannot travel in it')
  G(DATA_OPTIONS.filter((o) => o.teacher).every((o) => o.teacherLabel && ['yes', 'level'].includes(o.teacher)), 'each option sent to a teacher is labeled, and coarse')
  G(DATA_OPTIONS.filter((o) => o.teacher === 'level').every((o) => o.levels), 'a level option has levels')

  // The device total must not become a student's
  const shared = fresh()
  shared.record('word_tap', ID)
  const heard = []
  shared.listen((id, value, passageId) => heard.push([id, value, passageId]))
  G(heard.length === 0, 'starting to listen does not send what earlier readers on this device did')
  shared.record('opened', ID)
  G(heard.length === 1 && heard[0][0] === 'opened', 'a listener hears each new event')
  tracked(shared, 100).play([0, 100])
  G(heard.at(-1)[1] === top, 'a new reader on a shared device still reports their own audio level')
  shared.setRecording('opened', false)
  heard.length = 0
  shared.record('opened', ID)
  G(heard.length === 0, 'an option turned off is not sent either')

  // Sending fails, then recovers
  let tries = 0
  const flaky = createReporter({ options: DATA_OPTIONS, assignmentId: 'a', passageId: ID, studentKey: 's', wait: 0, retry: 1, send: async () => { tries++; if (tries === 1) throw new Error('blocked') } })
  flaky.note('opened', 1, ID)
  await new Promise((res) => setTimeout(res, 20))
  G(tries === 2, 'a failed send tries again and does not throw')
}

console.log(`SUMMARY guards_passed=${passed} guards_failed=${failed} behavior_matching=0 behavior_changed=0 guard_rules=${passed + failed}`)
process.exit(failed ? 1 : 0)
