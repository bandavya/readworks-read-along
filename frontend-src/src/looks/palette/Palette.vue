<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, shallowRef } from 'vue'
import { cleanPassage, assetUrl, gradeLabel, loadPassage, store, VOICE_NAMES } from '../../api'
import { SoundAlong } from '../../soundAlong'
import { HoldDetector } from '../../hold'
import { findDefinition } from '../../defs'
import { loadGloss, loadKidAudio, loadSyllables, ClipVoice } from '../../kidAudio'
import { itemsForPassage, tally, syllableItem } from '../../review'
import VocabCard from '../../components/VocabCard.vue'
import './palette.css'

const props = defineProps({ id: String })
const data = shallowRef(null)
const error = ref('')
const textEl = ref(null)
const playerEl = ref(null)
const gloss = shallowRef(null)
const syllables = shallowRef(null)
const kidAudio = shallowRef(null)
const state = reactive({ playing: false, time: 0, duration: 0, rate: store.get('rate', 1), voiceId: '', error: '' })
const card = ref(null)
const anchor = shallowRef(null)
const focusCard = ref(false)
const soundOn = ref(store.get('soundOn', true))
const activeTab = ref('read')
const toolsOpen = ref(false)
const readingSize = ref('normal')
const expanded = ref(false)
const guided = ref(false)
const numbered = ref(false)
const guideLine = ref(null)
const currentWord = shallowRef(null)
const imgFailed = ref(false)
const optionsOpen = ref(false)
const optionsButton = ref(null)
const highlightColors = [
  { id: 'yellow', label: 'Yellow', tint: '#f9f2a4' },
  { id: 'red', label: 'Red', tint: '#ffe3e8' },
  { id: 'green', label: 'Green', tint: '#d9f2d9' },
  { id: 'purple', label: 'Purple', tint: '#f1ddf8' },
  { id: 'blue', label: 'Blue', tint: '#dceaff' },
]
const savedHighlight = store.get('paletteHighlight', 'yellow')
const highlightColor = ref(highlightColors.some((color) => color.id === savedHighlight) ? savedHighlight : 'yellow')
const highlightTint = computed(() => highlightColors.find((color) => color.id === highlightColor.value)?.tint || highlightColors[0].tint)
const lastWord = shallowRef(null)
const saying = ref('')
const definitionVoice = new ClipVoice()
const wordAudio = new Audio()
wordAudio.addEventListener('ended', () => { saying.value = '' })
let engine
let holdClips = []
let suppressClick = false
let lastKeyboard = false
let lastPointerType = 'mouse'

