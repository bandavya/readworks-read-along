// Media-clock decisions. Timing tables read word metadata once; no DOM writes or input live here.
// Per voice, startOf[k] is the narrated word's start in DOM order (or null).
// order[] sorts timed word indices by start; starts[] and ends[] support clock lookup.
const PIN_MAX_MS = 500
const STALL_MS = 120
const END_GRACE = 0.6

export function timing(voice, el) {
  const d = el.dataset
  return d.l !== undefined ? voice.lead?.[Number(d.l)] : voice.t?.[Number(d.i)]
}

export function timingTable(voice, words) {
  const startOf = words.map((el) => {
    const t = timing(voice, el)
    return t ? t[0] : null
  })
  const order = []
  startOf.forEach((s, k) => { if (s !== null) order.push(k) })
  order.sort((x, y) => startOf[x] - startOf[y])
  return {
    startOf, order,
    starts: order.map((k) => startOf[k]),
    ends: order.map((k) => timing(voice, words[k])[1]),
  }
}

export function nextTimed(startOf, k) {
  for (let j = k; j < startOf.length; j++) if (startOf[j] !== null) return j
  for (let j = k - 1; j >= 0; j--) if (startOf[j] !== null) return j
  return null
}

// Consume an intention only when the new voice's metadata is ready.
export function applyPending(engine) {
  const p = engine.pending
  if (!p) return
  engine.pending = null
  if (p.time !== undefined) {
    engine.audio.currentTime = p.time
    engine.state.time = engine.audio.currentTime
    engine.tick()
    if (p.play && engine.enabled) engine._play()
    return
  }
  const k = p.wordK !== null && p.wordK >= 0 ? engine._nextTimed(p.wordK) : null
  if (k !== null) {
    if (p.snippet) engine._armSnippet(k)
    engine._seekWord(k, p.play && engine.enabled)
    if (p.snippet) engine._scheduleSnippetStop()
    return
  }
  if (p.snippet) {
    engine._snippet = false
    engine.stopAt = null
  } else if (p.play && engine.enabled) engine._play()
}

export function wordAtClock(engine, t, paused, now) {
  const pin = engine.pin
  if (pin && pin.at !== Infinity) {
    if (t !== pin.lastT) { pin.lastT = t; pin.moved = now }
    if (t >= pin.start) engine.pin = null
    else if (paused || now - pin.moved > STALL_MS) pin.at = now
    else if (now - pin.at > PIN_MAX_MS) engine.pin = null
  }
  if (engine.pin) return engine.pin.k
  let lo = 0
  let hi = engine.starts.length - 1
  let j = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (engine.starts[mid] <= t) { j = mid; lo = mid + 1 } else hi = mid - 1
  }
  if (j >= 0 && j === engine.starts.length - 1 && t > engine.ends[j] + END_GRACE) j = -1
  return j >= 0 ? engine.order[j] : -1
}
