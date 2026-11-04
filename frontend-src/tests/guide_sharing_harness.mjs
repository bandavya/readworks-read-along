// Run with node prototype/app/tests/guide_sharing_harness.mjs.
// Python checks the same fixture through word_bank.py --self-test.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { okGuard as G, finish } from './_kinds.mjs'
import * as review from '../src/review.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const api = fs.readFileSync(path.join(here, '..', 'src', 'api.js'), 'utf8')
const sharing = api.slice(api.indexOf('const ambiguous = new Set('), api.indexOf('// Grades arrive'))
  .replace('export const wordKey', 'const wordKey')
  .replace('export function loadSharedWordHelp', 'function loadSharedWordHelp')
  .replace('export function sharedWordHelp', 'function sharedWordHelp')
const passageLoader = api.slice(api.indexOf('export const loadPassage'), api.indexOf('// Reuse existing public help files'))
  .replace('export const loadPassage', 'const loadPassage')
const fixture = JSON.parse(fs.readFileSync(path.join(here, 'guide_key_fixture.json'), 'utf8'))

const bytes = { 'b.mp3': new Uint8Array([1, 2, 3]), 'c.mp3': new Uint8Array([4, 5, 6]) }
async function approved(pid, sid, voice) {
  const entry = { word: 'horizon', review: 'approved', voice, audio: { whole: `${pid}.mp3` } }
  const item = review.syllableItem(pid, sid, entry)
  entry.review_hash = item.hash
  entry.review_audio_versions = await review.verifyAudio(item, async (clip) => bytes[clip])
  // Simulate a fresh page: the saved approval exists, but no clip has been verified yet.
  await review.verifyAudio(item, async () => { throw new Error('clear cached version') }).catch(() => {})
  return entry
}
const docs = {
  a: { gloss: { entries: [] }, syllables: { z: { word: 'horizon', review: 'needs human check', voice: 'A', audio: { whole: 'a.mp3' } } } },
  b: { gloss: { entries: [] }, syllables: { y: await approved('b', 'y', 'B') } },
  c: { gloss: { entries: [] }, syllables: { x: await approved('c', 'x', 'C') } },
}
function make(index) {
  const loadedBundles = new Set()
  const getJson = async (p) => {
    const [, kind, file] = p.split('/')
    return docs[file.replace('.json', '')][kind]
  }
  const loadBundle = async (pid) => { loadedBundles.add(pid) }
  const verifyAudio = (item) => review.verifyAudio(item, async (clip) => {
    if (!loadedBundles.has(item.pid)) throw new Error('candidate bundle was not loaded')
    return bytes[clip]
  })
  return new Function('loadIndex', 'getJson', 'loadBundle', 'needsAudioVerification', 'reviewOf', 'syllableItem', 'verifyAudio',
    `${sharing}\nreturn { wordKey, loadSharedWordHelp, sharedWordHelp }`)(
      async () => index.map((uuid) => ({ uuid })), getJson, loadBundle, review.needsAudioVerification,
      review.reviewOf, review.syllableItem, verifyAudio)
}

const first = make(['a', 'c', 'b'])
const second = make(['b', 'a', 'c'])
for (const row of fixture) G(first.wordKey(row.input) === row.key, `JS guide key: ${JSON.stringify(row.input)}`)
await Promise.all([first.loadSharedWordHelp(), second.loadSharedWordHelp()])
const one = first.sharedWordHelp('horizon').guide
const two = second.sharedWordHelp('horizon').guide
G(one?._wordBankPid === 'b' && two?._wordBankPid === 'b', 'reordered index chooses the same reviewed guide')
G(first.sharedWordHelp('horizon', 'c').guide?._wordBankPid === 'c', 'local passage wins between equally reviewed guides')
G(first.sharedWordHelp('horizon', 'a').guide?._wordBankPid === 'b', 'reviewed guide wins over an unreviewed local candidate')
G(review.reviewOf(review.syllableItem('b', 'y', one)).state === 'approved', 'selected reviewed guide has verified audio')
G(one?._wordBankSource?.passage === 'b' && one?._wordBankSource?.voice === 'B' && one?._wordBankSource?.review === 'approved', 'selected guide retains passage, voice, and review provenance')
G(first.sharedWordHelp('read').guide === null, 'ambiguous spelling is not shared')
const preloaded = []
const loadPassage = new Function('publishedBase', 'getJson', 'loadBundle', 'loadSharedWordHelp', 'sharedWordHelp', 'document', 'cleanPassage',
  `${passageLoader}\nreturn loadPassage`)(null,
  async () => ({ html: '<span class="sa-w">horizon</span>' }),
  async (name) => { preloaded.push(name) },
  first.loadSharedWordHelp,
  first.sharedWordHelp,
  { createElement: () => ({
    set innerHTML(html) { this.html = html },
    querySelectorAll() { return [{ textContent: 'horizon' }] },
  }) }, (doc) => doc)
await loadPassage('c')
G(!preloaded.includes('b'), 'passage preloading keeps an equally reviewed local guide local')
preloaded.length = 0
await loadPassage('a')
G(preloaded.includes('b'), 'passage preloading fetches the selected reviewed guide from another passage')
finish()
