// Sentence rehearsal ("Listen -> your turn -> listen again"). Plain JS, no Vue: the components pass in a reactive
// `state` object and the SoundAlong engine; a Node harness passes plain objects and a mock engine.
//
// There is NO microphone and NO scoring: "your turn" is silent and has no timer. The child decides when to hear
// the model again. Nothing here says whether the child read it right.
//
// Phases:  idle -> listen (model reads the sentence, words light up) -> turn (sentence stays lit, audio quiet,
//          cue "Your turn") -> again (child pressed "Listen again": model reads it once more) -> done (choices).
import { sentenceRanges, rangeIndexOf } from './sentences'

export const LEAD_BLOCK = '.sa-title, .sa-byline, .kv-title, .kv-by' // heading/byline: never the default sentence
const BLOCKS = 'p, h1, h2, h3, h4, h5, li, figcaption, td'

// The sentence list for an engine whose words are DOM spans: one range per sentence over engine.words.
export function sentencesForEngine(engine, opts) {
  const words = engine.words.map((el) => ({ text: el.textContent, block: el.closest?.(BLOCKS) || null }))
  return sentenceRanges(words, opts)
}

export class Rehearsal {
  // state: { phase, index, count }; ranges: [{start, end}] over engine.words
  constructor(engine, state, ranges) {
    this.engine = engine
    this.state = state
    this.ranges = ranges
    this.marked = []
    state.phase = 'idle'
    state.index = -1
    // the title and byline are sentences too, but a child counts the story's own sentences
    let lead = 0
    while (lead < ranges.length && engine.words[ranges[lead].start]?.closest?.(LEAD_BLOCK)) lead++
    state.lead = lead
    state.count = ranges.length
    state.note = ''
  }

  get active() { return this.state.phase !== 'idle' }

  // The sentence to practice by default: the one holding the current word; else the first one after the
  // title/byline. `fromK` overrides (e.g. the first word of the shown page).
  defaultIndex(fromK) {
    const lead = (i) => !!this.engine.words[this.ranges[i].start]?.closest?.(LEAD_BLOCK)
    const firstBody = (from) => {
      for (let i = from; i < this.ranges.length; i++) if (!lead(i)) return i
      return this.ranges.length ? this.ranges.length - 1 : -1
    }
    const k = fromK ?? (this.engine.curK >= 0 ? this.engine.curK : null)
    if (k == null) return firstBody(0)
    const i = rangeIndexOf(this.ranges, k)
    // a page that opens with the title and byline: practice the first real sentence, unless the child is on the title
    return i >= 0 && lead(i) && this.engine.curK !== k ? firstBody(i) : i
  }

  start(fromK) { return this.startIndex(this.defaultIndex(fromK)) }

  startIndex(i) {
    if (i < 0 || i >= this.ranges.length) return false
    this._mark(i)
    this.state.index = i
    this.state.note = ''
    return this._play('listen')
  }

  _play(phase) {
    const r = this.ranges[this.state.index]
    this._phase(phase)
    const ok = this.engine.playRange(r.start, r.end, {
      onEnd: () => this._ended(phase),
      onCancel: () => this._taken(),
    })
    if (!ok) {
      this.state.note = 'This sentence has no audio.'
      this._unmark()
      this._phase('idle')
    }
    return ok
  }

  _ended(phase) {
    if (phase === 'listen') this._phase('turn')
    else if (phase === 'again') this._phase('done')
  }

  // Something else took over the audio (a tap on a word, Play, the scrubber, a voice change): step out quietly.
  _taken() {
    this._unmark()
    this.state.note = ''
    this._phase('idle')
  }

  // "Listen again": from "your turn" or from the choices at the end.
  listenAgain() {
    if (this.state.phase === 'turn') return this._play('again')
    if (this.state.phase === 'done') return this.startIndex(this.state.index) // the whole cycle once more
    return false
  }
  next() { return this.startIndex(this.state.index + 1) }
  prev() { return this.startIndex(this.state.index - 1) }

  // Back to the story: nothing is playing; Play continues after this sentence.
  exit() {
    if (!this.active) return
    this.engine.cancelRange?.()
    this._unmark()
    this.state.note = ''
    this._phase('idle')
  }

  dispose() {
    this.exit()
  }

  _phase(p) {
    this.state.phase = p
    const c = this.engine.container
    if (c?.setAttribute) {
      if (p === 'idle') c.removeAttribute('data-rh-phase')
      else c.setAttribute('data-rh-phase', p)
    }
  }

  _mark(i) {
    this._unmark()
    const r = this.ranges[i]
    for (let j = r.start; j <= r.end; j++) {
      const el = this.engine.words[j]
      el?.classList.add('sa-rehearse')
      this.marked.push(el)
    }
  }

  _unmark() {
    for (const el of this.marked) el?.classList.remove('sa-rehearse')
    this.marked = []
  }
}
