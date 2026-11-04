// Synthetic lead rendering parity. Run: node prototype/app/tests/kid_lead_render_harness.mjs
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { guard, finish } from './_kinds.mjs'
import { leadSpans, leadWordsHtml } from '../src/components/LeadWords.js'

const readerFile = fileURLToPath(new URL('../src/components/KidReader.vue', import.meta.url))
const readerSource = readFileSync(readerFile, 'utf8')

// Execute the reader's computed HTML with an empty DOMParser stub. This exercises
// the kid title/byline expression while keeping the fixture independent of private data.
function renderKidLead(passage) {
  const start = readerSource.indexOf('const textHtml = computed(() => {')
  const end = readerSource.indexOf('/* ---------- pagination ---------- */', start)
  if (start < 0 || end < 0) throw new Error('kid text renderer not found')
  const snippet = readerSource.slice(start, end)
  const computed = (fn) => ({ get value() { return fn() } })
  class EmptyDomParser {
    parseFromString() { return { querySelector: () => null, body: { querySelectorAll: () => [] } } }
  }
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  const render = new Function('props', 'computed', 'DOMParser', 'leadSpans', 'wrapStray', 'assetUrl', 'esc',
    `${snippet}\nreturn textHtml.value`)
  return render({ data: passage }, computed, EmptyDomParser, leadSpans, (el) => el, (s) => s, esc)
}

function leadSignature(html) {
  const sections = [...html.matchAll(/<(h1|p) class="(?:sa-title|sa-byline|kv-title|kv-by)">([\s\S]*?)<\/\1>/g)]
  return sections.map((section) => [...section[2].matchAll(/<span class="sa-w" data-l="(\d+)">([\s\S]*?)<\/span>/g)]
    .map((span) => [Number(span[1]), span[2]]))
}

const passage = {
  title_words: ['A&B', '<story>', '"here"'],
  by_words: ['By', 'A&B', '<Author>'],
  html: '',
}
const expected = [
  [[0, 'A&amp;B'], [1, '&lt;story&gt;'], [2, '&quot;here&quot;']],
  [[3, 'By'], [4, 'A&amp;B'], [5, '&lt;Author&gt;']],
]
guard('shared and kid lead render the same escaped words and indices', () => {
  const shared = leadSignature(leadWordsHtml(passage))
  const kid = leadSignature(renderKidLead(passage))
  if (JSON.stringify(shared) !== JSON.stringify(expected)) throw new Error('shared lead differs from expected escaped indices')
  if (JSON.stringify(kid) !== JSON.stringify(expected)) throw new Error('kid lead differs from expected escaped indices')
})
guard('kid renderer uses the shared span helper', () => {
  if (!readerSource.includes("import { leadSpans } from './LeadWords'")) throw new Error('missing shared helper import')
  if (readerSource.includes('const leadSpans =')) throw new Error('kid renderer still has a local span helper')
})
finish()
