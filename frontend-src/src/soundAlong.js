// Sound Along engine: plain JS, no Vue inside. The Vue layer passes in a reactive
// `state` object (for the player UI) and a few callbacks.
//
// The class owns playback and keeps the reader-facing API. The timing module
// decides which word the media clock is on; the DOM and input modules handle
// highlighting, following, and delegated word actions.
import { assetUrl } from './api'
import { timing, timingTable, nextTimed, applyPending, wordAtClock } from './engine/timing.js'
import { setCurrent, follow, applyRoving } from './engine/dom.js'
import { activate, onClick, onKey, lineNeighbour } from './engine/input.js'

const SEEK_LEAD = 0.02 // seek this much before the tapped word's start (no more)

export class SoundAlong {
  // Optional extras (used by the kid view; the passage page passes none and behaves as before):
  //   onCurrent(k, prevK)  the highlighted word changed (k >= 0)
  //   onEnded({ snippet }) the audio reached its end (snippet = it was a one-word playSnippet)
  //   follow: false        never scroll the window to follow the highlight (paged layouts)
  constructor({ state, onVocab, onTapWord, getSafeBottom, onCurrent, onEnded, follow = true }) {
    this.state = state
    this.onCurrent = onCurrent || null
    this.onEnded = onEnded || null
    this.follow = follow
    this.clicks = true
    this.keys = true
    this._snippet = false
    this.onVocab = onVocab || (() => {})
    this.onTapWord = onTapWord || null
    this.getSafeBottom = getSafeBottom || (() => window.innerHeight)
    this.audio = new Audio()
    SoundAlong.latest = this
    this.audio.preload = 'metadata'
    this.words = [] // narrated word spans, DOM order
    this.index = new Map() // span -> k
    this.voices = []
    this.voice = null
    this.startOf = []
    this.order = []
    this.starts = []
    this.ends = []
    this.curK = -1
    this.curEl = null
    this.pin = null // tapped word held until its media time; paused/stalled pins wait for playback
    this.pending = null // seek to apply once the new audio's metadata is ready
    this.range = null // sentence rehearsal: truthy while a bounded play is running (see playRange)
    this.rangeCb = null // { onEnd, onCancel } of the rehearsal that owns the audio (kept while quiet)
    this.quiet = false // after a range ended: no word is highlighted until something plays or seeks again
    this.rovingK = 0
    this.enabled = true
    this.raf = 0
    this.lastUserScroll = 0
    this.ignoreScrollUntil = 0
    this._onClick = this._onClick.bind(this)
    this._onKey = this._onKey.bind(this)
    this._bind()
  }

  /* ---------- setup / teardown ---------- */

  attach(container, voices, { voiceId, rate = 1, clicks = true, keys = true } = {}) {
    this.container = container
    this.clicks = clicks
    this.keys = keys
    this.voices = voices
    this.words = Array.from(container.querySelectorAll('.sa-w:not(.sa-unread)'))
    this.index = new Map(this.words.map((el, k) => [el, k]))
    this.words.forEach((el) => {
      el.tabIndex = -1
    })
    container.querySelectorAll('.sa-unread').forEach((el) => {
      el.title = 'Not read aloud'
    })
    if (clicks) container.addEventListener('click', this._onClick)
    if (keys) container.addEventListener('keydown', this._onKey)
    this.setRate(rate)
    this._loadVoice(voices.find((v) => v.id === voiceId) || voices[0], null)
    this._applyRoving(0)
  }

  destroy() {
    this.pending = null
    clearTimeout(this._snipT)
    cancelAnimationFrame(this.raf)
    this.container?.removeEventListener('click', this._onClick)
    this.container?.removeEventListener('keydown', this._onKey)
    for (const [ev, fn] of this._audioEvents) this.audio.removeEventListener(ev, fn)
    window.removeEventListener('wheel', this._onUserScroll)
    window.removeEventListener('touchmove', this._onUserScroll)
    window.removeEventListener('scroll', this._onScroll)
    this.audio.pause()
    this.audio.removeAttribute('src')
    this.audio.load()
  }

