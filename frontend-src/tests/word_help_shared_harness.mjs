import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { okGuard as G, finish } from './_kinds.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = fs.readFileSync(path.join(root, 'src/passage/useWordHelp.js'), 'utf8')
const holdSource = fs.readFileSync(path.join(root, 'src/hold.js'), 'utf8')
const timers = []
const fakeSetTimeout = (fn) => { timers.push(fn); return timers.length }
const HoldDetector = new Function('setTimeout', 'clearTimeout', `${holdSource.replace('export class HoldDetector', 'class HoldDetector')}\nreturn HoldDetector`)(fakeSetTimeout, () => {})
const listeners = new Map()
globalThis.document = {
  addEventListener: (type, fn) => listeners.set(`${type}:${listeners.size}`, fn),
  removeEventListener: () => {},
  querySelector: () => null,
}
globalThis.window = { getSelection: () => ({ removeAllRanges: () => {} }) }
class FakeAudio {
  addEventListener() {}
  pause() { this.pauses = (this.pauses || 0) + 1 }
  play() { return Promise.resolve() }
}
globalThis.Audio = FakeAudio
const voices = []
class FakeClipVoice {
  constructor() { voices.push(this) }
  stop() { this.stops = (this.stops || 0) + 1 }
  play(clips) { this.clips = clips; return Promise.resolve(true) }
}
const review = { kind: 'gloss', key: 'reviewed-version' }
const guideReview = { kind: 'syllable', key: 'guide-version' }
const useWordHelp = new Function('ref', 'shallowRef', 'computed', 'HoldDetector', 'findDefinition',
  'itemsForPassage', 'tally', 'syllableItem', 'ClipVoice', 'record', 'setTimeout',
  `${source.replace(/^import .*$/gm, '').replace('export function useWordHelp', 'function useWordHelp')}\nreturn useWordHelp`)(
  (v) => ({ value: v }), (v) => ({ value: v }), (fn) => ({ get value() { return fn() } }),
  HoldDetector, () => ({ word: 'test', text: 'A local draft.', clips: ['draft.mp3'], items: [review], guideItem: guideReview, guide: {} }),
  () => [], () => ({ total: 0 }), () => null, FakeClipVoice, () => {}, fakeSetTimeout,
)
const word = { dataset: { i: '2' }, classList: { contains: () => false }, closest: () => word }
const engine = { index: new Map([[word, 2]]), pause() { this.pauses = (this.pauses || 0) + 1 }, playSnippet() {} }
const help = useWordHelp({ id: 'synthetic', data: { value: { vocab: {} } }, soundOn: { value: true },
  spanish: { value: false }, getEngine: () => engine })
help.onHoldDown({ target: word, pointerType: 'touch', button: 0, clientX: 1, clientY: 1 })
timers.shift()()
help.onHoldUp()
let blocked = false
help.swallowClick({ stopPropagation() { blocked = true }, preventDefault() { blocked = blocked && true } })
G(blocked, 'a completed hold suppresses the following word click')
G(help.card.value?.reviewItems?.[0] === review && help.card.value?.reviewItems?.[1] === guideReview,
  'definition and guide review items reach the shared card')
G(voices[0].clips?.[0] === 'draft.mp3', 'a held definition plays its clip')
help.onGuideStart()
G(voices[0].stops >= 2 && engine.pauses >= 2, 'starting a guide interrupts the definition clip and narration')
const stopsBeforeClose = voices[0].stops
help.closeCard()
G(voices[0].stops === stopsBeforeClose + 1 && help.card.value === null,
  'closing word help interrupts its clip and removes the card')
help.dispose()
finish()
