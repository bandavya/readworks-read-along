<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from 'vue'
import { assetUrl, loadPassage, store, VOICE_NAMES } from '../../api'
import { SoundAlong } from '../../soundAlong'
import { loadGloss, loadKidAudio, loadSyllables, ClipVoice } from '../../kidAudio'
import { findDefinition } from '../../defs'
import { HoldDetector } from '../../hold'
import { turnPlan, finishPlan } from '../../pageSync'
import SyllableGuide from '../../components/SyllableGuide.vue'
import { SoundRibbon } from '../sound/ribbon'
import './mixKid.css'

const props = defineProps({ id: String })
const data = shallowRef(null)
const gloss = shallowRef(null)
const kidAudio = shallowRef(null)
const syllables = shallowRef(null)
const error = ref('')
const coverFailed = ref(false)
const pageArtFailed = ref(false)
const endArtFailed = ref(false)
const selectedWord = ref(0)
const screen = ref('start')
const mode = ref('listen')
const page = ref(0)
const pageCount = ref(1)
const ending = ref(false)
let heardEnd = false
const calm = ref(store.get('sound-kid-calm', false))
const textSize = ref(store.get('kid-size', 'M'))
const textFont = ref(store.get('kid-reading-font', 'andika'))
const textSpacing = ref(store.get('reading-spacing', false))
const settingsOpen = ref(false)
const settingsConfirm = ref(false)
const textRoot = ref(null)
const stage = ref(null)
const help = shallowRef(null)
let helpReturn = null
const state = reactive({ playing: false, time: 0, duration: 0, rate: store.get('kid-rate', 1), voiceId: '', error: '' })
const voiceId = ref(store.get('kid-voice', 'human'))
const clip = new ClipVoice()
let engine = null
let ribbon = null
let allWords = []
let groups = []
let wordPage = new Map()
let pageFirst = []
let blocks = []
let blockPages = new Map()
let suppressClick = false
const voices = computed(() => data.value?.voices || [])
const hasVoice = computed(() => voices.value.length > 0)
const vocab = computed(() => {
  if (!data.value) return []
  const order = [...data.value.html.matchAll(/data-vocab-sense-id="([^"]+)"/g)].map((m) => m[1])
  for (const id of Object.keys(data.value.vocab || {})) if (!order.includes(id)) order.push(id)
  return [...new Set(order)].filter((id) => data.value.vocab?.[id]).map((id) => {
    const v = data.value.vocab[id]
    const guide = syllables.value?.[id]
    const spoken = kidAudio.value?.vocab?.[props.id]?.[id]
    return { id, ...v, guide, spoken }
  })
})
const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const html = computed(() => {
  if (!data.value) return ''
  const d = data.value
  const title = (d.title_words || []).map((w, i) => `<span class="sa-w" data-l="${i}">${esc(w)}</span>`).join(' ') || esc(d.title)
  const by = (d.by_words || []).map((w, i) => `<span class="sa-w" data-l="${i + (d.title_words || []).length}">${esc(w)}</span>`).join(' ')
  const doc = new DOMParser().parseFromString(d.html || '', 'text/html')
  doc.querySelectorAll('figure, script, style').forEach((el) => el.remove())
  doc.querySelectorAll('img').forEach((el) => el.setAttribute('src', assetUrl(el.getAttribute('src'))))
  return `<h1>${title}</h1>${by ? `<p class="mix-kid-by">${by}</p>` : ''}${doc.body.innerHTML}`
})
const cover = computed(() => {
  if (!data.value) return null
  const doc = new DOMParser().parseFromString(data.value.html || '', 'text/html')
  const img = doc.querySelector('figure img')
  return img ? { src: assetUrl(`look-art/p-${props.id.slice(0, 8)}-1.webp`), alt: img.alt || '', caption: doc.querySelector('figure figcaption .image-caption')?.textContent?.trim() || '' } : null
})

const pageArt = computed(() => cover.value)
const endArt = assetUrl('look-art/end.webp')

