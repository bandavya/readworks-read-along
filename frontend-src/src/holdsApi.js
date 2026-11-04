// The holds panel's API setting and small pure helpers.
// One build-time setting, VITE_HOLDS_API (for example https://api.example.test). When it is not set,
// `holdsBase` is null: the #/holds route does not exist and the review screen shows no link to it, so today's behavior is
// untouched. The team passcode is typed by a person and exchanged for a signed session token that lives in sessionStorage
// (one browser tab session). The passcode itself is never in the build and never stored.
import { PUBLIC_SAMPLE } from './mode.js'

export function normalizeHoldsApi(raw) {
  const value = String(raw ?? '').trim().replace(/\/+$/, '')
  if (!value) return null
  try {
    const u = new URL(value)
    return u.protocol === 'https:' || u.protocol === 'http:' ? value : null
  } catch { return null }
}

export const holdsBase = PUBLIC_SAMPLE ? null : normalizeHoldsApi(import.meta.env && import.meta.env.VITE_HOLDS_API)

// ---------- session (per browser tab; every access guarded, the page works without storage) ----------
const SESSION_KEY = 'sa-holds-session'
export function readSession(storage, now = Date.now()) {
  try {
    const s = JSON.parse((storage || globalThis.sessionStorage).getItem(SESSION_KEY) || 'null')
    if (s && typeof s.token === 'string' && typeof s.name === 'string' && Date.parse(s.expiresAt) > now) return s
  } catch { /* storage unavailable or corrupt: signed out */ }
  return null
}
export function saveSession(session, storage) {
  try { (storage || globalThis.sessionStorage).setItem(SESSION_KEY, JSON.stringify(session)) } catch { /* ignore */ }
}
export function clearSession(storage) {
  try { (storage || globalThis.sessionStorage).removeItem(SESSION_KEY) } catch { /* ignore */ }
}

// A small remembered choice (auto-play on or off). Never required: without storage the default is used.
export function readPref(key, fallback, storage) {
  try {
    const v = (storage || globalThis.localStorage).getItem('sa-holds-' + key)
    return v === null || v === undefined ? fallback : JSON.parse(v)
  } catch { return fallback }
}
export function savePref(key, value, storage) {
  try { (storage || globalThis.localStorage).setItem('sa-holds-' + key, JSON.stringify(value)) } catch { /* ignore */ }
}

export class HoldsError extends Error {
  constructor(status, message, data) { super(message); this.status = status; this.data = data || {} }
}

// A request the API can refuse in plain words. Resolves to the JSON body; rejects with HoldsError(status, message, body).
export async function holdsRequest(path, { method = 'GET', body, token, timeoutMs = 25000, base = holdsBase, fetchFn = globalThis.fetch } = {}) {
  if (!base) throw new HoldsError(0, 'No holds API configured')
  const headers = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (token) headers.Authorization = `Bearer ${token}`
  let res
  try {
    res = await fetchFn(`${base}${path}`, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs),
    })
  } catch {
    throw new HoldsError(0, 'Could not reach the holds server. Check your connection and try again.')
  }
  let data = {}
  try { data = await res.json() } catch { /* an empty or non-JSON body */ }
  if (!res.ok) throw new HoldsError(res.status, data.error || `The server said ${res.status}.`, data)
  return data
}

// ---------- the audio a flag plays ----------
// A word is played from its OWN start to its OWN end, with a small pad. The server sends each flag's start and end from that
// word's row in the take's timing (for a flagged phrase: the first word's start to the last word's end).
export const WORD_PAD_BEFORE = 0.12
export const WORD_PAD_AFTER = 0.18
export const MISSING_HALF_WINDOW = 0.6

export function wordClip(flag, duration) {
  let from
  let to
  if (flag.kind === 'missing') {
    // a written word nobody said has no time of its own: play the moment around where it should have been
    const mid = (Number(flag.start) + Number(flag.end)) / 2
    from = mid - MISSING_HALF_WINDOW
    to = mid + MISSING_HALF_WINDOW
  } else {
    from = Number(flag.start) - WORD_PAD_BEFORE
    to = Number(flag.end) + WORD_PAD_AFTER
  }
  from = Math.max(0, from)
  if (duration) to = Math.min(duration, to)
  to = Math.max(to, from + 0.3)
  if (duration && to > duration) { to = duration; from = Math.max(0, to - 0.3) }      // a word at the very end still has sound in it
  return { from: Math.round(from * 1000) / 1000, to: Math.round(to * 1000) / 1000 }
}

