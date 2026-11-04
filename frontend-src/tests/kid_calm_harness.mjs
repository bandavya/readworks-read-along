// Scripted check for the kid view's start, hints and ending (fix-kid-calm). Runs IN THE BROWSER against a dev server:
//   const h = await import('/tests/kid_calm_harness.mjs'); JSON.stringify(await h.runAll(), null, 1)
// It mutes every audio element (wraps HTMLMediaElement.play), logs every play and every playing/pause/ended event, and
// answers: how many spoken prompts played before the first narrated word, did any prompt ever overlap narration,
// how many hints came, and does the ending stay put until the child chooses. Audio is real but silent; timing is real.
const ID = '8827e66c-6dd8-45b4-9a04-4122cffe77e3' // "Sybil's Brave Ride": short, has kid word help
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function until(fn, ms = 5000, step = 50) {
  const t0 = performance.now()
  while (performance.now() - t0 < ms) { const v = fn(); if (v) return v; await sleep(step) }
  return null
}

let log = []
let t0 = 0
let promptKeys = {}
let overlaps = []
const playing = new Map() // element -> kind
let installed = false

const kindOf = (src) => {
  const s = src || ''
  for (const [src2, key] of Object.entries(promptKeys)) if (s.endsWith(src2)) return { kind: 'prompt', key }
  return { kind: s.includes('audio/kid/') ? 'clip' : 'narr', key: null }
}

async function install() {
  if (installed) return
  installed = true
  const k = await (await fetch('/data/kid_audio.json')).json()
  for (const [key, p] of Object.entries(k.prompts)) promptKeys[p.audio] = key
  const note = (ev) => (e) => {
    const el = e.target
    if (!(el instanceof HTMLMediaElement)) return
    const { kind, key } = kindOf(el.src)
    if (ev === 'playing') {
      playing.set(el, kind + ':' + key)
      const kinds = [...playing.values()].map((v) => v.split(':')[0])
      if (kinds.includes('prompt') && kinds.includes('narr')) {
        overlaps.push({ ms: Math.round(performance.now() - t0), playing: [...playing.values()] })
      }
      log.push({ ms: Math.round(performance.now() - t0), ev: 'playing', kind, key })
    } else playing.delete(el)
  }
  const orig = HTMLMediaElement.prototype.play
  const seen = new WeakSet()
  HTMLMediaElement.prototype.play = function () {
    this.muted = true
    // Audio elements made with new Audio() are not in the page, so their events never reach document: listen on each.
    if (!seen.has(this)) { seen.add(this); for (const ev of ['playing', 'pause', 'ended', 'emptied', 'error']) this.addEventListener(ev, note(ev)) }
    const { kind, key } = kindOf(this.src)
    log.push({ ms: Math.round(performance.now() - t0), ev: 'play()', kind, key })
    const attempt = orig.call(this)
    // Observe the browser's refusal without changing the promise returned to the app.
    attempt?.then(undefined, (error) => {
      log.push({ ms: Math.round(performance.now() - t0), ev: 'play-rejected', kind, key, reason: error?.name || String(error) })
    })
    return attempt
  }
}

async function fresh(id = ID) {
  await install()
  location.hash = '#/'
  await sleep(300)
  playing.clear()
  log = []
  overlaps = []
  t0 = performance.now()
  location.hash = '#/kid/' + id
  await until(() => document.querySelector('.kv-choice'), 8000)
}
const $ = (s) => document.querySelector(s)
const prompts = (from = 0, to = Infinity) => log.filter((e) => e.ev === 'play()' && e.kind === 'prompt' && e.ms >= from && e.ms < to)
const firstNarr = () => log.find((e) => e.ev === 'playing' && e.kind === 'narr')
const keys = (l) => l.map((e) => e.key)
const visibleWords = () => [...document.querySelectorAll('.kv-text .sa-w:not(.kv-h)')].length


// The star does not end the story before the last page has been heard (pageSync.js): it plays the last page, and the
// ending appears by itself when that narration ends. So "reach the ending" = press the star, then wait for the choices.
async function reachEnding() {
  $('.kv-next.finish')?.click()
  return until(() => $('.kv-wordsbtn'), 60000, 100)
}