const spanish = computed(() => data.value?.lang === 'ES')
const voices = computed(() => data.value?.voices || [])
const vocab = computed(() => Object.entries(data.value?.vocab || {}).map(([id, v]) => ({ id, ...v })).sort((a, b) => a.word.localeCompare(b.word)))
const reviewSummary = computed(() => {
  if (!data.value) return ''
  const t = tally(itemsForPassage(props.id, { gloss: gloss.value, syllables: syllables.value, kid: kidAudio.value, data: data.value }))
  return t.total ? `${t.approved} of ${t.total} word-help items checked by a person.` : 'No computer-made word help for this passage.'
})
const lead = computed(() => {
  if (!data.value) return { titleHtml: '', html: '', image: null }
  const wrap = document.createElement('div')
  wrap.innerHTML = data.value.html || ''
  const figure = wrap.querySelector('figure:has(img)')
  let image = null
  if (figure) {
    const img = figure.querySelector('img')
    image = { src: assetUrl(img.getAttribute('src')), alt: img.getAttribute('alt') || '', caption: figure.querySelector('.image-caption')?.textContent.trim() || '', credit: figure.querySelector('.image-credit')?.textContent.trim() || '' }
    const parent = figure.parentElement
    figure.remove()
    if (parent?.classList.contains('grid-col-6') && !parent.children.length) parent.remove()
  }
  // ReadWorks image paths are relative to the public root, not to the current hash route.
  wrap.querySelectorAll('img').forEach((img) => img.setAttribute('src', assetUrl(img.getAttribute('src'))))
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const words = (list, offset) => list.map((w, i) => `<span class="sa-w" data-l="${offset + i}">${esc(w)}</span>`).join(' ')
  const by = data.value.by_words || []
  const byline = spanish.value && by[0]?.toLowerCase() === 'by' ? ['de', ...by.slice(1)] : by
  return { titleHtml: words(data.value.title_words || [], 0), bylineHtml: byline.length ? words(byline, (data.value.title_words || []).length) : '', html: wrap.innerHTML, image }
})
const fmt = (n) => `${Math.floor((n || 0) / 60)}:${String(Math.floor((n || 0) % 60)).padStart(2, '0')}`
function closeCard({ restoreFocus = false } = {}) {
  definitionVoice.stop()
  const el = anchor.value
  card.value = null
  anchor.value = null
  if (restoreFocus) (el?.querySelector('.sa-w') || el)?.focus?.()
}
function openVocab(sid, el) {
  if (spanish.value) return
  const v = data.value?.vocab?.[sid]
  if (!v) return
  const guide = syllables.value?.[sid] || null
  card.value = { id: sid, sid, pid: props.id, ...v, spanish: v.spanish ? `${v.spanish}` : null, guide, reviewItems: guide ? [syllableItem(props.id, sid, guide)] : [] }
  anchor.value = el
  focusCard.value = lastKeyboard
}
function helpFor(el, keyboard = false) {
  if (!el || !engine || spanish.value) return
  engine.pause()
  wordAudio.pause()
  definitionVoice.stop()
  const def = findDefinition(el, { gloss: gloss.value, kid: kidAudio.value, passageId: props.id, vocab: data.value.vocab, syllables: syllables.value })
  if (!def) {
    closeCard()
    const k = engine.index.get(el)
    if (k !== undefined) engine.playSnippet(k)
    return
  }
  holdClips = def.clips
  card.value = { id: `help:${el.dataset.i ?? 'l' + el.dataset.l}`, hold: true, word: def.word, definition: def.text, guide: def.guide, sid: def.sid, pid: props.id, reviewItems: [...def.items, def.guideItem].filter(Boolean), canSay: def.clips.length > 0 }
  anchor.value = el
  focusCard.value = keyboard
  if (def.clips.length && !keyboard) definitionVoice.play(def.clips)
}
const hold = new HoldDetector({ ms: 500, moveLimit: () => 12, onHold: (el) => { window.getSelection()?.removeAllRanges(); helpFor(el) } })
function onPointerDown(e) {
  lastKeyboard = false
  lastPointerType = e.pointerType || 'mouse'
  if (!soundOn.value || spanish.value || e.button > 0) return
  const el = e.target.closest?.('.sa-w:not(.sa-unread)')
  if (el) hold.down(el, e.clientX, e.clientY)
}
function onPointerUp() {
  if (hold.up().held) {
    suppressClick = true
    setTimeout(() => { suppressClick = false }, 500)
  }
}
function onPointerCancel() { hold.cancel() }
function onClickCapture(e) {
  if (!suppressClick) return
  suppressClick = false
  e.preventDefault()
  e.stopPropagation()
}
function onTextKey(e) {
  lastKeyboard = true
  const el = e.target.closest?.('.sa-w:not(.sa-unread)')
  if (el && (e.key === '?' || (e.shiftKey && e.key === 'Enter'))) {
    e.preventDefault()
    e.stopPropagation()
    helpFor(el, true)
  }
}
function onFocus(e) { lastWord.value = e.target.closest?.('.sa-w:not(.sa-unread)') || lastWord.value }
function onContext(e) { if ((lastPointerType === 'touch' || lastPointerType === 'pen') && e.target.closest?.('.sa-w')) e.preventDefault() }
function onDocPointer(e) {
  if (card.value && !e.target.closest?.('.vpop, [data-vocab-sense-id], .sa-w, .palette-help-button')) closeCard()
}
function onDocKey(e) {
  if (e.key !== 'Escape') return
  if (card.value) closeCard({ restoreFocus: true })
  if (optionsOpen.value) { optionsOpen.value = false; nextTick(() => optionsButton.value?.focus()) }
}
function onImageError(e) {
  const img = e.target
  if (!img.matches?.('.palette-text figure img')) return
  const fallback = document.createElement('div')
  fallback.className = 'palette-image-fallback'
  fallback.setAttribute('role', 'img')
  fallback.setAttribute('aria-label', img.alt || 'Passage picture unavailable')
  fallback.textContent = img.alt || 'Picture coming soon'
  img.replaceWith(fallback)
}
function toggle() { engine?.toggle() }
function setRate(rate) { store.set('rate', rate); engine?.setRate(rate) }
function setVoice(id) { store.set('voice', id); engine?.setVoice(id) }
function setSound(on) { soundOn.value = on; store.set('soundOn', on); engine?.setEnabled(on) }
function setHighlightColor(id) { highlightColor.value = id; store.set('paletteHighlight', id) }
function sayWord(sid) {
  const v = data.value?.vocab?.[sid]
  if (!v) return
  engine?.pause()
  wordAudio.pause()
  if (v.say) {
    wordAudio.src = v.say
    saying.value = sid
    wordAudio.play().catch(() => { saying.value = ''; const k = engine?.kOfSense(sid); if (k != null) engine.playSnippet(k) })
  } else {
    const k = engine?.kOfSense(sid)
    if (k != null) engine.playSnippet(k)
  }
}
function sayFromStory(sid) {
  const k = engine?.kOfSense(sid)
  if (k != null) engine.playSnippet(k)
}
function onCardSay() {
  if (card.value?.hold) { engine?.pause(); definitionVoice.play(holdClips) }
  else sayWord(card.value?.id)
}
function onGuideStart() { engine?.pause(); wordAudio.pause(); definitionVoice.stop() }
function openTab(tab) { activeTab.value = tab; engine?.pause(); closeCard() }
function updateGuideLine() {
  const el = currentWord.value
  const article = textEl.value?.querySelector('.palette-text')
  if (!guided.value || !el || !article?.contains(el)) { guideLine.value = null; return }
  const wordRect = el.getBoundingClientRect()
  const articleRect = article.getBoundingClientRect()
  const lineHeight = parseFloat(getComputedStyle(article).lineHeight) || wordRect.height
  guideLine.value = { top: (wordRect.top - articleRect.top - (lineHeight - wordRect.height) / 2) + 'px', height: lineHeight + 'px' }
}
function onCurrentWord(k) {
  currentWord.value = k >= 0 ? engine?.words[k] : null
  if (guided.value) updateGuideLine()
}
function setReadingSize(size) { readingSize.value = size; nextTick(updateGuideLine) }
function toggleGuided() { guided.value = !guided.value; nextTick(updateGuideLine) }
function toggleExpanded() { expanded.value = !expanded.value; nextTick(updateGuideLine) }

