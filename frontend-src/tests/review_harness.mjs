// Harness for the word-help review state (src/review.js) and the write-back script (tools/apply_reviews.py).
// Run from prototype/app:  node tests/review_harness.mjs
// No browser, no network. Uses the real data files in public/data, and a temp COPY of them for the write-back test.
// Kinds (see tests/README.md): GUARDS = unreviewed work never reads as approved, an edited entry's old approval stops
// counting, decisions survive a reload, the export -> write-back round trip changes exactly what was reviewed (and
// nothing else), ids are unique. BEHAVIOR (reported only) = today's state names ("draft", "checked", "fix"),
// group rules, export schema name, and the scripts' printed wording. A flagged item never reads approved is a guard.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import { okGuard as G, okBehavior as B, finish } from './_kinds.mjs'

// These fixtures are private media; keep the harness available when local data is linked.
const requiredLocalFiles = ['public/data/kid_audio.json', 'public/data/syllables', 'public/data/gloss', '../tools/apply_reviews.py']
if (requiredLocalFiles.some(file => !fs.existsSync(new URL('../' + file, import.meta.url)))) {
  console.log('SKIP review_harness.mjs: private ReadWorks fixtures or review tool are absent')
  process.exit(0)
}

// a tiny in-memory localStorage, installed before review.js loads
const mem = new Map()
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => void mem.set(k, String(v)),
  removeItem: (k) => void mem.delete(k),
}

const here = path.dirname(fileURLToPath(import.meta.url))
const appDir = path.resolve(here, '..')
const dataDir = path.join(appDir, 'public', 'data')
const R = await import(pathToFileURL(path.join(appDir, 'src', 'review.js')).href)

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'))
const reads = (item) => ['approved', 'checked'].includes(R.reviewOf(item).state) // reads as someone approved it

// ---- load every passage's word help, the way the review screen does ----
function load(dir, ids) {
  const out = []
  for (const pid of ids) {
    const gp = path.join(dir, 'gloss', pid + '.json')
    const sp = path.join(dir, 'syllables', pid + '.json')
    const dp = path.join(dir, pid + '.json')
    const k = readJson(path.join(dir, 'kid_audio.json'))
    out.push(...R.itemsForPassage(pid, {
      gloss: fs.existsSync(gp) ? readJson(gp) : null,
      syllables: fs.existsSync(sp) ? readJson(sp) : null,
      kid: k,
      data: readJson(dp),
    }))
  }
  return out
}
const ids = fs.readdirSync(path.join(dataDir, 'syllables')).map((f) => f.replace('.json', ''))
const gids = fs.readdirSync(path.join(dataDir, 'gloss')).filter((f) => f.endsWith('.json')).map((f) => f.replace('.json', ''))
const allIds = [...new Set([...ids, ...gids])]
const items = load(dataDir, allIds)

// 1. fingerprints and keys
G(R.hashText('') === '811c9dc5', 'hash of empty string is the FNV offset basis')
G(R.hashText('a') === 'e40c292c', 'hash of "a" matches the FNV-1a test vector', R.hashText('a'))
G(new Set(items.map((i) => i.key)).size === items.length, `all ${items.length} item keys are unique`)
const kinds = items.reduce((m, i) => ((m[i.kind] = (m[i.kind] || 0) + 1), m), {})
B(kinds.gloss === 932 && kinds.syllables === 61, 'item counts today: 932 meanings, 61 syllable guides', JSON.stringify(kinds))

// 2. nothing reads as approved unless a person decided: with no local choices, only an entry the data file itself
//    marks "approved" may read as approved
R.reloadStore()
G(items.every((i) => !reads(i) || R.dataApproved(i)), 'with no review choices, nothing reads as approved unless the data file says so')
const t0 = R.tally(items)
B(t0.approved === 0 && t0.draft === t0.total, 'shipped data today: nothing approved, every item a draft', JSON.stringify(t0))
B(items.every((i) => R.reviewOf(i).state === 'draft'), 'every item reads as "draft" before anyone reviews')

