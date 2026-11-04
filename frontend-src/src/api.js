import { publishedDataBase, contentAssetBase } from './config'

// Local prototype files, or an explicitly configured managed document endpoint.
const BASE = import.meta.env.BASE_URL
const publishedBase = publishedDataBase ? new URL(publishedDataBase.replace(/\/?$/, '/')) : null
const assetBase = contentAssetBase ? new URL(contentAssetBase.replace(/\/?$/, '/')) : publishedBase
const managedApi = publishedBase?.pathname.endsWith('/api/')
let publishedIndex

// The published demo packs each passage's many short clips (spoken definitions, syllables) into one bundle file,
// data/bundles/<name>.json = {path: base64 mp3}, because a published page may hold only ~500 files. A bundled path
// resolves to a blob: URL; anything else (and everything in local dev, where no bundles exist) is a plain file URL.
const bundled = new Map()
const bundleLoads = new Map()
export function loadBundle(name) {
  if (!bundleLoads.has(name)) {
    bundleLoads.set(name, fetch(new URL(`data/bundles/${name}.json`, new URL(BASE, document.baseURI)).href)
      .then((r) => (r.ok ? r.json() : {}))
      .then((m) => {
        for (const [p, b64] of Object.entries(m)) {
          if (bundled.has(p)) continue
          const bin = atob(b64)
          const bytes = new Uint8Array(bin.length)
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
          bundled.set(p, URL.createObjectURL(new Blob([bytes], { type: 'audio/mpeg' })))
        }
      })
      .catch(() => {}))
  }
  return bundleLoads.get(name)
}

export const assetUrl = (p) => bundled.get(p) ||
  (/^(?:https?:|blob:|data:)/i.test(p) ? p :
    assetBase && /^(?:audio|timing)\//.test(p) ? new URL(p, assetBase).href :
      new URL(p, new URL(BASE, document.baseURI)).href)

async function getJson(path) {
  const res = await fetch(assetUrl(path))
  if (!res.ok) throw new Error(`${path}: ${res.status}`)
  return res.json()
}

export const loadIndex = async () => {
  if (!publishedBase) return getJson('data/index.json')
  const response = await fetch(new URL(managedApi ? 'passages' : 'managed/index.json', publishedBase))
  if (!response.ok) throw new Error(`Managed index: ${response.status}`)
  publishedIndex = await response.json()
  return publishedIndex
}
// A painting stands in for each source photo, so the photo's credit doesn't belong beside it; the credit line keeps its source.
export function cleanPassage(doc, content = document.createElement('div')) {
  if (!content.innerHTML) content.innerHTML = doc.html || ''
  content.querySelectorAll('.image-credit').forEach((credit) => credit.remove())
  doc.html = content.innerHTML
  if (doc.credit) doc.credit = doc.credit.replace(/\s*Used here only.*$/, '')
  return doc
}
export const loadPassage = async (id) => {
  if (publishedBase) {
    const rows = publishedIndex || await loadIndex()
    const row = rows.find((item) => item.uuid === id)
    if (!row?.document || !row.document.startsWith(`managed/versions/${id}/`)) throw new Error('Passage is not published')
    const response = await fetch(new URL(managedApi ? `passages/${encodeURIComponent(id)}` : row.document, publishedBase))
    if (!response.ok) throw new Error(`Passage: ${response.status}`)
    return cleanPassage(await response.json())
  }
  const [doc] = await Promise.all([getJson(`data/${id}.json`), loadBundle(id), loadBundle('prompts'), loadSharedWordHelp()])
  // A guide may use another passage's clips. Meanings always stay with their passage.
  const content = document.createElement('div')
  content.innerHTML = doc.html || ''
  cleanPassage(doc, content)
  const sourceIds = new Set()
  for (const el of content.querySelectorAll('.sa-w')) {
    const { guide } = sharedWordHelp(el.textContent, id)
    if (guide?._wordBankPid && guide._wordBankPid !== id) sourceIds.add(guide._wordBankPid)
  }
  await Promise.all([...sourceIds].map(loadBundle))
  return doc
}

