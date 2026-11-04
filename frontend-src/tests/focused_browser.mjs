// Browser check of focused mode: node tests/focused_browser.mjs <base-url> [shot-folder]
// Installed Edge, muted. Needs passage data in the site. No browser package, server API or AWS call.
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { guard, finish } from './_kinds.mjs'

const [base, shots] = process.argv.slice(2)
if (!base) { console.error('Usage: node tests/focused_browser.mjs <base-url> [shot-folder] [passage id]'); process.exit(2) }
const site = base.replace(/\/$/, '')
const HIKE = process.argv[4] || 'ea76e55b-92bd-4671-8881-753d020e50a8'
const SIZES = [[320, 568], [390, 844], [844, 390], [768, 1024], [1366, 768], [1920, 1080]]
const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const port = 19800 + Math.floor(Math.random() * 150)
const dir = mkdtempSync(join(tmpdir(), 'focused-'))
const proc = spawn(edge, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, '--mute-audio', '--autoplay-policy=no-user-gesture-required', '--no-first-run', '--disable-gpu', 'about:blank'], { stdio: 'ignore' })
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
let ws, serial = 0
const pending = new Map()
function send(method, params = {}) { return new Promise((resolve, reject) => { const id = ++serial; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })) }) }
async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description || 'page error')
  return r.result.value
}
async function go(hash, wait = 'body') {
  await send('Page.navigate', { url: `${site}/${hash}` })
  for (let t = 0; t < 8000; t += 100) { if (await evaluate(`!!document.querySelector(${JSON.stringify(wait)})`)) break; await pause(100) }
  await pause(300)
}
async function size(w, h) { await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 768 }) }
async function shot(name) { if (!shots) return; const s = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(shots, `${name}.png`), Buffer.from(s.data, 'base64')) }
const q = (selector) => JSON.stringify(selector)
const clickJs = (selector) => evaluate(`(() => { const e = document.querySelector(${q(selector)}); if (!e) return false; e.scrollIntoView({ block: 'center' }); e.click(); return true })()`)

