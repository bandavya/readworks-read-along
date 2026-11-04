// Sentence rehearsal harness (plain Node, no browser, no Vue, no audio device).
//   node tests/rehearsal_harness.mjs            -> tests the files in ../src
//   SRC=D:/path/to/other/src node tests/...     -> same checks against another checkout (the "before" run)
//
// It mocks Audio, the clock, requestAnimationFrame and setTimeout (virtual time), builds fake word spans from the
// REAL passage files in public/data, and runs the real SoundAlong engine + Rehearsal controller.
// Kinds (see tests/README.md): GUARDS = a rehearsal never lights a word outside its sentence, never runs past its last
// word into the next sentence, the child's taps/Play/pause still work, splitting doesn't break abbreviations or quotes.
// BEHAVIOR (only reported, never fails the run) = today's phase sequence and names, "your turn" waiting, and what
// exactly happens to the rehearsal when the child interrupts it.
// Checks: (1) sentence boundaries on tricky text, (2) every sentence of every passage, both voices, 5 speeds:
// the range stops after the last word's end and before the next sentence's first word, nothing from the next
// sentence is ever highlighted, and the phases go listen -> turn -> again -> done, (3) interruptions: a word tap,
// Play, pause, scrubber and a voice switch each hand the audio back and clear the sentence.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { okGuard, okBehavior, finish } from './_kinds.mjs'

// These fixtures are private media; keep the harness available when local data is linked.
const requiredLocalFiles = ['public/data/index.json']
if (requiredLocalFiles.some(file => !fs.existsSync(new URL('../' + file, import.meta.url)))) {
  console.log('SKIP rehearsal_harness.mjs: private ReadWorks fixtures are absent')
  process.exit(0)
}

const here = path.dirname(fileURLToPath(import.meta.url))
const SRC = process.env.SRC ? path.resolve(process.env.SRC) : path.join(here, '..', 'src')
const DATA = path.join(here, '..', 'public', 'data')

// --- copy the modules under test next to a stub for ./api (which needs Vite's import.meta.env) ---
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rehearsal-'))
for (const f of ['soundAlong.js', 'rehearsal.js', 'sentences.js']) {
  if (fs.existsSync(path.join(SRC, f))) fs.copyFileSync(path.join(SRC, f), path.join(tmp, f))
}
fs.mkdirSync(path.join(tmp, 'engine'))
for (const f of ['timing.js', 'dom.js', 'input.js']) {
  fs.copyFileSync(path.join(SRC, 'engine', f), path.join(tmp, 'engine', f))
}
fs.writeFileSync(path.join(tmp, 'package.json'), '{"type":"module"}\n')
fs.writeFileSync(path.join(tmp, 'api.js'), 'export const assetUrl = (p) => p\n')
// Node needs file extensions on relative imports: add .js to the copies.
for (const f of fs.readdirSync(tmp)) {
  const p = path.join(tmp, f)
  if (!fs.statSync(p).isFile()) continue
  fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace(/from '(\.\/\w+)'/g, "from '$1.js'"))
}

/* ---------- virtual time + mocks ---------- */
let now = 0
let timers = []
let rafs = []
let tid = 0
globalThis.performance = { now: () => now }
globalThis.window = { addEventListener() {}, removeEventListener() {}, innerHeight: 800, scrollBy() {}, getSelection: () => null }
globalThis.requestAnimationFrame = (f) => { rafs.push(f); return rafs.length }
globalThis.cancelAnimationFrame = () => { rafs = [] }
globalThis.setTimeout = (f, ms = 0) => { timers.push({ id: ++tid, at: now + ms, f }); return tid }
globalThis.clearTimeout = (id) => { timers = timers.filter((t) => t.id !== id) }

