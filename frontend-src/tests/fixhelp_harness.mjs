import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { okGuard as G, okBehavior as B, finish } from './_kinds.mjs'
import { existsSync } from 'node:fs'

// These fixtures are private media; keep the harness available when local data is linked.
const requiredLocalFiles = ['public/data/67525eb4-444a-480a-b007-e35630b729b9.json', 'public/data/gloss/f3a39564-73e4-46be-a42e-5224d12427fd.json']
if (requiredLocalFiles.some(file => !existsSync(new URL('../' + file, import.meta.url)))) {
  console.log('SKIP fixhelp_harness.mjs: private ReadWorks fixtures are absent')
  process.exit(0)
}

const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => fs.readFileSync(path.join(app, p), 'utf8')
const api = read('src/api.js')
const defs = read('src/defs.js')
const focus = read('src/views/Focus.vue')
const guide = read('src/components/SyllableGuide.vue')
const passage = JSON.parse(read('public/data/67525eb4-444a-480a-b007-e35630b729b9.json'))
const donor = JSON.parse(read('public/data/gloss/f3a39564-73e4-46be-a42e-5224d12427fd.json'))
G(/data-i="260"[^>]*>called</i.test(passage.html) && donor.entries.some((e) => e.word === 'called' && /name/i.test(e.def)), 'the speech occurrence and naming donor fixture exist')
const findDefinition = new Function('glossItem', 'syllableItem', 'vocabItem', 'sharedWordHelp',
  defs.replace(/^import .*$/gm, '').replace('export function findDefinition', 'function findDefinition') + '\nreturn findDefinition')(
  () => ({}), () => ({}), () => ({}),
  () => ({ gloss: donor.entries.find((e) => e.word === 'called'), guide: null }),
)
const speechWord = { dataset: { i: '260' }, textContent: 'called', closest: () => null }
G(findDefinition(speechWord, { gloss: null, kid: null, passageId: '67525eb4-444a-480a-b007-e35630b729b9', vocab: {}, syllables: {} }) === null,
  'the speech occurrence cannot receive another passage’s naming definition')
B(!/shared\.gloss/.test(defs) && !/definitions\.set\(word/.test(api), 'current source has no cross-story meaning lookup')
B(/reviewItems:\s*\[\.\.\.def\.items,\s*def\.guideItem\]/.test(focus), 'current Reading helper passes both review items to its card')
B(/v-else-if="!iconsOnly && item"/.test(guide) && /v-else-if="iconsOnly && markKid"/.test(guide), 'current guide layout has draft markers in both modes')
const mem = new Map()
globalThis.localStorage = { getItem: (key) => mem.get(key) || null, setItem: (key, value) => mem.set(key, value) }
const R = await import('../src/review.js')
const item = { kind: 'gloss', pid: 'test', key: 'test|gloss|1|word', word: 'word', text: 'Local meaning', clips: ['audio/word.mp3'], hash: R.hashText('word|Local meaning|audio/word.mp3'), dataReview: '' }
const first = await R.verifyAudio(item, async () => new Uint8Array([1, 2, 3]))
R.setReview(item, 'approved')
G(R.reviewOf(item).state === 'checked', 'a local approval counts for the recorded audio bytes')
await R.verifyAudio(item, async () => new Uint8Array([1, 2, 4]))
G(R.reviewOf(item).state === 'draft', 'changed recording bytes at the same path revoke local approval')
G(!R.dataApproved({ ...item, dataReview: 'approved' }), 'bare file approval cannot count without a recorded version')
G(!R.dataApproved({ ...item, dataReview: 'approved', approvedHash: item.hash, approvedAudioVersions: first }), 'changed audio invalidates a file approval too')
await R.verifyAudio(item, async () => new Uint8Array([1, 2, 3]))
G(R.dataApproved({ ...item, dataReview: 'approved', approvedHash: item.hash, approvedAudioVersions: first }), 'matching recorded text and audio versions can count as file approval')
G(R.nextReviewKey(1, [{ key: 'a' }, { key: 'c' }]) === 'c' && R.nextReviewKey(2, [{ key: 'a' }, { key: 'c' }]) === 'c' && R.nextReviewKey(0, []) === null, 'after a reviewed row leaves, focus can advance to the next visible row or the filter')
const currentExport = R.buildExport([item])
G(currentExport.decisions[0].stale === false, 'an unchanged approved recording exports as current')
await R.verifyAudio(item, async () => new Uint8Array([1, 2, 4]))
const changedExport = R.buildExport([item])
G(changedExport.decisions[0].stale === true, 'a changed approved recording exports as stale')
await R.verifyAudio(item, async () => new Uint8Array([1, 2, 3]))
let finishPendingAudio
const pendingNote = R.saveReviewNote(item, 'pending note', async () => new Promise((resolve) => { finishPendingAudio = resolve }))
G(R.reviewOf(item).state === 'draft' && R.buildExport([item]).decisions[0].stale === true,
  'an audio check in progress does not leave the old approval current')
finishPendingAudio(new Uint8Array([1, 2, 3]))
G(await pendingNote && R.reviewOf(item).note === 'pending note', 'a completed audio check saves the note')
const beforeFailedNote = mem.get(R.REVIEW_KEY)
const savedFailedNote = await R.saveReviewNote(item, 'new note', async () => { throw new Error('audio unavailable') })
G(savedFailedNote === false && mem.get(R.REVIEW_KEY) === beforeFailedNote,
  'a failed audio check cannot save a note or renew the approval')
G(R.reviewOf(item).state === 'draft' && R.buildExport([item]).decisions[0].stale === true,
  'after audio verification fails, the old approval reads as draft and exports as stale')
const savedGoodNote = await R.saveReviewNote({ ...item, clips: [] }, 'new note')
G(savedGoodNote === false, 'a draft row cannot gain approval by saving a note')
G(await R.saveReviewNote(item, 'rechecked note', async () => new Uint8Array([1, 2, 3])) &&
  R.reviewOf(item).note === 'rechecked note', 'a note entered after a failed check saves only after audio is verified again')
let finishBackgroundAudio
const backgroundCheck = R.verifyAudio(item, async () => new Promise((resolve) => { finishBackgroundAudio = resolve }))
G(R.reviewOf(item).state === 'draft', 'an in-progress background audio check temporarily hides approval')
G(await R.saveReviewNote(item, 'while loading', async () => new Uint8Array([1, 2, 3])) &&
  R.reviewOf(item).note === 'while loading', 'a note entered during background verification is saved after a successful check')
finishBackgroundAudio(new Uint8Array([1, 2, 3]))
await backgroundCheck
const fileApproved = { ...item, key: item.key + '|file', clips: ['audio/file-word.mp3'],
  hash: R.hashText('word|Local meaning|audio/file-word.mp3'), dataReview: 'approved', approvedAudioVersions: first }
fileApproved.approvedHash = fileApproved.hash
G(await R.saveReviewNote(fileApproved, 'file note', async () => new Uint8Array([1, 2, 3])) &&
  R.reviewOf(fileApproved).note === 'file note', 'a file-approved row can save a note after its initial audio check')
await R.verifyAudio(item, async () => new Uint8Array([1, 2, 3]))
G(await R.saveReviewNote(item, 'new note', async () => new Uint8Array([1, 2, 3])) &&
  R.reviewOf(item).note === 'new note', 'a verified approved row can save its note')
finish()
