// Geometry and list decisions only; the view owns DOM hit testing, focus and announcements.
export function nearestWord(words, rectsOf, x, y, tolerance, lineHeight) {
  let best = null, distance = Infinity
  for (const word of words) for (const rect of rectsOf(word)) {
    const dx = x < rect.left ? rect.left - x : x > rect.right ? x - rect.right : 0
    const dy = y < rect.top ? rect.top - y : y > rect.bottom ? y - rect.bottom : 0
    if (dx > tolerance || dy > lineHeight / 2) continue
    const d = dy * 3 + dx
    if (d < distance) { distance = d; best = word }
  }
  return best
}

export function stepWord(words, current, direction) {
  const i = words.indexOf(current), j = i + direction
  return i < 0 || j < 0 || j >= words.length ? null : words[j]
}

export function adjacentLineWord(words, current, direction, rectOf) {
  const origin = rectOf(current)
  if (!origin) return null
  const cx = (origin.left + origin.right) / 2
  let top = Infinity
  for (const word of words) {
    const rect = rectOf(word)
    if (!rect) continue
    const delta = (rect.top - origin.top) * direction
    if (delta > origin.height * 0.5 && delta < top) top = delta
  }
  if (top === Infinity) return null
  let best = null, distance = Infinity
  for (const word of words) {
    const rect = rectOf(word)
    if (!rect || Math.abs((rect.top - origin.top) * direction - top) > origin.height * 0.4) continue
    const d = Math.abs((rect.left + rect.right) / 2 - cx)
    if (d < distance) { distance = d; best = word }
  }
  return best
}