  _bind() {
    const a = this.audio
    const s = this.state
    this._onUserScroll = () => {
      this.lastUserScroll = performance.now()
    }
    this._onScroll = () => {
      if (performance.now() > this.ignoreScrollUntil) this.lastUserScroll = performance.now()
    }
    window.addEventListener('wheel', this._onUserScroll, { passive: true })
    window.addEventListener('touchmove', this._onUserScroll, { passive: true })
    window.addEventListener('scroll', this._onScroll, { passive: true })

    const loop = () => {
      this.tick()
      this.raf = requestAnimationFrame(loop)
    }
    const startLoop = () => {
      if (!this.raf) this.raf = requestAnimationFrame(loop)
    }
    const stopLoop = () => {
      cancelAnimationFrame(this.raf)
      this.raf = 0
    }
    this._audioEvents = [
      ['play', () => { s.playing = true; startLoop() }],
      ['playing', () => { s.playing = true; startLoop() }],
      ['pause', () => {
        s.playing = false
        stopLoop()
        this.tick()
        if (this.curK >= 0) this._applyRoving(this.curK)
      }],
      ['ended', () => {
        s.playing = false
        stopLoop()
        this.pin = null
        this._setCurrent(-1)
        s.time = a.duration || 0
        const snippet = this._snippet
        this._snippet = false
        this.onEnded?.({ snippet })
        if (this.range) this._finishRange() // the range reached the very end of the audio
      }],
      // rAF pauses in hidden tabs; timeupdate (~4 Hz) keeps the highlight honest there.
      ['timeupdate', () => this.tick()],
      ['seeked', () => this.tick()],
      ['loadedmetadata', () => {
        s.duration = a.duration || 0
        s.error = ''
        this._applyPending()
      }],
      ['durationchange', () => { s.duration = a.duration || 0 }],
      ['error', () => {
        if (!a.getAttribute('src')) return
        s.error = 'Audio could not be loaded.'
        s.playing = false
        this.pin = null
      }],
    ]
    for (const [ev, fn] of this._audioEvents) a.addEventListener(ev, fn)
  }

  /* ---------- voice timing tables ---------- */

  _timing(voice, el) {
    return timing(voice, el)
  }

  _loadVoice(voice, wordK, { play = false, snippet = false } = {}) {
    this._clearRange() // a rehearsal's word range belongs to the old voice's timing
    this.voice = voice
    this.state.voiceId = voice.id
    this.state.error = ''
    Object.assign(this, timingTable(voice, this.words))
    this.pending = { wordK, play, snippet }
    this.audio.src = assetUrl(voice.audio)
    this.audio.defaultPlaybackRate = this.state.rate
    this.audio.load()
    this.audio.playbackRate = this.state.rate
    this.state.time = 0
    this.state.duration = 0
  }

  _applyPending() {
    return applyPending(this)
  }

  // A one-word snippet: stop just after word k ends, in the CURRENT voice's timing.
  _armSnippet(k) {
    this._snippet = true
    const t = this._timing(this.voice, this.words[k])
    this.stopAt = t ? t[1] + 0.05 : null
    clearTimeout(this._snipT)
  }

  _scheduleSnippetStop() {
    // Don't rely on the frame loop alone to stop at the end of the word (it is throttled in hidden tabs).
    clearTimeout(this._snipT)
    if (this.stopAt !== null && this.stopAt !== undefined) {
      const ms = ((this.stopAt - this.audio.currentTime) / (this.state.rate || 1)) * 1000 + 15
      this._snipT = setTimeout(() => this.tick(), Math.max(0, ms))
    }
  }

  _nextTimed(k) {
    return nextTimed(this.startOf, k)
  }

  /* ---------- controls ---------- */

  setEnabled(on) {
    this.enabled = on
    if (!on) {
      this.pending = null
      this._clearRange()
      this.audio.pause()
      this.pin = null
      this._setCurrent(-1)
    }
    this._applyRoving(on ? this.rovingK : -1)
  }

  toggle() {
    this._clearRange()
    this.stopAt = null
    this._snippet = false
    if (this.pending) {
      this.pending.play = !this.pending.play
      this.pending.snippet = false
      return
    }
    if (this.audio.paused) this._play()
    else this.audio.pause()
  }

  pause() {
    this._clearRange()
    if (this.pending) this.pending.play = false
    this.audio.pause()
  }

  // Continue from where the audio is (the kid view's play button).
  resume() {
    this.stopAt = null
    this._snippet = false
    if (this.pending) {
      this.pending.play = true
      this.pending.snippet = false
      return
    }
    return this._play()
  }