onMounted(async () => {
  document.body.classList.add('palette-active')
  const font = document.createElement('link')
  font.rel = 'stylesheet'
  font.href = 'https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700;800&display=swap'
  font.dataset.paletteFont = ''
  document.head.appendChild(font)
  try {
    // Show the local passage as soon as it arrives. The shared loader can finish
    // bundles and word-help caches in the background for embedded previews.
    const direct = () => fetch(assetUrl(`data/${props.id}.json`)).then((r) => {
      if (!r.ok) throw new Error(`Passage: ${r.status}`)
      return r.json()
    })
    data.value = cleanPassage(await direct())
    if (!data.value) throw new Error('Passage unavailable')
    // Shared word help is optional and must never delay the first reading text.
    loadPassage(props.id).catch(() => null)
  } catch { error.value = 'Could not load this passage.'; return }
  document.title = `${data.value.title} · Sound Along`
  Promise.all([loadSyllables(props.id), loadGloss(props.id), loadKidAudio()]).then(([s, g, k]) => { syllables.value = s; gloss.value = g; kidAudio.value = k })
  await nextTick()
  const el = textEl.value
  if (el && voices.value.length) {
    engine = new SoundAlong({ state, onVocab: openVocab, onCurrent: onCurrentWord, onEnded: () => { currentWord.value = null; guideLine.value = null }, getSafeBottom: () => playerEl.value?.getBoundingClientRect().top || window.innerHeight })
    const pref = store.get('voice', 'human')
    engine.attach(el, voices.value, { voiceId: voices.value.some((v) => v.id === pref) ? pref : voices.value[0].id, rate: state.rate })
    engine.setEnabled(soundOn.value)
  }
  document.addEventListener('pointerup', onPointerUp)
  document.addEventListener('pointercancel', onPointerCancel)
  document.addEventListener('pointerdown', onDocPointer, true)
  document.addEventListener('keydown', onDocKey)
  window.addEventListener('resize', updateGuideLine)
})
onBeforeUnmount(() => {
  engine?.destroy()
  hold.cancel()
  wordAudio.pause()
  definitionVoice.stop()
  document.body.classList.remove('palette-active')
  document.head.querySelector('[data-palette-font]')?.remove()
  document.removeEventListener('pointerup', onPointerUp)
  document.removeEventListener('pointercancel', onPointerCancel)
  document.removeEventListener('pointerdown', onDocPointer, true)
  document.removeEventListener('keydown', onDocKey)
  window.removeEventListener('resize', updateGuideLine)
})
</script>