// 3. a grown-up approves one, flags one
const g = items.find((i) => i.kind === 'gloss' && i.clips.length)
const s = items.find((i) => i.kind === 'syllables')
const g2 = items.find((i) => i.kind === 'gloss' && i !== g)
R.reviewer.set('AM')
await R.verifyAudio(g, async () => new Uint8Array([1, 2, 3]))
R.setReview(g, 'approved', 'sounds right')
R.setReview(s, 'fix', 'stress on the wrong beat')
G(R.reviewOf(s).note === 'stress on the wrong beat', 'a flagged item keeps its note')
G(!reads(s), 'a flagged item does not read as approved')
G(!reads(g2), 'an item nobody touched does not read as approved')
B(R.reviewOf(g).state === 'checked', 'approved on this device reads as "checked" (not the data-file "approved")')
B(R.reviewOf(s).state === 'fix', 'needs-a-fix reads as "fix"')
B(R.reviewOf(g2).state === 'draft', 'an item nobody touched reads as "draft"')
B(R.combineStates([g, s]) === 'fix' && R.combineStates([g, g2]) === 'draft' && R.combineStates([g]) === 'checked' && R.combineStates([]) === 'approved' && R.combineStates([null]) === 'approved', 'a group shows its least-reviewed member; nothing of ours = no marker')
const t1 = R.tally(items)
B(t1.approved === 1 && t1.fix === 1 && t1.draft === t1.total - 2, 'tally follows', JSON.stringify(t1))

// 4. choices survive a reload (localStorage), and an edit invalidates them
R.reloadStore()
G(R.reviewer.get() === 'AM' && !reads(s) && reads(g), 'choices and the reviewer name survive a reload')
B(R.reviewOf(g).state === 'checked', 'after a reload the approval still reads as "checked"')
const edited = { ...g, hash: R.hashText('different text') }
G(!reads(edited), 'if the text or clip changes, the old approval stops counting')
B(R.reviewOf(edited).state === 'draft' && R.reviewOf(edited).changed === true, 'an edited item reads as "draft" and says it changed since review')
await R.verifyAudio(g, async () => new Uint8Array([1, 2, 4]))
G(!reads(g), 'replacing recording bytes at the same path invalidates the old approval')
await R.verifyAudio(g, async () => new Uint8Array([1, 2, 3]))

// A note save may still be waiting for audio when the reviewer changes the decision.
let finishNoteAudio
const noteAudio = new Promise((resolve) => { finishNoteAudio = resolve })
const pendingNote = R.saveReviewNote(g, 'older note', async () => noteAudio)
R.setReview(g, 'fix', 'newer problem')
finishNoteAudio(new Uint8Array([1, 2, 3]))
const noteSaved = await pendingNote
G(!noteSaved && R.reviewOf(g).state === 'fix' && R.reviewOf(g).note === 'newer problem',
  'a note save waiting for audio cannot overwrite a newer Needs a fix decision')
R.setReview(g, 'approved', 'sounds right')

// 5. data-file approval, and a local "needs a fix" outranks it
const g2Versions = await R.verifyAudio(g2, async () => new Uint8Array([8, 9]))
const dataApproved = { ...g2, dataReview: 'approved', approvedHash: g2.hash, approvedAudioVersions: g2Versions }
B(R.reviewOf(dataApproved).state === 'approved', 'an entry the data file marks "approved" reads as "approved"')
R.setReview(dataApproved, 'fix', 'later problem')
G(!reads(dataApproved), 'a later local flag never reads as approved, even over a data-file approval')
B(R.reviewOf(dataApproved).state === 'fix', 'a later local flag currently displays as "fix"')
R.clearReview(dataApproved)
G(!reads({ ...g2, dataReview: 'needs human check' }), '"needs human check" in the data does not read as approved')
B(R.reviewOf({ ...g2, dataReview: 'needs human check' }).state === 'draft', '"needs human check" in the data reads as "draft"')
B(R.reviewOf({ ...g2, dataReview: 'needs fix' }).state === 'fix', '"needs fix" in the data shows as flagged ("fix")')

