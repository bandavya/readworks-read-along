// Passage totals kept on this device, with no identity or network calls and no dependencies. A host can listen for
// each event (see report.js) to send a coarse version to a teacher.
const KEY = 'sa-usage-v1'
const OFF_KEY = 'sa-data-off-v1'
const PASSAGE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const display = (option, value) => (option.levels ? option.levels[value] : value)

// options: the table in options.js. limit: comma-separated ids a build allows (empty allows none; undefined, all).
export function createUsage({ options, limit }) {
  const allowed = limit === undefined ? options : options.filter(({ id }) => limit.split(',').map((x) => x.trim()).includes(id))
  let fallback = {}
  let memoryOnly = false
  let off = new Set()
  let listener = null
  try { off = new Set(JSON.parse(globalThis.localStorage.getItem(OFF_KEY) || '[]')) }
  catch { /* broken or blocked storage: everything allowed stays on */ }

  const activeOptions = () => allowed.filter(({ id }) => !off.has(id))
  // A device total can't be a student's, so listeners get each event rather than the total.
  function notify(id, value, passageId) {
    if (activeOptions().some((option) => option.id === id)) listener?.(id, value, passageId)
  }

  function cleanRow(id, source) {
    const row = { passageId: id }
    for (const { id: field, levels } of activeOptions()) {
      const value = source?.[field]
      row[field] = Number.isSafeInteger(value) && value >= 0 && value < (levels?.length ?? Infinity) ? value : 0
    }
    return row
  }

  // Only active options with something to show survive a read, so what's off or removed goes at the next write,
  // which every page load does.
  function read() {
    let value = fallback
    if (!memoryOnly) {
      try { value = JSON.parse(globalThis.localStorage.getItem(KEY) || '{}') }
      catch (error) {
        // A broken value can be replaced on the next record; inaccessible storage cannot.
        if (error instanceof SyntaxError) return {}
        memoryOnly = true
      }
    }
    const data = {}
    if (!value || typeof value !== 'object' || Array.isArray(value)) return data
    for (const [id, source] of Object.entries(value)) {
      const row = cleanRow(id, source)
      if (PASSAGE_ID.test(id) && activeOptions().some((option) => row[option.id] > 0)) data[id] = row
    }
    return data
  }

  function write(data) {
    fallback = data
    if (memoryOnly) return
    try { globalThis.localStorage.setItem(KEY, JSON.stringify(data)) }
    catch { memoryOnly = true }
  }

  function update(id, passageId, change) {
    if (!activeOptions().some((option) => option.id === id) || typeof passageId !== 'string' || !PASSAGE_ID.test(passageId)) return
    const data = read()
    const row = data[passageId] || cleanRow(passageId)
    const value = change(row[id])
    if (value === row[id]) return
    data[passageId] = { ...row, [id]: value }
    write(data)
  }

  function record(event, passageId) {
    if (options.find(({ id }) => id === event)?.levels) return
    notify(event, 1, passageId)
    update(event, passageId, (count) => Math.min(count + 1, Number.MAX_SAFE_INTEGER))
  }

  // Uses the browser's own record of what played, so a replay counts once, a jump skips what it skipped, and a hidden
  // tab still counts. Levels only rise. A voice switch starts a new record, which can understate but never overstate.
  function trackPlayback(audio, passageId) {
    audio.addEventListener('error', () => { if (audio.error) record('audio_trouble', passageId) })
    const option = options.find(({ id }) => id === 'playback')
    if (!option) return
    audio.addEventListener('timeupdate', () => {
      let played = 0
      for (let i = 0; i < audio.played.length; i++) played += audio.played.end(i) - audio.played.start(i)
      if (!played) return
      const level = option.start.filter((share) => played / audio.duration >= share).length
      notify(option.id, level, passageId)
      update(option.id, passageId, (kept) => Math.max(kept, level))
    })
  }

  // Turning an option off also deletes what it kept.
  function setRecording(id, on) {
    if (on) off.delete(id)
    else off.add(id)
    try { globalThis.localStorage.setItem(OFF_KEY, JSON.stringify([...off])) }
    catch { /* blocked storage: the choice lasts until the page closes */ }
    write(read())
  }

  function summary() {
    const data = read()
    return Object.keys(data).sort().map((id) => data[id])
  }

  write(read())
  return { allowedOptions: () => allowed, activeOptions, record, trackPlayback, setRecording, summary, clear: () => write({}), listen: (fn) => { listener = fn } }
}