class FakeAudio {
  constructor() {
    this.ev = {}
    this.currentTime = 0
    this.paused = true
    this.playbackRate = 1
    this.duration = NaN
    this.attrs = {}
    FakeAudio.last = this
  }
  addEventListener(e, f) { (this.ev[e] ||= []).push(f) }
  removeEventListener(e, f) { this.ev[e] = (this.ev[e] || []).filter((x) => x !== f) }
  emit(e) { (this.ev[e] || []).slice().forEach((f) => f()) }
  set src(v) { this.attrs.src = v }
  get src() { return this.attrs.src }
  getAttribute(n) { return this.attrs[n] }
  removeAttribute(n) { delete this.attrs[n] }
  load() {
    const d = FakeAudio.durations[this.attrs.src] || 60
    setTimeout(() => { this.duration = d; this.emit('loadedmetadata') }, 5)
  }
  play() {
    if (!this.paused) return Promise.resolve()
    this.paused = false
    setTimeout(() => { this.emit('play'); this.emit('playing') }, 0)
    return Promise.resolve()
  }
  pause() {
    if (this.paused) return
    this.paused = true
    setTimeout(() => this.emit('pause'), 0)
  }
}
FakeAudio.durations = {}
globalThis.Audio = FakeAudio

let sinceTU = 0
function step(ms = 16) {
  now += ms
  const a = FakeAudio.last
  if (a && !a.paused) {
    a.currentTime += (ms / 1000) * a.playbackRate
    if (a.currentTime >= a.duration) {
      a.currentTime = a.duration
      a.paused = true
      a.emit('pause')
      a.emit('ended')
    }
  }
  const due = timers.filter((t) => t.at <= now)
  timers = timers.filter((t) => t.at > now)
  due.forEach((t) => t.f())
  const rs = rafs
  rafs = []
  rs.forEach((f) => f())
  sinceTU += ms
  if (sinceTU >= 250) { sinceTU = 0; a?.emit('timeupdate') }
}
function run(ms) {
  for (let t = 0; t < ms; t += 16) step(16)
}

/* ---------- fake DOM: just enough for the engine ---------- */
class ClassList {
  constructor() { this.s = new Set() }
  add(c) { this.s.add(c) }
  remove(c) { this.s.delete(c) }
  toggle(c, on) { if (on) this.s.add(c); else this.s.delete(c) }
  contains(c) { return this.s.has(c) }
}
class Span {
  constructor(text, block, dataset, cls) {
    this.textContent = text
    this.block = block
    this.dataset = dataset
    this.classList = new ClassList()
    cls.forEach((c) => this.classList.add(c))
    this.tabIndex = -1
    this.title = ''
  }
  closest(sel) {
    if (/sa-title|kv-title/.test(sel)) return this.block.lead ? this.block : null
    if (/vocab/.test(sel)) return null
    return this.block // the paragraph/heading block selector
  }
  getBoundingClientRect() { return { top: 0, bottom: 10, left: 0, right: 10, height: 10 } }
  focus() {}
}
function buildContainer(doc) {
  const spans = []
  const mk = (words, offset) => {
    const b = { lead: true }
    words.forEach((w, i) => spans.push(new Span(w, b, { l: String(offset + i) }, ['sa-w'])))
  }
  mk(doc.title_words || [], 0)
  if ((doc.by_words || []).length) mk(doc.by_words, (doc.title_words || []).length)
  for (const m of doc.html.matchAll(/<(p|h[1-6]|li)\b[^>]*>([\s\S]*?)<\/\1>/g)) {
    const b = { lead: false }
    for (const s of m[2].matchAll(/<span class="sa-w( sa-unread)?" data-i="(\d+)"[^>]*>([^<]*)<\/span>/g)) {
      spans.push(new Span(s[3], b, { i: s[2] }, s[1] ? ['sa-w', 'sa-unread'] : ['sa-w']))
    }
  }
  return {
    spans,
    addEventListener() {},
    removeEventListener() {},
    querySelectorAll(sel) {
      if (sel === '.sa-w:not(.sa-unread)') return spans.filter((s) => !s.classList.contains('sa-unread'))
      if (sel === '.sa-unread') return spans.filter((s) => s.classList.contains('sa-unread'))
      return []
    },
    attrs: {},
    setAttribute(k, v) { this.attrs[k] = v },
    removeAttribute(k) { delete this.attrs[k] },
  }
}