const ABBREVIATION = /^(?:(?:Mr|Mrs|Ms|Dr|St|Jr|Sr|Mt|vs|etc|No|[A-Z])\.|(?:[A-Za-z]\.){2,})$/
const SENTENCE_END = /[.!?]["'”’)\]]*$/
export function endsSentence(word) {
  return SENTENCE_END.test(word || '') && !ABBREVIATION.test(word)
}

// The sentence around words[i]: [first, last] indexes. A run with no full stop is cut at 40 words each way.
export function sentenceBounds(words, i) {
  const n = words.length
  if (!n) return [0, 0]
  const at = Math.min(Math.max(i, 0), n - 1)
  let a = at
  while (a > 0 && at - a < 40 && !endsSentence(words[a - 1])) a--
  let b = at
  while (b < n - 1 && b - at < 40 && !endsSentence(words[b])) b++
  return [a, b]
}

// What to show and play for a flag's sentence. `data` is the take detail: lead, text, rows, duration. A flag in the title and byline
// uses the lead-in as its sentence. Returns { words, mark, span, from, to }: mark = index of the flagged word in `words`,
// span = how many written words the flag covers (0 for an extra spoken word: it sits BEFORE words[mark]).
export function sentenceFor(data, flag) {
  const lead = data.lead || []
  const text = data.text || []
  const rows = data.rows || []
  let words
  let base
  let mark
  if (flag.text_index < 0) {
    words = lead
    base = 0
    mark = Math.max(0, Math.min(flag.word_index, lead.length - 1))
  } else {
    const [a, b] = sentenceBounds(text, flag.text_index)
    words = text.slice(a, b + 1)
    base = lead.length + a
    mark = Math.min(Math.max(flag.text_index - a, 0), Math.max(words.length - 1, 0))
  }
  const span = flag.kind === 'extra' ? 0 : Math.max(1, String(flag.written || '').trim().split(/\s+/).length)
  const first = rows[base]
  const last = rows[base + Math.max(words.length - 1, 0)]
  const from = first ? Math.max(0, first[0] - 0.1) : 0
  let to = last ? last[1] + 0.25 : from + 3
  if (data.duration) to = Math.min(data.duration, to)
  return { words, mark, span, from: Math.round(from * 1000) / 1000, to: Math.round(Math.max(to, from + 0.5) * 1000) / 1000 }
}

// ---------- answers, outcome, speed ----------
export function summarize(flags) {
  const right = flags.filter((f) => f.answer?.answer === 'right').length
  const wrong = flags.filter((f) => f.answer?.answer === 'wrong').length
  return { total: flags.length, right, wrong, unanswered: flags.length - right - wrong }
}

// One plain sentence about where a take stands.
export function outcomeText(s) {
  if (!s.total) return 'Nothing to answer.'
  if (!s.wrong && !s.unanswered) return `All ${s.total} ${s.total === 1 ? 'sounds' : 'sound'} right.`
  const parts = []
  if (s.right) parts.push(`${s.right} ${s.right === 1 ? 'sounds' : 'sound'} right`)
  if (s.wrong) parts.push(`${s.wrong} ${s.wrong === 1 ? 'sounds' : 'sound'} wrong`)
  if (s.unanswered) parts.push(`${s.unanswered} not answered`)
  const sentence = parts.join(', ')
  return sentence.charAt(0).toUpperCase() + sentence.slice(1) + '.'
}

export function formatDuration(seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0))
  if (s < 60) return `${s} s`
  const m = Math.floor(s / 60)
  return s % 60 ? `${m} min ${s % 60} s` : `${m} min`
}

// "14 flags in 3 min 20 s": only from times a person's own answers carried. A scripted run, or a flag answered without a time,
// gives no line at all (never an estimate).
export function speedLine(speed) {
  if (!speed || !speed.complete || !speed.timed) return ''
  return `${speed.timed} flag${speed.timed === 1 ? '' : 's'} in ${formatDuration(speed.seconds)}`
}

// Time a flag is on screen, not counting time the page was hidden. The clock is injectable so a test can drive it.
export function makeStopwatch(now = () => performance.now()) {
  let acc = 0
  let t0 = null
  return {
    start() { acc = 0; t0 = now() },
    pause() { if (t0 !== null) { acc += now() - t0; t0 = null } },
    resume() { if (t0 === null) t0 = now() },
    seconds() { return Math.round((acc + (t0 === null ? 0 : now() - t0)) / 100) / 10 },
  }
}

// ---------- the queue ----------
// The next hold to clear: one with flags still to answer first, then any that only needs its decision. Holds that cannot be
// released here, and ones the person skipped this sitting, are left out. The server already lists them in the right order.
export function nextTake(takes, skip = new Set()) {
  const open = takes.filter((t) => !t.blocked && !skip.has(`${t.id}.${t.voice}`))
  return open.find((t) => t.unanswered > 0) || open[0] || null
}

export function shortState(state) {
  return { live_unanswered: 'Live now', held: 'Held', live_answered: 'Live, answered', stale: 'Left over' }[state] || state
}

