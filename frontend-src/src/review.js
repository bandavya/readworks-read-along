// Review state for word help.
// Everything we generated for word help is a DRAFT until a person has checked it: kid definitions (gloss entries),
// syllable guides, and the Polly clips that speak them. This file answers one question for each of those things:
// "has a person checked this?", and records a grown-up's answer.
//
// Where the answer lives:
//   1. In the data files. An entry whose `review` starts with "approved" (written by tools/apply_reviews.py from an
//      export of this screen) counts as approved. Anything else, including "needs human check", is a draft.
//   2. In this browser (localStorage), as a grown-up's choice on the review screen: approved or needs a fix, plus an
//      optional note. A choice is tied to a fingerprint (hash) of the text and clip it was made on; if the entry is
//      edited or its audio is replaced later, the old choice stops counting and the entry is a draft again.
// States an entry can be in: 'approved' (data file) · 'checked' (approved on this device only) · 'fix' · 'draft'.
import { ref, reactive } from 'vue'

export const REVIEW_KEY = 'soundAlong.review.v1'
export const EXPORT_SCHEMA = 'sound-along-review/1'

// ---------- fingerprints (same function in tools/apply_reviews.py) ----------
// FNV-1a, 32 bit, over the UTF-8 bytes. Small, no dependencies, easy to repeat in Python.
export function hashText(s) {
  return hashBytes(new TextEncoder().encode(String(s)))
}
function hashBytes(bytes) {
  let h = 0x811c9dc5
  for (const b of bytes) {
    h ^= b
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}
const audioVersions = reactive(new Map())
export function needsAudioVerification(item) {
  return !!item?.clips?.length && (store.value.decisions[item.key]?.state === 'approved' || /^approved/i.test(item.dataReview || ''))
}
export async function verifyAudio(item, load = async (clip) => {
  const { assetUrl } = await import('./api.js')
  const response = await fetch(assetUrl(clip))
  if (!response.ok) throw new Error(`Audio unavailable: ${clip}`)
  return response.arrayBuffer()
}) {
  // Treat the whole set as unverified while any clip is still loading.
  for (const clip of item.clips || []) audioVersions.delete(clip)
  for (const clip of item.clips || []) {
    const bytes = new Uint8Array(await load(clip))
    audioVersions.set(clip, `${bytes.length}:${hashBytes(bytes)}`)
  }
  return (item.clips || []).map((clip) => audioVersions.get(clip))
}
const versionsOf = (item) => (item.clips || []).map((clip) => audioVersions.get(clip))
const versionsMatch = (item, recorded) => Array.isArray(recorded) && recorded.length === (item.clips || []).length &&
  recorded.every((version, i) => !!version && version === versionsOf(item)[i])

// ---------- the things that can be reviewed ----------
// Each item: { kind, pid, key, word, text, clips: [path], hash, dataReview }
// `key` is stable across reloads and does not depend on array position alone.
export function glossItem(pid, entry, idx, clip, fileReview) {
  const clips = clip ? [clip] : []
  return {
    kind: 'gloss',
    pid,
    key: `${pid}|gloss|${(entry.indices || []).join(',')}|${entry.word}`,
    word: entry.word,
    pos: entry.pos || '',
    indices: entry.indices || [],
    text: entry.def,
    clips,
    hash: hashText([entry.word, entry.def, clip || ''].join('|')),
    dataReview: entry.review ?? fileReview ?? '',
    approvedHash: entry.review_hash,
    approvedAudioVersions: entry.review_audio_versions,
  }
}

export function syllableItem(pid, sid, entry) {
  const a = entry.audio || {}
  const clips = [a.whole, a.slow, ...(a.syllables || [])].filter(Boolean)
  return {
    kind: 'syllables',
    pid,
    key: `${pid}|syl|${sid}`,
    sid,
    word: entry.word,
    text: (entry.syllables || []).join(' · '),
    clips,
    hash: hashText([(entry.syllables || []).join('·'), entry.stress_index, a.whole || '', a.slow || '', (a.syllables || []).join(',')].join('|')),
    dataReview: entry.review ?? '',
    approvedHash: entry.review_hash,
    approvedAudioVersions: entry.review_audio_versions,
  }
}

// ReadWorks' own written definition is theirs; what is ours is the Polly clip that speaks it.
import { PUBLIC_SAMPLE } from './mode.js'

export function vocabItem(pid, sid, vocab, kidEntry) {
  const clip = kidEntry?.audio
  if (!clip && !PUBLIC_SAMPLE) return null
  return {
    kind: 'vocab',
    pid,
    key: `${pid}|vocab|${sid}`,
    sid,
    word: vocab?.word || kidEntry?.word || '',
    text: vocab?.definition || kidEntry?.def || '',
    clips: clip ? [clip] : [],
    hash: hashText([vocab?.definition || kidEntry?.def || '', clip || ''].join('|')),
    dataReview: PUBLIC_SAMPLE ? (kidEntry?.review ?? vocab?.review ?? 'needs human check') : (kidEntry.review ?? ''),
    approvedHash: kidEntry?.review_hash,
    approvedAudioVersions: kidEntry?.review_audio_versions,
  }
}

// Every reviewable item of one passage, in reading order (used by the review screen and the report script).
export function itemsForPassage(pid, { gloss, syllables, kid, data }) {
  const out = []
  const g = gloss?.entries || []
  g.forEach((en, i) => out.push({ order: en.indices?.[0] ?? 1e6 + i, ...glossItem(pid, en, i, kid?.gloss?.[pid]?.[i]?.audio, gloss.review) }))
  for (const [sid, ent] of Object.entries(syllables || {})) {
    const firstUse = firstIndexOfSense(data?.html, sid)
    out.push({ order: firstUse, ...syllableItem(pid, sid, ent) })
  }
  for (const [sid, v] of Object.entries(data?.vocab || {})) {
    const it = vocabItem(pid, sid, v, kid?.vocab?.[pid]?.[sid])
    if (it) out.push({ order: firstIndexOfSense(data?.html, sid), ...it })
  }
  return out.sort((a, b) => a.order - b.order)
}
function firstIndexOfSense(html, sid) {
  if (!html) return 1e6
  const m = html.match(new RegExp(`data-vocab-sense-id="${sid}"[^>]*>\\s*<span[^>]*data-i="(\\d+)"`))
  return m ? Number(m[1]) : 1e6
}

// ---------- the browser-side store ----------
function readStore() {
  try {
    const raw = globalThis.localStorage?.getItem(REVIEW_KEY)
    const o = raw ? JSON.parse(raw) : null
    if (o && typeof o === 'object' && o.decisions) return { reviewer: o.reviewer || '', decisions: o.decisions }
  } catch {}
  return { reviewer: '', decisions: {} }
}
const store = ref(readStore())
function persist() {
  try {
    globalThis.localStorage?.setItem(REVIEW_KEY, JSON.stringify(store.value))
  } catch {}
}

export function reloadStore() {
  store.value = readStore()
}
export const reviewer = {
  get: () => store.value.reviewer,
  set(name) {
    store.value = { ...store.value, reviewer: String(name || '').slice(0, 60) }
    persist()
  },
}

export function dataApproved(item) {
  return /^approved/i.test(item?.dataReview || '') && item.approvedHash === item.hash && versionsMatch(item, item.approvedAudioVersions)
}

// -> { state: 'approved' | 'checked' | 'fix' | 'draft', note, changed }
// `changed` = a past choice exists but the entry has been edited since, so it no longer counts.
export function reviewOf(item) {
  if (!item) return { state: 'approved', note: '', changed: false }
  const rec = store.value.decisions[item.key]
  if (rec && rec.hash === item.hash && (rec.state !== 'approved' || versionsMatch(item, rec.audioVersions))) {
    if (rec.state === 'fix') return { state: 'fix', note: rec.note || '', changed: false }
    if (rec.state === 'approved') return { state: dataApproved(item) ? 'approved' : 'checked', note: rec.note || '', changed: false }
  }
  if (dataApproved(item)) return { state: 'approved', note: '', changed: false }
  if (/^needs fix/i.test(item.dataReview || '')) return { state: 'fix', note: '', changed: false }
  return { state: 'draft', note: '', changed: !!rec || /^approved/i.test(item.dataReview || '') }
}

// The state of a group of items shown together (a definition plus its syllable guide, say): the least-reviewed one.
export function combineStates(items) {
  const list = (items || []).filter(Boolean)
  if (!list.length) return 'approved' // nothing of ours here, so nothing to mark
  const states = list.map((it) => reviewOf(it).state)
  for (const s of ['fix', 'draft', 'checked']) if (states.includes(s)) return s
  return 'approved'
}

export const STATE_TEXT = {
  draft: 'Draft word help. A person has not checked it yet.',
  fix: 'A grown-up flagged this word help for a fix.',
  checked: 'Checked by a grown-up on this device.',
  approved: 'Checked by a person.',
}
export const KID_STATE_TEXT = 'Draft word help. A grown-up has not checked it yet.'

export function setReview(item, state, note = '') {
  if (state !== 'approved' && state !== 'fix') return clearReview(item)
  if (state === 'approved' && (item.clips || []).some((clip) => !audioVersions.has(clip))) throw new Error('Check the audio version before approval.')
  const decisions = { ...store.value.decisions }
  decisions[item.key] = {
    kind: item.kind,
    passage: item.pid,
    key: item.key,
    word: item.word,
    text: item.text,
    clips: item.clips,
    hash: item.hash,
    audioVersions: state === 'approved' ? versionsOf(item) : [],
    state,
    note: String(note || '').slice(0, 500),
    at: new Date().toISOString(),
  }
  store.value = { ...store.value, decisions }
  persist()
}
export function clearReview(item) {
  const decisions = { ...store.value.decisions }
  delete decisions[item.key]
  store.value = { ...store.value, decisions }
  persist()
}

// A note on an approved row must never renew approval against unverified audio.
// Leave the previous choice intact if the recording cannot be checked.
export async function saveReviewNote(item, note, load) {
  const state = reviewOf(item).state
  if (state === 'fix') {
    setReview(item, 'fix', note)
    return true
  }
  const decision = store.value.decisions[item.key]
  const fileApproval = /^approved/i.test(item.dataReview || '') && item.approvedHash === item.hash
  // A prior approval reads as draft while its audio is loading or after a failed load.
  // A fresh, successful check may save the note, but must not invent approval for an untouched draft.
  if (state !== 'checked' && state !== 'approved' &&
      !(decision?.state === 'approved' && decision.hash === item.hash) && !fileApproval) return false
  try {
    await verifyAudio(item, load)
    // The reviewer may have flagged or cleared this row while its clips loaded.
    // Also reject an approval whose content no longer matches the verified audio.
    if (store.value.decisions[item.key] !== decision || !['checked', 'approved'].includes(reviewOf(item).state)) return false
    setReview(item, 'approved', note)
    return true
  } catch {
    return false
  }
}

// ---------- export ----------
// JSON a script can read (tools/apply_reviews.py). `states` in the file use the data-file words:
// 'approved' or 'needs_fix'. Decisions that no longer match the data (hash changed) are left out of "current".
export function buildExport(items = null, now = new Date()) {
  const decisions = Object.values(store.value.decisions)
  const live = items ? new Map(items.map((it) => [it.key, it])) : null
  return {
    schema: EXPORT_SCHEMA,
    exported_at: now.toISOString(),
    reviewer: store.value.reviewer || '',
    note:
      'Choices a grown-up made on the Sound Along review screen, on one browser. "hash" fingerprints the text and clip they ' +
      'were made on; tools/apply_reviews.py skips any entry that has changed since.',
    decisions: decisions.map((d) => ({
      kind: d.kind,
      passage: d.passage,
      key: d.key,
      word: d.word,
      text: d.text,
      clips: d.clips,
      hash: d.hash,
      audioVersions: d.audioVersions,
      state: d.state === 'fix' ? 'needs_fix' : 'approved',
      note: d.note || '',
      reviewed_at: d.at,
      stale: live ? (live.has(d.key)
        ? live.get(d.key).hash !== d.hash || (d.state === 'approved' && !versionsMatch(live.get(d.key), d.audioVersions))
        : undefined) : undefined,
    })),
  }
}

// Counts for a list of items: approved (data or this device) · fix · still to check.
export function tally(items) {
  const t = { total: items.length, approved: 0, fix: 0, draft: 0 }
  for (const it of items) {
    const s = reviewOf(it).state
    if (s === 'fix') t.fix++
    else if (s === 'draft') t.draft++
    else t.approved++
  }
  return t
}

// When a reviewed row leaves the current filter, use the row now at its position.
export function nextReviewKey(before, visibleItems) {
  return visibleItems[Math.min(Math.max(before, 0), visibleItems.length - 1)]?.key ?? null
}
