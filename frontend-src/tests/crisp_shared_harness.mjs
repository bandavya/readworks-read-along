// Mount the real Crisp parent with synthetic loaders and child components.
// This Node harness checks Vue wiring; browser layout still needs a live audit.
import { readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as vue from 'vue'
import { guard, behavior, okGuard, okBehavior, finish } from './_kinds.mjs'
import { pageMaps } from '../src/kid/pages.js'
import { stepWord, adjacentLineWord } from '../src/kid/select.js'
import { pageForNarration, pageForAnchor } from '../src/kid/sync.js'

const require = createRequire(new URL('../package.json', import.meta.url))
const { parse, compileScript } = require('@vue/compiler-sfc')
const root = new URL('../src/', import.meta.url)
const read = (path) => readFileSync(fileURLToPath(new URL(path, root)), 'utf8')
const parent = read('looks/sharpened/SharpenedKidView.vue')
const shared = read('components/KidReader.vue')
const yes = (v, message) => { if (!v) throw new Error(message) }
const same = (a, b, name) => yes(a === b, name + ' lost identity')

const descriptor = parse(parent).descriptor
let code = compileScript(descriptor, { id: 'crisp-contract', inlineTemplate: true }).content
code = code.replace(/import\s*\{([^}]+)\}\s*from\s*['"]vue['"];?/g,
  (_, names) => 'const {' + names.replace(/\s+as\s+/g, ': ') + '} = vue')
code = code.replace(/^import\s+.*?\s+from\s+['"][^'"]+['"];?\s*$/gm, '')
code = code.replace(/^import\s+['"][^'"]+['"];?\s*$/gm, '')
code = code.replace('export default', 'return')

const passage = {
  title: 'Synthetic story', title_words: ['Synthetic', 'story'], by_words: ['By', 'Tester'],
  html: '<p><span class="sa-w" data-k="0">Hello</span></p>',
  voices: [{ id: 'voice', words: [{ start: 0, end: 1 }] }],
  vocab: { 1: { word: 'Hello', definition: 'A greeting.' } },
}
const gloss = { 1: { review: 'pending', text: 'A greeting.' } }
const kid = { prompts: { welcome: { audio: 'welcome.mp3' } }, vocab: {} }
const syllables = { 1: { review: 'pending', parts: ['hel', 'lo'] } }
const loads = []
const loadPassage = async (id) => { loads.push(['passage', id]); return passage }
const loadGloss = async (id) => { loads.push(['gloss', id]); return gloss }
const loadKidAudio = async () => kid
const loadSyllables = async (id) => { loads.push(['syllables', id]); return syllables }
const store = { get(_key, fallback) { return fallback }, set() {} }
const voices = []
class ClipVoice {
  constructor() { this.stops = 0; this.plays = []; this.speaking = false; voices.push(this) }
  play(urls) { this.plays.push(urls); return Promise.resolve(true) }
  stop() { this.stops++; this.speaking = false; this.onChange?.(false) }
}
const vocabItem = (_id, key) => ({ key, fingerprint: 'vocab-fingerprint' })
const syllableItem = (_id, key) => ({ key, fingerprint: 'syllable-fingerprint' })

const instances = { start: [], reader: [], words: [], grownups: [] }
function child(kind) {
  const props = kind === 'reader'
    ? ['data', 'gloss', 'kid', 'syllables', 'mode', 'settings', 'voice', 'prompts', 'visit', 'passageId']
    : kind === 'grownups' ? ['settings', 'voices', 'passageId', 'open']
      : ['title', 'needTap', 'cards', 'voice', 'prompts', 'speaking']
  return vue.defineComponent({
    props,
    emits: kind === 'reader' ? ['home', 'done'] : kind === 'start' ? ['choose']
      : kind === 'grownups' ? ['request-open', 'update:open'] : ['home', 'again'],
    setup(props, { emit, expose }) {
      const entry = { props, emit, unmounted: false, calls: [] }
      instances[kind].push(entry)
      expose(kind === 'reader' ? { pauseAll() { entry.calls.push('pauseAll') } } : {})
      vue.onBeforeUnmount(() => { entry.unmounted = true })
      return () => vue.h('stub')
    },
  })
}
const KidStart = child('start')
const KidReader = child('reader')
const KidWords = child('words')
const KidGrownups = child('grownups')
const component = new Function('vue', 'loadPassage', 'loadGloss', 'loadKidAudio', 'loadSyllables',
  'store', 'ClipVoice', 'vocabItem', 'syllableItem', 'KidStart', 'KidReader', 'KidWords', 'KidGrownups', code)(
  vue, loadPassage, loadGloss, loadKidAudio, loadSyllables, store, ClipVoice,
  vocabItem, syllableItem, KidStart, KidReader, KidWords, KidGrownups)

const listeners = new Map()
function add(scope, type, fn) {
  const key = scope + ':' + type
  if (!listeners.has(key)) listeners.set(key, new Set())
  listeners.get(key).add(fn)
}
const remove = (scope, type, fn) => listeners.get(scope + ':' + type)?.delete(fn)
globalThis.window = {
  innerWidth: 1100, innerHeight: 760,
  addEventListener(type, fn) { add('window', type, fn) },
  removeEventListener(type, fn) { remove('window', type, fn) },
}
globalThis.document = {
  title: '', documentElement: { style: { fontSize: '', removeProperty(key) { if (key === 'font-size') this.fontSize = '' } } },
  addEventListener(type, fn) { add('document', type, fn) },
  removeEventListener(type, fn) { remove('document', type, fn) },
}
function node(type, text = '') { return { type, text, children: [], parent: null, props: {} } }
function detach(el) {
  const at = el.parent?.children.indexOf(el) ?? -1
  if (at >= 0) el.parent.children.splice(at, 1)
  el.parent = null
}
const renderer = vue.createRenderer({
  createElement: (type) => node(type), createText: (text) => node('#text', text),
  createComment: (text) => node('#comment', text),
  setText(el, text) { el.text = text }, setElementText(el, text) { el.text = text; el.children = [] },
  patchProp(el, key, _old, value) { el.props[key] = value },
  insert(el, parent, anchor = null) {
    if (el.parent) detach(el)
    el.parent = parent
    const at = anchor ? parent.children.indexOf(anchor) : -1
    if (at < 0) parent.children.push(el)
    else parent.children.splice(at, 0, el)
  },
  remove: detach,
  parentNode: (el) => el.parent,
  nextSibling: (el) => el.parent?.children[el.parent.children.indexOf(el) + 1] || null,
})

const host = node('host')
const app = renderer.createApp(component, { id: 'synthetic-passage' })
app.mount(host)
await Promise.resolve()
await Promise.resolve()
await vue.nextTick()
guard('mounted Crisp loads the requested passage and review inputs', () => {
  for (const kind of ['passage', 'gloss', 'syllables'])
    yes(loads.some(([k, id]) => k === kind && id === 'synthetic-passage'), kind + ' id not loaded')
  yes(document.title.includes('Synthetic story'), 'passage title not mounted')
})

instances.start.at(-1)?.emit('choose', 'listen')
await vue.nextTick()
const first = instances.reader.at(-1)
guard('mounted reader receives actual synthetic prop identities and review data', () => {
  yes(first && !first.unmounted, 'reader did not mount')
  yes(instances.reader.filter(entry => !entry.unmounted).length === 1, 'more than one reader mounted')
  for (const [name, expected] of Object.entries({ data: passage, gloss, kid, syllables, voice: voices[0] }))
    same(first.props[name], expected, name)
  same(first.props.settings.voice, 'voice', 'selected voice')
  same(first.props.passageId, 'synthetic-passage', 'passage id')
  same(first.props.data.voices[0].words[0].start, 0, 'timing')
  same(first.props.gloss[1].review, 'pending', 'gloss review state')
  same(first.props.syllables[1].review, 'pending', 'syllable review state')
})

instances.grownups.at(-1)?.emit('request-open')
await vue.nextTick()
guard('mounted grown-up request calls pauseAll on the mounted reader', () => {
  yes(first.calls.join(',') === 'pauseAll', 'pauseAll did not reach reader')
  yes(instances.grownups.at(-1)?.props.open === true, 'settings panel did not open')
})

first.emit('home')
await vue.nextTick()
guard('mounted reader home event returns to start and unmounts reader', () => {
  yes(first.unmounted, 'reader survived home')
  yes(instances.start.at(-1) && !instances.start.at(-1).unmounted, 'start did not return')
})
instances.start.at(-1).emit('choose', 'self')
await vue.nextTick()
const second = instances.reader.at(-1)
second.emit('done')
await vue.nextTick()
guard('mounted reader done event reaches words and releases reader', () => {
  yes(second !== first && second.unmounted, 'reader did not release on done')
  yes(instances.reader.every(entry => entry.unmounted), 'reader remains mounted on words screen')
  yes(instances.words.at(-1) && !instances.words.at(-1).unmounted, 'words did not mount')
  const cards = instances.words.at(-1).props.cards
  same(cards[0].reviewItems[0].fingerprint, 'vocab-fingerprint', 'vocab review fingerprint')
  same(cards[0].reviewItems[1].fingerprint, 'syllable-fingerprint', 'guide review fingerprint')
})

const stopsBeforeExit = voices[0].stops
app.unmount()
guard('parent cleanup stops prompts and removes its listeners', () => {
  yes(voices[0].stops > stopsBeforeExit, 'prompt audio was not stopped')
  yes((listeners.get('window:resize')?.size || 0) === 0, 'resize listener remains')
  yes((listeners.get('document:pointerdown')?.size || 0) === 0, 'pointer listener remains')
  yes(document.documentElement.style.fontSize === '', 'screen scale remains')
})

guard('shared page and keyboard selection seams reject invalid words and track narration', () => {
  const words = [0, 1, 2, 3].map(k => ({ k, block: k < 2 ? 'title' : 'body' }))
  const maps = pageMaps([[words[0], words[1]], [words[2], words[3]]], w => w.block,
    w => w.k === 1 ? undefined : w.k)
  yes(maps.kPage[1] === undefined, 'unread word acquired a narrated index')
  yes(maps.kPage[2] === 1 && maps.pageFirstK[1] === 2, 'narrated index lost its page')
  let shown = 0
  for (const k of [0, 2, 3]) {
    shown = pageForNarration(k, shown, maps.kPage) ?? shown
    yes(shown === maps.kPage[k], 'shown and narrated page disagree')
  }
  yes(pageForNarration(-1, shown, maps.kPage) === null, 'invalid narration index changed page')
  yes(pageForAnchor(99, shown, 2, maps.kPage) === shown, 'invalid anchor changed page')
  const visible = [words[2], words[3]]
  yes(stepWord(visible, words[2], 1) === words[3], 'keyboard cannot reach next shown word')
  yes(stepWord(visible, words[3], 1) === null, 'keyboard escaped shown page')
  yes(stepWord(visible, words[0], 1) === null, 'hidden word entered keyboard selection')
  const rects = new Map([[words[2], { left: 0, right: 30, top: 0, height: 20 }],
    [words[3], { left: 0, right: 30, top: 40, height: 20 }]])
  yes(adjacentLineWord(visible, words[2], 1, w => rects.get(w)) === words[3], 'line navigation failed')
})
behavior('Crisp uses the shared page progress and practice controls', () => {
  yes(shared.includes('class="kv-dots"') && shared.includes('<RehearseKid'), 'shared controls changed')
})

// Optional host browser proof. The default Node run above checks parent wiring only.
// Usage: node prototype/app/tests/crisp_shared_harness.mjs --browser http://localhost:<port>/#/look/sharpened/kid/<id>
// Both parents use a fresh Chrome profile and the real KidReader; media is observed, never mocked.
async function browserMediaTrace(url) {
  yes(/^https?:\/\/(localhost|127\.0\.0\.1):\d+\/#\/(?:look\/sharpened\/)?kid\//.test(url || ''), 'local kid URL required')
  const profile = mkdtempSync(join(tmpdir(), 'crisp-media-'))
  const port = 9500 + Math.floor(Math.random() * 500)
  const chrome = spawn(process.env.CHROME || (process.platform === 'win32' ? join(process.env.PROGRAMFILES || '', 'Google', 'Chrome', 'Application', 'chrome.exe') : 'google-chrome'), [
    '--headless=new', `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`,
    '--no-first-run', '--autoplay-policy=no-user-gesture-required', 'about:blank',
  ], { stdio: 'ignore' })
  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))
  let ws
  try {
    let target
    for (let i = 0; i < 40 && !target; i++) {
      await sleep(250)
      try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(t => t.type === 'page') } catch { /* starting */ }
    }
    yes(target, 'Chrome did not start for browser media trace')
    ws = new WebSocket(target.webSocketDebuggerUrl)
    await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }))
    let id = 0
    const pending = new Map()
    ws.addEventListener('message', event => {
      const message = JSON.parse(event.data)
      if (pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id) }
    })
    const send = (method, params = {}) => new Promise(resolve => {
      const n = ++id
      pending.set(n, resolve)
      ws.send(JSON.stringify({ id: n, method, params }))
    })
    const localOrigin = new URL(url).origin
    ws.addEventListener('message', event => {
      const message = JSON.parse(event.data)
      if (message.method !== 'Fetch.requestPaused') return
      const request = message.params.request.url
      const allowed = request.startsWith(localOrigin + '/')
      void send(allowed ? 'Fetch.continueRequest' : 'Fetch.failRequest',
        allowed ? { requestId: message.params.requestId } : { requestId: message.params.requestId, errorReason: 'BlockedByClient' })
    })
    await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] })
    const evaluate = async expression => {
      const response = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
      if (response.result?.exceptionDetails) throw new Error(JSON.stringify(response.result.exceptionDetails))
      return response.result?.result?.value
    }
    await send('Page.enable')
    await send('Page.addScriptToEvaluateOnNewDocument', { source: `
      window.__kidMedia = [];
      window.__kidMediaMax = 0;
      window.__kidMediaEvents = [];
      const NativeAudio = window.Audio;
      window.Audio = function (...args) {
        const media = new NativeAudio(...args);
        const index = window.__kidMedia.length;
        window.__kidMedia.push(media);
        for (const event of ['play', 'playing', 'pause', 'ended']) media.addEventListener(event, () => {
          window.__kidMediaEvents.push({ index, event, time: media.currentTime });
          window.__kidMediaMax = Math.max(window.__kidMediaMax,
            window.__kidMedia.filter(m => !m.paused && !m.ended).length);
        });
        return media;
      };
    ` })
    await send('Page.navigate', { url })
    const inspect = async label => {
      const result = await evaluate(`(() => ({
        label: ${JSON.stringify(label)},
        route: location.hash,
        screen: !!document.querySelector('.kv-wordscreen') ? 'words' : !!document.querySelector('.kv-read') ? 'read' : 'start',
        media: (window.__kidMedia || []).map((m, index) => ({ index, paused: m.paused, ended: m.ended, time: m.currentTime, src: m.currentSrc || m.src })),
        events: window.__kidMediaEvents || [],
        maxActive: window.__kidMediaMax || 0,
        active: document.activeElement?.getAttribute('aria-label') || document.activeElement?.tagName,
        activeClass: document.activeElement?.className?.baseVal || document.activeElement?.className || '',
        activeUsable: !!document.activeElement?.matches('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"]):not([aria-disabled="true"])'),
      }))()`)
      console.log('BROWSER_MEDIA ' + JSON.stringify(result))
      yes(result.maxActive <= 1 && result.media.filter(m => !m.paused && !m.ended).length <= 1, `${label}: overlapping audio owners`)
      return result
    }
    const click = async selector => {
      const found = await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true })()`)
      yes(found, `missing browser control ${selector}`)
      await sleep(180)
    }
    await sleep(1500)
    await inspect('opening')
    await click('.kv-choice')
    await sleep(600)
    const first = await inspect('first reader')
    yes(first.screen === 'read' && first.media.length >= 1, 'real reader did not create narration media')
    const firstNarration = first.media.length - 1
    yes(first.events.some(e => e.index === firstNarration && e.event === 'playing') && first.media[firstNarration].time > 0,
      'narration playback was not observed; media creation alone is insufficient')
    okGuard(first.activeUsable, 'reader transition reaches a usable control', 'first reader')
    okBehavior(first.active === 'Pause' || first.active === 'Play', 'reader focus uses current play label', first.active)
    await click('.kv-home')
    const home = await inspect('Home')
    yes(home.screen === 'start' && home.media[firstNarration]?.paused, 'narration survived Home')
    okGuard(home.activeUsable, 'opening transition reaches a usable control', 'Home')
    okBehavior(home.active === 'Read to me', 'opening focus uses current choice label', home.active)
    await click('.kv-choice')
    await sleep(600)
    const reopened = await inspect('repeated opening')
    yes(reopened.screen === 'read' && reopened.media.length > first.media.length, 'reader was not recreated')
    yes(reopened.media[firstNarration]?.paused, 'first reader narration survived repeated opening')
    const secondNarration = reopened.media.length - 1
    yes(reopened.events.some(e => e.index === secondNarration && e.event === 'playing') && reopened.media[secondNarration].time > 0,
      'reopened narration playback was not observed')
    okGuard(reopened.activeUsable, 'reader transition reaches a usable control', 'reopened reader')
    okBehavior(reopened.active === 'Pause' || reopened.active === 'Play', 'reader focus uses current play label', reopened.active)
    await click('.kv-home')
    const secondHome = await inspect('second Home')
    yes(secondHome.media[secondNarration]?.paused, 'second reader narration survived Home')
    okGuard(secondHome.activeUsable, 'opening transition reaches a usable control', 'second Home')
    okBehavior(secondHome.active === 'Read to me', 'opening focus uses current choice label', secondHome.active)
    // The second choice opens self reading, so Done can be reached without waiting for a recording.
    await click('.kv-self')
    const self = await inspect('self reader')
    yes(self.screen === 'read' && self.media.length > reopened.media.length, 'self reader was not created')
    const selfNarration = self.media.length - 1
    for (let i = 0; i < 100 && !(await evaluate("!!document.querySelector('.kv-replay')")); i++) await click('.kv-next')
    await click('.kv-wordsbtn')
    const done = await inspect('Done')
    yes(done.screen === 'words' && [firstNarration, secondNarration, selfNarration].every(index => done.media[index]?.paused), 'narration survived Done')
    okGuard(done.activeUsable, 'words transition reaches a usable control', 'Done')
    okBehavior(done.active === 'Home', 'words focus uses current Home label', done.active)
  } finally {
    ws?.close()
    chrome.kill()
    await sleep(500)
    try { rmSync(profile, { recursive: true, force: true }) } catch { /* Chrome can hold its disposable profile */ }
  }
}

if (process.argv[2] === '--browser') {
  try {
    const crisp = process.argv[3]
    const canonical = crisp.replace('/#/look/sharpened/kid/', '/#/kid/')
    yes(canonical !== crisp, 'Crisp route required for paired focus trace')
    await browserMediaTrace(canonical)
    await browserMediaTrace(crisp)
    okGuard(true, 'both real KidReader parents play exclusively, stop on Home and Done, and retain focus')
  } catch (error) { okGuard(false, 'both real KidReader parents play exclusively, stop on Home and Done, and retain focus', String(error)) }
}
finish()
