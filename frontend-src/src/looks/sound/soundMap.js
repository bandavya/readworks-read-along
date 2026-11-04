// A small, silent picture of a passage's real narration timing.
// Each row is a paragraph; the spaces between bars are recorded pauses.
export function soundMap(doc) {
  const voice = doc.voices?.find((v) => v.id === 'human' && v.t?.length) || doc.voices?.find((v) => v.t?.length)
  if (!voice) return null
  const root = document.createElement('div')
  root.innerHTML = doc.html || ''
  const rows = [...root.querySelectorAll('p')].map((p) => {
    const times = [...p.querySelectorAll('.sa-w[data-i]')]
      .map((w) => voice.t[Number(w.dataset.i)])
      .filter((t) => Array.isArray(t) && Number.isFinite(t[0]) && Number.isFinite(t[1]) && t[1] > t[0])
    if (!times.length) return null
    const first = times[0][0]
    const last = times[times.length - 1][1]
    const span = Math.max(.01, last - first)
    return times.map(([start, end]) => ({
      x: Math.max(0, Math.min(298, ((start - first) / span) * 300)),
      w: Math.max(1.2, Math.min(300, ((end - start) / span) * 300)),
    }))
  }).filter(Boolean)
  return rows.length ? { rows, voice: voice.id } : null
}
