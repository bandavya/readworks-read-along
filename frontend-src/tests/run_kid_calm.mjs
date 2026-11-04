// Runs kid_calm_harness.mjs in its OWN headless Chrome (no shared browser pane). Usage, with a dev server running:
//   node tests/run_kid_calm.mjs http://localhost:8955 [scenarioName]   (no name = runAll)
// Needs Chrome at the usual Windows path (CHROME env var overrides). Opens a private profile in the temp folder.
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const base = process.argv[2] || 'http://localhost:8955'
const only = process.argv[3] || ''
const chrome = process.env.CHROME || (process.platform === 'win32' ? join(process.env.PROGRAMFILES || '', 'Google', 'Chrome', 'Application', 'chrome.exe') : 'google-chrome')
const port = 9300 + Math.floor(Math.random() * 600)
const dir = mkdtempSync(join(tmpdir(), 'kidcalm-'))
let guardsPassed = 0
let guardsFailed = 0
let behaviorMatching = 0
let behaviorChanged = 0
const proc = spawn(chrome, [
  '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, '--no-first-run', '--mute-audio',
  '--window-size=1024,768',
  // Default: let silent test audio play without a real gesture. BLOCKED=1 keeps Chrome's normal rule, which refuses
  // sound until a real tap: that is how the "browser refused the sound" fallback is checked.
  ...(process.env.BLOCKED ? [] : ['--autoplay-policy=no-user-gesture-required']),
  'about:blank',
], { stdio: 'ignore' })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
try {
  let target = null
  for (let i = 0; i < 40 && !target; i++) {
    await sleep(250)
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
      target = list.find((t) => t.type === 'page')
    } catch { /* not up yet */ }
  }
  if (!target) throw new Error('Chrome did not start')
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((r) => ws.addEventListener('open', r))
  let id = 0
  const pending = new Map()
  ws.addEventListener('message', (m) => {
    const d = JSON.parse(m.data)
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id) }
  })
  const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })) })
  await send('Emulation.setDeviceMetricsOverride', { width: 1024, height: 768, deviceScaleFactor: 1, mobile: false })
  await send('Page.enable')
  await send('Page.navigate', { url: base + '/#/' })
  await sleep(2500)
  if (process.env.AUDIT_JS) { // pass the loop-3 accessibility audit function into the page
    const src = readFileSync(process.env.AUDIT_JS, 'utf8')
    await send('Runtime.evaluate', { expression: `window.__audit = (0, eval)(${JSON.stringify(src + String.fromCharCode(10) + ';audit')})`, returnByValue: true })
  }
  const expr = `import('/tests/kid_calm_harness.mjs').then(async (h) => JSON.stringify(await ${only ? `h.${only}()` : 'h.runAll()'}, null, 1))`
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 240000 })
  if (r.result?.exceptionDetails) throw new Error(`Browser scenario failed: ${JSON.stringify(r.result.exceptionDetails).slice(0, 800)}`)
  const result = JSON.parse(r.result?.result?.value || 'null')
  console.log(JSON.stringify(result, null, 1))
  if (!only && (!Array.isArray(result?.checks) || result.checks.length === 0)) throw new Error('Kid calm run returned no checks')
  for (const check of result?.checks || []) {
    if (check.passed) guardsPassed++
    else { guardsFailed++; console.log(`FAIL ${check.name}${check.detail ? `: ${check.detail}` : ''}`) }
  }
  for (const check of result?.behaviors || []) {
    console.log(`BEHAVIOR (current, pencil): ${check.matched ? 'pass' : 'changed'} — ${check.name}`)
    if (check.matched) behaviorMatching++
    else behaviorChanged++
  }
  if (!only) {
    // Prompt counts are measurements; the ending choice is today's behavior.
    console.log(`MEASURE prompts_before_first_word=${JSON.stringify(result.listen_tapped_at_once.spokenPromptsBeforeFirstNarratedWord)} hints_first_pause=${JSON.stringify(result.listen_tapped_at_once.hintsInFirstQuietPause)} hints_second_pause=${JSON.stringify(result.listen_tapped_at_once.hintsInSecondQuietPause)}`)
    const stays = result.ending.wordsButton && result.ending.replayButton && result.ending.homeButton &&
      result.ending.onReadingScreenAfter8s && !result.ending.wordsToKnowOpenedByItself
    console.log(`BEHAVIOR (current, pencil): ${stays ? 'pass' : 'changed'} — ending stays on the reading screen with choices`)
    if (stays) behaviorMatching++
    else behaviorChanged++
  }
  if (process.env.SHOT) { // leave the page as the scenario left it and save a picture
    const shot = await send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(process.env.SHOT, Buffer.from(shot.result.data, 'base64'))
  }
  ws.close()
} catch (error) {
  guardsFailed++
  console.error(`FAIL kid calm browser run: ${error.stack || error}`)
} finally {
  proc.kill()
  await sleep(500)
  try { rmSync(dir, { recursive: true, force: true }) } catch { /* profile still locked: harmless temp */ }
}
console.log(`SUMMARY guards_passed=${guardsPassed} guards_failed=${guardsFailed} behavior_matching=${behaviorMatching} behavior_changed=${behaviorChanged}`)
if (guardsFailed) process.exitCode = 1
