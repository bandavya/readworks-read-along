// Browser guard for the classic reader and kid view. Shell command:
// node tests/reader_layout_browser.mjs http://localhost:8992 <passage-id> [shot-directory]
// Requires a running local Vite server and installed Edge; no npm package or AWS call.
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { guard, behavior, finish } from './_kinds.mjs'
const [base, passageId, shots] = process.argv.slice(2)
if (!base || !passageId) { console.error('Usage: node tests/reader_layout_browser.mjs <base-url> <passage-id> [shot-directory]'); process.exit(2) }
const sizes = [[320,568],[390,844],[844,390],[768,1024],[1180,820],[1366,768],[1920,1080],[2560,1440]]
const edge = process.env.EDGE || (process.platform === 'win32' ? join(process.env['PROGRAMFILES(X86)'] || process.env.PROGRAMFILES || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe') : 'msedge')
const port = 19300 + Math.floor(Math.random() * 400)
const dir = mkdtempSync(join(tmpdir(), 'reader-layout-'))
const proc = spawn(edge, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, '--mute-audio', '--autoplay-policy=no-user-gesture-required', '--no-first-run', '--disable-gpu', 'about:blank'], { stdio: 'ignore' })
let ws, serial = 0
const pending = new Map()
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
function send(method, params = {}) { return new Promise((resolve, reject) => {
  const id = ++serial; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params }))
}) }
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails).slice(0, 500))
  return result.result.value
}
async function key(name, vk) {
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: name, code: name, windowsVirtualKeyCode: vk })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: name, code: name, windowsVirtualKeyCode: vk })
}
async function go(hash) {
  await send('Page.navigate', { url: `${base.replace(/\/$/, '')}/#/${hash}` })
  await pause(1300)
}
const measure = `(() => {
  const w = innerWidth, h = innerHeight;
  const target = ['.player .play','.player .scrub input','.player-more','.speed-slider input','.kv-play','.kv-choose','.kv-gear','.kv-arrow:not(:disabled)','.kv-meaning-offer','.filters select','.teacher-form input','.teacher-form select','.teacher-form button','.card-kid','.lib-more','.tabs button'];
  const small = target.flatMap(q => [...document.querySelectorAll(q)].filter(e => getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().width && (e.getBoundingClientRect().width < 43 || e.getBoundingClientRect().height < 43)).map(e => q));
  const story = [...document.querySelectorAll('.sa-text p:not(.sa-byline), .kv-text .kv-p')].find(p => p.querySelector('.sa-w:not(.sa-unread)'));
  const firstWord = story?.querySelector('.sa-w:not(.sa-unread)');
  const dock = document.querySelector('.dock');
  const limit = dock ? dock.getBoundingClientRect().top : h;
  const r = firstWord?.getBoundingClientRect();
  const visibleHeight = r ? Math.max(0, Math.min(r.bottom, limit) - Math.max(r.top, 0)) : 0;
  const feedback = document.querySelector('.fb-pill.fb-up')?.getBoundingClientRect();
  const kidFeedback = document.querySelector('.fb-pill.fb-kid')?.getBoundingClientRect();
  const kidRead = document.querySelector('.kv-read')?.getBoundingClientRect();
  return { width: document.documentElement.scrollWidth, viewport: w, small, storyVisible: visibleHeight >= 16,
    storyTop: r?.top, visibleHeight, limit, dockHeight: dock?.getBoundingClientRect().height,
    feedbackBottom: feedback?.bottom, kidFeedbackTop: kidFeedback?.top, kidReadBottom: kidRead?.bottom };
})()`
try {
  let tabs
  for (let i = 0; i < 40; i++) { try { tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); if (tabs.some(t => t.type === 'page')) break } catch {} await pause(250) }
  if (!tabs?.some(t => t.type === 'page')) throw new Error('Edge debugging port unavailable')
  ws = new WebSocket(tabs.find(t => t.type === 'page').webSocketDebuggerUrl)
  await new Promise(resolve => { ws.onopen = resolve })
  ws.onmessage = ({ data }) => { const m = JSON.parse(data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(Error(JSON.stringify(m.error))) : p.resolve(m.result) } }
  await send('Page.enable'); await send('Runtime.enable')
  if (shots) mkdirSync(shots, { recursive: true })
  for (const [width, height] of sizes) {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width <= 390 || height < 500 })
    for (const route of ['','teacher/',`p/${passageId}`,`kid/${passageId}`]) {
      await go(route)
      if (route.startsWith('kid/')) { await evaluate(`document.querySelector('.kv-listen')?.click(); true`); await pause(500) }
      const name = route ? route.split('/')[0] : 'library'
      const m = await evaluate(measure)
      guard(`${name} ${width}x${height}: no sideways scroll`, () => { if (m.width > m.viewport + 1) throw Error(`${m.width} > ${m.viewport}`) })
      guard(`${name} ${width}x${height}: primary targets at least 44px`, () => { if (m.small.length) throw Error(m.small.join(', ')) })
      if (name === 'p' || name === 'kid') guard(`${name} ${width}x${height}: first story word visible on opening`, () => { if (!m.storyVisible) throw Error(`word top ${m.storyTop}, visible ${m.visibleHeight}px, available bottom ${m.limit}`) })
      if (name === 'p' && (width <= 1400 || height <= 900)) guard(`${name} ${width}x${height}: compact player leaves room`, () => {
        if (m.dockHeight > 100) throw Error(`player height ${m.dockHeight}px`)
      })
      if (name === 'p') guard(`${name} ${width}x${height}: Feedback leaves story clear`, () => {
        if (m.feedbackBottom == null || m.feedbackBottom > m.storyTop) throw Error(`Feedback bottom ${m.feedbackBottom}, story top ${m.storyTop}`)
      })
      if (name === 'kid') guard(`${name} ${width}x${height}: Feedback sits outside reading area`, () => {
        if (m.kidFeedbackTop == null || m.kidReadBottom == null || m.kidFeedbackTop < m.kidReadBottom - 1)
          throw Error(`Feedback top ${m.kidFeedbackTop}, reading area bottom ${m.kidReadBottom}`)
      })
      if (shots) { const shot = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(shots, `${name}-${width}x${height}.png`), Buffer.from(shot.data, 'base64')) }
      if (name === 'p') {
        await evaluate(`(() => {
          const more = document.querySelector('.player-more');
          if (more && getComputedStyle(more).display !== 'none') more.click();
          return true;
        })()`)
        await pause(120)
        const sliderReady = await evaluate(`(() => {
          const slider = document.querySelector('.speed-slider input');
          slider?.focus();
          return !!slider && slider.getBoundingClientRect().width > 0 && getComputedStyle(slider).display !== 'none';
        })()`)
        guard(`speed slider ${width}x${height}: visible after More`, () => { if (!sliderReady) throw Error('slider hidden') })
        const before = await evaluate(`Number(document.querySelector('.speed-slider input')?.value)`)
        await key('ArrowLeft', 37)
        const after = await evaluate(`Number(document.querySelector('.speed-slider input')?.value)`)
        guard(`speed slider ${width}x${height}: arrow key changes value`, () => { if (!(after < before)) throw Error(`${before} -> ${after}`) })
        const speedDetails = await evaluate(`(() => {
          const slider = document.querySelector('.speed-slider input');
          const stops = [...document.querySelectorAll('.speed-stops span')].map(s => {
            const r = s.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
          });
          slider.value = '1.05'; slider.dispatchEvent(new Event('input', { bubbles: true }));
          return { max: Number(slider.max), snapped: Number(slider.value), normal: stops[1], slower: stops[0], faster: stops[2] };
        })()`)
        guard(`speed slider ${width}x${height}: 2x and Normal detent`, () => {
          if (speedDetails.max !== 2 || speedDetails.snapped !== 1 ||
              !(speedDetails.slower.left < speedDetails.normal.left && speedDetails.normal.left < speedDetails.faster.left) ||
              (speedDetails.slower.right > speedDetails.normal.left && speedDetails.slower.bottom > speedDetails.normal.top))
            throw Error(JSON.stringify(speedDetails))
        })
        // More may cover the first word on a narrow screen; close it before the tap check.
        await evaluate(`(() => { const more = document.querySelector('.player-more'); if (more?.getAttribute('aria-expanded') === 'true') more.click(); return true })()`)
        const point = await evaluate(`(() => { const r = document.querySelector('.sa-text .sa-w:not(.sa-unread)')?.getBoundingClientRect(); return r && { x: (r.left+r.right)/2, y: (r.top+r.bottom)/2 } })()`)
        guard(`word tap ${width}x${height}: word is reachable`, () => { if (!point || point.y <= 0 || point.y >= height) throw Error('first word outside viewport') })
        if (point && point.y > 0 && point.y < height) {
          await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 })
          await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 })
          const tapped = await evaluate(`({ playing: !!document.querySelector('.sa-text .sa-w.sa-now'), prompt: !!document.querySelector('.word-meaning-prompt') })`)
          guard(`word tap ${width}x${height}: starts playback highlight`, () => { if (!tapped.playing) throw Error('no active word') })
          behavior(`word tap ${width}x${height}: meaning prompt appears when help exists`, () => { if (!tapped.prompt) throw Error('no prompt on sampled word') })
        }
        if (width === 390 && height === 844) {
          const paragraphBefore = await evaluate(`(() => {
            const more = document.querySelector('.player-more');
            if (more?.getAttribute('aria-expanded') === 'true') more.click();
            const word = document.querySelector('.sa-text .sa-w[data-vocab-sense-id], .sa-text [data-vocab-sense-id] .sa-w');
            word?.scrollIntoView({ block: 'center' }); word?.focus(); return word?.closest('p')?.getBoundingClientRect().height;
          })()`)
          await key('Enter', 13)
          await pause(1200)
          const offer = await evaluate(`(() => {
            const b = document.querySelector('.word-meaning-prompt');
            const p = b?.closest('p');
            return { visible: !!b && b.getBoundingClientRect().width > 0, fixed: b && getComputedStyle(b).position === 'fixed',
              paragraphHeight: p?.getBoundingClientRect().height,
              announced: document.querySelector('.sa-visually-hidden[aria-live="polite"]:last-of-type')?.textContent || '' };
          })()`)
          guard('meaning offer: keyboard activation remains visible without moving the paragraph', () => {
            if (!offer.visible || !offer.fixed || Math.abs(offer.paragraphHeight - paragraphBefore) > 1) throw Error(JSON.stringify({ offer, paragraphBefore }))
          })
          behavior('meaning offer: announces the available action', () => { if (!offer.announced.includes('What does it mean?')) throw Error(offer.announced) })
          const info = await evaluate(`(async () => {
            const word = document.querySelector('.sa-text .sa-w[data-vocab-sense-id], .sa-text [data-vocab-sense-id] .sa-w');
            const sid = word?.closest('[data-vocab-sense-id]')?.dataset.vocabSenseId;
            const data = await (await fetch('/data/${passageId}.json')).json();
            document.querySelector('.word-meaning-prompt')?.click();
            return { source: data.vocab?.[sid], sid };
          })()`)
          await pause(100)
          const cardInfo = await evaluate(`({ pos: document.querySelector('.vpop-pos')?.textContent,
            example: document.querySelector('.vpop-ex')?.textContent, spanish: document.querySelector('.vpop-es')?.textContent })`)
          guard('meaning card: current vocabulary details are present', () => {
            if (!info.source || (info.source.pos && cardInfo.pos !== info.source.pos) ||
              (info.source.example && cardInfo.example !== info.source.example) ||
              (info.source.spanish && !cardInfo.spanish?.includes(info.source.spanish)))
              throw Error(JSON.stringify({ info, cardInfo }))
          })
          await evaluate(`(() => {
            const words = [...document.querySelectorAll('.sa-text .sa-w[data-vocab-sense-id], .sa-text [data-vocab-sense-id] .sa-w')];
            const next = words.find(w => w.closest('[data-vocab-sense-id]') !== words[0]?.closest('[data-vocab-sense-id]'));
            next?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); next?.click();
            return true;
          })()`)
          await pause(120)
          const closed = await evaluate(`!document.querySelector('.vpop')`)
          guard('meaning card: another vocabulary tap closes the old card', () => { if (!closed) throw Error('old card stayed open') })
          await evaluate(`(() => {
            const more = document.querySelector('.player-more');
            if (more?.getAttribute('aria-expanded') !== 'true') more?.click();
            document.querySelector('.rh-open')?.click(); return true;
          })()`)
          await pause(120)
          const practice = await evaluate(`(() => {
            document.querySelector('.sa-text .sa-w')?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
            const menu = document.querySelector('.player-more-options');
            const panel = document.querySelector('.rh-panel');
            const r = panel?.getBoundingClientRect();
            return { open: menu?.classList.contains('open'), panel: !!panel,
              panelTop: r?.top, panelBottom: r?.bottom, dockTop: document.querySelector('.dock')?.getBoundingClientRect().top };
          })()`)
          guard('sentence practice: panel stays open while tapping the story', () => {
            if (!practice.open || !practice.panel || practice.panelTop < 0 || practice.panelBottom > practice.dockTop + 1)
              throw Error(JSON.stringify(practice))
          })
        }
      }
      if (name === 'kid') {
        const point = await evaluate(`(() => { const r = document.querySelector('.kv-text .sa-w:not(.sa-unread):not(.kv-h)')?.getBoundingClientRect(); return r && { x: (r.left+r.right)/2, y: (r.top+r.bottom)/2 } })()`)
        guard(`kid word tap ${width}x${height}: word is reachable`, () => { if (!point || point.y <= 0 || point.y >= height) throw Error('first word outside viewport') })
        if (point && point.y > 0 && point.y < height) {
          await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 })
          await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 })
          const playing = await evaluate(`!!document.querySelector('.kv-text .sa-w.sa-now')`)
          guard(`kid word tap ${width}x${height}: starts playback highlight`, () => { if (!playing) throw Error('no active word') })
        }
      }
    }
  }
} catch (e) { guard('browser harness ran', () => { throw e }) }
finally { try { ws?.close() } catch {} proc.kill(); await pause(300); try { rmSync(dir, { recursive: true, force: true }) } catch {} }
finish({ printGuardPasses: false })
