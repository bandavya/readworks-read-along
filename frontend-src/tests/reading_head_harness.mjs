// The reading point a buddy's pointer follows, and the rule that a buddy is off unless someone turns it on.
import { readFileSync } from 'node:fs'
import { guard, finish } from './_kinds.mjs'
import { buildPath, mouthShut, knownBuddy } from '../src/character/readingHead.js'

// Two lines, a silence after the third word, no gap at the line change, then a page change.
const words = [
  { k: 0, text: 'One', start: 1, end: 1.3, x: 10, y: 0, w: 30, h: 20, page: 0 },
  { k: 1, text: 'two', start: 1.3, end: 1.6, x: 50, y: 0, w: 30, h: 20, page: 0 },
  { k: 2, text: 'three', start: 1.6, end: 2.0, x: 90, y: 0, w: 50, h: 20, page: 0 },
  { k: 3, text: 'four', start: 3.0, end: 3.4, x: 150, y: 0, w: 40, h: 20, page: 0 },
  { k: 4, text: 'five', start: 3.4, end: 3.7, x: 10, y: 40, w: 40, h: 20, page: 0 },
  { k: 5, text: 'six', start: 5, end: 5.3, x: 10, y: 0, w: 30, h: 20, page: 1 },
]
const path = buildPath(words)
const samples = []
for (let t = 0; t < 6; t += 0.01) samples.push(t)

guard('before the first word the point waits at the first word; after the last it stays at the end', () => {
  const a = path.at(0)
  if (a.phase !== 'before' || a.x !== 10 || a.k !== 0) throw new Error(JSON.stringify(a))
  const z = path.at(6)
  if (z.phase !== 'after' || z.x !== 40 || z.k !== 5) throw new Error(JSON.stringify(z))
})

guard('while a word is spoken the point is inside that word', () => {
  for (const t of samples) {
    const h = path.at(t)
    if (h.phase !== 'word') continue
    if (h.x < h.word.x - 0.001 || h.x > h.word.x + h.word.w + 0.001 || h.y !== h.word.y) throw new Error(`t=${t}: ${h.x} outside ${h.word.text}`)
  }
})

guard('the same time always gives the same answer, whatever was asked before (seeks and taps need no special case)', () => {
  const first = path.at(3.2)
  path.at(0.5)
  path.at(5.2)
  const again = path.at(3.2)
  if (JSON.stringify({ ...first, word: 0, next: 0 }) !== JSON.stringify({ ...again, word: 0, next: 0 })) throw new Error('differs')
})

guard('the point never jumps backward along a line while reading it', () => {
  let last = null
  for (const t of samples) {
    const h = path.at(t)
    if (last && last.line === h.line && h.x < last.x - 0.001 && h.phase !== 'sweep' && h.phase !== 'page') throw new Error(`t=${t}: ${last.x} to ${h.x}`)
    last = h
  }
})

guard('it arrives on the next line by the time that line first word starts, even when the voice leaves no gap', () => {
  const h = path.at(3.4)
  if (h.k !== 4 || Math.abs(h.y - 40) > 0.001) throw new Error(JSON.stringify({ k: h.k, y: h.y }))
  const leaving = path.at(3.39)
  if (leaving.phase !== 'sweep') throw new Error(`phase ${leaving.phase}`)
})

guard('a tapped word that is lit before the audio reaches it is where the point waits, and the clock takes over after', () => {
  const pinned = path.forHighlight(1.25, 2)
  if (pinned.k !== 2 || pinned.x !== 90 || pinned.phase !== 'word') throw new Error(JSON.stringify({ k: pinned.k, x: pinned.x, phase: pinned.phase }))
  const normal = path.forHighlight(1.65, 2)
  if (normal.k !== 2 || normal.x <= 90) throw new Error('clock no longer drives it')
  const none = path.forHighlight(1.25, -1)
  if (none.k !== 0) throw new Error('nothing lit should leave the clock in charge')
})

guard('with reduced motion the answer does not change inside a word or the silence after it', () => {
  const a = JSON.stringify({ ...path.calmAt(1.62, 2), word: 0, next: 0 })
  for (const t of [1.7, 1.95, 2.5, 2.9]) {
    const b = JSON.stringify({ ...path.calmAt(t, 2), word: 0, next: 0 })
    if (a !== b) throw new Error(`t=${t} moved`)
  }
  if (path.calmAt(1.62, 2).talk !== 0) throw new Error('mouth still moving')
})