// Put punctuation outside narrated spans into the same paging system. It is never given a sound action.
function wrapLooseText(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const found = []
  while (walker.nextNode()) {
    const n = walker.currentNode
    if (/\S/.test(n.nodeValue) && !n.parentElement.closest('.sa-w')) found.push(n)
  }
  for (const n of found) {
    const frag = document.createDocumentFragment()
    for (const part of n.nodeValue.split(/(\s+)/)) {
      if (!part) continue
      if (/^\s+$/.test(part)) frag.append(document.createTextNode(part))
      else { const span = document.createElement('span'); span.className = 'sa-w sa-unread'; span.textContent = part; frag.append(span) }
    }
    n.replaceWith(frag)
  }
}
function buildPages() {
  const root = textRoot.value
  if (!root) return
  wrapLooseText(root)
  allWords = [...root.querySelectorAll('.sa-w')]
  blocks = [...root.children]
  const blockOf = (w) => { let b = w; while (b.parentElement && b.parentElement !== root) b = b.parentElement; return b }
  const abbreviation = /^(mr|mrs|ms|dr|st|jr|sr|vs)\.$/i
  groups = []
  let current = []
  let lastBlock = null
  const finish = () => { if (current.length) groups.push(current); current = [] }
  for (const w of allWords) {
    const block = blockOf(w)
    if (lastBlock && block !== lastBlock) finish()
    lastBlock = block
    current.push(w)
    const token = w.textContent.trim()
    if ((/[.!?â€¦]["'â€â€™)\]]*$/.test(token) && !abbreviation.test(token)) || current.length >= 24) finish()
  }
  finish()
  wordPage = new Map()
  blockPages = new Map()
  pageFirst = []
  groups.forEach((group, p) => group.forEach((w) => {
    wordPage.set(w, p)
    const b = blockOf(w)
    if (!blockPages.has(b)) blockPages.set(b, new Set())
    blockPages.get(b).add(p)
    const k = engine?.index.get(w)
    if (k !== undefined && pageFirst[p] === undefined) pageFirst[p] = k
  }))
  pageCount.value = Math.max(1, groups.length)
  applyPage()
}
function applyPage() {
  allWords.forEach((w) => {
    const visible = wordPage.get(w) === page.value
    w.classList.toggle('mix-kid-hidden', !visible)
    if (!w.classList.contains('sa-unread')) { if (visible) w.tabIndex = 0; else w.removeAttribute('tabindex') }
  })
  blocks.forEach((b) => b.classList.toggle('mix-kid-hidden', !blockPages.get(b)?.has(page.value)))
}
function turn(delta) {
  const target = Math.max(0, Math.min(pageCount.value - 1, page.value + delta))
  if (target === page.value) { if (delta > 0) finishRead(); return }
  closeHelp()
  ending.value = false
  page.value = target
  applyPage()
  const plan = turnPlan({ listen: mode.value === 'listen', playing: state.playing, firstK: pageFirst[target] })
  if (plan === 'play-page') engine?.playFrom(pageFirst[target])
  else if (plan === 'pause') engine?.pause()
  textRoot.value?.querySelector('.sa-w[tabindex="0"]:not(.mix-kid-hidden)')?.focus({ preventScroll: true })
}
function onCurrent(k) {
  const p = wordPage.get(engine?.words[k])
  if (p !== undefined && p !== page.value && screen.value === 'read') { page.value = p; applyPage() }
}
function enterRead(chosen) {
  mode.value = chosen
  screen.value = 'read'
  page.value = 0
  ending.value = false
  heardEnd = false
  engine?.rewind()
  nextTick(() => {
    applyPage()
    document.querySelector(chosen === 'listen' && hasVoice.value ? '.mix-kid-play' : '.mix-kid-text .sa-w:not(.sa-unread):not(.mix-kid-hidden)')?.focus({ preventScroll: true })
    if (chosen === 'listen' && hasVoice.value) engine?.playFrom(pageFirst[0] ?? 0)
  })
}
function finishRead() {
  if (ending.value) return
  const last = pageCount.value - 1
  const plan = finishPlan({ listen: mode.value === 'listen', hasNarration: !!engine && !state.error, heardEnd, playingLastPage: state.playing && wordPage.get(engine?.curEl) === last, lastFirstK: pageFirst[last] })
  if (plan === 'keep-listening') return
  if (plan === 'play-last') { engine?.playFrom(pageFirst[last]); return }
  engine?.pause(); clip.stop(); closeHelp(); ending.value = true
  nextTick(() => document.querySelector('.mix-kid-end-again')?.focus({ preventScroll: true }))
}
function finishStory() { engine?.pause(); clip.stop(); closeHelp(); screen.value = 'words'; nextTick(() => document.querySelector('.mix-kid-words-title')?.focus()) }
function home() { engine?.pause(); clip.stop(); closeHelp(); screen.value = 'start' }
function toggle() {
  clip.stop()
  if (!engine) return
  if (state.playing) engine.pause()
  else if (engine.curK < 0 || wordPage.get(engine.curEl) !== page.value) engine.playFrom(pageFirst[page.value] ?? 0)
  else engine.resume()
}
function closeHelp() { clip.stop(); help.value = null; helpReturn?.focus?.({ preventScroll: true }); helpReturn = null }
function helpFor(w) {
  if (!w || w.classList.contains('sa-unread')) return
  engine?.pause(); clip.stop()
  helpReturn = w
  const found = findDefinition(w, { gloss: gloss.value, kid: kidAudio.value, passageId: props.id, vocab: data.value.vocab, syllables: syllables.value, sayFallback: true })
  if (!found) { const k = engine?.index.get(w); if (k !== undefined) engine.playSnippet(k); return }
  help.value = { ...found, clips: found.clips || [], items: [...(found.items || []), found.guideItem].filter(Boolean) }
  nextTick(() => document.querySelector('.mix-kid-help-close')?.focus())
}
const hold = new HoldDetector({ ms: 500, moveLimit: () => 14, onHold: (w) => { window.getSelection()?.removeAllRanges(); helpFor(w); suppressClick = true } })
const onPointerCancel = () => hold.cancel()
function pointerDown(e) { const w = e.target.closest?.('.sa-w:not(.sa-unread):not(.mix-kid-hidden)'); if (w && e.button === 0) hold.down(w, e.clientX, e.clientY) }
function pointerUp() { if (hold.up().held) { suppressClick = true; setTimeout(() => { suppressClick = false }, 500) } }
function textClick(e) {
  if (suppressClick) { suppressClick = false; e.stopPropagation(); e.preventDefault(); return }
  if (mode.value === 'self') { const w = e.target.closest?.('.sa-w:not(.sa-unread)'); if (w) { e.stopPropagation(); helpFor(w) } }
}
function textKey(e) {
  const w = e.target.closest?.('.sa-w:not(.sa-unread):not(.mix-kid-hidden)')
  if (w && (e.key === '?' || (e.shiftKey && e.key === 'Enter'))) { e.preventDefault(); e.stopPropagation(); helpFor(w) }
  else if (w && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); e.stopPropagation(); if (mode.value === 'self') helpFor(w); else engine?.playFrom(engine.index.get(w)) }
  else if (e.key === 'ArrowRight' && !w) turn(1)
  else if (e.key === 'ArrowLeft' && !w) turn(-1)
}
function sayHelp() { if (help.value?.clips?.length) { engine?.pause(); clip.play(help.value.clips) } }
function hearCard(c) { engine?.pause(); clip.play([c.say, c.spoken?.audio].filter(Boolean)) }
function setVoice(id) { voiceId.value = id; store.set('kid-voice', id); engine?.setVoice(id) }
function setRate(rate) { state.rate = rate; store.set('kid-rate', rate); engine?.setRate(rate) }
function setCalm(v) { calm.value = v; store.set('sound-kid-calm', v) }
function setSize(v) { textSize.value = v; store.set('kid-size', v) }
function setFont(v) { textFont.value = v; store.set('kid-reading-font', v) }
function setSpacing(v) { textSpacing.value = v; store.set('reading-spacing', v) }
function openConfirm() { engine?.pause(); clip.stop(); settingsConfirm.value = true; nextTick(() => document.querySelector('.mix-kid-confirm-cancel')?.focus()) }
function openSettings() { settingsConfirm.value = false; settingsOpen.value = true; engine?.pause(); clip.stop(); nextTick(() => document.querySelector('.mix-kid-settings-close')?.focus()) }
function closeSettings() { settingsOpen.value = false; nextTick(() => document.querySelector('.mix-kid-grownups')?.focus()) }
function trapDialog(e) {
  if (e.key !== 'Tab') return
  const elements = [...e.currentTarget.querySelectorAll('button, a[href]')].filter((el) => !el.disabled)
  if (!elements.length) return
  const first = elements[0], last = elements.at(-1)
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
}
function onKeyGlobal(e) {
  if (e.key === 'Escape') { if (settingsOpen.value) closeSettings(); else if (settingsConfirm.value) settingsConfirm.value = false; else if (help.value) closeHelp(); else if (state.playing) engine?.pause(); return }
  if (e.key === ' ' && screen.value === 'read' && !ending.value && mode.value === 'listen' && !help.value && !e.target.closest?.('a,button,input,select,textarea,.sa-w')) { e.preventDefault(); toggle() }
}
// A tap anywhere on the page that isn't a word stops the voice. It never starts it: only the big button does.
function spreadTap(e) { if (mode.value === 'listen' && state.playing && !e.target.closest?.('.sa-w:not(.sa-unread)')) engine?.pause() }
const pauseForOverlay = () => { engine?.pause(); clip.stop() }

onMounted(async () => {
  document.body.classList.add('mix-kid-active')
  document.addEventListener('pointerup', pointerUp)
  document.addEventListener('pointercancel', onPointerCancel)
  document.addEventListener('keydown', onKeyGlobal)
  window.addEventListener('sa-feedback-open', pauseForOverlay)
  try { data.value = await loadPassage(props.id) } catch { error.value = 'Could not load this story.'; return }
  document.title = `${data.value.title} · Sound Along`
  Promise.all([loadGloss(props.id), loadKidAudio(), loadSyllables(props.id)]).then(([g, k, s]) => { gloss.value = g; kidAudio.value = k; syllables.value = s })
  await nextTick()
  if (voices.value.length) {
    engine = new SoundAlong({ state, follow: false, onCurrent, onEnded: ({ snippet }) => { if (!snippet && screen.value === 'read') { heardEnd = true; page.value = pageCount.value - 1; applyPage(); ending.value = true; nextTick(() => document.querySelector('.mix-kid-end-again')?.focus({ preventScroll: true })) } }, onVocab: () => {} })
    const initial = voices.value.some((v) => v.id === voiceId.value) ? voiceId.value : voices.value[0].id
    voiceId.value = initial
    engine.attach(textRoot.value, voices.value, { voiceId: initial, rate: state.rate, clicks: true, keys: false })
  }
  buildPages()
  if (engine) ribbon = new SoundRibbon(stage.value, engine, { calm: () => calm.value, kid: true })
})
onBeforeUnmount(() => {
  ribbon?.destroy(); engine?.destroy(); clip.stop(); hold.cancel()
  document.removeEventListener('pointerup', pointerUp)
  document.removeEventListener('pointercancel', onPointerCancel)
  document.removeEventListener('keydown', onKeyGlobal)
  window.removeEventListener('sa-feedback-open', pauseForOverlay)
  document.body.classList.remove('mix-kid-active')
})
watch(page, () => { if (screen.value === 'read') nextTick(applyPage) })
</script>

<template>
  <main class="mix-kid" :lang="data?.lang === 'ES' ? 'es' : 'en'">
    <header v-if="screen === 'start' || !data || error" class="mix-kid-top">
      <span class="mix-kid-brand">ReadWorks <span>Sound Along</span></span>
      <button class="mix-kid-grownups" type="button" @click="openConfirm" aria-label="Grown-ups corner">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a2 2 0 0 1 2 2v.5l1.5.9.5-.3a2 2 0 0 1 2.7.7l.7 1.2a2 2 0 0 1-.7 2.7l-.5.3v1.8l.5.3a2 2 0 0 1 .7 2.7l-.7 1.2a2 2 0 0 1-2.7.7l-.5-.3-1.5.9v.5a2 2 0 0 1-2 2h-1.4a2 2 0 0 1-2-2v-.5l-1.5-.9-.5.3a2 2 0 0 1-2.7-.7l-.7-1.2a2 2 0 0 1 .7-2.7l.5-.3v-1.8l-.5-.3a2 2 0 0 1-.7-2.7l.7-1.2a2 2 0 0 1 2.7-.7l.5.3 1.5-.9V5a2 2 0 0 1 2-2z"/><circle cx="11.3" cy="12" r="2.5"/></svg>
      </button>
    </header>
    <p v-if="error" class="mix-kid-status">{{ error }} <a href="#/look/mix/">All stories</a></p>
    <p v-else-if="!data" class="mix-kid-status" role="status">Loading story…</p>
    <template v-else>
      <section v-if="screen === 'start'" class="mix-kid-start" aria-label="Start story">
        <div class="mix-kid-start-inner">
          <div class="mix-kid-start-art">
            <div class="mix-kid-pentagon mix-kid-story-art">
              <img v-if="cover && !coverFailed" :src="cover.src" :alt="cover.alt" @error="coverFailed = true">
              <div v-else class="mix-kid-art-fallback" role="img" :aria-label="cover?.alt || 'Story illustration'"><svg viewBox="0 0 120 100" aria-hidden="true"><path d="M8 76 39 43 57 59 77 25 112 76Z"/><circle cx="33" cy="23" r="8"/></svg></div>
            </div>
          </div>
          <div class="mix-kid-start-copy">
            <h1>{{ data.title }}</h1>
            <div class="mix-kid-start-choices">
              <button v-if="hasVoice" class="mix-kid-choice mix-kid-choice-main" type="button" @click="enterRead('listen')">
                <span class="mix-kid-door-icon" aria-hidden="true"><svg viewBox="0 0 48 48"><path d="M15 7v34l29-17z"/></svg></span><span>Read to me</span>
              </button>
              <button v-else class="mix-kid-choice mix-kid-choice-self" type="button" @click="enterRead('self')">
                <span class="mix-kid-door-icon" aria-hidden="true"><svg viewBox="0 0 48 48"><path d="M7 12h15c5 0 7 3 7 7v22H11a5 5 0 0 0-4 2zm34 0H34c-5 0-7 3-7 7v22h10a5 5 0 0 1 4 2z"/></svg></span><span>Read on my own</span>
              </button>
            </div>
          </div>
        </div>
        <button v-if="hasVoice" class="mix-kid-quiet" type="button" @click="enterRead('self')"><svg viewBox="0 0 48 48" aria-hidden="true"><path d="M7 12h15c5 0 7 3 7 7v22H11a5 5 0 0 0-4 2zm34 0H34c-5 0-7 3-7 7v22h10a5 5 0 0 1 4 2z"/></svg><span>Read on my own</span></button>
      </section>
      <section v-show="screen === 'read'" class="mix-kid-read" aria-label="Story">
        <div class="mix-kid-read-top">
          <div class="mix-kid-progress" role="progressbar" :aria-label="`Page ${page + 1} of ${pageCount}`" aria-valuemin="1" :aria-valuemax="pageCount" :aria-valuenow="page + 1"><i :style="{ width: `${(page + 1) / pageCount * 100}%` }"></i></div>
          <button class="mix-kid-grownups" type="button" @click="openConfirm" aria-label="Grown-ups corner"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a2 2 0 0 1 2 2v.5l1.5.9.5-.3a2 2 0 0 1 2.7.7l.7 1.2a2 2 0 0 1-.7 2.7l-.5.3v1.8l.5.3a2 2 0 0 1 .7 2.7l-.7 1.2a2 2 0 0 1-2.7.7l-.5-.3-1.5.9v.5a2 2 0 0 1-2 2h-1.4a2 2 0 0 1-2-2v-.5l-1.5-.9-.5.3a2 2 0 0 1-2.7-.7l-.7-1.2a2 2 0 0 1 .7-2.7l.5-.3v-1.8l-.5-.3a2 2 0 0 1-.7-2.7l.7-1.2a2 2 0 0 1 2.7-.7l.5.3 1.5-.9V5a2 2 0 0 1 2-2z"/><circle cx="11.3" cy="12" r="2.5"/></svg></button>
        </div>
        <div v-if="ending" class="mix-kid-end">
          <div class="mix-kid-end-art">
            <img v-if="!endArtFailed" :src="endArt" alt="" @error="endArtFailed = true">
            <div v-else class="mix-kid-art-fallback" aria-hidden="true"><svg viewBox="0 0 120 100"><path d="M8 76 39 43 57 59 77 25 112 76Z"/><circle cx="33" cy="23" r="8"/></svg></div>
          </div>
          <div><h2>The end</h2><button class="mix-kid-end-again" type="button" @click="enterRead(mode)">Read it again</button><button v-if="vocab.length" class="mix-kid-end-words" type="button" @click="finishStory">Words to know</button><a href="#/look/mix/">Pick another story</a></div>
        </div>
        <div v-show="!ending" class="mix-kid-spread" @click="spreadTap">
          <div class="mix-kid-picture-page">
            <div class="mix-kid-picture-frame">
              <img v-if="pageArt && !pageArtFailed" :src="pageArt.src" :alt="pageArt.alt" @error="pageArtFailed = true">
              <div v-else class="mix-kid-art-fallback" role="img" :aria-label="pageArt?.alt || 'Story page'"><svg viewBox="0 0 120 100" aria-hidden="true"><path d="M8 76 39 43 57 59 77 25 112 76Z"/><circle cx="33" cy="23" r="8"/></svg></div>
            </div>
            <p v-if="page === 0 && pageArt?.caption">{{ pageArt.caption }}</p>
          </div>
          <div class="mix-kid-text-page">
            <div ref="stage" class="mix-kid-stage" @pointerdown="pointerDown" @pointermove="hold.move($event.clientX, $event.clientY)" @click.capture="textClick" @keydown="textKey" @contextmenu.prevent>
              <div ref="textRoot" class="mix-kid-text sa-text" :class="{ 'mix-kid-font-sans': textFont === 'sans', 'mix-kid-spaced': textSpacing }" :style="{ '--mix-kid-size': ({ S: .88, M: 1, L: 1.2, XL: 1.4, XXL: 1.6 })[textSize] || 1 }" v-html="html"></div>
            </div>
          </div>
        </div>
        <div v-if="!ending" class="mix-kid-controls">
          <button class="mix-kid-turn mix-kid-back" type="button" aria-label="Back" @click="page === 0 ? home() : turn(-1)"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 5.5 8 12l6.5 6.5"/></svg></button>
          <button v-if="hasVoice && mode === 'listen'" class="mix-kid-play" :class="{ 'mix-kid-playing': state.playing }" type="button" :aria-label="state.playing ? 'Pause story' : 'Play story'" @click="toggle"><svg v-if="state.playing" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3h5v18H5zm9 0h5v18h-5z"/></svg><svg v-else viewBox="0 0 24 24" aria-hidden="true"><path d="M5 2v20l17-10z"/></svg><span>{{ state.playing ? 'Pause' : 'Play' }}</span></button>
          <button class="mix-kid-turn mix-kid-next" type="button" :aria-label="page + 1 === pageCount ? 'Finish' : 'Next'" @click="turn(1)"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.5 5.5 16 12l-6.5 6.5"/></svg></button>
        </div>
        <p v-if="state.error" class="mix-kid-error">{{ state.error }} <button type="button" @click="engine?.retry()">Try again</button></p>
      </section>
      <section v-if="screen === 'words'" class="mix-kid-words">
        <div class="mix-kid-read-top mix-kid-words-top"><button type="button" @click="enterRead(mode)">Read again</button></div>
        <h1 class="mix-kid-words-title" tabindex="-1">Words to know</h1>
        <div v-if="vocab.length" class="mix-kid-word-sky">
          <svg class="mix-kid-sky-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path d="M18 66 35 22 53 70 72 28 87 63 53 70 18 66"/></svg>
          <button v-for="(c, i) in vocab" :key="c.id" class="mix-kid-star" :class="`mix-kid-star-${i % 8}`" type="button" :aria-pressed="selectedWord === i" @click="selectedWord = i; hearCard(c)"><span>{{ c.word }}</span></button>
        </div>
        <article v-if="vocab[selectedWord]" class="mix-kid-word-card" aria-live="polite">
          <button type="button" class="mix-kid-word-hear" @click="hearCard(vocab[selectedWord])">Hear {{ vocab[selectedWord].word }} <span aria-hidden="true">▶</span></button>
          <p>{{ vocab[selectedWord].definition }}</p>
          <SyllableGuide v-if="vocab[selectedWord].guide" :entry="vocab[selectedWord].guide" :pid="id" :sid="vocab[selectedWord].id" :iconsOnly="true" :markKid="false" @start="clip.stop()" />
        </article>
        <p v-if="!vocab.length">This story has no words to know.</p>
      </section>
      <div v-if="help" class="mix-kid-help-back" @click.self="closeHelp" @keydown="trapDialog"><div class="mix-kid-help" role="dialog" aria-modal="true" aria-label="Word help"><button class="mix-kid-help-close" type="button" @click="closeHelp">Close</button><p class="mix-kid-help-word">{{ help.word }}</p><p>{{ help.text }}</p><button v-if="help.clips.length" type="button" class="mix-kid-help-say" @click="sayHelp">Hear meaning</button><SyllableGuide v-if="help.guide" :entry="help.guide" :pid="id" :sid="help.sid || ''" :iconsOnly="true" :markKid="false" @start="clip.stop()" /></div></div>
      <div v-if="settingsConfirm" class="mix-kid-modal-back" @click.self="settingsConfirm = false" @keydown="trapDialog"><div class="mix-kid-modal" role="dialog" aria-modal="true" aria-label="Grown-ups corner"><h2>Grown-ups corner</h2><p>Is a grown-up here to open the reading settings?</p><div class="mix-kid-modal-actions"><button class="mix-kid-confirm-cancel" type="button" @click="settingsConfirm = false">Not now</button><button type="button" @click="openSettings">Open settings</button></div></div></div>
      <div v-if="settingsOpen" class="mix-kid-modal-back" @click.self="closeSettings" @keydown="trapDialog"><div class="mix-kid-modal mix-kid-settings" role="dialog" aria-modal="true" aria-label="Grown-ups corner"><button class="mix-kid-settings-close" type="button" @click="closeSettings">Done</button><h2>Grown-ups corner</h2><p>Tap a word to hear it. Hold a word for help. With a keyboard, focus a word and press Shift + Enter for help.</p><div v-if="voices.length > 1" class="mix-kid-setting"><h3>Reading voice</h3><div><button v-for="v in voices" :key="v.id" type="button" :aria-pressed="voiceId === v.id" @click="setVoice(v.id)">{{ VOICE_NAMES[v.id] || v.label }}</button></div></div><div v-if="hasVoice" class="mix-kid-setting"><h3>Speed</h3><div><button v-for="r in [0.75, 1, 1.5, 2]" :key="r" type="button" :aria-pressed="state.rate === r" @click="setRate(r)">{{ r }}×</button></div></div><div class="mix-kid-setting"><h3>Sound line</h3><div><button type="button" :aria-pressed="!calm" @click="setCalm(false)">Show the line</button><button type="button" :aria-pressed="calm" @click="setCalm(true)">Calm underline</button></div></div><div class="mix-kid-setting"><h3>Text size</h3><div><button v-for="s in ['S', 'M', 'L', 'XL', 'XXL']" :key="s" type="button" :aria-pressed="textSize === s" @click="setSize(s)">{{ s }}</button></div></div><div class="mix-kid-setting"><h3>Letters</h3><div><button type="button" :aria-pressed="textFont === 'andika'" @click="setFont('andika')">Andika</button><button type="button" :aria-pressed="textFont === 'sans'" @click="setFont('sans')">Simple sans</button><button type="button" :aria-pressed="textSpacing" @click="setSpacing(!textSpacing)">Extra spacing {{ textSpacing ? 'on' : 'off' }}</button></div></div><a :href="`#/look/mix/p/${id}`">Open grown-up reader</a></div></div>
    </template>
  </main>
</template>




