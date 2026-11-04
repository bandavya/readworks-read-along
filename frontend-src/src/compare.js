// Comparison data is derived from the passage's own voice records. A timing
// variant may be added only with independently verified identity for this audio.
export function validTiming(rows, count, { allowNull = false } = {}) {
  if (!Array.isArray(rows) || rows.length !== count) return false
  let previous = 0
  for (const row of rows) {
    if (row == null && allowNull) continue
    if (!Array.isArray(row) || !Number.isFinite(row[0]) || !Number.isFinite(row[1]) || row[0] < 0 || row[1] <= row[0] || row[0] < previous) return false
    previous = row[1]
  }
  return true
}

export function validTakeTiming(voice, bodyCount, leadCount) {
  if (!validTiming(voice?.t, bodyCount) || !validTiming(voice?.lead, leadCount, { allowNull: true })) return false
  const lastLead = voice.lead.findLast(row => row != null)
  return !lastLead || voice.t[0][0] >= lastLead[1]
}

export function playableTakes(doc) {
  const bodyCount = Number(doc?.words)
  const leadCount = (doc?.title_words?.length || 0) + (doc?.by_words?.length || 0)
  if (!Number.isInteger(bodyCount) || bodyCount < 1) return []
  const seenIds = new Set()
  const seenAudio = new Set()
  return (Array.isArray(doc?.voices) ? doc.voices : []).filter(v => {
    const valid = v && ['generated', 'human'].includes(v.id) &&
    typeof v.audio === 'string' && v.audio.trim().length > 0 &&
    validTakeTiming(v, bodyCount, leadCount) &&
    !seenIds.has(v.id) && !seenAudio.has(v.audio)
    if (valid) { seenIds.add(v.id); seenAudio.add(v.audio) }
    return valid
  })
}

// The engine uses DOM order for playback, while each timing row uses its data index.
// Reject a passage whose displayed words would silently pair with different rows.
export function validWordIndices(words, doc) {
  const leadCount = (doc?.title_words?.length || 0) + (doc?.by_words?.length || 0)
  const bodyCount = Number(doc?.words)
  if (!Number.isInteger(bodyCount) || words.length !== leadCount + bodyCount) return false
  return words.every((word, position) => {
    const lead = position < leadCount
    const key = lead ? 'l' : 'i'
    const other = lead ? 'i' : 'l'
    const value = word?.dataset?.[key]
    return typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value) &&
      word.dataset[other] === undefined && Number(value) === (lead ? position : position - leadCount)
  })
}

export function chosenTake(takes, requested) {
  return takes.find(v => v.id === requested) || takes[0] || null
}

export function timingFor(voice, word) {
  const raw = word?.dataset?.l ?? word?.dataset?.i
  if (typeof raw !== 'string' || !/^(0|[1-9]\d*)$/.test(raw)) return null
  const n = Number(raw)
  if (!Number.isSafeInteger(n)) return null
  return word?.dataset?.l !== undefined ? voice?.lead?.[n] || null : voice?.t?.[n] || null
}

export function timingForTake(takes, takeId, word) {
  return timingFor(takes.find(take => take.id === takeId), word)
}

export function csv(rows) {
  const fields = ['passage_id', 'take_id', 'audio', 'recording_source', 'timing_source', 'word_index', 'word', 'start_s', 'end_s', 'observation', 'sample_count', 'observation_provenance', 'observed_at']
  const cell = value => {
    const raw = String(value ?? '')
    const safe = /^\s*[=+@-]/.test(raw) ? `'${raw}` : raw
    return `"${safe.replaceAll('"', '""')}"`
  }
  return [fields.join(','), ...rows.map(row => fields.map(f => cell(row[f])).join(','))].join('\r\n') + '\r\n'
}