async function scenarioListen({ patient }) {
  await fresh()
  if (patient) {
    await until(() => log.some((e) => e.ev === 'playing' && e.key === 'welcome'), 4000)
    await until(() => ![...playing.values()].some((v) => v.startsWith('prompt')), 8000)
  }
  const clickAt = Math.round(performance.now() - t0)
  $('.kv-choice.kv-listen').click()
  let pressesAfterChoice = 0
  let fn = await until(firstNarr, 3500)
  if (!fn && $('.kv-play')) { pressesAfterChoice = 1; $('.kv-play').click(); fn = await until(firstNarr, 3000) }
  const beforeFirst = fn ? prompts(0, fn.ms + 1) : prompts()
  await sleep(6000) // narration plays
  const promptsWhilePlaying = prompts(fn ? fn.ms + 1 : 1e9)
  // turn a page by hand while narration plays: no hint may follow
  const nextBtn = $('.kv-next:not(.finish)')
  if (nextBtn) nextBtn.click()
  await sleep(1500)
  const afterTurn = prompts(fn ? fn.ms + 1 : 1e9)
  // pause, then sit quietly
  const pauseAt = Math.round(performance.now() - t0)
  if ($('.kv-play.playing')) $('.kv-play').click()
  await sleep(8000)
  const hintsAfterPause1 = prompts(pauseAt)
  // play again, pause again, sit quietly: still only the one hint per visit
  $('.kv-play').click(); await sleep(1500)
  const pause2 = Math.round(performance.now() - t0)
  if ($('.kv-play.playing')) $('.kv-play').click()
  await sleep(8000)
  const hintsAfterPause2 = prompts(pause2)
  return {
    pressesAfterChoice,
    msFromTapToFirstNarratedWord: fn ? fn.ms - clickAt : null,
    spokenPromptsBeforeFirstNarratedWord: keys(beforeFirst),
    promptsAfterChoiceBeforeFirstWord: keys(prompts(clickAt, fn ? fn.ms + 1 : 1e9)),
    promptsSpokenWhileNarrationRan: keys(promptsWhilePlaying.filter((e) => e.ms < pauseAt)),
    promptsAfterManualPageTurn: keys(afterTurn.filter((e) => e.ms < pauseAt)),
    hintsInFirstQuietPause: keys(hintsAfterPause1),
    hintsInSecondQuietPause: keys(hintsAfterPause2),
    totalHintsThisVisit: keys(prompts(clickAt)).length,
    overlaps,
  }
}

async function scenarioSelf() {
  await fresh()
  await until(() => log.some((e) => e.ev === 'playing' && e.key === 'welcome'), 4000)
  await until(() => ![...playing.values()].some((v) => v.startsWith('prompt')), 8000)
  const at = Math.round(performance.now() - t0)
  $('.kv-choice.kv-self').click()
  await sleep(2500)
  const early = keys(prompts(at))
  await sleep(6500)
  const late = keys(prompts(at))
  return { promptsInFirst2_5s: early, promptsAfter9s: late, overlaps }
}

async function scenarioEnding() {
  await fresh()
  $('.kv-choice.kv-listen').click()
  await until(() => $('.kv-next'), 3000)
  await sleep(500)
  for (let i = 0; i < 30 && !$('.kv-next.finish'); i++) { $('.kv-next').click(); await sleep(120) }
  const wordsBefore = visibleWords()
  const lastPageDots = $('.kv-dot.on') ? [...document.querySelectorAll('.kv-dot')].indexOf($('.kv-dot.on')) : -1
  const at = Math.round(performance.now() - t0)
  await reachEnding()
  const endedAt = Math.round(performance.now() - t0)
  await sleep(8000)
  const out = {
    onReadingScreenAfter8s: !!$('.kv-text') && !$('.kv-wordscreen'),
    wordsToKnowOpenedByItself: !!$('.kv-wordscreen'),
    lastPageWordsVisible_before_after: [wordsBefore, visibleWords()],
    lastPageDot: lastPageDots,
    replayButton: !!($('.kv-replay')),
    wordsButton: !!($('.kv-wordsbtn')),
    homeButton: !!($('.kv-home')),
    endLine: ($('.kv-endline')?.textContent || '').trim(),
    promptsAfterFinish: keys(prompts(at)),
    msFromStarToEnding: endedAt - at,
  }
  const words = $('.kv-wordsbtn')
  if (words) { words.click(); await sleep(400) }
  out.wordsScreenAfterTappingWords = !!$('.kv-wordscreen')
  return out
}

async function scenarioEndingReplay() {
  await fresh()
  $('.kv-choice.kv-listen').click()
  await until(() => $('.kv-next'), 3000)
  await sleep(500)
  for (let i = 0; i < 30 && !$('.kv-next.finish'); i++) { $('.kv-next').click(); await sleep(120) }
  await reachEnding()
  await sleep(1200)
  const before = log.filter((e) => e.ev === 'playing' && e.kind === 'narr').length
  $('.kv-replay')?.click()
  await sleep(2500)
  return {
    narrationRestartedFromReplay: log.filter((e) => e.ev === 'playing' && e.kind === 'narr').length > before,
    endChoicesGoneAfterReplay: !$('.kv-wordsbtn'),
    pageAfterReplayIsFirst: [...document.querySelectorAll('.kv-dot')].indexOf($('.kv-dot.on')) === 0,
  }
}

