// Pure page decisions. `fits` is supplied by the view because only the browser can measure rendered text.
export function sentenceGroups(words, blockOf, textOf) {
  const out = []
  let cur = null
  const abbr = /^(mr|mrs|ms|dr|st|jr|sr|vs)\.$/i
  for (const word of words) {
    const block = blockOf(word)
    if (!cur || cur.block !== block) { cur = { els: [], block }; out.push(cur) }
    cur.els.push(word)
    const text = textOf(word).trim()
    if (/[.!?…]["'”’)\]]*$/.test(text) && !abbr.test(text)) cur = null
  }
  return out
}

// Greedy whole-sentence pages, splitting an oversized sentence only between words.
// `fits(pageIndex, words)` measures the view after it applies its chosen size.
export function planPages(sentences, fits) {
  const pages = []
  let cur = []
  for (const sentence of sentences) {
    const group = sentence.els
    if (fits(pages.length, [...cur, ...group])) { cur.push(...group); continue }
    if (cur.length) {
      pages.push(cur)
      cur = []
      if (fits(pages.length, group)) { cur.push(...group); continue }
    }
    for (const word of group) {
      if (cur.length && !fits(pages.length, [...cur, word])) {
        pages.push(cur)
        cur = []
      }
      cur.push(word)
    }
  }
  if (cur.length) pages.push(cur)
  return pages
}

export function pageMaps(pages, blockOf, indexOf) {
  const elPage = new Map(), blockPages = new Map(), kPage = [], pageFirstK = []
  pages.forEach((words, page) => words.forEach((word) => {
    elPage.set(word, page)
    const block = blockOf(word)
    if (!blockPages.has(block)) blockPages.set(block, new Set())
    blockPages.get(block).add(page)
    const k = indexOf(word)
    if (k === undefined) return
    kPage[k] = page
    if (pageFirstK[page] === undefined) pageFirstK[page] = k
  }))
  return { elPage, blockPages, kPage, pageFirstK }
}
