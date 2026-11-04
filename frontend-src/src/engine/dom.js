const USER_SCROLL_QUIET = 2500

export function setCurrent(engine, k) {
  if (k === engine.curK) return
  engine.curEl?.classList.remove('sa-now')
  const prev = engine.curK
  engine.curK = k
  engine.curEl = k >= 0 ? engine.words[k] : null
  engine.curEl?.classList.add('sa-now')
  if (k >= 0) engine.onCurrent?.(k, prev)
}

export function follow(engine, el) {
  const now = performance.now()
  if (now - engine.lastUserScroll < USER_SCROLL_QUIET) return
  const top = 12
  const bottom = engine.getSafeBottom() - 12
  const r = el.getBoundingClientRect()
  if (r.top >= top && r.bottom <= bottom) return
  const delta = r.top - (top + (bottom - top) * 0.3)
  engine.ignoreScrollUntil = now + 200
  window.scrollBy({ top: delta, behavior: 'instant' })
}

export function applyRoving(engine, k) {
  if (!engine.keys) return
  engine.words.forEach((el) => {
    if (el.tabIndex === 0) el.tabIndex = -1
  })
  if (k >= 0 && engine.words[k]) {
    engine.rovingK = k
    engine.words[k].tabIndex = 0
  }
}
