// Node harness for the Sound Along engine and the kid reader's page-turn rules (no browser, no audio).
//   node tests/engine_harness.mjs
// Mocks: Audio (play/pause/seek/load/events), a fake clock (performance.now, setTimeout), requestAnimationFrame,
// and word elements. It copies the REAL src/soundAlong.js and src/engine/*.js (only `./api` is stubbed) and loads the REAL
// src/pageSync.js. The kid reader's old page-turn logic is replayed from a copy in this file ("legacy") so the
// bug stays reproducible after the fix.
// Reproduces: R1 F5 (3 voice/pin state bugs), R1 F6 (missing audio -> visible, recoverable), R2 F2 (page turn vs voice).
// Kinds (see tests/README.md): engine mechanics and displayed/spoken page agreement are GUARDS;
// page-turn and ending policy choices are BEHAVIOR and are only reported.
// Limits: logic only. Real browsers fire media events asynchronously and decode audio; this mock fires them
// synchronously. The Vue component itself is checked separately in a browser.
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { guard, behavior, recordBehavior, finish } from './_kinds.mjs'

/* ---------- mocks ---------- */
const clock = { now: 0, timers: [], tid: 1, raf: new Map(), rid: 1 }
Object.defineProperty(globalThis, 'performance', { value: { now: () => clock.now }, configurable: true })
globalThis.setTimeout = (fn, ms = 0) => { const id = clock.tid++; clock.timers.push({ id, at: clock.now + ms, fn }); return id }
globalThis.clearTimeout = (id) => { clock.timers = clock.timers.filter((t) => t.id !== id) }
globalThis.requestAnimationFrame = (fn) => { const id = clock.rid++; clock.raf.set(id, fn); return id }
globalThis.cancelAnimationFrame = (id) => { clock.raf.delete(id) }
globalThis.window = { innerHeight: 800, addEventListener() {}, removeEventListener() {}, scrollBy() {} }

const audios = []
class MockAudio {
  constructor() {
    this.l = {}; this.currentTime = 0; this.paused = true; this.playbackRate = 1; this.defaultPlaybackRate = 1
    this.duration = NaN; this._src = ''; this.loaded = false; this.stalled = false
    this.failPlay = false; this.failLoad = false
    audios.push(this)
  }
  addEventListener(e, f) { (this.l[e] ||= []).push(f) }
  removeEventListener(e, f) { this.l[e] = (this.l[e] || []).filter((x) => x !== f) }
  emit(e) { for (const f of [...(this.l[e] || [])]) f({}) }
  set src(v) { this._src = v }
  get src() { return this._src }
  getAttribute(n) { return n === 'src' ? this._src || null : null }
  removeAttribute() { this._src = '' }
  load() { this.currentTime = 0; this.paused = true; this.loaded = false }
  play() {
    if (this.failPlay) return Promise.reject(new Error('NotAllowedError'))
    if (!this.paused) return Promise.resolve()
    this.paused = false; this.emit('play'); this.emit('playing')
    return Promise.resolve()
  }
  pause() { if (this.paused) return; this.paused = true; this.emit('pause') }
}
globalThis.Audio = MockAudio

function loadMeta(a, duration = 9) {
  if (a.failLoad) { a.emit('error'); return }
  a.loaded = true; a.duration = duration; a.emit('loadedmetadata')
}
// Move the fake wall clock and the media clock together, firing frame callbacks, timers and timeupdate.
function advance(ms, step = 16) {
  for (let done = 0; done < ms; done += step) {
    clock.now += step
    for (const a of audios) {
      if (!a.paused && a.loaded && !a.stalled) {
        a.currentTime += (step / 1000) * a.playbackRate
        if (a.currentTime >= a.duration) { a.currentTime = a.duration; a.paused = true; a.emit('pause'); a.emit('ended') }
      }
      if (Math.floor(clock.now / 250) !== Math.floor((clock.now - step) / 250)) a.emit('timeupdate')
    }
    for (const t of clock.timers.filter((x) => x.at <= clock.now)) { clock.timers = clock.timers.filter((x) => x !== t); t.fn() }
    const frames = [...clock.raf.entries()]
    clock.raf.clear()
    for (const [, fn] of frames) fn()
  }
}

