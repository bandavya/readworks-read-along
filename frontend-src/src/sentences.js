// Sentence boundaries for sentence rehearsal. Pure JS (no DOM, no Vue) so a Node harness can test it.
//
// Input: the narrated words in reading order, as [{ text, block }] where `block` is anything that is the same
// object/value for words in the same paragraph/heading (a DOM element, a number). Output: [{ start, end }] with
// INDICES INTO THAT LIST, end inclusive, every word in exactly one range.
//
// This is a punctuation heuristic (a sentence ends at . ! ? or an ellipsis, plus any closing quote or bracket),
// not a validated language parser (E1 report B1). It never ends a sentence at a common abbreviation ("Mr.", "Dr.",
// "U.S.") or a single-letter initial ("J. K."), and a heading or paragraph always ends one.

const END = /[.!?\u2026]["'\u201d\u2019)\]]*$/
const SOFT = /[,;:\u2014\u2013]["'\u201d\u2019)\]]*$/
// Titles that are always followed by a name: never the end of a sentence.
const TITLES = new Set(['mr', 'mrs', 'ms', 'dr', 'prof', 'rev', 'sgt', 'capt', 'lt', 'mt', 'st', 'jr', 'sr', 'vs'])
// Abbreviations that CAN end a sentence ("in the U.S."): only a continuation when the next word is lower case.
const SOFT_ABBR = new Set(['u.s', 'u.k', 'a.m', 'p.m', 'e.g', 'i.e', 'etc', 'inc', 'ltd'])
const OPEN = /^["'“‘(\[]+/

export function endsSentence(text, nextText) {
  const t = String(text).trim()
  if (!END.test(t)) return false
  const bare = t.replace(/["'”’)\]]*$/, '')
  if (/\.$/.test(bare) && !/\.\.$/.test(bare)) {
    const stem = bare.slice(0, -1).replace(OPEN, '').toLowerCase()
    const next = nextText == null ? '' : String(nextText).trim().replace(OPEN, '')
    if (TITLES.has(stem)) return false
    if (SOFT_ABBR.has(stem) && /^[a-z0-9]/.test(next)) return false
    // "J." in "J. K. Rowling": one capital letter (not the word "I"), and the next word starts with a capital
    if (/^[A-Z]$/.test(bare.slice(-2, -1)) && stem.length === 1 && stem !== 'i' && /^[A-Z]/.test(next)) return false
  }
  return true
}

// words: [{ text, block }]; opts.maxWords: split longer sentences at a comma/semicolon/colon/dash when there is one
// (else after maxWords words), so a beginning reader gets a phrase, not a paragraph. Default: no limit.
export function sentenceRanges(words, { maxWords = Infinity } = {}) {
  const out = []
  let start = 0
  const close = (end) => {
    if (end < start) return
    splitLong(words, start, end, maxWords, out)
    start = end + 1
  }
  for (let i = 0; i < words.length; i++) {
    const last = i === words.length - 1 || words[i + 1].block !== words[i].block
    if (last || endsSentence(words[i].text, words[i + 1]?.text)) close(i)
  }
  return out
}

function splitLong(words, start, end, maxWords, out) {
  if (end - start + 1 <= maxWords) {
    out.push({ start, end })
    return
  }
  // prefer the soft-punctuation break nearest the middle that keeps the first piece within the limit
  let cut = -1
  const mid = start + Math.floor((end - start) / 2)
  for (let j = start; j < end && j - start + 1 <= maxWords; j++) {
    if (SOFT.test(String(words[j].text).trim()) && (cut < 0 || Math.abs(j - mid) < Math.abs(cut - mid))) cut = j
  }
  if (cut < 0 || cut - start + 1 < 3) cut = start + maxWords - 1
  out.push({ start, end: cut })
  splitLong(words, cut + 1, end, maxWords, out)
}

// Index of the range containing word k (or the nearest one after it), or -1.
export function rangeIndexOf(ranges, k) {
  if (!ranges.length) return -1
  let lo = 0
  let hi = ranges.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (ranges[mid].end < k) lo = mid + 1
    else hi = mid
  }
  return lo
}
