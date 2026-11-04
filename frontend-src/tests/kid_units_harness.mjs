// Pure kid reader seams. Run: node prototype/app/tests/kid_units_harness.mjs
// The Sybil fixture stays local; this harness prints only counts and check names, never passage text.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { guard, behavior, finish } from './_kinds.mjs'
import { sentenceGroups, planPages, pageMaps } from '../src/kid/pages.js'
import { nearestWord, stepWord, adjacentLineWord } from '../src/kid/select.js'
import { pageForNarration, pageForAnchor } from '../src/kid/sync.js'
import { existsSync } from 'node:fs'

// These fixtures are private media; keep the harness available when local data is linked.
const requiredLocalFiles = ['public/data/8827e66c-6dd8-45b4-9a04-4122cffe77e3.json']
if (requiredLocalFiles.some(file => !existsSync(new URL('../' + file, import.meta.url)))) {
  console.log('SKIP kid_units_harness.mjs: private ReadWorks fixtures are absent')
  process.exit(0)
}

const eq = (a, b) => { if (a !== b) throw new Error(`expected ${b}, got ${a}`) }
const yes = (condition, message) => { if (!condition) throw new Error(message) }
const fixture = fileURLToPath(new URL('../public/data/8827e66c-6dd8-45b4-9a04-4122cffe77e3.json', import.meta.url))
const passage = JSON.parse(readFileSync(fixture, 'utf8'))

// Mirror the reader's title/byline plus each HTML block, retaining the words' block boundaries.
const tokens = [], blocks = []
function addBlock(texts) {
  const block = blocks.length
  blocks.push(block)
  for (const text of texts) tokens.push({ text, block, k: tokens.length })
}
addBlock(passage.title_words)
if (passage.by_words?.length) addBlock(passage.by_words)
for (const match of passage.html.matchAll(/<(p|h2|h3|h4|li)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
  const words = [...match[2].matchAll(/<span\b[^>]*class=["'][^"']*\bsa-w\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi)]
    .map((m) => m[1].replace(/<[^>]*>/g, '').replace(/&[^;]+;/g, ' '))
  if (words.length) addBlock(words)
}
const groups = sentenceGroups(tokens, (w) => w.block, (w) => w.text)
guard('Sybil fixture is present and forms multiple sentence groups', () => {
  yes(tokens.length > 50 && groups.length > 5, 'fixture did not parse as expected')
})
for (const capacity of [12, 26]) {
  const pages = planPages(groups, (_page, words) => words.length <= capacity)
  const maps = pageMaps(pages, (w) => w.block, (w) => w.k)
  guard(`Sybil page plan covers every word once at capacity ${capacity}`, () => {
    eq(pages.flat().length, tokens.length)
    eq(new Set(pages.flat()).size, tokens.length)
    yes(pages.length > 1, 'expected multiple pages')
    pages.forEach((words, page) => {
      yes(words.length > 0, 'empty page')
      yes(words.length <= capacity || words.length === 1, 'overfull page')
      words.forEach((word) => eq(maps.kPage[word.k], page))
      eq(maps.pageFirstK[page], words[0].k)
    })
  })
  guard(`Sybil displayed page tracks each narrated word at capacity ${capacity}`, () => {
    let shown = 0
    for (const word of tokens) {
      const next = pageForNarration(word.k, shown, maps.kPage)
      if (next !== null) shown = next
      eq(shown, maps.kPage[word.k])
    }
    // A seek back to a word on a prior page must also move the display.
    eq(pageForNarration(0, shown, maps.kPage), 0)
  })
  behavior(`Sybil page count at capacity ${capacity} is a layout choice`, () => {
    yes(pages.length >= Math.ceil(tokens.length / capacity), 'unexpected count')
  })
}

guard('narration corrects a stale page even when previous word shares its page', () => {
  eq(pageForNarration(2, 0, [0, 1, 1]), 1)
  eq(pageForNarration(1, 1, [0, 1]), null)
  eq(pageForNarration(-1, 1, [0, 1]), null)
  eq(pageForAnchor(1, 0, 2, [0, 1]), 1)
  eq(pageForAnchor(undefined, 5, 2, [0, 1]), 1)
})

const a = { id: 'a' }, b = { id: 'b' }, c = { id: 'c' }, d = { id: 'd' }
const rects = new Map([
  [a, { left: 0, right: 30, top: 0, bottom: 20, height: 20 }],
  [b, { left: 50, right: 80, top: 0, bottom: 20, height: 20 }],
  [c, { left: 0, right: 30, top: 40, bottom: 60, height: 20 }],
  [d, { left: 50, right: 80, top: 40, bottom: 60, height: 20 }],
])
const rect = (word) => rects.get(word)
guard('tap selection favors the same line and respects distance limits', () => {
  eq(nearestWord([a, b, c, d], (w) => [rect(w)], 42, 10, 24, 40), b)
  eq(nearestWord([a, b, c, d], (w) => [rect(w)], 500, 10, 24, 40), null)
  eq(nearestWord([a, b, c, d], (w) => [rect(w)], 10, 35, 24, 40), c)
})
guard('keyboard selection stops at edges and picks the closest next-line word', () => {
  eq(stepWord([a, b, c], a, -1), null)
  eq(stepWord([a, b, c], c, 1), null)
  eq(stepWord([a, b, c], b, -1), a)
  eq(adjacentLineWord([a, b, c, d], b, 1, rect), d)
  eq(adjacentLineWord([a, b, c, d], b, -1, rect), null)
})
finish()