<template>
  <div class="palette-shell" :class="{ 'palette-expanded': expanded }" :lang="spanish ? 'es' : 'en'" :style="{ '--palette-highlight': highlightTint }">
    <header class="palette-top">
      <a class="palette-brand" href="#/look/palette/">ReadWorks <span>Sound Along</span></a>
      <nav aria-label="Reader navigation"><a href="#/look/palette/">All passages</a><a v-if="data && !spanish" :href="`#/look/palette/kid/${id}`">Kid view <span aria-hidden="true">↗</span></a></nav>
    </header>
    <main v-if="error" class="palette-error"><p>{{ error }}</p><a href="#/look/palette/">Back to passages</a></main>
    <main v-else-if="!data" class="palette-error">Loading passage…</main>
    <main v-else ref="textEl" @pointerdown="onPointerDown" @pointermove="(e) => hold.move(e.clientX, e.clientY)" @click.capture="onClickCapture" @keydown="onTextKey" @focusin="onFocus" @contextmenu="onContext" @error.capture="onImageError">
      <section class="palette-hero" aria-labelledby="palette-heading">
        <div class="palette-hero-inner">
          <div class="palette-hero-copy">
            <a class="palette-back" href="#/look/palette/">← All passages</a>
            <p class="palette-meta">{{ spanish ? `Grado ${data.grade}` : gradeLabel(data.grade) }} <span aria-hidden="true">·</span> {{ data.wordcount || data.words }} {{ spanish ? 'palabras' : 'words' }}</p>
            <h1 id="palette-heading" class="sa-title" v-html="lead.titleHtml"></h1>
            <p v-if="lead.bylineHtml" class="palette-author" v-html="lead.bylineHtml"></p>
          </div>
          <figure class="palette-hero-art" :class="{ 'is-empty': !lead.image || imgFailed }">
            <img v-if="lead.image && !imgFailed" :src="lead.image.src" :alt="lead.image.alt" @error="imgFailed = true" />
            <div v-else class="palette-art-fallback" role="img" :aria-label="lead.image?.alt || 'Passage picture unavailable'">
              <svg viewBox="0 0 180 180" aria-hidden="true"><path d="M90 10 168 66 138 160H42L12 66Z" fill="none" stroke="currentColor" stroke-width="3"/><path d="M90 39 138 74 120 131H60L42 74Z" fill="none" stroke="currentColor" stroke-width="2"/></svg>
              <span>{{ lead.image?.alt || 'Picture coming soon' }}</span>
            </div>
            <figcaption v-if="lead.image?.caption || lead.image?.credit" class="palette-hero-caption"><span>{{ lead.image.caption }}</span><small>{{ lead.image.credit }}</small></figcaption>
          </figure>
        </div>
      </section>
      <div class="palette-subnav" role="tablist" :aria-label="spanish ? 'Secciones' : 'Passage sections'">
        <button role="tab" :aria-selected="activeTab === 'read'" @click="openTab('read')">{{ spanish ? 'Lectura' : 'Passage' }}</button>
        <button role="tab" :aria-selected="activeTab === 'words'" @click="openTab('words')">{{ spanish ? 'Vocabulario' : 'Vocabulary' }} <span>{{ vocab.length }}</span></button>
      </div>
      <div class="palette-body">
        <div class="palette-reading" v-show="activeTab === 'read'">
          <div class="palette-reader-note"><span class="palette-note-mark" aria-hidden="true"></span><span>{{ spanish ? 'Toca una palabra para escuchar desde allí.' : 'Tap a word to hear from there. Press and hold, or press ? on a focused word, for help.' }}</span></div>
          <div class="palette-tools">
            <button type="button" class="palette-tools-toggle" :aria-expanded="toolsOpen" aria-controls="palette-tools-panel" @click="toolsOpen = !toolsOpen">Reading tools <span aria-hidden="true">{{ toolsOpen ? '−' : '+' }}</span></button>
            <div v-if="toolsOpen" id="palette-tools-panel" class="palette-tools-panel">
              <div role="group" aria-label="Text size"><span>Text size</span><button v-for="size in ['small','normal','large']" :key="size" type="button" :aria-pressed="readingSize === size" @click="setReadingSize(size)">{{ size === 'normal' ? 'Medium' : size[0].toUpperCase() + size.slice(1) }}</button></div>
              <div class="palette-tool-switches"><button type="button" :aria-pressed="expanded" @click="toggleExpanded">Distraction-free view</button><button type="button" :aria-pressed="guided" @click="toggleGuided">Guided reading strip</button><button type="button" :aria-pressed="numbered" @click="numbered = !numbered">Paragraph numbers</button></div>
              <p v-if="guided">The strip follows the current line when the passage plays. Tap a word to move to it.</p>
            </div>
          </div>
          <div class="palette-text-wrap" :class="{ 'palette-guided': guided, 'palette-numbered': numbered }">
            <div v-if="guided && guideLine" class="palette-line-guide" :style="guideLine" aria-hidden="true"></div>
            <article class="palette-text sa-text" :class="['palette-size-' + readingSize, { 'sa-off': !soundOn }]" v-html="lead.html"></article>
          </div>
          <p class="palette-credit">{{ data.credit }}</p>
        </div>
        <section v-if="activeTab === 'words'" class="palette-words-panel" aria-labelledby="palette-words-heading">
          <h2 id="palette-words-heading">{{ spanish ? 'Vocabulario' : 'Words to know' }}</h2>
          
          <p v-if="!vocab.length">{{ spanish ? 'Esta lectura no tiene palabras de vocabulario.' : 'No vocabulary words in this passage.' }}</p>
          <div v-for="v in vocab" :key="v.id" class="palette-word-row">
            <button type="button" :aria-label="spanish ? `Escuchar ${v.word}` : `Open word card for ${v.word}`" @click="spanish ? sayFromStory(v.id) : openVocab(v.id, $event.currentTarget)"><span>{{ v.word }}</span><span aria-hidden="true">{{ spanish ? '▶' : '↗' }}</span></button>
            <p>{{ v.definition }}</p>
          </div>
        </section>
        <aside class="palette-side">
          <div class="palette-side-inner">
            <div class="palette-side-title"><span class="palette-pentagon-small" aria-hidden="true"></span><h2>{{ spanish ? 'Sobre la lectura' : 'In this passage' }}</h2></div>
            <dl><dt>{{ spanish ? 'Grado' : 'Grade' }}</dt><dd>{{ gradeLabel(data.grade) }}</dd><dt>Lexile</dt><dd>{{ data.lexile ? `${data.lexile}L` : '—' }}</dd><dt>{{ spanish ? 'Palabras' : 'Words' }}</dt><dd>{{ data.wordcount || data.words }}</dd></dl>
            <div class="palette-side-words" v-if="vocab.length"><h3>{{ spanish ? 'Vocabulario' : 'Words to know' }}</h3><button v-for="v in vocab" :key="v.id" @click="openTab('words')">{{ v.word }} <span aria-hidden="true">→</span></button></div>
            
            <a v-if="!spanish" class="palette-helper-link" :href="`#/focus/${id}`">Open Reading helper ↗</a>
          </div>
        </aside>
      </div>
      <div v-if="voices.length" ref="playerEl" class="palette-player-wrap">
        <div class="palette-player" role="group" :aria-label="spanish ? 'Controles de audio' : 'Sound Along player'">
          <button class="palette-play" type="button" :aria-label="state.playing ? 'Pause narration' : 'Play narration'" :disabled="!soundOn" @click="toggle"><svg v-if="state.playing" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4h3v16H7zm7 0h3v16h-3z"/></svg><svg v-else viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3v18l14-9z"/></svg></button>
          <div class="palette-player-mid"><div class="palette-player-caption"><strong>{{ state.playing ? (spanish ? 'Leyendo' : 'Reading aloud') : (spanish ? 'Escuchar lectura' : 'Listen and read') }}</strong><span>{{ fmt(state.time) }} / {{ fmt(state.duration) }}</span></div><input type="range" min="0" :max="state.duration || 1" step="0.1" :value="state.time" :aria-label="spanish ? 'Posición del audio' : 'Audio position'" :disabled="!soundOn" @input="engine?.seekTime(Number($event.target.value))" /></div>
          <div class="palette-desktop-controls">
            <div v-if="voices.length > 1" class="palette-voice" role="group" aria-label="Voice"><button v-for="v in voices" :key="v.id" type="button" :aria-pressed="state.voiceId === v.id" :disabled="!soundOn" @click="setVoice(v.id)"><span class="palette-face" aria-hidden="true">{{ v.id === 'human' ? '●' : '◆' }}</span><span>{{ VOICE_NAMES[v.id] || v.label }}</span></button></div>
            <div class="palette-speeds" role="group" aria-label="Speed"><button v-for="rate in [0.75, 1, 1.5, 2]" :key="rate" type="button" :aria-pressed="state.rate === rate" :disabled="!soundOn" @click="setRate(rate)"><span v-if="state.rate === rate" aria-hidden="true">&#10003; </span>{{ rate === 0.75 ? 'Slower' : rate === 1 ? 'Normal' : rate === 1.5 ? 'Faster' : 'Fastest' }} <small v-if="rate !== 1">{{ rate }}x</small></button></div>
          <div class="palette-highlights" role="group" aria-label="Highlight color"><span class="palette-highlights-label">Highlight color</span><button v-for="color in highlightColors" :key="color.id" type="button" :aria-label="`${color.label} highlight`" :aria-pressed="highlightColor === color.id" :title="color.label" @click="setHighlightColor(color.id)"><span :style="{ background: color.tint }"></span></button></div>
            <button class="palette-sound" type="button" :aria-pressed="soundOn" @click="setSound(!soundOn)">{{ soundOn ? 'Sound on' : 'Sound off' }}</button>
          </div>
          <button ref="optionsButton" class="palette-mobile-menu" type="button" :aria-expanded="optionsOpen" aria-controls="palette-options" @click="optionsOpen = !optionsOpen">Voice &amp; speed</button>
        </div>
        <div v-show="optionsOpen" id="palette-options" class="palette-options" role="group" aria-label="Voice and speed options">
          <div v-if="voices.length > 1" class="palette-voice" role="group" aria-label="Voice"><button v-for="v in voices" :key="v.id" type="button" :aria-pressed="state.voiceId === v.id" :disabled="!soundOn" @click="setVoice(v.id)"><span class="palette-face" aria-hidden="true">{{ v.id === 'human' ? '●' : '◆' }}</span><span>{{ VOICE_NAMES[v.id] || v.label }}</span></button></div>
          <div class="palette-speeds" role="group" aria-label="Speed"><button v-for="rate in [0.75, 1, 1.5, 2]" :key="rate" type="button" :aria-pressed="state.rate === rate" :disabled="!soundOn" @click="setRate(rate)"><span v-if="state.rate === rate" aria-hidden="true">&#10003; </span>{{ rate === 0.75 ? 'Slower' : rate === 1 ? 'Normal' : rate === 1.5 ? 'Faster' : 'Fastest' }} <small v-if="rate !== 1">{{ rate }}x</small></button></div>
          <div class="palette-highlights" role="group" aria-label="Highlight color"><span class="palette-highlights-label">Highlight color</span><button v-for="color in highlightColors" :key="color.id" type="button" :aria-label="`${color.label} highlight`" :aria-pressed="highlightColor === color.id" :title="color.label" @click="setHighlightColor(color.id)"><span :style="{ background: color.tint }"></span></button></div>
          <button class="palette-sound" type="button" :aria-pressed="soundOn" @click="setSound(!soundOn)">{{ soundOn ? 'Sound on' : 'Sound off' }}</button>
        </div>
        <p v-if="state.error" class="palette-audio-error">{{ state.error }} <button @click="engine?.retry()">Try again</button></p>
      </div>
    </main>
    <VocabCard v-if="card && anchor" :card="card" :anchor="anchor" :focus-on-open="focusCard" :saying="saying === card.id" @close="closeCard({ restoreFocus: true })" @say="onCardSay" @guide-start="onGuideStart" />
  </div>
</template>