// ---------- keys ----------
// Keys that clear a flag, when the focus is not in a field. Space is left to a focused button.
export function keyAction(event) {
  const tag = (event.target && event.target.tagName) || ''
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag) || event.ctrlKey || event.metaKey || event.altKey) return null
  const onButton = /^(BUTTON|A|SUMMARY)$/.test(tag)
  switch (event.key) {
    case 'y': case '1': return 'right'
    case 'n': case '2': return 'wrong'
    case 's': return 'sentence'
    case 'u': case 'Backspace': return 'undo'
    case 'ArrowRight': return 'next'
    case 'ArrowLeft': return 'prev'
    case ' ': return onButton ? null : 'word'
    default: return null
  }
}

// Next or previous index, stopping at the ends.
export function stepIndex(i, n, dir) {
  if (!n) return 0
  return Math.min(n - 1, Math.max(0, i + dir))
}

export function paragraphsOf(words, paras) {
  const out = []
  let at = 0
  for (const n of paras && paras.length ? paras : [words.length]) {
    out.push({ start: at, words: words.slice(at, at + n) })
    at += n
  }
  if (at < words.length) out.push({ start: at, words: words.slice(at) })
  return out
}

export function flagsText(n) {
  return `${n} flag${n === 1 ? '' : 's'}`
}

// A page driven by a script (a test) says so; its answers are saved as scripted and never counted as a person's speed.
export function isScripted(win = globalThis) {
  try { return win.__holdsScripted === true || (win.navigator && win.navigator.webdriver === true) } catch { return false }
}

// ---------- guarding the answers ----------
// An answer must come from a fresh press. A held key (auto-repeat), a key that was not released since the last answer, a click that
// is not backed by a new pointer press or a new key press (a held Enter on a focused button), and anything within `minMs` of a flag
// arriving, are all ignored. Two real taps are two answers.
export function makeAnswerGate(now = () => performance.now(), minMs = 300) {
  let arrived = 0
  let fresh = false
  let held = null
  const tooSoon = () => now() - arrived < minMs
  return {
    arrive() { arrived = now(); fresh = false },
    // a global key press: true only for a new press of an answer key, released since the last answer
    keyDown(event) {
      if (event.repeat) return false
      if (held !== null) return false
      if (tooSoon()) return false
      held = event.key
      return true
    },
    keyUp(event) { if (held !== null && event.key === held) held = null },
    reset() { held = null; fresh = false },
    // a press on an answer button (pointer, or a non-repeating Enter or Space) makes the next click count, once
    pressed(event) {
      if (event && event.repeat) return
      fresh = true
    },
    click() {
      if (!fresh || tooSoon()) { fresh = false; return false }
      fresh = false
      return true
    },
  }
}

export function changedMessage(n) {
  return `This take changed. Your last ${n === 1 ? 'answer wasn’t' : `${n} answers weren’t`} saved.`
}

// Answers go to the server one after another, each with the fingerprint of the take as it was WHEN THE ANSWER WAS MADE. If the
// server says the take changed, every answer still waiting is dropped (never sent against the new take) and the person is told how
// many were not saved. `send(job)` does the request; hooks.changed(n) and hooks.failed(job, error) report back.
export function makeAnswerQueue(send, hooks) {
  let chain = Promise.resolve()
  let generation = 0
  let unsaved = 0
  const changed = (e) => e && e.status === 409 && e.data && e.data.changed === true
  return {
    add(job) {
      const mine = generation
      unsaved++
      chain = chain.then(async () => {
        if (mine !== generation) return
        try {
          await send(job)
          unsaved--
        } catch (e) {
          if (changed(e)) {
            const n = unsaved
            generation++
            unsaved = 0
            await hooks.changed(n, e)
          } else {
            unsaved--
            await hooks.failed(job, e)
          }
        }
      })
      return chain
    },
    idle() { return chain },
  }
}

// One audio, one clip at a time. A clip that is still waiting for the recording to load is cancelled by anything that stops or
// replaces it, so moving on can never start the old word under the new flag.
export function makeClipPlayer(audio, { onState = () => {}, rate = () => 1, every = setInterval, clear = clearInterval } = {}) {
  let loaded = ''
  let stopAt = null
  let timer = null
  let pending = null
  function cancel() {
    if (pending) { audio.removeEventListener('loadedmetadata', pending); pending = null }
  }
  function stop() {
    cancel()
    audio.pause()
    clear(timer)
    stopAt = null
    onState('')
  }
  function play(url, from, to, which) {
    cancel()
    audio.pause()
    clear(timer)
    if (loaded !== url) { audio.src = url; loaded = url; audio.load() }
    stopAt = to
    const go = () => {
      pending = null
      audio.currentTime = from
      audio.playbackRate = rate()
      const p = audio.play()
      onState(which)
      timer = every(() => { if (stopAt !== null && audio.currentTime >= stopAt) stop() }, 16)
      if (p && p.catch) p.catch(() => stop())
    }
    if (audio.readyState >= 1) go()
    else { pending = go; audio.addEventListener('loadedmetadata', go, { once: true }) }
  }
  return { play, stop, cancel }
}
