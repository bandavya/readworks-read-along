const STORAGE_KEY = 'sound-along-listen-v1'

export function newSeed() {
  const values = new Uint32Array(1)
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(values)
  else values[0] = Date.now() >>> 0
  return values[0]
}

export function seededOrder(items, seed) {
  const order = [...items]
  let state = seed >>> 0
  for (let i = order.length - 1; i > 0; i--) {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0
    const j = state % (i + 1)
    ;[order[i], order[j]] = [order[j], order[i]]
  }
  return order
}

export function clipForVoice(config, passage, source) {
  const voice = passage.voices?.find((v) => v.id === source)
  const first = voice?.t?.[config.firstWord]
  const last = voice?.t?.[config.lastWord]
  if (!voice?.audio || !first || !last || !(last[1] > first[0])) return null
  return { source, audio: voice.audio, start: first[0], end: last[1] + 0.2, timings: voice.t }
}

// Keep word reports tied to the voice actually heard, without showing its identity.
export function clipWords(config, passage, clip) {
  if (!clip?.timings || !passage?.html || typeof DOMParser === 'undefined') return []
  const doc = new DOMParser().parseFromString(passage.html, 'text/html')
  return [...doc.querySelectorAll('.sa-w[data-i]')]
    .map((node) => {
      const index = Number(node.getAttribute('data-i'))
      const time = clip.timings[index]?.[0]
      return { index, text: node.textContent.trim(), time }
    })
    .filter((word) => word.index >= config.firstWord && word.index <= config.lastWord &&
      Number.isInteger(word.index) && Number.isFinite(word.time))
}

export function saveRatings(rows) {
  const all = readRatings()
  all.push(...rows)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all))
  return all
}

export function readRatings() {
  try {
    const rows = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
    return Array.isArray(rows) ? rows : []
  } catch { return [] }
}

// A rating is one clip response; a listener is one session. Keep those counts separate.
export function ratingSummary(rows) {
  const valid = rows.filter((row) => row && typeof row.source === 'string' && row.source &&
    typeof row.session_id === 'string' && row.session_id &&
    Number.isInteger(row.rating) && row.rating >= 1 && row.rating <= 5)
  const listeners = new Set(valid.map((row) => row.session_id)).size
  const sources = [...new Set(valid.map((row) => row.source))].sort().map((source) => {
    const values = valid.filter((row) => row.source === source).map((row) => row.rating)
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length
    const spread = Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length)
    return { source, ratings: values.length, listeners: new Set(valid.filter((row) => row.source === source).map((row) => row.session_id)).size,
      mean, spread, min: Math.min(...values), max: Math.max(...values) }
  })
  return { listeners, ratings: valid.length, sources }
}

export function ratingsCsv(rows) {
  const fields = ['session_id', 'seed', 'clip_id', 'passage_id', 'source', 'rating', 'start_s', 'end_s', 'rated_at', 'off_word_index', 'off_word', 'off_word_time_s']
  const cell = (value) => {
    const raw = String(value ?? '')
    const safe = /^[\s]*[=+@-]/.test(raw) ? `'${raw}` : raw
    return `"${safe.replaceAll('"', '""')}"`
  }
  return [fields.join(','), ...rows.map((row) => fields.map((field) => cell(row[field])).join(','))].join('\r\n') + '\r\n'
}
