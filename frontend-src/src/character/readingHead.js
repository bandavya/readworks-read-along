// Where the reading point is at a given media time. No DOM, no audio: give it the words (timing + letter box) and ask
// at(t). A character's pointer follows this, so it moves through a word while the word is spoken instead of hopping
// when the word changes. Pure on purpose: the same t always gives the same answer, so seeks, taps and 2x speed need no
// special handling.
//
// words: sorted by start: { k, text, start, end, x, y, w, h, page }
const MIN_SWEEP = 0.18 // seconds a line change needs; taken from the end of the last word on the line when no gap exists
const REST_GAP = 0.35 // a silence this long is a rest, not a glide
const LEAVE_BEFORE = 0.22 // on a rest, start moving this long before the next word

const ease = (p) => p * p * (3 - 2 * p)

// A mouth from the word and its timing alone, so it works for every voice: generated (which has no mouth-shape data)
// and human recordings. talk is how open, 0 to 1: one open-and-close per vowel group. mouth is a rough shape from the
// letter being said: 'open' (a, o), 'wide' (e, i, y), 'round' (u, w, oo), 'closed' (m, b, p), 'bite' (f, v), or 'rest'.
function mouthAt(text, p) {
  const letters = text.toLowerCase().replace(/[^a-z]/g, '')
  if (!letters) return { talk: 0, mouth: 'rest' }
  const beats = Math.max(1, (letters.match(/[aeiouy]+/g) || []).length)
  const talk = Math.abs(Math.sin(Math.PI * beats * p)) * Math.min(1, 0.55 + letters.length * 0.05)
  const c = letters[Math.min(letters.length - 1, Math.floor(p * letters.length))]
  const mouth = 'ao'.includes(c) ? 'open' : 'eiy'.includes(c) ? 'wide' : 'uw'.includes(c) ? 'round' : 'mbp'.includes(c) ? 'closed' : 'fv'.includes(c) ? 'bite' : 'open'
  return { talk, mouth }
}
const clamp01 = (p) => Math.max(0, Math.min(1, p))

// A continuous mouth, for drawing that doesn't jump. Each letter of a word sets a target for how open, wide and round the
// lips are, spaced evenly across the time the word takes; between targets the lips ease, and a short window averages out
// the flapping that fast speech would otherwise cause. Lips stay parted across a short gap and close only in a real
// silence, starting to open a moment before the next word, the way a speaker does. Pure, like the rest of this file.
const LIPS = { a: [1, 0.2, 0], o: [0.8, 0, 0.75], e: [0.55, 0.7, 0], i: [0.4, 0.9, 0], y: [0.4, 0.85, 0], u: [0.35, 0, 1], w: [0.3, 0, 0.9], m: [0, 0, 0], b: [0, 0.05, 0], p: [0, 0.05, 0], f: [0.12, 0.5, 0], v: [0.12, 0.5, 0] }
const LIPS_OTHER = [0.32, 0.3, 0.05]
const LIPS_WINDOW = 0.045 // seconds either side
const CLOSE_AFTER = 0.11 // a silence longer than twice this closes the mouth
const OPEN_BEFORE = 0.08

function lipKeys(words) {
  const keys = []
  words.forEach((w, i) => {
    const letters = w.text.toLowerCase().replace(/[^a-z]/g, '')
    const dur = w.end - w.start
    if (!letters) return
    ;[...letters].forEach((c, j) => {
      const [open, wide, round] = LIPS[c] || LIPS_OTHER
      keys.push({ t: w.start + (dur * (j + 0.5)) / letters.length, open, wide, round })
    })
    const next = words[i + 1]
    if (!next || next.start - w.end > CLOSE_AFTER + OPEN_BEFORE) {
      keys.push({ t: w.end + CLOSE_AFTER, open: 0, wide: 0, round: 0 })
      if (next) keys.push({ t: next.start - OPEN_BEFORE, open: 0, wide: 0, round: 0 })
    }
  })
  return keys
}

function lipsAt(keys, t) {
  let lo = 0
  let hi = keys.length - 1
  let j = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (keys[mid].t <= t) { j = mid; lo = mid + 1 } else hi = mid - 1
  }
  const REST = { open: 0, wide: 0, round: 0 }
  const a = j < 0 ? { ...REST, t: keys[0] ? keys[0].t - OPEN_BEFORE : t } : keys[j]
  const b = keys[j + 1] || { ...REST, t: a.t + CLOSE_AFTER }
  if (t >= b.t) return REST
  if (t < a.t) return REST
  const e = ease((t - a.t) / Math.max(b.t - a.t, 0.001))
  return { open: a.open + (b.open - a.open) * e, wide: a.wide + (b.wide - a.wide) * e, round: a.round + (b.round - a.round) * e }
}

// A paused or stopped voice has a closed mouth, wherever the clock stopped.
export function mouthShut(h) {
  return { ...h, talk: 0, mouth: 'rest', lips: { open: 0, wide: 0, round: 0 } }
}

// Which saved character to use: one that no longer exists counts as none.
export function knownBuddy(saved, ids) {
  return saved && ids.includes(saved) ? saved : ''
}