const mkWord = (i) => ({
  dataset: { i: String(i) }, tabIndex: -1, textContent: 'w' + i,
  classList: { s: new Set(), add(c) { this.s.add(c) }, remove(c) { this.s.delete(c) }, contains(c) { return this.s.has(c) } },
  focus() {}, closest() { return null }, getBoundingClientRect() { return { top: 0, bottom: 10, left: 0, right: 10, height: 10 } },
})

const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src')
const tmp = mkdtempSync(path.join(os.tmpdir(), 'engine-'))
mkdirSync(path.join(tmp, 'engine'))
for (const f of ['timing.js', 'dom.js', 'input.js']) {
  copyFileSync(path.join(src, 'engine', f), path.join(tmp, 'engine', f))
}
const engineSrc = readFileSync(path.join(src, 'soundAlong.js'), 'utf8')
  .replace(/import \{ assetUrl \} from '\.\/api'/, 'const assetUrl = (u) => u')
writeFileSync(path.join(tmp, 'soundAlong.js'), engineSrc)
writeFileSync(path.join(tmp, 'package.json'), '{"type":"module"}\n')
const { SoundAlong } = await import(pathToFileURL(path.join(tmp, 'soundAlong.js')).href)
let pageSync = null
try { pageSync = await import('../src/pageSync.js') } catch { /* before the fix the module does not exist yet */ }

/* ---------- fixture: 6 words, two voices ---------- */
const T_A = [[1, 1.8], [3.2, 4.0], [4.5, 5.2], [5.5, 6.2], [6.5, 7.2], [7.5, 8.2]]
const T_B = [[2, 2.8], [7.0, 7.6], [8, 8.6], [9, 9.6], [10, 10.6], [11, 11.6]]
const voices = () => [{ id: 'A', audio: 'a.mp3', t: T_A.map((x) => [...x]) }, { id: 'B', audio: 'b.mp3', t: T_B.map((x) => [...x]) }]

function setup(extra = {}) {
  audios.length = 0; clock.now = 1000; clock.timers = []; clock.raf.clear()
  const state = { playing: false, time: 0, duration: 0, rate: 1, voiceId: '', error: '' }
  const words = [0, 1, 2, 3, 4, 5].map(mkWord)
  const container = { querySelectorAll: (s) => (s === '.sa-w:not(.sa-unread)' ? words : []), addEventListener() {}, removeEventListener() {} }
  const engine = new SoundAlong({ state, follow: false, ...extra })
  engine.attach(container, voices(), { voiceId: 'A', clicks: false, keys: false })
  loadMeta(engine.audio, 9)
  return { engine, state, audio: engine.audio, words }
}

/* ---------- tiny test runner ---------- */
// F5.* / F6.* are GUARDS (engine mechanics). R2F2.* are BEHAVIOR (what a manual page turn / the final star does: undecided).
const eq = (a, b, what) => { if (a !== b) throw new Error(`${what}: expected ${b}, got ${a}`) }
const near = (a, b, tol, what) => { if (Math.abs(a - b) > tol) throw new Error(`${what}: expected ~${b}, got ${a}`) }
const ok = (c, what) => { if (!c) throw new Error(what) }

guard('Reader word tap seeks audio and offers separate help', () => {
  let tapped = null
  const { engine, audio, words } = setup({ onTapWord: (el) => { tapped = el } })
  engine._onClick({ target: { closest: (selector) => selector === '.sa-w' ? words[2] : null } })
  eq(tapped, words[2], 'tap callback')
  eq(engine.curK, 2, 'highlight starts at tapped word')
  ok(!audio.paused, 'tap plays audio')
})
guard('In-between speed follows the media clock for the highlight', () => {
  const { engine, audio } = setup()
  engine.setRate(1.1)
  engine.toggle()
  advance(1000)
  near(audio.currentTime, 1.1, .05, 'media clock at 1.1 speed')
  eq(engine.curK, 0, 'first spoken word')
  advance(2000)
  eq(engine.curK, 1, 'second spoken word at 3.2 seconds')
})

