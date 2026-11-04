import assert from 'node:assert/strict'
// ribbon.js creates a Range at import time, as the browser provides one.
globalThis.document = { createRange: () => ({
  selectNodeContents(el) { this.el = el },
  getBoundingClientRect() { return this.el.getBoundingClientRect() },
}) }
const { SoundRibbon } = await import('./ribbon.js')

const box = (left, top, width, height = 20) => ({ left, top, right: left + width, bottom: top + height, width, height })
const block = { getBoundingClientRect: () => box(20, 90, 300, 100) }
const words = [
  { rect: box(40, 100, 40), timing: [0, .3] },
  { rect: box(90, 100, 55), timing: [.4, .8] },
  { rect: box(40, 140, 45), timing: [.9, 1.2] },
]
const elements = words.map(({ rect }) => ({ getBoundingClientRect: () => rect, closest: () => block }))
const svg = {
  style: {}, hidden: true, children: [], attributes: {},
  setAttribute(name, value) { this.attributes[name] = Number(value) || value },
  replaceChildren() { this.children = [] },
  append(...children) { this.children.push(...children) },
}
const rail = { style: {}, hidden: true }
const ribbon = Object.assign(Object.create(SoundRibbon.prototype), {
  root: { getBoundingClientRect: () => box(0, 0, 660, 400) },
  engine: { words: elements, voice: {}, _timing: (_, el) => words[elements.indexOf(el)].timing },
  svg, rail, dot: { style: {} }, calm: () => false, parts: [],
})
const oldDocument = globalThis.document
const oldMatchMedia = globalThis.matchMedia
globalThis.document.createElementNS = () => ({ attributes: {}, setAttribute(name, value) { this.attributes[name] = Number(value) || value } })
globalThis.matchMedia = () => ({ matches: false })
try {
  ribbon.draw(0, block, words[0].rect, 'first line')
  assert.equal(svg.style.display, '')
  assert.equal(rail.hidden, false)
  assert.equal(svg.children.length, 4, 'one base and one fill per word on the current line')
  assert.equal(Number.parseFloat(svg.style.top), 124)
  const top = Number.parseFloat(svg.style.top)
  const height = Number(svg.attributes.height)
  assert.ok(top >= 120 + 4 && top + height <= 140 - 4)
  for (const segment of svg.children) {
    const segmentTop = top + Number(segment.attributes.y)
    const segmentBottom = segmentTop + Number(segment.attributes.height)
    assert.ok(segmentTop >= 120 && segmentBottom <= 140, 'segment stays clear of both lines')
  }
  ribbon.paint(.55, 1)
  assert.ok(Number(ribbon.parts[0].fill.attributes.width) > 0)
  assert.ok(Number(ribbon.parts[1].fill.attributes.width) > 0)
  assert.equal(Number(ribbon.parts[2]?.fill?.attributes.width || 0), 0)
  Object.assign(words[2].rect, box(40, 132, 45))
  ribbon.draw(0, block, words[0].rect, 'tight line')
  assert.equal(svg.style.display, 'none', 'only a lane under 8 px hides the ribbon')
  assert.equal(rail.hidden, false, 'the margin rail remains visible')
} finally {
  globalThis.document = oldDocument
  globalThis.matchMedia = oldMatchMedia
}
console.log('sound ribbon geometry OK')