// 6. export shape
const ex = R.buildExport(items, new Date('2026-10-31T23:00:00Z'))
G(ex.reviewer === 'AM' && ex.decisions.length === 2, 'the export has the reviewer and both decisions')
G(ex.decisions.some((d) => d.state === 'approved' && d.key === g.key) && ex.decisions.some((d) => d.state === 'needs_fix' && d.note), 'the export carries approved / needs_fix decisions with their notes')
B(ex.schema === 'sound-along-review/1', 'export schema name is "sound-along-review/1"', ex.schema)

// 7. write-back: apply the export to a temp COPY of the data and read it again
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'review-data-'))
const tmp = path.join(tmpRoot, 'data')
fs.mkdirSync(tmp)
fs.cpSync(dataDir, tmp, { recursive: true, filter: (src) => !/[\\/]audio[\\/]|\.(mp3|wav|webp|png)$/.test(src) })
const exportPath = path.join(tmp, 'export.json')
fs.writeFileSync(exportPath, JSON.stringify(ex))
const tools = path.resolve(appDir, '..', 'tools', 'apply_reviews.py')
const py = (...args) => spawnSync('python', ['-I', tools, ...args], { encoding: 'utf8' })
const dry = py(exportPath, '--data', tmp)
G(dry.status === 0, 'apply_reviews.py dry run succeeds', dry.stdout + dry.stderr)
B(/2 applied, 0 changed since reviewed, 0 not found \(dry run/.test(dry.stdout), 'dry run prints "2 applied, 0 changed since reviewed, 0 not found (dry run"', dry.stdout)
G(readJson(path.join(tmp, 'gloss', g.pid + '.json')).entries.every((e) => !e.review), 'dry run left the gloss file untouched')
const real = py(exportPath, '--data', tmp, '--write')
G(real.status === 0, 'apply_reviews.py --write succeeds', real.stdout + real.stderr)
B(/2 applied/.test(real.stdout), 'write run prints "2 applied"', real.stdout)
const items2 = load(tmp, allIds)
mem.clear()
R.reloadStore() // a different browser: no local choices at all
const gAfter = items2.find((i) => i.key === g.key)
const sAfter = items2.find((i) => i.key === s.key)
G(gAfter.approvedHash === g.hash && JSON.stringify(gAfter.approvedAudioVersions) === JSON.stringify(ex.decisions.find((d) => d.key === g.key).audioVersions),
  'write-back carries the reviewed text and audio versions into the data entry', JSON.stringify(gAfter))
await R.verifyAudio(gAfter, async () => new Uint8Array([1, 2, 3]))
G(reads(gAfter), 'a versioned file approval counts when the recording bytes still match')
await R.verifyAudio(gAfter, async () => new Uint8Array([1, 2, 4]))
G(!reads(gAfter), 'a changed recording revokes the written file approval')
G(R.reviewOf(sAfter).state === 'fix', 'after write-back the flagged entry is still flagged')
G(items2.filter((i) => i.key !== g.key && i.key !== s.key).every((i) => !reads(i)), 'no other entry became approved')
await R.verifyAudio(gAfter, async () => new Uint8Array([1, 2, 3]))
G(R.tally(items2).approved === 1 && R.tally(items2).fix === 1, 'versioned write-back grants only the reviewed approval', JSON.stringify(R.tally(items2)))
const gf = readJson(path.join(tmp, 'gloss', g.pid + '.json'))
const ge = gf.entries.find((e) => e.word === g.word && e.indices.join(',') === g.indices.join(','))
G(ge.review === 'approved' && ge.reviewed_by === 'AM' && ge.review_note === 'sounds right' &&
  ge.review_hash === g.hash && JSON.stringify(ge.review_audio_versions) === JSON.stringify(ex.decisions.find((d) => d.key === g.key).audioVersions),
  'the file records who, when, note, and reviewed versions', JSON.stringify(ge))
// untouched files keep their bytes
G(fs.readFileSync(path.join(tmp, 'syllables', ids.find((i) => i !== s.pid) + '.json'), 'utf8') === fs.readFileSync(path.join(dataDir, 'syllables', ids.find((i) => i !== s.pid) + '.json'), 'utf8'), 'files with no decisions are byte-identical')

// 8. a changed entry is skipped, not applied blindly
const gfile = path.join(tmp, 'gloss', g.pid + '.json')
const gj = readJson(gfile)
const e2 = gj.entries.find((e) => e.word === g.word && e.indices.join(',') === g.indices.join(','))
delete e2.review; delete e2.reviewed_by; delete e2.reviewed_at; delete e2.review_note
e2.def = e2.def + ' (edited)'
fs.writeFileSync(gfile, JSON.stringify(gj, null, 1))
const stale = py(exportPath, '--data', tmp, '--write')
const gjAfter = readJson(gfile).entries.find((e) => e.word === g.word && e.indices.join(',') === g.indices.join(','))
G(stale.status === 0 && !gjAfter.review, 'an entry edited after review is not given the old approval', stale.stdout + stale.stderr)
B(/1 applied, 1 changed since reviewed/.test(stale.stdout), 'an edited entry is reported as "1 applied, 1 changed since reviewed"', stale.stdout)

// 9. The report verifies both content and the actual audio bytes before counting an approval.
const reportData = readJson(gfile)
const reportEntry = reportData.entries.find((e) => e.word === g.word && e.indices.join(',') === g.indices.join(','))
reportEntry.review = 'approved'
reportEntry.def = g.text
reportEntry.review_hash = g.hash
reportEntry.review_audio_versions = ex.decisions.find((d) => d.key === g.key).audioVersions
fs.writeFileSync(gfile, JSON.stringify(reportData, null, 1))
const clipFile = path.join(tmpRoot, g.clips[0])
fs.mkdirSync(path.dirname(clipFile), { recursive: true })
fs.writeFileSync(clipFile, Buffer.from([1, 2, 3]))
const reportCount = () => {
  const result = py('--report', '--data', tmp)
  G(result.status === 0, 'apply_reviews.py --report succeeds', result.stdout + result.stderr)
  return result.stdout || ''
}
const currentReport = reportCount()
G(/TOTAL \d+: approved 1, needs fix 1, still to check \d+/.test(currentReport),
  'the report counts a file approval only when its saved text and audio versions match', currentReport)
reportEntry.def = g.text + ' (edited again)'
fs.writeFileSync(gfile, JSON.stringify(reportData, null, 1))
const editedReport = reportCount()
G(/TOTAL \d+: approved 0, needs fix 1, still to check \d+/.test(editedReport),
  'changed definition text makes the report count the approval as draft', editedReport)
reportEntry.def = g.text
fs.writeFileSync(gfile, JSON.stringify(reportData, null, 1))
fs.writeFileSync(clipFile, Buffer.from([1, 2, 4]))
const replacedReport = reportCount()
G(/TOTAL \d+: approved 0, needs fix 1, still to check \d+/.test(replacedReport),
  'replacement audio at the same path makes the report count the approval as draft', replacedReport)
fs.writeFileSync(clipFile, Buffer.from([1, 2, 3]))
delete reportEntry.review_audio_versions
fs.writeFileSync(gfile, JSON.stringify(reportData, null, 1))
const missingVersionReport = reportCount()
G(/TOTAL \d+: approved 0, needs fix 1, still to check \d+/.test(missingVersionReport),
  'an approval label without saved audio versions counts as draft in the report', missingVersionReport)
B(/TOTAL \d+: approved 0, needs fix 1, still to check \d+/.test(missingVersionReport),
  'the report prints "TOTAL n: approved 0, needs fix 1, still to check n"', missingVersionReport.split('\n').slice(-2).join(' '))

fs.rmSync(tmpRoot, { recursive: true, force: true })
finish()