guard('the continuous mouth stays in range, moves smoothly, and closes in a real silence', () => {
  let last = null
  for (const t of samples) {
    const { open, wide, round } = path.at(t).lips
    for (const v of [open, wide, round]) if (!(v >= 0 && v <= 1)) throw new Error(`t=${t}: out of range ${v}`)
    if (last !== null && Math.abs(open - last) > 0.2) throw new Error(`t=${t}: jumped ${last} to ${open}`)
    last = open
  }
  if (path.at(2.5).lips.open !== 0) throw new Error('should be closed in the long silence')
  if (path.at(0).lips.open !== 0 || path.at(5.9).lips.open !== 0) throw new Error('should be closed before and after')
  if (path.calmAt(1.7, 2).lips.open !== 0) throw new Error('reduced motion keeps it closed')
})

guard('a paused voice has a closed mouth, wherever the clock stopped, and the point stays on its word', () => {
  const mid = path.at(1.1)
  if (mid.lips.open === 0 && mid.talk === 0) throw new Error('fixture should be mid-word with an open mouth')
  const shut = mouthShut(mid)
  if (shut.talk !== 0 || shut.mouth !== 'rest' || shut.lips.open !== 0 || shut.lips.wide !== 0 || shut.lips.round !== 0) throw new Error('mouth still open')
  if (shut.x !== mid.x || shut.k !== mid.k) throw new Error('closing the mouth moved the point')
  const full = readFileSync(new URL('../src/character/buddyDriver.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
  if ((full.match(/engine\.audio\.paused \|\| engine\.audio\.ended \? mouthShut\(/g) || []).length !== 2) throw new Error('the driver must close the mouth whenever it sets the head')
})

guard('a saved character that no longer exists counts as none', () => {
  if (knownBuddy('gone', ['a', 'b']) !== '') throw new Error('unknown id kept')
  if (knownBuddy('a', ['a', 'b']) !== 'a') throw new Error('known id lost')
  if (knownBuddy('', ['a']) !== '' || knownBuddy(null, ['a']) !== '') throw new Error('empty should stay off')
})

guard('words are grouped into lines and pages', () => {
  if (path.lines.length !== 3) throw new Error(`lines ${path.lines.length}`)
  if (path.lines[2].page !== 1) throw new Error('page')
})

guard('a buddy is off unless someone chose one', () => {
  const src = readFileSync(new URL('../src/character/buddies.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
  if (!/BUDDY_UI = fromAddress !== null \|\| !!buildDefault \|\| showcase/.test(src)) throw new Error('the switch for showing it changed')
  if (!/saved = BUDDY_UI \? store\.get\('buddy', buildDefault\) : ''/.test(src) || !/knownBuddy\(fromAddress \?\? saved, ids\)/.test(src) || !/VITE_BUDDY \|\| ''/.test(src)) throw new Error('default changed')
  const app = readFileSync(new URL('../src/App.vue', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
  if (!/<BuddyHost v-if="BUDDY_UI && buddyChoice/.test(app)) throw new Error('nothing may run until a character is chosen')
  const bar = readFileSync(new URL('../src/components/ThemeBar.vue', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
  if (!/<BuddyPicker v-if="BUDDY_UI"/.test(bar)) throw new Error('an ordinary build must not show the picker')
  const host = readFileSync(new URL('../src/character/BuddyHost.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
  if (!/if \(!wanted \|\| !ready\)/.test(host)) throw new Error('host no longer stands down when none is chosen')
})

guard('the buddy changes nothing in the engine except its safe line, and puts that back', () => {
  const full = readFileSync(new URL('../src/character/buddyDriver.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
  if (!/engine\.getSafeBottom = safeBottom\n/.test(full)) throw new Error('safe line not restored')
  const src = full.replace(/engine\.getSafeBottom = [^\n]*\n/g, '\n')
  if (/engine\.[\w.]+\s*=[^=]/.test(src) || /engine\.[\w.]*\.(play|pause|load)\(|engine\.(play|pause|seek\w*|resume|toggle|setRate|setVoice|setEnabled)\(/.test(src)) throw new Error('writes to the engine')
})

guard('a paged reader keeps its own text layout: the buddy changes it only where the reader scrolls', () => {
  const full = readFileSync(new URL('../src/character/buddyDriver.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
  const scoped = full.slice(full.indexOf('if (engine.follow) {\n    if (room.lineHeight)'))
  if (!scoped.startsWith('if (engine.follow)')) throw new Error('layout changes moved out of the scrolling branch')
  const outside = full.replace(/if \(engine\.follow\) \{\n    if \(room\.lineHeight\)[\s\S]*?\n  \}\n/, '')
  if (/host\.style\.(lineHeight|padding\w*)\s*=/.test(outside)) throw new Error('layout changed outside the scrolling branch')
})

finish()
