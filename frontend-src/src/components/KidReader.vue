<script setup>
// The kid reading screen. The passage is PAGED to fit the screen (no
// scrolling). The SoundAlong engine is reused as is: it owns the audio clock, the highlight and the "pin" rule.
// The view owns measurement, pointer events, the definition bubble, and voice hints;
// pure page, selection, and sync decisions live in src/kid/.
import { ref, reactive, shallowRef, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { SoundAlong } from '../soundAlong'
import { assetUrl } from '../api'
import { HoldDetector } from '../hold'
import { findDefinition } from '../defs'
import { helpChoice } from '../helpPolicy'
import { vocabItem } from '../review'
import ReviewMark from './ReviewMark.vue'
import SyllableGuide from './SyllableGuide.vue'
import { turnPlan, finishPlan } from '../pageSync'
import RehearseKid from './RehearseKid.vue'
import { record, trackPlayback } from '../usage'
import { PUBLIC_SAMPLE } from '../mode'
import { sentenceGroups, planPages, pageMaps } from '../kid/pages'
import { nearestWord, stepWord, adjacentLineWord } from '../kid/select'
import { pageForNarration, pageForAnchor } from '../kid/sync'
import { leadSpans } from './LeadWords'

const props = defineProps({
  data: Object, gloss: Object, kid: Object, syllables: Object, mode: String, settings: Object,
  voice: Object, prompts: Object, visit: Object, passageId: String, autoWords: Boolean,
})
const emit = defineEmits(['home', 'done'])

const listen = computed(() => props.mode === 'listen')
const help = helpChoice()
const HOLD_MS = 500

const textEl = ref(null)
const pageEl = ref(null)
const stageEl = ref(null)
const bubbleEl = ref(null)
const guideEl = ref(null)
const page = ref(0)
const pageCount = ref(1)
const lineGuide = shallowRef(null)
const ending = ref(false)
const state = reactive({ playing: false, time: 0, duration: 0, rate: props.settings.rate, voiceId: '', error: '' })
const pressed = ref(false)
// The big button pulses when it is the way forward: nothing played yet, or the browser refused the sound.
const refused = ref(false) // "Read to me" asked for sound and none started (the browser said no, or the file didn't load)
const pulse = computed(() => listen.value && !state.playing && !ending.value && (!props.visit.played || refused.value || !!state.error))
const meaningOffer = shallowRef(null)
let meaningOfferTimer = 0
let meaningOfferHinted = false
const bubble = shallowRef(null) // { word, text, clips, left, top, below, arrow }
const autoAnnounced = new Set()
let autoTimer = 0
watch(() => props.autoWords, (on) => { if (!on && bubble.value?.auto) closeBubble() })
const flash = ref(null)
let flashN = 0
let engine = null
const engineRef = shallowRef(null) // same engine, reactive for the sentence-practice control
let ro = null
let destroyed = false
let userPaused = false // the child pressed pause (so a stopped narration is not a refused one)

/* ---------- the text: title, byline, one small picture, then ReadWorks' paragraphs ---------- */
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// ReadWorks leaves some punctuation outside the word spans (the "." after a vocabulary word, an opening quote).
// Wrap each such run in an unread span so paging can hide and show it together with its neighbors.
function wrapStray(el) {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  const nodes = []
  while (walker.nextNode()) {
    const n = walker.currentNode
    if (/\S/.test(n.nodeValue) && !n.parentElement.closest('.sa-w')) nodes.push(n)
  }
  for (const n of nodes) {
    const frag = document.createDocumentFragment()
    for (const part of n.nodeValue.split(/(\s+)/)) {
      if (!part) continue
      if (/^\s+$/.test(part)) frag.appendChild(document.createTextNode(part))
      else {
        const sp = document.createElement('span')
        sp.className = 'sa-w sa-unread kv-tx'
        sp.textContent = part
        frag.appendChild(sp)
      }
    }
    n.parentNode.replaceChild(frag, n)
  }
  return el
}

const textHtml = computed(() => {
  const d = props.data
  const tw = d.title_words || []
  const bw = d.by_words || []
  const doc = new DOMParser().parseFromString(d.html, 'text/html')
  const img = doc.querySelector('figure img')
  const alt = img?.getAttribute('alt') || ''
  const src = img?.getAttribute('src') || ''
  const blocks = [...doc.body.querySelectorAll('p, h2, h3, h4, li')]
    .filter((el) => !el.closest('figure'))
    .map(wrapStray)
    .map((el) => `<p class="kv-p${/^H/.test(el.tagName) ? ' kv-sub' : ''}">${el.innerHTML}</p>`)
    .join('')
  const fig = img
    ? `<figure class="kv-fig"><span class="kv-fig-ph"><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M21 19V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2zM8.5 13.5l2.5 3 3.5-4.5 4.5 6H5z"/></svg><span>${esc(alt)}</span></span>` +
      `<img src="${esc(assetUrl(src))}" alt="${esc(alt)}" onerror="this.style.display='none'"></figure>`
    : ''
  return (
    `<h1 class="kv-title">${leadSpans(tw, 0)}</h1>` +
    (bw.length ? `<p class="kv-by">${leadSpans(bw, tw.length)}</p>` : '') +
    fig +
    blocks
  )
})

/* ---------- pagination ---------- */
let allWords = [] // every .sa-w (read aloud or not), DOM order
let blocks = [] // children of the text container
let blockOfWord = new Map()
let figEl = null
let elPage = new Map() // word span -> page
let blockPages = new Map() // block -> Set of pages
let kPage = [] // narrated word k -> page
let pageFirstK = [] // page -> first narrated word k
let visibleNarrated = [] // narrated spans on the shown page (for tap-in-the-gap)

// Measure candidate pages in the DOM; src/kid/pages.js decides where to split them.
function layout(sentences, imgScale) {
  const root = textEl.value
  const avail = pageEl.value.clientHeight
  root.style.setProperty('--img-s', String(imgScale))
  return planPages(sentences, (pageIndex, candidates) => {
    const visible = new Set(candidates)
    for (const word of allWords) word.classList.toggle('kv-h', !visible.has(word))
    for (const block of blocks) {
      if (block === figEl) block.classList.toggle('kv-h', pageIndex !== 0)
      else block.classList.toggle('kv-h', !candidates.some((word) => blockOfWord.get(word) === block))
    }
    return root.offsetHeight <= avail
  })
}

function paginate() {
  const root = textEl.value
  if (!root || !pageEl.value || !pageEl.value.clientHeight) return
  const sentences = sentenceGroups(allWords, (el) => blockOfWord.get(el), (el) => el.textContent)
  let pages = []
  // The first page holds title + byline + picture. If not even the first sentence fits, shrink the picture.
  for (const scale of [1, 0.7, 0.45]) {
    pages = layout(sentences, scale)
    const body = pages[0]?.some((w) => blockOfWord.get(w).classList.contains('kv-p'))
    if (body || pages.length <= 1) break
  }
  const maps = pageMaps(pages, (word) => blockOfWord.get(word), (word) => engine?.index.get(word))
  elPage = maps.elPage
  blockPages = maps.blockPages
  pageCount.value = Math.max(1, pages.length)
  kPage = maps.kPage
  pageFirstK = maps.pageFirstK
}

function applyPage(p) {
  for (const w of allWords) w.classList.toggle('kv-h', elPage.get(w) !== p)
  for (const b of blocks) {
    if (b === figEl) b.classList.toggle('kv-h', p !== 0)
    else b.classList.toggle('kv-h', !blockPages.get(b)?.has(p))
  }
  visibleNarrated = allWords.filter((w) => elPage.get(w) === p && !w.classList.contains('sa-unread'))
  syncPickables()
  updateLineGuide()
}

// A quiet ruler under the line containing the spoken word. It has no focus stop or speech output;
// the existing word highlight remains the precise current-place cue.
function updateLineGuide() {
  if (!props.settings.lineGuide || !pageEl.value || !textEl.value || !engine?.curEl ||
      elPage.get(engine.curEl) !== page.value || ending.value) {
    lineGuide.value = null
    return
  }
  const word = engine.curEl.getClientRects()[0]
  const area = pageEl.value.getBoundingClientRect()
  const text = textEl.value.getBoundingClientRect()
  if (!word || word.bottom < area.top || word.top > area.bottom) {
    lineGuide.value = null
    return
  }
  lineGuide.value = {
    top: Math.min(area.height - 4, Math.max(0, word.bottom - area.top + 3)),
    left: Math.max(0, text.left - area.left),
    width: Math.min(text.width, area.width),
  }
}

function setup() {
  const root = textEl.value
  blocks = [...root.children]
  figEl = root.querySelector('.kv-fig')
  allWords = [...root.querySelectorAll('.sa-w')]
  blockOfWord = new Map()
  for (const w of allWords) {
    let n = w
    while (n.parentElement && n.parentElement !== root) n = n.parentElement
    blockOfWord.set(w, n)
  }
}

function repaginate() {
  if (!textEl.value || !allWords.length) return
  const anchorK = state.playing && engine?.curK >= 0 ? engine.curK : pageFirstK[page.value]
  // laying the pages out hides every word for a moment, which drops keyboard focus: put it back afterwards
  const hadFocus = choosing.value && document.activeElement?.classList?.contains('sa-w')
  paginate()
  page.value = pageForAnchor(anchorK, page.value, pageCount.value, kPage)
  applyPage(page.value)
  if (hadFocus) {
    const el = pickEl && visibleNarrated.includes(pickEl) ? pickEl : visibleNarrated[0]
    if (el) setPick(el)
    else chooseBtn.value?.focus({ preventScroll: true })
  }
}

let rpTimer = 0
function repaginateSoon() {
  clearTimeout(rpTimer)
  rpTimer = setTimeout(repaginate, 120)
}

// `manual` = the child turned the page (arrow, swipe, key). What they see and what they hear must agree, so
// narration that was going carries on from the first word of the page now showing (src/pageSync.js).
function goPage(p, { fromTurn = true, manual = false } = {}) {
  clearMeaningOffer()
  const np = Math.max(0, Math.min(pageCount.value - 1, p))
  if (np === page.value) return
  const focused = document.activeElement
  const focusedWord = textEl.value?.contains(focused)
  closeBubble()
  page.value = np
  applyPage(np)
  // Hiding the old page can remove focus from its word or Previous button.
  nextTick(() => {
    if (destroyed) return
    if (focusedWord && choosing.value) {
      const el = pickEl && visibleNarrated.includes(pickEl) ? pickEl : visibleNarrated[0]
      if (el) setPick(el)
      else chooseBtn.value?.focus({ preventScroll: true })
    } else if (focused && (focusedWord || (focused.classList?.contains('kv-prev') && np === 0)) &&
      (focusedWord || focused.disabled || np === 0)) {
      stageEl.value?.querySelector('.kv-next:not(:disabled)')?.focus({ preventScroll: true })
    }
  })
  announce(`Page ${np + 1} of ${pageCount.value}.`)
  if (manual && engine) {
    const plan = turnPlan({ listen: listen.value, playing: state.playing, firstK: pageFirstK[np] })
    if (plan === 'play-page') engine.playFrom(pageFirstK[np])
    else if (plan === 'pause') engine.pause()
  }
  if (fromTurn) armHint() // (a page turn is a touch: idle time starts over; no spoken hint comes with it)
}
const atEnd = computed(() => page.value >= pageCount.value - 1)
function next() {
  if (ending.value) return
  if (atEnd.value) finish()
  else goPage(page.value + 1, { manual: true })
}
function prev() {
  if (ending.value) { ending.value = false; armHint(); return } // the back arrow leaves the end choices
  goPage(page.value - 1, { manual: true })
}

/* ---------- the one help hint ---------- */
// At most ONE spoken hint per visit, and only after a few seconds of quiet while NOTHING is being read: never while
// narration plays, never at a page turn. It names something that is on screen right now: the pulsing big button when
// the sound didn't start, or "tap any word" when a voice is available.
const HINT_IDLE_MS = 6000
let hintTimer = 0
function armHint() {
  clearTimeout(hintTimer)
  if (props.visit.hinted || destroyed || ending.value) return
  hintTimer = setTimeout(sayHint, HINT_IDLE_MS)
}
function sayHint() {
  if (props.visit.hinted || destroyed || ending.value || state.playing || bubble.value || props.prompts.speaking) return
  props.visit.hinted = true
  props.prompts.say(listen.value && (!props.visit.played || refused.value || state.error) ? 'tap_play' : 'tap_word')
}

/* ---------- play / pause (top rail) ---------- */
function interrupt() { props.prompts.interrupt() }

function togglePlay() {
  if (!engine || ending.value) return
  interrupt()
  closeBubble()
  props.visit.played = true
  state.error = ''
  refused.value = false
  userPaused = state.playing
  if (state.playing) {
    engine.pause() // pausing is quiet: interrupt() above also cut any spoken hint
    return
  }
  playShownPage()
}
// Play from where the audio is, or from the top of the page that is showing.
function playShownPage() {
  const cur = engine.curK
  if (cur >= 0 && kPage[cur] === page.value) engine.resume()
  else {
    // Narration is somewhere else (or hasn't started): read from the top of the page that is showing.
    const k = pageFirstK[page.value]
    engine.playFrom(k !== undefined ? k : 0)
  }
}

// Audio trouble: say so on screen, and give the child (or a grown-up) a button that tries again.
const hasVoices = computed(() => (props.data.voices || []).length > 0)
const problem = computed(() => {
  if (ending.value) return null
  if (!hasVoices.value) return listen.value ? { text: 'This story has no voice yet.', retry: false } : null
  if (state.error) return { text: 'The voice will not play right now.', retry: true }
  return null
})
function retryAudio() {
  interrupt()
  props.visit.played = true
  engine?.retry()
}

let lastDown = 0
function onPlayDown(e) {
  if (e.button > 0) return
  lastDown = performance.now()
  pressed.value = true
  togglePlay()
  setTimeout(() => { pressed.value = false }, 180)
}
function onPlayClick() {
  // keyboard (Space / Enter) arrives as a click with no pointerdown just before it
  if (performance.now() - lastDown < 700) return
  togglePlay()
}

function showFlash(x, y, icon) {
  flash.value = { x, y, icon, n: ++flashN }
  const n = flashN
  setTimeout(() => { if (flash.value?.n === n) flash.value = null }, 650)
}

function startOver() {
  interrupt()
  closeBubble()
  autoAnnounced.clear()
  ending.value = false
  goPage(0, { fromTurn: false })
  if (listen.value && engine) {
    props.visit.played = true
    engine.rewind()
    engine.playFrom(pageFirstK[0] ?? 0)
  }
  record('replay', props.passageId)
}

function goHome() {
  interrupt()
  engine?.pause()
  emit('home')
}

/* ---------- the end ---------- */
// The last page STAYS. The rail turns into three big choices (read again / words from the story / home); nothing
// moves on by itself. "Words to know" opens only when the child taps it.
let heardEnd = false // the narration reached its very end at least once
function finish({ force = false } = {}) {
  if (ending.value || destroyed) return
  if (!force) {
    // The star must not end the story before the last page has been heard (src/pageSync.js).
    const last = pageCount.value - 1
    const plan = finishPlan({
      listen: listen.value,
      hasNarration: !!engine && !state.error,
      heardEnd,
      playingLastPage: state.playing && engine?.curK >= 0 && kPage[engine.curK] === last,
      lastFirstK: pageFirstK[last],
    })
    if (plan === 'keep-listening') return
    if (plan === 'play-last') {
      interrupt()
      closeBubble()
      props.visit.played = true
      playShownPage()
      return
    }
  }
  exitChoose({ quiet: true }) // the keyboard mode and its buttons give way to the end choices
  ending.value = true
  clearTimeout(hintTimer)
  closeBubble()
  engine?.pause()
  props.prompts.say('the_end')
  // the star (or a Tab stop that just went away) held keyboard focus: put it on "read again" so it isn't lost
  nextTick(() => {
    const a = document.activeElement
    if (!a || a === document.body || a.closest?.('.kv-next')) replayBtn.value?.focus({ preventScroll: true })
  })
}
function toWords() {
  interrupt()
  emit('done')
}

/* ---------- finding the word under a finger ---------- */
function wordAt(x, y) {
  const hit = document.elementFromPoint(x, y)?.closest?.('.sa-w:not(.sa-unread)')
  if (hit && textEl.value.contains(hit)) return hit
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
  const tol = 1.5 * rem // about 24 px, scaled with the screen
  const lh = parseFloat(getComputedStyle(textEl.value).lineHeight) || 40
  return nearestWord(visibleNarrated, (word) => word.getClientRects(), x, y, tol, lh)
}

/* ---------- touch: tap, press-and-hold, swipe ---------- */
let down = null
let swallow = false
// Press-and-hold timing is shared with the teacher page (src/hold.js)
const hold = new HoldDetector({
  ms: HOLD_MS,
  moveLimit: () => 0.75 * (parseFloat(getComputedStyle(document.documentElement).fontSize) || 16),
  onHold: () => holdFire(down),
})

function onDown(e) {
  if (e.button > 0 || ending.value) return
  if (e.target.closest('button, .kv-bubble')) return
  e.preventDefault()
  try { stageEl.value.setPointerCapture(e.pointerId) } catch { /* not essential */ }
  if (swallow) { swallow = false; down = { dead: true }; return }
  const el = wordAt(e.clientX, e.clientY)
  down = { x: e.clientX, y: e.clientY, t: performance.now(), el, moved: false, held: false, timer: 0 }
  if (el) {
    el.classList.add('kv-pressing')
    hold.down(el, e.clientX, e.clientY)
  }
}
function onMove(e) {
  const d = down
  if (!d || d.dead || d.moved) return
  hold.move(e.clientX, e.clientY)
  if (hold.moveLimit() < Math.hypot(e.clientX - d.x, e.clientY - d.y)) {
    d.moved = true
    d.el?.classList.remove('kv-pressing')
  }
}
function onUp(e) {
  const d = down
  down = null
  if (!d || d.dead) return
  hold.up()
  d.el?.classList.remove('kv-pressing')
  if (d.held) return
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
  const dx = e.clientX - d.x
  const dy = e.clientY - d.y
  const dt = performance.now() - d.t
  if (Math.abs(dx) > 3.5 * rem && Math.abs(dx) > 1.5 * Math.abs(dy) && dt < 1000) {
    interrupt()
    if (dx < 0) next()
    else prev()
    return
  }
  if (d.moved) return
  if (dt > 900 && !d.el) return
  tap(d.el, e)
}
function onCancel() {
  const d = down
  down = null
  if (d && !d.dead) {
    hold.cancel()
    d.el?.classList.remove('kv-pressing')
  }
}

function tap(el, e) {
  if (!engine) return
  clearMeaningOffer()
  interrupt()
  if (el) {
    const k = engine.index.get(el)
    if (k === undefined) return
    if (choosing.value && visibleNarrated.includes(el)) setPick(el, { focus: false })
    if (listen.value) {
      props.visit.played = true
      engine.playFrom(k) // pin rule lives in the engine: never highlights a word before this one
    } else if (!PUBLIC_SAMPLE || hasVoices.value) engine.playSnippet(k) // Read on my own: just this one word
    record('word_tap', props.passageId)
    offerMeaning(el)
    return
  }
  // blank space: pause / resume with a flash, like the teacher page
  if (listen.value) {
    const willPlay = !state.playing
    togglePlay()
    showFlash(e.clientX, e.clientY, willPlay ? 'play' : 'pause')
  }
}

function clearMeaningOffer() {
  clearTimeout(meaningOfferTimer)
  meaningOffer.value = null
}
function offerMeaning(el) {
  const def = findDefinition(el, { gloss: props.gloss, kid: props.kid,
    passageId: props.passageId, vocab: props.data.vocab, syllables: props.syllables, help })
  if (!def) return
  meaningOffer.value = { el, word: def.word }
  if (!meaningOfferHinted) { announce('Meaning button above the story.'); meaningOfferHinted = true }
  meaningOfferTimer = setTimeout(() => {
    if (!document.activeElement?.classList?.contains('kv-meaning-offer')) clearMeaningOffer()
  }, 5000)
}
function offeredMeaning() {
  const el = meaningOffer.value?.el
  clearMeaningOffer()
  if (el) showMeaning(el)
}

/* ---------- press and hold: the definition bubble ---------- */
function holdFire(d) {
  if (!d || down !== d || d.moved || !d.el) return
  d.held = true
  d.el.classList.remove('kv-pressing')
  showMeaning(d.el)
}
// The meaning of one word: pauses the story, then shows the definition bubble and plays clips when available.
// Shared by press-and-hold and the keyboard "Meaning" action. Returns the entry or null.
function showMeaning(el) {
  clearMeaningOffer()
  interrupt()
  engine?.pause()
  const def = markSampleVocab(findDefinition(el, { gloss: props.gloss, kid: props.kid, passageId: props.passageId, vocab: props.data.vocab, syllables: props.syllables, sayFallback: true, help }))
  if (def?.guide) {
    // the guide says the word itself; don't also play ReadWorks' recording of it
    const say = props.data.vocab?.[def.sid]?.say
    def.clips = def.clips.filter((c) => c !== say)
  }
  if (!def) {
    const k = engine?.index.get(el)
    if (k !== undefined && (!PUBLIC_SAMPLE || hasVoices.value)) engine.playSnippet(k) // no definition: just say the word
    announce(`${el.textContent.trim()}. No meaning for this word yet.${PUBLIC_SAMPLE && !hasVoices.value ? ' This sample has no recording.' : ' Playing the word.'}`)
    return null
  }
  openBubble(el, def)
  announce(`Meaning of ${def.word}. ${def.text}`)
  return def
}

function markSampleVocab(def) {
  if (!PUBLIC_SAMPLE || !def?.sid || def.items?.length || def.text !== props.data.vocab?.[def.sid]?.definition) return def
  const item = vocabItem(props.passageId, def.sid, props.data.vocab[def.sid], props.kid?.vocab?.[props.passageId]?.[def.sid])
  return { ...def, items: item ? [item] : [] }
}

let heldEl = null
async function openBubble(el, def) {
  closeBubble()
  heldEl = el
  el.classList.add('kv-held')
  bubble.value = { ...def, left: 0, top: -9999, below: false, arrow: 0 }
  record('word_card_opened', props.passageId)
  await nextTick()
  placeBubble()
  speakBubble()
}
function placeBubble() {
  const b = bubble.value
  const bEl = bubbleEl.value
  if (!b || !bEl || !heldEl) return
  const r = heldEl.getBoundingClientRect()
  const w = bEl.offsetWidth
  const h = bEl.offsetHeight
  const gap = 12
  const topLimit = stageEl.value.getBoundingClientRect().top + 8
  const above = r.top - gap - h >= topLimit
  const top = above ? r.top - gap - h : Math.min(window.innerHeight - h - 8, r.bottom + gap)
  const cx = (r.left + r.right) / 2
  const left = Math.max(8, Math.min(window.innerWidth - w - 8, cx - w / 2))
  bubble.value = { ...b, left, top, below: !above, arrow: Math.max(24, Math.min(w - 24, cx - left)) }
}
async function speakBubble() {
  const b = bubble.value
  if (!b) return
  const g = guideEl.value
  if (g) {
    // vocabulary word: the word first (syllables light up); the spoken meaning follows in onGuideDone
    interrupt()
    g.playWhole()
    return
  }
  if (b.clips.length) props.prompts.speakNow(b.clips)
  else {
    const k = heldEl ? engine?.index.get(heldEl) : undefined
    interrupt()
    if (k !== undefined && (!PUBLIC_SAMPLE || hasVoices.value)) engine.playSnippet(k)
  }
}
function onGuideDone(e) {
  const b = bubble.value
  if (e.mode === 'whole' && e.completed && b?.clips.length) props.prompts.speakNow(b.clips)
}
function onGuideStart() {
  props.prompts.interrupt()
  engine?.pause()
}
function closeBubble() {
  clearTimeout(autoTimer)
  if (!bubble.value && !heldEl) return
  heldEl?.classList.remove('kv-held')
  heldEl = null
  if (bubble.value) { const wasAuto = bubble.value.auto; bubble.value = null; if (!wasAuto) interrupt() }
}
// A tap outside closes the bubble; a word tap still plays from that word.
function onDocDown(e) {
  if (!bubble.value) return
  if (e.target.closest?.('.kv-bubble')) return
  swallow = !bubble.value.auto && !!e.target.closest?.('.kv-stage') && !e.target.closest('button, .sa-w')
  closeBubble()
}

/* ---------- keyboard: "Choose a word" (arrows move between words; no pointer, no timed hold) ---------- */
// A button in the top rail turns this mode on (it is a normal Tab stop, so keyboards and switch scanning reach it).
// In the mode every word on the shown page is a Tab stop and the arrows also move between words.
//   Enter / Space = hear from here when a voice exists   M or the Meaning button = the meaning
//   Up / Down = line above / below   Home / End = first / last word   PageUp / PageDown = turn the page   Esc = back
// Outside the mode the arrows still turn pages, as before.
const choosing = ref(false)
const pickText = ref('')
const srMsg = ref('')
const chooseBtn = ref(null)
const replayBtn = ref(null)
let pickEl = null
let hinted = false
let srTimer = 0

// A polite announcement for screen readers (a visually hidden live region). Cleared first so repeats are read again.
function announce(msg) {
  clearTimeout(srTimer)
  srMsg.value = ''
  srTimer = setTimeout(() => { srMsg.value = msg }, 40)
}
const pickHint = computed(() =>
  ((!PUBLIC_SAMPLE || hasVoices.value) ? (listen.value ? 'Press Enter to hear from here. ' : 'Press Enter to hear this word. ') : '') +
  'Press M for the meaning. Press the arrow keys to move to another word. Press Escape to stop choosing.')

// Words on the shown page become keyboard stops only while choosing (so the page is not hundreds of Tab stops otherwise).
function syncPickables() {
  for (const w of allWords) {
    if (w.hasAttribute('tabindex')) {
      w.removeAttribute('tabindex')
      w.removeAttribute('role')
    }
  }
  if (!choosing.value) return
  for (const w of visibleNarrated) {
    w.setAttribute('tabindex', '0')
    w.setAttribute('role', 'button')
  }
  if (!pickEl || !visibleNarrated.includes(pickEl)) setPick(visibleNarrated[0] || null, { focus: false })
}

function setPick(el, { focus = true } = {}) {
  if (pickEl && pickEl !== el) {
    pickEl.classList.remove('kv-pick')
    pickEl.removeAttribute('aria-describedby')
  }
  pickEl = el
  pickText.value = el ? el.textContent.trim() : ''
  if (!el) return
  el.classList.add('kv-pick')
  // the instructions are read once on the first word, not again on every move
  if (!hinted) el.setAttribute('aria-describedby', 'kv-pick-hint')
  else el.removeAttribute('aria-describedby')
  if (focus) {
    el.focus({ preventScroll: true })
    hinted = true
  }
}

function enterChoose() {
  if (ending.value || choosing.value) return
  interrupt()
  closeBubble()
  if (state.playing) engine?.pause()
  choosing.value = true
  hinted = false
  syncPickables()
  // start on the word being read, if it is on this page; else the first word
  const k = engine?.curK ?? -1
  const cur = k >= 0 ? visibleNarrated.find((w) => engine.index.get(w) === k) : null
  setPick(cur || visibleNarrated[0] || null)
  announce(`Choosing a word. Page ${page.value + 1} of ${pageCount.value}.`)
}
function exitChoose({ quiet = false } = {}) {
  if (!choosing.value) return
  closeBubble()
  interrupt()
  choosing.value = false
  syncPickables()
  pickEl?.classList.remove('kv-pick')
  pickEl?.removeAttribute('aria-describedby')
  pickEl = null
  pickText.value = ''
  if (quiet) return
  chooseBtn.value?.focus({ preventScroll: true })
  announce('Stopped choosing a word.')
}
function toggleChoose() {
  if (choosing.value) exitChoose()
  else enterChoose()
}

function stepPick(dir) {
  const next = stepWord(visibleNarrated, pickEl, dir)
  if (!next) {
    announce(dir > 0 ? 'Last word on this page. Press Page Down for the next page.' : 'First word on this page. Press Page Up for the previous page.')
    return
  }
  setPick(next)
}
// Up / Down: the word on the neighboring line whose middle is closest across.
function linePick(dir) {
  if (!pickEl?.getClientRects()[0]) return
  const best = adjacentLineWord(visibleNarrated, pickEl, dir, (word) => word?.getClientRects()[0])
  if (!best) {
    announce(dir > 0 ? 'Last line on this page. Press Page Down for the next page.' : 'First line on this page. Press Page Up for the previous page.')
    return
  }
  setPick(best)
}

// Tab (or a switch's "next") lands on a word: that word becomes the chosen one.
function onTextFocus(e) {
  const w = e.target
  if (!choosing.value || !w?.classList?.contains('sa-w') || w === pickEl || !visibleNarrated.includes(w)) return
  setPick(w, { focus: false })
  hinted = true
}

function hearFromHere() {
  if (!pickEl || !engine) return
  closeBubble()
  tap(pickEl, null)
}
function askMeaning() {
  const el = pickEl
  if (!el) return
  if (bubble.value && heldEl === el) { interrupt(); speakBubble(); return } // again: say it again
  showMeaning(el)
  el.focus({ preventScroll: true })
}

// PageUp / PageDown turn the page without ever starting or ending the story (the star does that).
function turnPage(dir) {
  const np = page.value + dir
  if (np < 0 || np >= pageCount.value) {
    announce(dir > 0 ? 'This is the last page. Use the star button to finish.' : 'This is the first page.')
    return
  }
  interrupt()
  goPage(np)
}

// When pagination changes the current page while choosing, keep the pick on the shown page.
watch(page, async () => {
  if (!choosing.value) return
  await nextTick()
  const a = document.activeElement
  const lost = !a || a === document.body || a.classList?.contains('sa-w')
  const el = pickEl && visibleNarrated.includes(pickEl) ? pickEl : visibleNarrated[0]
  if (el) setPick(el, { focus: lost })
})

function onKey(e) {
  if (document.querySelector('.kv-panel, .fb-scrim')) return
  if (e.target?.matches?.('input, textarea, select, [contenteditable]') || e.target?.closest?.('[contenteditable]')) return
  if (e.ctrlKey || e.metaKey || e.altKey) return // leave the browser's own shortcuts (Alt+Left = back) alone
  const k = e.key
  if (k === 'PageDown') { e.preventDefault(); turnPage(1); return }
  if (k === 'PageUp') { e.preventDefault(); turnPage(-1); return }
  if (k === 'Escape') {
    if (bubble.value) closeBubble()
    else if (choosing.value) exitChoose()
    return
  }
  if (!choosing.value) {
    if (k === 'ArrowRight') { e.preventDefault(); next() }
    else if (k === 'ArrowLeft') { e.preventDefault(); prev() }
    return
  }
  const onWord = !!e.target.classList?.contains('sa-w')
  if (k === 'ArrowRight') { e.preventDefault(); stepPick(1) }
  else if (k === 'ArrowLeft') { e.preventDefault(); stepPick(-1) }
  else if (k === 'ArrowDown') { e.preventDefault(); linePick(1) }
  else if (k === 'ArrowUp') { e.preventDefault(); linePick(-1) }
  else if (k === 'Home') { e.preventDefault(); setPick(visibleNarrated[0]) }
  else if (k === 'End') { e.preventDefault(); setPick(visibleNarrated[visibleNarrated.length - 1]) }
  else if ((k === 'Enter' || k === ' ') && onWord) {
    // the focused word is the button; Space must not scroll the page
    e.preventDefault()
    if (e.target !== pickEl) setPick(e.target, { focus: false })
    hearFromHere()
  } else if ((k === 'm' || k === 'M') && (onWord || e.target === document.body)) {
    e.preventDefault()
    askMeaning()
  }
}

/* ---------- sentence practice (RehearseKid): which sentence, which page ---------- */
function rehearseFrom() {
  const k = engine?.curK
  return k >= 0 && kPage[k] === page.value ? k : (pageFirstK[page.value] ?? 0)
}

/* ---------- engine callbacks ---------- */
function onCurrent(k, prevK) {
  // Ended playback leaves the engine at -1. The next first word starts a
  // fresh reading even when the previous highlighted word is no longer set.
  if (k === 0 && prevK !== 0) autoAnnounced.clear()
  const spokenPage = pageForNarration(k, page.value, kPage)
  if (spokenPage !== null) goPage(spokenPage)
  updateLineGuide()
  if (!listen.value || !props.autoWords || !state.playing || ending.value || choosing.value) return
  const el = engine?.words[k]
  const id = el?.closest('[data-vocab-sense-id]')?.dataset.vocabSenseId
  if (!id || !props.data.vocab?.[id]?.definition) return
  const def = markSampleVocab(findDefinition(el, { gloss: props.gloss, kid: props.kid, passageId: props.passageId, vocab: props.data.vocab, syllables: props.syllables, help }))
  if (!def) return
  closeBubble()
  heldEl = el
  bubble.value = { ...def, auto: true, guide: null, left: 0, top: -9999, below: false, arrow: 0 }
  nextTick(placeBubble)
  if (!autoAnnounced.has(k)) { autoAnnounced.add(k); announce(`${def.word}: ${def.text}`) }
  autoTimer = setTimeout(closeBubble, 3000)
}
function onEnded({ snippet }) {
  if (snippet || !listen.value) return
  record('reached_end', props.passageId)
  autoAnnounced.clear()
  heardEnd = true
  finish({ force: true })
}

/* ---------- life cycle ---------- */
onMounted(async () => {
  await nextTick()
  setup()
  const voices = props.data.voices || []
  if (voices.length) {
    engine = new SoundAlong({ state, follow: false, onCurrent, onEnded })
    trackPlayback(engine.audio, props.passageId)
    const pref = voices.some((v) => v.id === props.settings.voice) ? props.settings.voice : voices[0].id
    engine.attach(textEl.value, voices, { voiceId: pref, rate: props.settings.rate, clicks: false, keys: false })
    engine.audio.addEventListener('play', onNarrationPlay)
    engineRef.value = engine
  }
  textEl.value.querySelectorAll('[title]').forEach((n) => n.removeAttribute('title')) // nothing may depend on hover
  repaginate()
  document.fonts?.ready?.then(() => { if (!destroyed) repaginate() })
  ro = new ResizeObserver(repaginateSoon)
  ro.observe(pageEl.value)
  document.addEventListener('pointerdown', onDocDown, true)
  window.addEventListener('keydown', onKey)
  window.addEventListener('resize', repaginateSoon) // also covers the screen scale (rem) changing

  // "Read to me" was the child's tap: read at once, with no second press and no spoken instruction first.
  // (If the browser refuses the sound, the big button pulses and the one idle hint names it.)
  if (listen.value && engine) {
    props.visit.played = true
    engine.playFrom(pageFirstK[0] ?? 0)
    setTimeout(() => { if (!destroyed && !state.playing && !ending.value && !userPaused) { refused.value = true; armHint() } }, 1800)
  }
  armHint()
  window.addEventListener('pointerdown', armHint, true)
  window.addEventListener('keydown', armHint, true)
})

onBeforeUnmount(() => {
  clearMeaningOffer()
  clearTimeout(autoTimer)
  destroyed = true
  clearTimeout(rpTimer)
  clearTimeout(hintTimer)
  window.removeEventListener('pointerdown', armHint, true)
  window.removeEventListener('keydown', armHint, true)
  clearTimeout(srTimer)
  ro?.disconnect()
  engine?.destroy()
  document.removeEventListener('pointerdown', onDocDown, true)
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('resize', repaginateSoon)
})

function onNarrationPlay() {
  if (listen.value && !engine?._snippet) record('play_started', props.passageId)
}

// Narration and spoken instructions never overlap: when narration starts, anything a prompt was saying stops;
// when it stops, the quiet-time clock for the one hint starts over.
watch(() => state.playing, (on) => {
  if (on) {
    refused.value = false
    interrupt()
    clearTimeout(hintTimer)
    // playFrom highlights before the media play event; its first word still
    // needs the automatic card and polite announcement.
    if (engine?.curK >= 0) onCurrent(engine.curK, engine.curK)
  } else armHint()
})
watch(() => state.error, (e) => { if (e) armHint() })
watch(() => props.settings.voice, (v) => { if (engine && v) engine.setVoice(v) })
watch(() => props.settings.rate, (r) => engine?.setRate(r))
watch(() => props.settings.lineGuide, async () => { await nextTick(); updateLineGuide() })
watch(ending, () => updateLineGuide())
watch(() => [props.settings.size, props.settings.font, props.settings.spacing], async () => {
  await nextTick()
  repaginate()
  document.fonts?.ready?.then(() => { if (!destroyed) repaginate() })
})

defineExpose({
  pauseAll() {
    engine?.pause()
    closeBubble()
  },
})

const dots = computed(() => Array.from({ length: pageCount.value }, (_, i) => i))
</script>

<template>
  <div class="kv-read" :class="{ 'kv-selfmode': !listen }">
    <header class="kv-rail">
      <button type="button" class="kv-btn kv-home" aria-label="Home" @click="goHome">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 3 1.8 12.2h3v8.3h5.4v-5.6h3.6v5.6h5.4v-8.3h3z" /></svg>
      </button>
      <template v-if="ending">
        <button ref="replayBtn" type="button" class="kv-play kv-replay" aria-label="Read it again" @click="startOver">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 4.5V1.2L7.2 5.4 12 9.6V6.3a5.7 5.7 0 1 1-5.7 5.7H3.6A8.4 8.4 0 1 0 12 4.5z" /></svg>
        </button>
        <button type="button" class="kv-wordsbtn" aria-label="Words from the story" @click="toWords">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zm2 4v2h10V8zm0 4v2h10v-2zm0 4v2h6v-2z" /></svg>
          <span aria-hidden="true">Words</span>
        </button>
      </template>
      <button
        v-else-if="listen"
        type="button"
        class="kv-play"
        :class="{ pressed, pulse, playing: state.playing }"
        :aria-label="state.playing ? 'Pause' : 'Play'"
        @pointerdown.prevent="onPlayDown"
        @click="onPlayClick"
      >
        <svg v-if="state.playing" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M6.5 4.5h4v15h-4zM13.5 4.5h4v15h-4z" /></svg>
        <svg v-else viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M7.5 4.5v15l12-7.5z" /></svg>
      </button>
      <template v-if="!ending">
        <button
          ref="chooseBtn"
          type="button"
          class="kv-btn kv-choose"
          :class="{ on: choosing }"
          :aria-pressed="choosing"
          aria-label="Choose a word"
          @click="toggleChoose"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M3 5.5h18v2.6H3zM3 16.9h18v2.6H3z" /><path fill="currentColor" d="M8 10h8.6a1.4 1.4 0 0 1 1.4 1.4v1.2a1.4 1.4 0 0 1-1.4 1.4H8a1.4 1.4 0 0 1-1.4-1.4v-1.2A1.4 1.4 0 0 1 8 10z" /></svg>
        </button>
        <button v-if="choosing" type="button" class="kv-btn kv-mean" :aria-label="`Meaning of ${pickText}`" @click="askMeaning">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M4 3.5h13a3 3 0 0 1 3 3V20l-4-3H4a1 1 0 0 1-1-1v-12a1 1 0 0 1 1-1zm7.2 3.3a2.9 2.9 0 0 0-3 2.6h1.9c.1-.5.5-.8 1-.8.6 0 1 .4 1 .9 0 1.2-2.1 1.1-2.1 3.3h1.9c0-1.4 2.2-1.5 2.2-3.3 0-1.5-1.2-2.7-2.9-2.7zM10.1 13.6v1.7h1.9v-1.7z" /></svg>
        </button>
        <button v-else type="button" class="kv-btn kv-again" aria-label="Start over" @click="startOver">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 4.5V1.2L7.2 5.4 12 9.6V6.3a5.7 5.7 0 1 1-5.7 5.7H3.6A8.4 8.4 0 1 0 12 4.5z" /></svg>
        </button>
      </template>
      <RehearseKid v-if="listen && engineRef && !ending" :engine="engineRef" :start-k="rehearseFrom" :page-of="(k) => kPage[k]" :page="page" :before="interrupt" />
    </header>

    <div v-if="problem" class="kv-problem" role="alert">
      <span class="kv-problem-text">{{ problem.text }}</span>
      <button v-if="problem.retry" type="button" class="kv-problem-btn" @click="retryAudio">Try again</button>
    </div>
    <!-- screen readers: status messages, and the instructions that the picked word points to -->
    <p class="kv-sr" role="status" aria-live="polite" aria-atomic="true">{{ srMsg }}</p>
    <p id="kv-pick-hint" class="kv-sr">{{ pickHint }}</p>

    <div class="kv-meaning-slot">
      <button v-if="meaningOffer" type="button" class="kv-meaning-offer" :aria-label="`Meaning of ${meaningOffer.word}`"
        @click="offeredMeaning" @blur="meaningOfferTimer = setTimeout(clearMeaningOffer, 1500)">What does it mean?</button>
    </div>
    <div class="kv-dotswrap">
      <div class="kv-dots" :class="{ gone: ending }" role="img" :aria-label="`Page ${page + 1} of ${pageCount}`">
        <span v-for="i in dots" :key="i" class="kv-dot" :class="{ on: i === page }"></span>
      </div>
      <p class="kv-endline" :class="{ on: ending }" role="status">{{ ending ? 'The end' : '' }}</p>
    </div>

    <div
      ref="stageEl"
      class="kv-stage"
      @pointerdown="onDown"
      @pointermove="onMove"
      @pointerup="onUp"
      @pointercancel="onCancel"
      @dragstart.prevent
      @selectstart.prevent
    >
      <button type="button" class="kv-arrow kv-prev" :class="{ off: page === 0 }" :disabled="page === 0" aria-label="Previous page" @click="prev">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M14.5 4.5 7 12l7.5 7.5 2.2-2.2L11.4 12l5.3-5.3z" /></svg>
      </button>

      <div ref="pageEl" class="kv-page">
        <!-- ReadWorks' words + our spans; taps are handled above with pointer events, not by the engine -->
        <div ref="textEl" class="kv-text" :lang="data.lang === 'ES' ? 'es' : 'en'" @focusin="onTextFocus" v-html="textHtml"></div>
        <div v-if="lineGuide" class="kv-line-guide" aria-hidden="true" :style="{ top: `${lineGuide.top}px`, left: `${lineGuide.left}px`, width: `${lineGuide.width}px` }"></div>
      </div>

      <button
        type="button"
        class="kv-arrow kv-next"
        :class="{ finish: atEnd }"
        :aria-label="atEnd ? 'Finish the story' : 'Next page'"
        :disabled="ending"
        @click="next"
      >
        <svg v-if="atEnd" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="m12 2 2.9 6.6 7.1.7-5.4 4.7 1.6 7-6.2-3.7-6.2 3.7 1.6-7L2 9.3l7.1-.7z" /></svg>
        <svg v-else viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M9.5 4.5 17 12l-7.5 7.5-2.2-2.2L12.6 12 7.3 6.7z" /></svg>
      </button>

    </div>

    <div
      v-if="bubble"
      ref="bubbleEl"
      class="kv-bubble"
      :class="{ below: bubble.below }"
      :style="{ left: bubble.left + 'px', top: bubble.top + 'px', '--ax': bubble.arrow + 'px' }"
      role="group"
      :aria-label="`Meaning of ${bubble.word}`"
    >
      <div class="kv-bubble-text">
        <p class="kv-bubble-word">{{ bubble.word }}<ReviewMark variant="kid" :items="[...(bubble.items || []), bubble.guideItem]" /></p>
        <p class="kv-bubble-def">{{ bubble.text }}</p>
        <SyllableGuide v-if="bubble.guide && !bubble.auto" ref="guideEl" class="kv-bubble-guide" icons-only :mark-kid="false" :entry="bubble.guide" @start="onGuideStart" @done="onGuideDone" />
      </div>
      <button v-if="bubble.auto" type="button" class="kv-bubble-say" aria-label="Close word card" @click="closeBubble">&times;</button>
      <button v-else-if="!bubble.guide && (bubble.clips.length || hasVoices)" type="button" class="kv-bubble-say" aria-label="Hear it again" @click="speakBubble">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M4 9v6h4l5 4V5L8 9H4zm12.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4zM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z" /></svg>
      </button>
    </div>

    <div v-if="flash" :key="flash.n" class="kv-flash" :style="{ left: flash.x + 'px', top: flash.y + 'px' }" aria-hidden="true">
      <svg v-if="flash.icon === 'pause'" viewBox="0 0 24 24"><path fill="currentColor" d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" /></svg>
      <svg v-else viewBox="0 0 24 24"><path fill="currentColor" d="M8 5v14l11-7z" /></svg>
    </div>
  </div>
</template>