/* ===== F5 case 1: voice switch before the first word must keep playing ===== */
guard('F5.1 switch voice in the lead-in (before word 0) while playing: new voice keeps playing', () => {
  const { engine, audio } = setup()
  engine.toggle(); advance(300)
  eq(engine.curK, -1, 'curK before first word')
  engine.setVoice('B'); loadMeta(audio, 12); advance(100)
  eq(audio.paused, false, 'new audio paused?')
})
guard('F5.1b switch voice in the lead-in while PAUSED: stays paused', () => {
  const { engine, audio } = setup()
  engine.setVoice('B'); loadMeta(audio, 12); advance(100)
  eq(audio.paused, true, 'new audio paused?')
})
guard('F5.1c rapid A->B->A before B loads, while playing: still playing after A loads', () => {
  const { engine, audio } = setup()
  engine.playFrom(2); advance(200)
  engine.setVoice('B'); engine.setVoice('A'); loadMeta(audio, 9); advance(100)
  eq(audio.paused, false, 'audio paused?')
  eq(engine.curK, 2, 'word kept')
  near(audio.currentTime, 4.48 + 0.1, 0.12, 'position')
})

/* ===== F5 case 2: a one-word snippet's stop time must follow the voice switch ===== */
guard('F5.2 snippet (old end 4.00) then switch to a voice where the word is at 7.00: plays the word, then stops', () => {
  const { engine, audio, state } = setup()
  engine.playSnippet(1); advance(100)
  engine.setVoice('B'); loadMeta(audio, 12)
  near(audio.currentTime, 6.98, 0.01, 'seek position')
  advance(400)
  eq(audio.paused, false, 'stopped immediately by the old stop time?')
  eq(engine.curK, 1, 'highlight')
  advance(1000)
  eq(audio.paused, true, 'should have stopped after the word (7.65)')
  ok(audio.currentTime >= 7.6 && audio.currentTime < 7.9, 'stopped right after the word, at ' + audio.currentTime)
  eq(state.playing, false, 'state.playing')
})
guard('F5.2b snippet, no switch: still stops at the word end (control)', () => {
  const { engine, audio } = setup()
  engine.playSnippet(1); advance(1500)
  eq(audio.paused, true, 'paused')
  ok(audio.currentTime < 4.3, 'stopped near 4.05, at ' + audio.currentTime)
})
guard('F5.2c ordinary playback after a snippet+switch is not stopped by a stale stop time', () => {
  const { engine, audio } = setup()
  engine.playSnippet(1); advance(100)
  engine.setVoice('B'); loadMeta(audio, 12); advance(1500) // snippet over
  engine.playFrom(3); advance(3000)
  eq(audio.paused, false, 'kept playing a normal read-from-here')
})

/* ===== F5 case 3: a paused or stalled voice-switched pin must not step back ===== */
guard('F5.3 pause on word 1, switch voice, wait 601 ms: highlight stays on word 1', () => {
  const { engine, audio } = setup()
  engine.playFrom(1); advance(100); engine.pause()
  engine.setVoice('B'); loadMeta(audio, 12)
  eq(engine.curK, 1, 'highlight right after switch')
  advance(601); engine.tick()
  eq(engine.curK, 1, 'highlight after 601 ms')
  advance(5000)
  eq(engine.curK, 1, 'highlight after 5 s paused')
  eq(audio.paused, true, 'still paused')
})
guard('F5.3b playing but stalled after a voice switch: highlight stays on the tapped word', () => {
  const { engine, audio } = setup()
  engine.playFrom(1); advance(100)
  engine.setVoice('B'); loadMeta(audio, 12)
  audio.stalled = true
  advance(1500)
  eq(engine.curK, 1, 'highlight while stalled')
  audio.stalled = false; advance(300)
  eq(engine.curK, 1, 'highlight once it starts moving (word 1 spans 7.0-7.6 in B)')
})
guard('F5.3c the paused pin is released by a seek elsewhere (tap another word)', () => {
  const { engine, audio } = setup()
  engine.playFrom(1); advance(100); engine.pause()
  engine.setVoice('B'); loadMeta(audio, 12); advance(700)
  engine.playFrom(4); advance(300)
  eq(engine.curK, 4, 'now on word 4')
})
guard('F5.3d regression: playing normally, the pin lets go once the clock reaches the word', () => {
  const { engine } = setup()
  engine.playFrom(2); advance(60)
  ok(engine.pin === null, 'pin released after the clock reached the word start')
  advance(1500)
  eq(engine.curK, 3, 'highlight follows the voice')
})
guard('F5.3e regression: the 500 ms escape still frees a pin when the media advances but the seek did not land', () => {
  const { engine, audio } = setup()
  engine.playFrom(3)
  audio.currentTime = 0 // the seek "did not land"
  advance(700)
  ok(engine.pin === null, 'pin released by the wall-clock escape')
})