  // Play from narrated word k (like tapping it, without any vocabulary popup).
  playFrom(k) {
    this.stopAt = null
    this._snippet = false
    const kk = this._nextTimed(k)
    if (kk === null) return false
    if (this.pending) this.pending = { wordK: kk, play: true, snippet: false }
    this._seekWord(kk, true)
    return true
  }

  // Back to the very start, paused.
  rewind() {
    this._clearRange()
    this.stopAt = null
    this._snippet = false
    this.pin = null
    if (this.pending) this.pending = { time: 0, play: false }
    this.audio.pause()
    this.audio.currentTime = 0
    this._setCurrent(-1)
    this.tick()
  }

  // Has narration been started at least once? (A tap on blank space only pauses/resumes then.)
  get started() {
    return this.audio.currentTime > 0 || this.curK >= 0
  }

  // Say ONE word from the narration, then stop: the fallback when a word has no recorded clip.
  playSnippet(k) {
    const kk = this._nextTimed(k)
    if (kk === null) return false
    if (this.pending) this.pending = { wordK: kk, play: true, snippet: true }
    this._armSnippet(kk)
    this._seekWord(kk, true)
    this._scheduleSnippetStop()
    return true
  }

  // Sentence rehearsal: play narrated words k0..k1 (inclusive) and stop right after the last one's end, then call
  // onEnd(). Nothing is highlighted after it stops (`quiet`) until something else plays or seeks. If anything else
  // takes over the audio (a tap on a word, play, rewind, the scrubber) before it ends, onCancel() is called instead.
  // Returns false if no word in the range has timing.
  playRange(k0, k1, { onEnd, onCancel } = {}) {
    this._clearRange(true)
    let first = null
    let last = null
    for (let j = k0; j <= k1 && j < this.startOf.length; j++) {
      if (this.startOf[j] === null) continue
      if (first === null) first = j
      last = j
    }
    if (first === null) return false
    const end = this._timing(this.voice, this.words[last])[1]
    // stop a hair after the word ends, but never into the next word's first sound; words that touch stop at the end
    let stop = end + 0.06
    const pos = this.order.indexOf(last)
    const nextStart = pos >= 0 && pos + 1 < this.order.length ? this.startOf[this.order[pos + 1]] : null
    if (nextStart !== null) stop = nextStart > end + 0.011 ? Math.min(stop, nextStart - 0.01) : Math.min(end, nextStart) // touching or overlapping words
    this._seekWord(first, false)
    this._snippet = true // a bounded play: the audio's own end must not count as "the story ended"
    this.stopAt = stop
    this.range = true
    this.rangeCb = { onEnd, onCancel }
    // The frame loop and timeupdate are throttled in hidden tabs: also arm a timer for the stop.
    clearTimeout(this._snipT)
    const ms = ((this.stopAt - this.audio.currentTime) / (this.state.rate || 1)) * 1000 + 15
    this._snipT = setTimeout(() => this.tick(), Math.max(0, ms))
    this._playRaw()
    return true
  }

  // Leave a running range (rehearsal) without calling its callbacks: the caller already knows.
  cancelRange({ pause = true } = {}) {
    const had = this.range || this.quiet
    this._clearRange(true)
    if (had && pause) {
      this.stopAt = null
      this._snippet = false
      this.audio.pause()
    }
  }

  _finishRange() {
    const cb = this.rangeCb
    this.range = null
    this.quiet = true
    this._snippet = false
    this.stopAt = null
    clearTimeout(this._snipT)
    this._setCurrent(-1)
    cb?.onEnd?.()
  }

  _clearRange(silent = false) {
    const cb = this.rangeCb
    this.range = null
    this.quiet = false
    this.rangeCb = null
    if (!silent) cb?.onCancel?.()
  }

  // The narrated word index of a vocabulary sense's first occurrence in the passage.
  kOfSense(senseId) {
    const el = this.container?.querySelector(`[data-vocab-sense-id="${CSS.escape(senseId)}"] .sa-w:not(.sa-unread)`)
    const k = el ? this.index.get(el) : undefined
    return k === undefined ? null : k
  }

  _play() {
    this._clearRange()
    return this._playRaw()
  }

  _playRaw() {
    return this.audio.play().catch(() => {
      this.state.error = 'Audio could not be played.'
    })
  }

  setRate(r) {
    this.state.rate = r
    this.audio.defaultPlaybackRate = r
    this.audio.playbackRate = r
  }