/* ---------- load the modules under test ---------- */
const { SoundAlong } = await import(pathToFileURL(path.join(tmp, 'soundAlong.js')).href)
let sent = null
let reh = null
try {
  sent = await import(pathToFileURL(path.join(tmp, 'sentences.js')).href)
  reh = await import(pathToFileURL(path.join(tmp, 'rehearsal.js')).href)
} catch (e) { /* the "before" run: the modules do not exist yet */ }

/* ---------- 1. sentence boundaries ---------- */
console.log('1. sentence boundaries')
if (!sent) okBehavior(false, 'src/sentences.js exists (sentence splitting lives there)', 'src/sentences.js does not exist')
else {
  const split = (text, opts) => {
    const ws = text.split(/\s+/).map((t) => ({ text: t, block: 1 }))
    return sent.sentenceRanges(ws, opts).map((r) => ws.slice(r.start, r.end + 1).map((w) => w.text).join(' '))
  }
  // kind 'guard' = splitting must not break abbreviations, initials, quotes mid-word. 'behavior' = a policy choice.
  const eq = (text, want, opts, kind = 'guard') => {
    const got = split(text, opts)
    const same = JSON.stringify(got) === JSON.stringify(want)
    const name = `split "${text}"`
    const detail = `-> ${JSON.stringify(got)} (wanted ${JSON.stringify(want)})`
    if (kind === 'guard') okGuard(same, name, detail)
    else okBehavior(same, name, detail)
  }
  eq('The cat sat. The dog ran!', ['The cat sat.', 'The dog ran!'])
  eq('Is it here? Yes, it is.', ['Is it here?', 'Yes, it is.'])
  eq('Mr. Lee met Dr. Kim in St. Louis. They talked.', ['Mr. Lee met Dr. Kim in St. Louis.', 'They talked.'])
  eq('She read "Hello." Then she left.', ['She read "Hello."', 'Then she left.'])
  eq('"I like it," she said. "Do you?"', ['"I like it," she said.', '"Do you?"'])
  eq('Dad met J. K. Rowling today. Wow.', ['Dad met J. K. Rowling today.', 'Wow.'])
  eq('It was so hot. So did I. Then we left.', ['It was so hot.', 'So did I.', 'Then we left.'])
  eq('It lives in the U.S. and eats fish. It is big.', ['It lives in the U.S. and eats fish.', 'It is big.'])
  eq('It lives in the U.S. Then it swims.', ['It lives in the U.S.', 'Then it swims.'])
  // where an ellipsis ends a "sentence", and where a long sentence is cut, are design choices (pencil)
  eq('Wait... what happened? Nothing!', ['Wait...', 'what happened?', 'Nothing!'], undefined, 'behavior')
  eq('A big sentence that goes on, and on, and on until it is long enough to split here, then more words follow it today.', [
    'A big sentence that goes on, and on,',
    'and on until it is long enough to split here, then more words follow it today.',
  ], { maxWords: 20 }, 'behavior')
  eq('One two three four five six seven eight nine ten.', ['One two three four five', 'six seven eight nine ten.'], { maxWords: 5 })
  const two = sent.sentenceRanges([{ text: 'Title', block: 1 }, { text: 'Words', block: 1 }, { text: 'Body', block: 2 }, { text: 'goes.', block: 2 }])
  okGuard(JSON.stringify(two) === JSON.stringify([{ start: 0, end: 1 }, { start: 2, end: 3 }]), 'a block change ends a sentence')
  const all = [...Array(40).keys()].map((i) => ({ text: i % 7 === 6 ? 'w.' : 'w', block: i < 20 ? 1 : 2 }))
  const rs = sent.sentenceRanges(all, { maxWords: 5 })
  okGuard(rs[0].start === 0 && rs.at(-1).end === 39 && rs.every((r, i) => (i === 0 || r.start === rs[i - 1].end + 1) && r.end >= r.start), 'ranges tile the words')
}