/* ===== F3: the last command wins while switched-voice metadata is pending ===== */
guard('F3.1 Pause before switched voice metadata arrives cancels pending Play', () => {
  const { engine, audio, state } = setup()
  engine.playFrom(1); advance(100)
  engine.setVoice('B'); engine.pause()
  loadMeta(audio, 12); advance(100)
  eq(audio.paused, true, 'audio after delayed metadata')
  eq(state.playing, false, 'playing state')
})
guard('F3.2 Off before switched voice metadata arrives cancels pending Play', () => {
  const { engine, audio, state } = setup()
  engine.playFrom(1); advance(100)
  engine.setVoice('B'); engine.setEnabled(false)
  loadMeta(audio, 12); advance(100)
  eq(engine.enabled, false, 'enabled')
  eq(audio.paused, true, 'audio after delayed metadata')
  eq(state.playing, false, 'playing state')
})
guard('F3.2b Play/Pause toggle before switched voice metadata arrives cancels pending Play', () => {
  const { engine, audio, state } = setup()
  engine.playFrom(1); advance(100)
  engine.setVoice('B'); engine.toggle()
  loadMeta(audio, 12); advance(100)
  eq(audio.paused, true, 'audio after delayed metadata')
  eq(state.playing, false, 'playing state')
})
guard('F3.3 a newer scrubber seek wins over a pending word seek', () => {
  const { engine, audio } = setup()
  engine.playFrom(1); advance(100)
  engine.setVoice('B'); engine.seekTime(9)
  loadMeta(audio, 12)
  near(audio.currentTime, 9, 0.001, 'newer seek position')
})
guard('F3.4 Rewind during voice loading stays at the start and paused', () => {
  const { engine, audio, state } = setup()
  engine.playFrom(1); advance(100)
  engine.setVoice('B'); engine.rewind()
  loadMeta(audio, 12); advance(100)
  near(audio.currentTime, 0, 0.001, 'rewound position')
  eq(audio.paused, true, 'audio after delayed metadata')
  eq(state.playing, false, 'playing state')
})
guard('F3.5 a newer playFrom word wins during voice loading', () => {
  const { engine, audio } = setup()
  engine.playFrom(1); advance(100)
  engine.setVoice('B'); engine.playFrom(3)
  loadMeta(audio, 12)
  near(audio.currentTime, T_B[3][0] - 0.02, 0.001, 'newer word position')
  eq(audio.paused, false, 'newer word plays')
})
guard('F3.6 a newer playSnippet word wins during voice loading', () => {
  const { engine, audio } = setup()
  engine.playFrom(1); advance(100)
  engine.setVoice('B'); engine.playSnippet(3)
  loadMeta(audio, 12)
  near(audio.currentTime, T_B[3][0] - 0.02, 0.001, 'newer snippet position')
  near(engine.stopAt, T_B[3][1] + 0.05, 0.001, 'newer snippet stop')
  advance(800)
  eq(audio.paused, true, 'snippet stops at the newer word')
})
guard('F3.7 a newer scrubber seek survives another voice switch before metadata', () => {
  const { engine, audio } = setup()
  engine.playFrom(1); advance(100)
  engine.setVoice('B'); engine.seekTime(9); engine.setVoice('A')
  loadMeta(audio, 12)
  near(audio.currentTime, 9, 0.001, 'newer scrubber position after second switch')
  eq(audio.paused, false, 'play intent after second switch')
})
guard('F3.8 a newer paused scrubber seek survives another voice switch', () => {
  const { engine, audio } = setup()
  engine.playFrom(1); advance(100)
  engine.setVoice('B'); engine.pause(); engine.seekTime(9); engine.setVoice('A')
  loadMeta(audio, 12)
  near(audio.currentTime, 9, 0.001, 'paused scrubber position after second switch')
  eq(audio.paused, true, 'pause intent after second switch')
})

