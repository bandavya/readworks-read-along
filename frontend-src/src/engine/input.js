// Delegated word input. Playback remains owned by SoundAlong.
export function activate(engine, span) {
  engine.stopAt = null
  const vocabEl = span.closest('[data-vocab-sense-id]')
  const k = engine.index.get(span)
  if (engine.enabled && k !== undefined) {
    const kk = engine._nextTimed(k)
    if (kk !== null) engine._seekWord(kk)
  }
  if (engine.onTapWord) engine.onTapWord(span)
  else if (vocabEl) engine.onVocab(vocabEl.dataset.vocabSenseId, vocabEl)
}

export function onClick(engine, e) {
  const span = e.target.closest?.('.sa-w')
  const vocabEl = e.target.closest?.('[data-vocab-sense-id]')
  if (span && !span.classList.contains('sa-unread')) engine._activate(span)
  else if (vocabEl && !engine.onTapWord) engine.onVocab(vocabEl.dataset.vocabSenseId, vocabEl)
}

export function onKey(engine, e) {
  const span = e.target.closest?.('.sa-w')
  if (!span || !engine.enabled) return
  const k = engine.index.get(span)
  if (k === undefined) return
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault()
    engine._activate(span)
    return
  }
  let next = null
  if (e.key === 'ArrowRight') next = k + 1
  else if (e.key === 'ArrowLeft') next = k - 1
  else if (e.key === 'Home') next = 0
  else if (e.key === 'End') next = engine.words.length - 1
  else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') next = engine._lineNeighbour(k, e.key === 'ArrowDown' ? 1 : -1)
  else return
  e.preventDefault()
  if (next === null || next < 0 || next >= engine.words.length) return
  engine._applyRoving(next)
  engine.words[next].focus()
}

export function lineNeighbour(words, k, dir) {
  const r0 = words[k].getBoundingClientRect()
  const cx = (r0.left + r0.right) / 2
  let lineTop = null
  let best = null
  let bestDx = Infinity
  for (let j = k + dir; j >= 0 && j < words.length; j += dir) {
    const r = words[j].getBoundingClientRect()
    if (Math.abs(r.top - r0.top) < r0.height / 2) continue
    if (lineTop === null) lineTop = r.top
    if (Math.abs(r.top - lineTop) > r.height / 2) break
    const dx = Math.abs((r.left + r.right) / 2 - cx)
    if (dx < bestDx) { bestDx = dx; best = j }
  }
  return best
}