/* ---------- 2. every sentence, both voices, five speeds ---------- */
const index = JSON.parse(fs.readFileSync(path.join(DATA, 'index.json'), 'utf8'))
let sentences = 0
let worstTail = 0 // seconds the audio ran past the last word's end
let minGapToNext = Infinity // seconds of margin before the next sentence's first word
let leaks = 0
let worstBleed = -Infinity // seconds the stop landed after the next sentence's first word (<= 0: never)
let phaseErrors = 0
const rateSet = [0.75, 1, 1.25, 1.5, 2]
const hasPlayRange = typeof SoundAlong.prototype.playRange === 'function'

function setup(doc, voiceId, rate) {
  timers = []
  rafs = []
  const container = buildContainer(doc)
  FakeAudio.durations = {}
  for (const v of doc.voices) FakeAudio.durations[v.audio] = (v.t.filter(Boolean).at(-1)?.[1] || 60) + 1
  const state = { playing: false, time: 0, duration: 0, rate, voiceId: '', error: '' }
  const eng = new SoundAlong({ state })
  eng.attach(container, doc.voices, { voiceId, rate, clicks: false, keys: false })
  run(100)
  return { eng, state, container }
}

console.log('2. every sentence, both voices, five speeds')
if (!hasPlayRange) okBehavior(false, 'SoundAlong has playRange (sentence-bounded play)', 'SoundAlong has no playRange')
else if (reh) {
  for (const it of index) {
    const doc = JSON.parse(fs.readFileSync(path.join(DATA, `${it.uuid}.json`), 'utf8'))
    for (const voiceId of doc.voices.map((v) => v.id)) {
      for (const rate of rateSet) {
        const { eng } = setup(doc, voiceId, rate)
        const ranges = reh.sentencesForEngine(eng)
        const st = {}
        const r = new reh.Rehearsal(eng, st, ranges)
        for (let i = 0; i < ranges.length; i++) {
          if (rate !== 1 && i % 4 !== 0) continue // every sentence at 1x, every 4th at the other speeds
          const { start, end } = ranges[i]
          let first = null
          let last = null
          for (let j = start; j <= end; j++) {
            if (eng.startOf[j] === null) continue
            if (first === null) first = j
            last = j
          }
          if (first === null) continue
          sentences++
          const tag = `${it.title}/${voiceId}/x${rate}/#${i}`
          try {
            const lastEnd = eng._timing(eng.voice, eng.words[last])[1]
            let nextStart = null
            for (let j = end + 1; j < eng.words.length; j++) if (eng.startOf[j] !== null) { nextStart = eng.startOf[j]; break }
            const seen = []
            eng.onCurrent = (k) => seen.push(k)
            const phases = []
            const watch = () => { if (phases.at(-1) !== st.phase) phases.push(st.phase) }
            r.startIndex(i)
            watch()
            let guardN = 0
            while (st.phase === 'listen' && guardN++ < 4000) { step(16); watch() }
            const stopT = eng.audio.currentTime
            okGuard(st.phase !== 'listen', 'the listening part of a sentence ends by itself', `${tag}: still listening after 64 s`)
            okBehavior(st.phase === 'turn', 'after listening, the phase is "turn" (your turn)', `${tag}: phase ${st.phase}`)
            // The stop point can only be judged once the harness sees the audio stopped at "your turn".
            const atTurn = st.phase === 'turn'
            if (atTurn) {
              okGuard(eng.audio.paused, 'audio is stopped when the sentence has been heard', `${tag}: audio not paused`)
              okGuard(stopT >= Math.min(lastEnd, nextStart ?? Infinity) - 1e-6, 'audio does not stop before the last word has ended', `${tag}: stopped before the last word ended (${stopT} < ${lastEnd})`)
              worstTail = Math.max(worstTail, stopT - lastEnd)
              if (nextStart !== null) {
                minGapToNext = Math.min(minGapToNext, nextStart - stopT)
                // words that touch (no gap) can bleed by one animation frame at most; a gap must never be crossed
                okGuard(stopT - nextStart <= 0.016 * rate + 1e-6, 'audio does not run into the next sentence', `${tag}: bled into the next sentence by more than one frame (${stopT} vs ${nextStart})`)
                worstBleed = Math.max(worstBleed, stopT - nextStart)
              }
              okBehavior(eng.curK === -1, 'no word is lit during "your turn"', `${tag}: curK ${eng.curK}`)
            }
            let leakedHere = 0
            for (const k of seen) if (k < first || k > end) { leaks++; leakedHere++ }
            okGuard(leakedHere === 0, 'a rehearsal never lights a word outside its sentence', `${tag}: lit a word outside ${first}..${end}`)
            const marked = eng.words.filter((w) => w.classList.contains('sa-rehearse')).length
            okBehavior(marked === end - start + 1, 'the sentence stays marked during "your turn"', `${tag}: ${marked} of ${end - start + 1} marked`)
            run(1500) // a long silent "your turn": nothing may move or start playing
            okBehavior(st.phase === 'turn' && eng.audio.paused && eng.audio.currentTime === stopT, '"your turn" waits for the child indefinitely', `${tag}: ${st.phase}, paused ${eng.audio.paused}`)
            r.listenAgain()
            watch()
            guardN = 0
            while (st.phase === 'again' && guardN++ < 4000) { step(16); watch() }
            okBehavior(st.phase === 'done', 'after "listen again", the phase is "done"', `${tag}: ${st.phase}`)
            const seq = JSON.stringify(phases) === JSON.stringify(['listen', 'turn', 'again', 'done'])
            if (!seq) phaseErrors++
            okBehavior(seq, 'phase order is listen, turn, again, done', `${tag}: phases ${phases}`)
            r.exit()
            okGuard(eng.words.every((w) => !w.classList.contains('sa-rehearse')), 'leaving the rehearsal clears the sentence mark', `${tag}: still marked after exit`)
            eng.onCurrent = null
          } catch (e) {
            okGuard(false, 'the harness can drive a rehearsal (startIndex / listenAgain / exit)', `${tag}: ${e.message}`)
            try { r.exit() } catch { /* ignore */ }
          }
        }
        eng.destroy()
      }
    }
  }
  console.log(`   sentences played ${sentences}; worst overrun past the last word ${worstTail.toFixed(3)}s; smallest margin before the next sentence ${minGapToNext.toFixed(3)}s; worst bleed into it ${Math.max(0, worstBleed).toFixed(3)}s; words lit outside the sentence ${leaks}; phase-order errors ${phaseErrors}`)
}