/* ===== F6: missing audio is visible and recoverable ===== */
guard('F6.1 audio file fails to load: state.error is set, and retry() recovers', () => {
  const { engine, audio, state } = setup()
  audio.failLoad = true
  engine.setVoice('B'); loadMeta(audio, 12)
  ok(state.error, 'error text is set')
  ok(typeof engine.retry === 'function', 'engine.retry exists')
  audio.failLoad = false
  engine.retry(); loadMeta(audio, 12); advance(100)
  eq(state.error, '', 'error cleared after retry')
  eq(audio.paused, false, 'playing after retry')
})
{
  const { engine, audio, state } = setup()
  audio.failPlay = true
  engine.toggle()
  await Promise.resolve(); await Promise.resolve()
  guard('F6.2 browser refuses play(): error is set', () => ok(state.error, 'error text is set'))
  audio.failPlay = false
  if (typeof engine.retry === 'function') { engine.retry(); loadMeta(audio, 9) }
  guard('F6.2b ...and retry() then plays', () => { ok(typeof engine.retry === 'function', 'engine.retry exists'); eq(audio.paused, false, 'playing') })
}

/* ===== R2 F2: the kid reader's page turn / final star ===== */
// Pages: [words 0-2] [words 3-5]. The "reader" mirrors KidReader.vue's goPage/next/prev/togglePlay/finish/onCurrent/onEnded.
const K_PAGE = [0, 0, 0, 1, 1, 1]
const FIRST_K = [0, 3]
function makeReader({ legacy, listen = true }) {
  const R = { page: 0, ended: false, heardEnd: false }
  const hooks = {
    onCurrent: (k, prevK) => {
      const pg = K_PAGE[k]
      if (pg === R.page) return
      const prevPg = prevK >= 0 ? K_PAGE[prevK] : undefined
      if (prevPg === undefined || pg !== prevPg) R.page = pg
    },
    onEnded: ({ snippet }) => {
      if (snippet || !listen) return
      R.heardEnd = true
      R.finish(true)
    },
  }
  const { engine, state, audio } = setup(hooks)
  R.engine = engine; R.state = state; R.audio = audio
  R.togglePlay = () => {
    if (state.playing) { engine.pause(); return }
    const cur = engine.curK
    if (cur >= 0 && K_PAGE[cur] === R.page) engine.resume()
    else engine.playFrom(FIRST_K[R.page])
  }
  R.goPage = (p, { manual = false } = {}) => {
    const np = Math.max(0, Math.min(1, p))
    if (np === R.page) return
    R.page = np
    if (manual && !legacy) {
      const plan = pageSync.turnPlan({ listen, playing: state.playing, firstK: FIRST_K[np] })
      if (plan === 'play-page') engine.playFrom(FIRST_K[np])
      else if (plan === 'pause') engine.pause()
    }
  }
  R.next = () => { if (R.page >= 1) R.finish(false); else R.goPage(R.page + 1, { manual: true }) }
  R.prev = () => R.goPage(R.page - 1, { manual: true })
  R.finish = (force) => {
    if (R.ended) return
    if (!legacy && !force) {
      const playingLast = state.playing && engine.curK >= 0 && K_PAGE[engine.curK] === 1
      const plan = pageSync.finishPlan({ listen, hasNarration: true, heardEnd: R.heardEnd, playingLastPage: playingLast, lastFirstK: FIRST_K[1] })
      if (plan === 'keep-listening') return
      if (plan === 'play-last') { R.togglePlay(); return }
    }
    R.ended = true
    engine.pause()
  }
  return R
}
// Does what the child sees (page) agree with what they hear (the word being read)?
function mismatchWhilePlaying(R, ms) {
  let bad = 0
  for (let t = 0; t < ms; t += 100) {
    advance(100)
    if (R.state.playing && R.engine.curK >= 0 && K_PAGE[R.engine.curK] !== R.page) bad++
  }
  return bad
}
const legacyBugs = {}
for (const legacy of [true, false]) {
  const run = (name, fn) => {
    if (legacy) {
      try { fn(makeReader({ legacy: true })); legacyBugs[name] = 'not reproduced' } catch (e) { legacyBugs[name] = 'REPRODUCED: ' + e.message }
    } else {
      if (!pageSync) {
        if (/shown page and the spoken page never disagree/.test(name)) guard(name, () => { throw new Error('src/pageSync.js does not exist') })
        else recordBehavior(name, false, 'src/pageSync.js does not exist (the page-turn design moved?)')
        return
      }
      const check = /shown page and the spoken page never disagree/.test(name) ? guard : behavior
      check(name, () => fn(makeReader({ legacy: false })))
    }
  }
  run('R2F2.1 Next pressed during narration of page 1: the shown page and the spoken page never disagree', (R) => {
    R.togglePlay(); advance(2500) // reading page 1 (word 1 at ~3.2 s)
    eq(R.page, 0, 'on page 1')
    R.next()
    eq(mismatchWhilePlaying(R, 3000), 0, 'samples where page shown != page spoken')
  })
  run('R2F2.2 Previous pressed during narration of page 2: the shown page and the spoken page never disagree', (R) => {
    R.togglePlay(); advance(6000)
    eq(R.page, 1, 'narration turned to page 2')
    R.prev()
    eq(mismatchWhilePlaying(R, 2500), 0, 'samples where page shown != page spoken')
  })
  run('R2F2.3 Next while PAUSED, then Play: reads the page that is showing', (R) => {
    R.togglePlay(); advance(2000); R.togglePlay(); advance(100)
    R.next(); R.togglePlay(); advance(1500)
    eq(R.page, 1, 'page')
    ok(R.state.playing && K_PAGE[R.engine.curK] === 1, 'speaking page 2')
  })
  run('R2F2.4 Final star pressed before the last page was heard (nothing played): story does not end', (R) => {
    R.next() // page 2, nothing played yet
    R.next() // the star
    eq(R.ended, false, 'ended')
  })
  run('R2F2.5 Final star pressed mid-way through the last page: story does not end, narration goes on to the end', (R) => {
    R.togglePlay(); advance(6000); eq(R.page, 1, 'on last page')
    R.next(); eq(R.ended, false, 'ended right after star')
    advance(1000); eq(R.ended, false, 'ended while still reading')
    advance(3000); eq(R.ended, true, 'ends once the narration finishes')
  })
  run('R2F2.6 Whole story heard: it ends by itself when the audio ends', (R) => {
    R.togglePlay(); advance(9500)
    ok(R.ended, 'ends when the audio ends')
  })
  if (!legacy) {
    behavior('R2F2.7 "Read on my own" (no narration): the star ends the story at once', () => {
      const R = makeReader({ legacy: false, listen: false }); R.next(); R.next(); eq(R.ended, true, 'ended')
    })
  }
}

/* ---------- report ---------- */
console.log('--- old kid-reader logic replayed (documentary; these show the bug) ---')
for (const [k, v] of Object.entries(legacyBugs)) console.log(`  ${v.startsWith('REPRODUCED') ? 'BUG ' : 'ok  '} ${k}\n        ${v}`)
console.log('--- current code ---')
finish()