// Reuse existing public help files in memory. The private corpus inventory never enters a Vite build.
import { needsAudioVerification, reviewOf, syllableItem, verifyAudio } from './review'
const ambiguous = new Set(['read', 'live', 'wind', 'record', 'tear', 'lead', 'bow', 'close'])
// Keep in step with prototype/tools/word_bank.py; guide_key_fixture.json checks both implementations.
export const wordKey = (s) => String(s ?? '').replace(/\u2019/g, "'").replace(/[^\p{L}\p{N}'_]/gu, '').toLowerCase()
let sharedHelpPromise
let sharedHelp = { syllables: new Map(), names: new Set() }
export function loadSharedWordHelp() {
  if (!sharedHelpPromise) sharedHelpPromise = loadIndex().then(async (passages) => {
    const sources = await Promise.all(passages.map(async ({ uuid: pid }) => {
      const optional = async (path) => { try { return await getJson(path) } catch { return null } }
      const [gloss, syllables] = await Promise.all([
        optional(`data/gloss/${pid}.json`), optional(`data/syllables/${pid}.json`),
      ])
      return { pid, gloss, syllables }
    }))
    const names = new Set()
    for (const { gloss } of sources) for (const entry of gloss?.entries || []) {
      if (entry.pos === 'name') names.add(wordKey(entry.word))
    }
    const guides = new Map()
    for (const { pid, syllables } of sources) {
      for (const [sid, entry] of Object.entries(syllables || {})) {
        const word = wordKey(entry.word)
        if (word && !ambiguous.has(word) && !names.has(word)) {
          const guide = { ...entry, _wordBankPid: pid, _wordBankSid: sid,
            _wordBankSource: { passage: pid, voice: entry.voice || null, review: entry.review || 'needs human check' } }
          if (!guides.has(word)) guides.set(word, [])
          guides.get(word).push(guide)
        }
      }
    }
    const candidates = [...guides.values()].flat()
    const toVerify = candidates.map((guide) => ({
      guide, item: syllableItem(guide._wordBankPid, guide._wordBankSid, guide),
    })).filter(({ item }) => needsAudioVerification(item))
    // Bundled clips must be available before verification, including clips from another passage.
    await Promise.all([...new Set(toVerify.map(({ guide }) => guide._wordBankPid))].map(loadBundle))
    // A file or device approval counts only when its current clip bytes match the review.
    await Promise.all(toVerify.map(({ item }) => verifyAudio(item).catch(() => {})))
    sharedHelp = { syllables: guides, names }
    return sharedHelp
  }).catch(() => sharedHelp)
  return sharedHelpPromise
}
export function sharedWordHelp(word, passageId = null) {
  const key = wordKey(word)
  if (!key || ambiguous.has(key) || sharedHelp.names.has(key)) return { guide: null }
  const candidates = sharedHelp.syllables.get(key) || []
  // A review counts only while its text and checked audio version still match (review.js).
  // defs.js gives an exact local sense precedence; this ranks the remaining shared candidates.
  const rank = (guide) => [
    ['approved', 'checked'].includes(reviewOf(syllableItem(guide._wordBankPid, guide._wordBankSid, guide)).state) ? 0 : 1,
    guide._wordBankPid === passageId ? 0 : 1,
    guide._wordBankPid, guide._wordBankSid,
  ]
  const compare = (a, b) => {
    const ar = rank(a), br = rank(b)
    for (let i = 0; i < ar.length; i++) {
      if (ar[i] < br[i]) return -1
      if (ar[i] > br[i]) return 1
    }
    return 0
  }
  return { guide: candidates.length ? [...candidates].sort(compare)[0] : null }
}

// Grades arrive as "K", "1".."7", sometimes "Seventh", sometimes "".
const WORD_GRADES = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8 }
export function gradeNum(g) {
  const s = String(g ?? '').trim().toLowerCase()
  if (!s) return null
  if (s === 'k') return 0
  if (/^\d+$/.test(s)) return Number(s)
  return WORD_GRADES[s] ?? null
}
export function gradeLabel(g) {
  const n = gradeNum(g)
  if (n === null) return 'Not graded'
  return n === 0 ? 'Grade K' : `Grade ${n}`
}

export const VOICE_NAMES = { human: 'Human voice', generated: 'Generated voice' }

// Remembered per-viewer conveniences (never required).
export const store = {
  get(k, d) { try { const v = localStorage.getItem('rwp-' + k); return v === null ? d : JSON.parse(v) } catch { return d } },
  set(k, v) { try { localStorage.setItem('rwp-' + k, JSON.stringify(v)) } catch { /* ignore */ } },
}