  seekTime(t) {
    // scrubber: explicit time, no word pin
    this._clearRange()
    this.pin = null
    this.stopAt = null
    this._snippet = false
    if (this.pending) {
      this.pending = { time: t, play: this.pending.play }
      this.state.time = t
      return
    }
    this.audio.currentTime = t
    this.tick()
  }

  setVoice(id) {
    const v = this.voices.find((x) => x.id === id)
    if (!v || v === this.voice) return
    const pendingTime = this.pending?.time
    const keep = this.pin ? this.pin.k : this.curK // keep the reading position by WORD
    // A switch can land before the previous one finished loading (A -> B -> A): the audio is paused by then, so
    // the earlier request says whether narration was meant to be going, and whether it was a one-word snippet.
    const wasPlaying = !this.audio.paused || !!this.pending?.play
    const snippet = (this._snippet && this.stopAt != null) || !!this.pending?.snippet
    // The old voice's stop time means nothing in the new voice's timing: re-armed from the new timing on load.
    this.stopAt = null
    clearTimeout(this._snipT)
    this.audio.pause()
    this._loadVoice(v, keep >= 0 ? keep : null, { play: wasPlaying, snippet })
    if (pendingTime !== undefined) {
      // An explicit scrubber position is newer than the word kept by the earlier voice switch.
      this.pending = { time: pendingTime, play: wasPlaying }
      this.state.time = pendingTime
      this.pin = null
      this._setCurrent(-1)
      return
    }
    if (keep >= 0) {
      // Hold the highlight on that word while the new audio loads (same pin rule as a tap).
      const k = this._nextTimed(keep)
      if (k !== null) {
        this.pin = { k, start: Infinity, at: Infinity }
        this._setCurrent(k)
      }
    }
  }

  // Try the current voice again after "Audio could not be loaded / played": reload it, go back to the same word,
  // and play. (The error text clears when the new load succeeds.)
  retry() {
    const keep = this.pin ? this.pin.k : this.curK
    const snippet = this._snippet && this.stopAt != null
    this.stopAt = null
    clearTimeout(this._snipT)
    this._loadVoice(this.voice, keep >= 0 ? keep : null, { play: true, snippet })
    if (keep >= 0) {
      const k = this._nextTimed(keep)
      if (k !== null) {
        this.pin = { k, start: Infinity, at: Infinity }
        this._setCurrent(k)
      }
    }
  }

  // Seek to word k and (optionally) play. Lead by at most 0.02 s; hold its
  // highlight until the media clock reaches it. A paused or stalled pin waits.
  _seekWord(k, play = true) {
    const start = this.startOf[k]
    if (start === null) return
    this._clearRange()
    this.pin = { k, start, at: performance.now(), lastT: undefined, moved: performance.now() }
    this.lastUserScroll = 0
    this.audio.currentTime = Math.max(0, start - SEEK_LEAD)
    this._setCurrent(k)
    this._applyRoving(k)
    this.state.time = this.audio.currentTime
    if (play) this._play()
  }

  /* ---------- the clock-driven highlight ---------- */

  tick() {
    const a = this.audio
    const t = a.currentTime
    if (Math.abs(t - this.state.time) >= 0.1) this.state.time = t
    if (!this.enabled) return
    if (this.stopAt !== null && this.stopAt !== undefined && t >= this.stopAt) {
      this.stopAt = null
      a.pause()
      if (this.range) this._finishRange()
    }

    let k = wordAtClock(this, t, a.paused, performance.now())
    if (this.quiet) k = -1
    this._setCurrent(k)
    if (this.follow && k >= 0 && !a.paused) this._follow(this.words[k])
  }

  _setCurrent(k) {
    return setCurrent(this, k)
  }

  // Scroll only when the current word leaves the visible area (above the dock),
  // and never within a couple of seconds of the user's own scrolling.
  _follow(el) {
    return follow(this, el)
  }

  /* ---------- word interaction (event delegation) ---------- */

  _applyRoving(k) {
    return applyRoving(this, k)
  }

  _activate(span) {
    return activate(this, span)
  }

  _onClick(e) {
    return onClick(this, e)
  }

  _onKey(e) {
    return onKey(this, e)
  }

  // Up/Down: nearest word (by x) on the previous/next visual line.
  _lineNeighbour(k, dir) {
    return lineNeighbour(this.words, k, dir)
  }
}