export function buildPath(words, { longChars = 9, longDur = 0.75 } = {}) {
  const lines = []
  let line = null
  words.forEach((w, i) => {
    const prev = words[i - 1]
    const page = w.page || 0
    const fresh = !prev || (prev.page || 0) !== page || Math.abs(prev.y - w.y) > (w.h || 1) * 0.6 || w.x < prev.x
    if (fresh) {
      line = { index: lines.length, page, x0: w.x, x1: w.x + w.w, y: w.y, h: w.h, first: i, last: i }
      lines.push(line)
    } else {
      line.x1 = Math.max(line.x1, w.x + w.w)
      line.last = i
    }
    w.line = line.index
  })
  const keys = lipKeys(words)
  // How long the pointer stays on each word: a word that ends a line gives up its tail if the voice leaves no gap.
  const leaveAt = words.map((w, i) => {
    const next = words[i + 1]
    if (!next || next.line === w.line) return w.end
    const latest = next.start - MIN_SWEEP
    return Math.max(w.start + (w.end - w.start) * 0.6, Math.min(w.end, latest))
  })

  function find(t) {
    let lo = 0
    let hi = words.length - 1
    let j = -1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (words[mid].start <= t) { j = mid; lo = mid + 1 } else hi = mid - 1
    }
    return j
  }

  function pos(t) {
    const j = find(t)
    if (j < 0) {
      const w = words[0]
      return { j: 0, x: w.x, y: w.y, phase: 'before', p: 0 }
    }
    const w = words[j]
    const next = words[j + 1]
    const leave = leaveAt[j]
    if (t <= leave) {
      const p = clamp01((t - w.start) / Math.max(leave - w.start, 0.001))
      return { j, x: w.x + w.w * p, y: w.y, phase: 'word', p }
    }
    if (!next) return { j, x: w.x + w.w, y: w.y, phase: 'after', p: 1 }
    const gap = next.start - leave
    const go = gap >= REST_GAP ? next.start - LEAVE_BEFORE : leave
    if (t < go) return { j, x: w.x + w.w, y: w.y, phase: 'rest', p: clamp01((t - leave) / Math.max(go - leave, 0.001)) }
    const p = clamp01((t - go) / Math.max(next.start - go, 0.001))
    const e = ease(p)
    const phase = next.line === w.line ? 'glide' : (next.page || 0) !== (w.page || 0) ? 'page' : 'sweep'
    return { j, x: w.x + w.w + (next.x - w.x - w.w) * e, y: w.y + (next.y - w.y) * e, phase, p }
  }

  function lips(t) {
    const before = lipsAt(keys, t - LIPS_WINDOW)
    const now = lipsAt(keys, t)
    const after = lipsAt(keys, t + LIPS_WINDOW)
    const mix = (k) => (before[k] + 2 * now[k] + after[k]) / 4
    return { open: mix('open'), wide: mix('wide'), round: mix('round') }
  }

  function at(t) {
    const here = pos(t)
    const ahead = pos(t + 0.03)
    const behind = pos(t - 0.03)
    const w = words[here.j]
    const next = words[here.j + 1] || null
    const dur = w.end - w.start
    const say = here.phase === 'word' ? mouthAt(w.text, here.p) : { talk: 0, mouth: 'rest' }
    return {
      i: here.j,
      k: w.k,
      word: w,
      next,
      x: here.x,
      y: here.y,
      h: w.h,
      baseline: here.y + w.h,
      line: w.line,
      page: (here.phase === 'page' && here.p >= 0.5 && next ? next.page : w.page) || 0,
      phase: here.phase, // before · word · glide · rest · sweep · page · after
      p: here.p, // progress through the phase, 0 to 1
      wordP: here.phase === 'word' ? here.p : here.j < words.length && t >= w.end ? 1 : 0,
      vx: (ahead.x - behind.x) / 0.06, // pixels per media second; negative on a return sweep
      vy: (ahead.y - behind.y) / 0.06,
      dur,
      long: w.text.length >= longChars || dur >= longDur,
      gapLeft: next ? Math.max(0, next.start - t) : 0,
      talk: say.talk,
      mouth: say.mouth,
      lips: lips(t),
    }
  }

  // What the reader is showing, which can differ from the clock: a tapped word stays lit until the audio reaches it, so
  // the point waits at the start of that word instead of marking the word the clock is still on.
  const byK = new Map(words.map((w) => [w.k, w]))
  function forHighlight(t, k) {
    const h = at(t)
    if (k < 0 || h.k === k) return h
    const w = byK.get(k)
    return w ? at(w.start) : h
  }

  // Reduced motion: time stands still at the start of the word that is lit, so nothing a character computes from the clock
  // can move until the word changes. Timers, wobbles and blinks then have nothing to run on, in any character.
  function calmAt(t, k) {
    const h = forHighlight(t, k)
    return { ...at(h.word.start), lips: { open: 0, wide: 0, round: 0 } }
  }

  return { words, lines, at, forHighlight, calmAt, first: words[0]?.start ?? 0, last: words[words.length - 1]?.end ?? 0 }
}