async function scenarioFeedbackKeyboard() {
  await fresh()
  $('.kv-choice.kv-listen')?.click()
  const readingReady = await until(() => $('.kv-text') && visibleWords() > 0 && $('.kv-dot.on') && $('.fb-pill'), 4000)
  if (!readingReady) return { readingPagePresent: false, feedbackTextareaPresent: false, textareaFocused: false, editableKeyLeftPageAlone: false, feedbackClosed: false, focusReturnedToOpener: false }
  const page = () => [...document.querySelectorAll('.kv-dot')].indexOf($('.kv-dot.on'))
  const opener = $('.fb-pill')
  opener.focus()
  opener.click()
  const textareaReady = await until(() => $('.fb-card textarea'), 2000)
  if (!textareaReady) return { readingPagePresent: true, feedbackTextareaPresent: false, textareaFocused: false, editableKeyLeftPageAlone: false, feedbackClosed: false, focusReturnedToOpener: false }
  const field = $('.fb-card textarea')
  const before = page()
  field.focus()
  const textareaFocused = document.activeElement === field
  field.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true, cancelable: true }))
  await sleep(100)
  const editableKeyLeftPageAlone = textareaFocused && before >= 0 && page() === before
  field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
  await until(() => !$('.fb-card'), 2000)
  return { readingPagePresent: true, feedbackTextareaPresent: true, textareaFocused, editableKeyLeftPageAlone, feedbackClosed: !$('.fb-card'), focusReturnedToOpener: document.activeElement === opener }
}

export async function runAll() {
  const out = {}
  out.listen_tapped_at_once = await scenarioListen({ patient: false })
  out.listen_tapped_after_welcome = await scenarioListen({ patient: true })
  out.self = await scenarioSelf()
  out.ending = await scenarioEnding()
  out.ending_replay = await scenarioEndingReplay()
  out.feedback_keyboard = await scenarioFeedbackKeyboard()
  out.checks = [
    { name: 'listen choice reaches narrated audio', passed: out.listen_tapped_at_once.msFromTapToFirstNarratedWord !== null },
    { name: 'spoken prompts never overlap narration', passed: !out.listen_tapped_at_once.overlaps.length && !out.listen_tapped_after_welcome.overlaps.length && !out.self.overlaps.length,
      detail: JSON.stringify([out.listen_tapped_at_once.overlaps, out.listen_tapped_after_welcome.overlaps, out.self.overlaps]) },
    { name: 'Replay restarts narration', passed: out.ending_replay.narrationRestartedFromReplay },
    { name: 'Feedback keyboard fixture has a reading page and focused textarea', passed: out.feedback_keyboard.readingPagePresent && out.feedback_keyboard.feedbackTextareaPresent && out.feedback_keyboard.textareaFocused },
    { name: 'editable Feedback controls do not turn kid pages', passed: out.feedback_keyboard.editableKeyLeftPageAlone },
    { name: 'closing Feedback returns focus to its opener', passed: out.feedback_keyboard.feedbackClosed && out.feedback_keyboard.focusReturnedToOpener },
  ]
  out.behaviors = [{ name: 'tapping Words to know opens that screen', matched: out.ending.wordsScreenAfterTappingWords }]
  location.hash = '#/'
  return out
}
export { scenarioListen, scenarioSelf, scenarioEnding, scenarioEndingReplay }