/* ---------- 3. interruptions ---------- */
// GUARD part: what the child asked for still happens (the tapped word plays and lights, Play plays, pause pauses,
// a voice switch alone never starts playback). BEHAVIOR part: that the rehearsal exits and clears its mark (phase "idle").
console.log('3. interruptions')
if (reh && hasPlayRange) {
  const doc = JSON.parse(fs.readFileSync(path.join(DATA, `${index[1].uuid}.json`), 'utf8'))
  const fresh = (voiceId = 'generated') => {
    const s = setup(doc, voiceId, 1)
    const st = {}
    const r = new reh.Rehearsal(s.eng, st, reh.sentencesForEngine(s.eng))
    return { ...s, st, r }
  }
  const marked = (eng) => eng.words.filter((w) => w.classList.contains('sa-rehearse')).length
  const toPhase = (x, ph) => { let g = 0; while (x.st.phase === ph && g++ < 4000) step(16) }
  const toTurn = (x) => { x.r.startIndex(2); toPhase(x, 'listen') }
  const exits = (x) => x.st.phase === 'idle' && marked(x.eng) === 0
  const exitsDetail = (x) => `phase ${x.st.phase}, marked ${marked(x.eng)}`

  let x = fresh()
  x.r.startIndex(2)
  run(300)
  okBehavior(x.st.phase === 'listen', 'while a sentence plays the phase is "listen"', `phase ${x.st.phase}`)
  x.eng.playFrom(x.eng.words.length - 5) // a tap on a word elsewhere
  run(50)
  okBehavior(exits(x), 'a word tap mid-listen exits the rehearsal and clears the sentence', exitsDetail(x))
  okGuard(!x.eng.audio.paused, 'a word tapped mid-listen plays (the rehearsal does not swallow the tap)')

  x = fresh(); toTurn(x)
  x.eng.playFrom(0); run(50)
  okBehavior(exits(x), 'a word tap during "your turn" exits the rehearsal and clears the sentence', exitsDetail(x))
  okGuard(x.eng.curK >= 0, 'a word tapped during "your turn" lights up')

  x = fresh(); toTurn(x)
  x.eng.toggle(); run(50) // the Play button
  okBehavior(exits(x), 'Play during "your turn" exits the rehearsal and clears the sentence', exitsDetail(x))
  okGuard(!x.eng.audio.paused, 'Play during "your turn" plays')

  x = fresh(); x.r.startIndex(2); run(300); x.eng.pause(); run(50)
  okBehavior(exits(x), 'pause mid-listen exits the rehearsal and clears the sentence', exitsDetail(x))
  okGuard(x.eng.audio.paused, 'pause mid-listen stays paused')

  x = fresh(); toTurn(x); x.eng.seekTime(1); run(50)
  okBehavior(exits(x), 'the scrubber exits the rehearsal and clears the sentence', exitsDetail(x))

  x = fresh(); toTurn(x); x.eng.setVoice('human'); run(200)
  okBehavior(exits(x), 'a voice switch during "your turn" exits the rehearsal and clears the sentence', exitsDetail(x))
  okGuard(x.eng.audio.paused, 'a voice switch during "your turn" does not start playing by itself')

  x = fresh(); x.r.startIndex(2); run(300); x.eng.setVoice('human'); run(300)
  okBehavior(exits(x), 'a voice switch mid-listen exits the rehearsal and clears the sentence', exitsDetail(x))

  x = fresh(); toTurn(x); x.r.next(); toPhase(x, 'listen')
  const nr = x.r.ranges[x.st.index]
  okGuard(nr && marked(x.eng) === nr.end - nr.start + 1, 'after Next sentence only that sentence is marked', `marked ${marked(x.eng)}`)
  okBehavior(x.st.index === 3 && x.st.phase === 'turn', 'Next sentence moves on by one and waits at "your turn"', `index ${x.st.index}, phase ${x.st.phase}`)

  // after Done, Play continues with the sentence AFTER the practiced one (the audio sits at the end of the sentence)
  x = fresh(); toTurn(x)
  const endT = x.eng.audio.currentTime
  x.r.exit(); x.eng.resume(); run(400)
  okBehavior(x.eng.audio.currentTime >= endT && x.eng.curK >= x.r.ranges[3].start && x.eng.curK <= x.r.ranges[3].end,
    'after Done, Play continues in the next sentence',
    `curK ${x.eng.curK}, next sentence ${x.r.ranges[3].start}..${x.r.ranges[3].end}`)

  // the default sentence skips the title and byline (and counts the story's own sentences)
  x = fresh()
  okBehavior(x.st.lead === 2 && x.r.defaultIndex() === 2, 'the default sentence is the first after the title and byline', `lead ${x.st.lead}, default ${x.r.defaultIndex()}`)
  okBehavior(x.r.defaultIndex(0) === 2, 'starting from the title word practices the first real sentence')

  // the last sentence of the story: the audio's own end must not look like "the story ended"
  x = fresh()
  let storyEnded = 0
  x.eng.onEnded = ({ snippet }) => { if (!snippet) storyEnded++ }
  x.r.startIndex(x.r.ranges.length - 1)
  toPhase(x, 'listen')
  okGuard(storyEnded === 0, 'rehearsing the last sentence does not end the story', `end events ${storyEnded}`)
  okBehavior(x.st.phase === 'turn', 'the last sentence rehearses up to "your turn"', `phase ${x.st.phase}`)
}

fs.rmSync(tmp, { recursive: true, force: true })
finish({ printGuardPasses: false })