try {
  let target
  for (let i = 0; i < 40 && !target; i++) {
    await pause(250)
    try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page') } catch { /* Edge is still starting */ }
  }
  ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve) => { ws.onopen = resolve })
  ws.onmessage = (m) => { const d = JSON.parse(m.data); const p = pending.get(d.id); if (p) { pending.delete(d.id); d.error ? p.reject(Error(d.error.message)) : p.resolve(d.result) } }
  await send('Page.enable'); await send('Runtime.enable')
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__plays = []; { const real = HTMLMediaElement.prototype.play; HTMLMediaElement.prototype.play = function () { window.__plays.push({ src: this.src, rate: this.playbackRate }); return real.apply(this, arguments) } }` })

  await size(1366, 768)
  await go('', '.mix-library')
  const home = await evaluate(`({ hash: location.hash, theme: !!document.querySelector('.tb-strip'), all: !!document.querySelector('.mix-all-features'), map: !!document.querySelector('.mix-library-map-space'), feedback: document.body.innerText.includes('Bookshelf') })`)
  guard('opens on the focused library', () => { if (home.hash !== '#/look/mix/') throw Error(home.hash) })
  guard('no theme bar, voice maps or bookshelf', () => { if (home.theme || home.map || home.feedback) throw Error(JSON.stringify(home)) })
  guard('an All features button is there', () => { if (!home.all) throw Error('missing') })
  await shot('library-1366')

  for (const [w, h] of SIZES) {
    await size(w, h)
    await go(`#/look/mix/p/${HIKE}`, '.mix-text .sa-w')
    const v = await evaluate(`(() => {
      const word = document.querySelector('.mix-text .sa-w[data-i]'), dock = document.querySelector('.mix-dock')
      const small = [...document.querySelectorAll('.mix-dock button, .mix-top button')].filter(e => e.offsetParent && e.getBoundingClientRect().height < 44).map(e => e.textContent.trim())
      return { over: document.documentElement.scrollWidth - innerWidth, dock: dock?.getBoundingClientRect().height, small, firstWord: word?.getBoundingClientRect().top, dockTop: dock?.getBoundingClientRect().top }
    })()`)
    guard(`${w}x${h}: no sideways scroll`, () => { if (v.over > 1) throw Error(`${v.over}px`) })
    guard(`${w}x${h}: player leaves room to read`, () => { if (v.dock > h * 0.3) throw Error(`${v.dock}px of ${h}`) })
    guard(`${w}x${h}: player tap targets are 44 px`, () => { if (v.small.length) throw Error(v.small.join(', ')) })
    await clickJs('.mix-tools-button'); await pause(150)
    const tools = await evaluate(`(() => {
      const t = document.querySelector('.mix-tools'), r = t?.getBoundingClientRect()
      return { labels: [...t.querySelectorAll('.mix-tool-group > span')].map(s => s.textContent), slider: !!t.querySelector('.speed-slider input'), fits: r.top >= 0 && r.right <= innerWidth + 1, text: t.innerText }
    })()`)
    guard(`${w}x${h}: tools are simple and fit`, () => { if (!tools.slider || !tools.fits || /Spotlight|Two lines|Highlight color|Show the voice/.test(tools.text)) throw Error(JSON.stringify(tools)) })
    await shot(`reader-tools-${w}`)
    await clickJs('.mix-tools-button'); await pause(100)
    await shot(`reader-${w}`)
  }

  await size(1366, 768)
  await go(`#/look/mix/p/${HIKE}`, '.mix-text .sa-w')
  await clickJs('.mix-play')
  // Move past the spoken title, which lights words in the heading rather than the story.
  for (let t = 0; t < 5000; t += 200) { if (await evaluate(`Number(document.querySelector('#mix-seek').max) > 1`)) break; await pause(200) }
  await evaluate(`(() => { const s = document.querySelector('#mix-seek'); s.value = String(Number(s.max) * 0.4); s.dispatchEvent(new Event('input', { bubbles: true })) })()`)
  let lit = null
  for (let t = 0; t < 8000 && !lit; t += 200) { await pause(200); lit = await evaluate(`(() => { const e = document.querySelector('.mix-text .sa-now'); if (!e) return null; const s = getComputedStyle(e); return { bg: s.backgroundColor, line: s.textDecorationLine, ribbon: document.querySelectorAll('[class*=ribbon]:not(.mix-voice-off)').length } })()`) }
  guard('playing lights a word, highlight only', () => { if (!lit || lit.line !== 'none' || lit.bg === 'rgba(0, 0, 0, 0)') throw Error(JSON.stringify(lit)) })
  const ribbonShown = await evaluate(`[...document.querySelectorAll('[class*=ribbon]')].some(e => { const s = getComputedStyle(e); return s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity) > 0 && e.getBoundingClientRect().width > 0 })`)
  guard('no moving line under the words', () => { if (ribbonShown) throw Error('a ribbon is visible') })
  await clickJs('.mix-tools-button'); await pause(100)
  await evaluate(`[...document.querySelectorAll('.mix-tools button')].find(b => b.textContent === 'Underline the word')?.click()`)
  await pause(500)
  const under = await evaluate(`(() => { const e = document.querySelector('.mix-text .sa-now'); if (!e) return null; const s = getComputedStyle(e); return { line: s.textDecorationLine, bg: s.backgroundColor } })()`)
  guard('underline choice underlines without a highlight', () => { if (under && (under.line !== 'underline' || under.bg !== 'rgba(0, 0, 0, 0)')) throw Error(JSON.stringify(under)) })
  await evaluate(`[...document.querySelectorAll('.mix-tools button')].find(b => b.textContent === 'Highlight the sentence')?.click()`)
  await pause(500)
  const sentence = await evaluate(`({ words: document.querySelectorAll('.mix-sentence').length, line: getComputedStyle(document.querySelector('.mix-text .sa-now') || document.body).textDecorationLine })`)
  const midStory = await evaluate(`(() => { const e = document.querySelector('.mix-text .sa-now'); if (!e) return null; const r = e.getBoundingClientRect(), d = document.querySelector('.mix-dock').getBoundingClientRect(); return { top: r.top, bottom: r.bottom, dockTop: d.top } })()`)
  guard('the lit word stays on screen, above the player', () => { if (!midStory || midStory.top < 0 || midStory.bottom > midStory.dockTop) throw Error(JSON.stringify(midStory)) })
  guard('sentence choice lights the sentence and underlines the word', () => { if (sentence.words < 2 || sentence.line !== 'underline') throw Error(JSON.stringify(sentence)) })
  await evaluate(`[...document.querySelectorAll('.mix-tools button')].find(b => b.textContent === 'Highlight the word')?.click()`)
  await clickJs('.mix-play'); await clickJs('.mix-tools-button')

  await go(`#/look/mix/p/${HIKE}`, '.mix-text .sa-w')
  const hold = (selector) => evaluate(`(async () => {
    const el = document.querySelector(${JSON.stringify(selector)})
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' }))
    await new Promise((resolve) => setTimeout(resolve, 650))
    document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
    await new Promise((resolve) => setTimeout(resolve, 150))
    const note = document.querySelector('.mix-note')
    return { note: !!note, text: note?.innerText || '' }
  })()`)
  const plain = await hold('.mix-text .sa-w[data-i]:not([data-vocab-sense-id *= "x"])')
  guard('holding an ordinary word opens nothing', () => { if (plain.note) throw Error(plain.text) })
  const marked = await hold('.mix-text [data-vocab-sense-id] .sa-w')
  guard('holding a vocabulary word shows its meaning, with no second voice', () => { if (!marked.note || /Hear meaning/.test(marked.text) || !/Meaning/i.test(marked.text)) throw Error(JSON.stringify(marked)) })
  await evaluate(`document.querySelector('.mix-note-top button')?.click()`)
  await evaluate(`[...document.querySelectorAll('.mix-tabs button')][1].click()`); await pause(200)
  const words = await evaluate(`({ rows: document.querySelectorAll('.mix-word').length, es: document.querySelectorAll('.mix-word-es').length })`)
  await clickJs('.mix-word button'); await pause(300)
  guard('Words to know shows each word once, with no second card', () => { if (!words.rows) throw Error('no rows') })
  const side = await evaluate(`!!document.querySelector('.mix-side .mix-note')`)
  guard('hearing a listed word adds no duplicate panel', () => { if (side) throw Error('side card open') })
  const oneSyllable = await evaluate(`(async () => {
    const data = await (await fetch('data/syllables/${HIKE}.json')).json()
    return Object.values(data).filter(e => (e.syllables || []).length === 1).map(e => e.word)
  })().catch(() => [])`)
  if (oneSyllable.length) {
    await evaluate(`window.__plays = []`)
    const clicked = await evaluate(`(() => { const row = [...document.querySelectorAll('.mix-word')].find(r => ${JSON.stringify(oneSyllable)}.includes(r.querySelector('button').textContent.trim())); const b = row?.querySelector('.sg-slow'); b?.click(); return !!b })()`)
    await pause(300)
    const play = await evaluate(`window.__plays.at(-1)`)
    guard('slow on a one-syllable word plays it slowly, once', () => { if (!clicked || !play || Math.abs(play.rate - 0.6) > 0.01) throw Error(JSON.stringify({ clicked, play })) })
  }
  await shot('words-1366')

  for (const [w, h] of [[390, 844], [1366, 768]]) {
    await size(w, h)
    await go(`#/look/mix/kid/${HIKE}`, '.mix-text .sa-w')
    const kid = await evaluate(`({ article: !!document.querySelector('.mix-kid-article'), paged: !!document.querySelector('.kv-text, .mix-kid-read'), over: document.documentElement.scrollWidth - innerWidth, size: parseFloat(getComputedStyle(document.querySelector('.mix-text')).fontSize) })`)
    guard(`younger readers ${w}: the normal article with larger text`, () => { if (!kid.article || kid.paged || kid.over > 1 || kid.size < 20) throw Error(JSON.stringify(kid)) })
    await shot(`kid-${w}`)
  }

  await size(1366, 768)
  await go('#/look/mix/', '.mix-library')
  await clickJs('.mix-all-features'); await pause(300)
  await go('#/look/mix/', '.mix-library')
  const all = await evaluate(`({ theme: !!document.querySelector('.tb-strip'), back: !!document.querySelector('.focused-back') })`)
  guard('All features brings back the themes', () => { if (!all.theme || !all.back) throw Error(JSON.stringify(all)) })
  await go(`#/look/mix/kid/${HIKE}`, '.mix-kid-read, .mix-text')
  const paged = await evaluate(`!document.querySelector('.mix-kid-article')`)
  guard('All features keeps the paged kid view', () => { if (!paged) throw Error('article view shown') })
  await clickJs('.focused-back'); await pause(300)
  await go('#/look/mix/', '.mix-library')
  const again = await evaluate(`!!document.querySelector('.tb-strip')`)
  guard('focused mode is restored', () => { if (again) throw Error('theme bar still there') })
} catch (e) { guard('browser check completes', () => { throw e }) } finally { try { ws?.close() } catch { /* closing */ } proc.kill(); await pause(300); try { rmSync(dir, { recursive: true, force: true }) } catch { /* Edge may hold a file */ } }
if (shots) mkdirSync(shots, { recursive: true })
finish()