// Run with BLOCKED=1 (Chrome refuses sound until a real tap): the refusal must leave a visible retry control
// and passage text. Pulse styling and hint counts describe today's design.
export async function scenarioBlocked() {
  await fresh()
  const at = Math.round(performance.now() - t0)
  $('.kv-choice.kv-listen').click()
  await sleep(1200)
  const early = { playButtonPulsing: !!$('.kv-play.pulse'), playing: !!$('.kv-play.playing'), promptsSoFar: keys(prompts(at)) }
  await sleep(7500)
  const narrationAttempts = () => log.filter((e) => e.ev === 'play()' && e.kind === 'narr').length
  const refusedAttempts = log.filter((e) => e.ev === 'play-rejected' && e.kind === 'narr')
  const audioRefused = narrationAttempts() > 0 && refusedAttempts.length > 0 && !log.some((e) => e.ev === 'playing' && e.kind === 'narr')
  const retry = $('.kv-problem-btn')
  const retryVisible = !!retry && retry.getClientRects().length > 0 && getComputedStyle(retry).visibility !== 'hidden'
  const retryUsable = retryVisible && !retry.disabled && retry.tabIndex >= 0 && !!(retry.getAttribute('aria-label') || retry.textContent.trim())
  const after8_7s = { playButtonPulsing: !!$('.kv-play.pulse'), hints: keys(prompts(at)) }
  const attemptsBeforeRetry = narrationAttempts()
  if (retryUsable) retry.click()
  const retryAttempted = retryUsable && !!(await until(() => narrationAttempts() > attemptsBeforeRetry, 2000))
  const out = { early, after8_7s, audioRefused, refusedAttempts, retryVisible, retryUsable, retryAttempted, textStillShown: !!$('.kv-text') && visibleWords() > 0 }
  out.checks = [{ name: 'blocked audio leaves a working retry control and passage text', passed: out.audioRefused && out.retryUsable && out.retryAttempted && out.textStillShown,
    detail: JSON.stringify({ refusedAttempts: out.refusedAttempts, retryVisible: out.retryVisible, retryUsable: out.retryUsable, retryAttempted: out.retryAttempted, textStillShown: out.textStillShown }) }]
  out.behaviors = [{ name: 'blocked audio pulses the play button', matched: out.after8_7s.playButtonPulsing }]
  return out
}

// Needs AUDIT_JS=<path to loops_2026-10-31/l3_accessibility/audit.js> (the runner hands it to the page).
export async function scenarioAudit() {
  await fresh()
  const out = {}
  out.start = await window.__audit('kid start')
  $('.kv-choice.kv-listen').click()
  await sleep(1500)
  out.reading = await window.__audit('kid reading')
  for (let i = 0; i < 30 && !$('.kv-next.finish'); i++) { $('.kv-next').click(); await sleep(120) }
  await reachEnding()
  await sleep(600)
  out.ending = await window.__audit('kid ending')
  $('.kv-wordsbtn')?.click()
  await sleep(600)
  out.words = await window.__audit('kid words')
  return out
}

// For a picture (SHOT=<png> in the runner): stop on the ending screen.
export async function scenarioShot() {
  await fresh()
  $('.kv-choice.kv-listen').click()
  await sleep(1500)
  for (let i = 0; i < 30 && !$('.kv-next.finish'); i++) { $('.kv-next').click(); await sleep(120) }
  await reachEnding()
  await sleep(800)
  const b = $('.kv-wordsbtn'); return b ? [getComputedStyle(b).fontSize, getComputedStyle(b.querySelector('span')).fontSize, getComputedStyle(document.documentElement).fontSize] : 'no btn'
}

// "Tap one to hear it" must be true on a word card that has a syllable guide: tapping its word plays the word.
export async function scenarioWordsTap() {
  await fresh()
  $('.kv-choice.kv-listen').click()
  await sleep(1000)
  for (let i = 0; i < 30 && !$('.kv-next.finish'); i++) { $('.kv-next').click(); await sleep(120) }
  await reachEnding()
  await sleep(500)
  $('.kv-wordsbtn')?.click()
  await sleep(500)
  const cards = [...document.querySelectorAll('.kv-wcard')]
  const out = []
  for (const c of cards) {
    const hear = c.querySelector('.kv-wcard-hear') || c.querySelector('button.kv-wcard-main')
    const before = log.length
    hear?.click()
    await sleep(700)
    out.push({ word: c.querySelector('.kv-wcard-word')?.textContent, guided: !!c.querySelector('.kv-wcard-hear'), playsAfterTap: log.slice(before).filter((e) => e.ev === 'play()').length })
  }
  return out
}

// Probe (not part of runAll): in listen mode, with narration auto-started, does "Choose a word" still reach every word?
export async function probeChoose() {
  await fresh()
  $('.kv-choice.kv-listen').click()
  await sleep(300)
  const vis = () => [...document.querySelectorAll('.kv-text .sa-w:not(.sa-unread)')].filter((e) => e.getClientRects().length > 0)
  const out = { wordsAtStart: vis().length, dot: [...document.querySelectorAll('.kv-dot')].indexOf($('.kv-dot.on')) }
  const c = $('[aria-label^="Choose a word"]'); c.focus(); c.click(); await sleep(150)
  out.wordsAfterChoose = vis().length
  out.dotAfterChoose = [...document.querySelectorAll('.kv-dot')].indexOf($('.kv-dot.on'))
  out.playingAfterChoose = !!$('.kv-play.playing')
  const seen = new Set()
  for (let i = 0; i < 30; i++) {
    const a = document.activeElement; if (a?.classList.contains('sa-w')) seen.add(a)
    a.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }))
    await sleep(5)
  }
  out.seen = seen.size
  out.wordsNow = vis().length
  return out
}
