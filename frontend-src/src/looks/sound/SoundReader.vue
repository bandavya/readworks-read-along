<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from 'vue'
import { assetUrl, gradeLabel, loadPassage, store, VOICE_NAMES } from '../../api'
import { SoundAlong } from '../../soundAlong'
import { HoldDetector } from '../../hold'
import { findDefinition } from '../../defs'
import { loadGloss, loadKidAudio, loadSyllables, ClipVoice } from '../../kidAudio'
import { itemsForPassage, tally, syllableItem } from '../../review'
import VocabCard from '../../components/VocabCard.vue'
import SyllableGuide from '../../components/SyllableGuide.vue'
import { SoundRibbon } from './ribbon'
import './sound.css'

const props = defineProps({ id: String })
const data = shallowRef(null)
const error = ref('')
const textEl = ref(null)
const articleEl = ref(null)
const dockEl = ref(null)
const gloss = shallowRef(null)
const syllables = shallowRef(null)
const kidAudio = shallowRef(null)
const extrasReady = ref(false)
const state = reactive({ playing: false, time: 0, duration: 0, rate: store.get('rate', 1), voiceId: '', error: '' })
const soundOn = ref(store.get('soundOn', true))
const calm = ref(false)
const wordsOpen = ref(false)
const optionsOpen = ref(false)
const card = ref(null)
const anchor = shallowRef(null)
const focusCard = ref(false)
const imageFailed = ref(false)
const saying = ref('')
const defVoice = new ClipVoice()
const wordAudio = new Audio()
wordAudio.addEventListener('ended', () => { saying.value = '' })
let engine
let ribbon
let holdClips = []
let suppressClick = false
let lastPointerType = 'mouse'

const spanish = computed(() => data.value?.lang === 'ES')
const voices = computed(() => data.value?.voices || [])
const vocab = computed(() => Object.entries(data.value?.vocab || {}).map(([id, v]) => ({ id, ...v })).sort((a, b) => a.word.localeCompare(b.word)))
const reviewSummary = computed(() => {
  if (!data.value) return ''
  if (!extrasReady.value) return 'Loading word-help review status…'
  const t = tally(itemsForPassage(props.id, { gloss: gloss.value, syllables: syllables.value, kid: kidAudio.value, data: data.value }))
  return t.total ? `${t.approved} of ${t.total} word-help items checked by a person.` : 'No computer-made word help for this passage.'
})
const prepared = computed(() => {
  if (!data.value) return { html: '', image: null }
  const wrap = document.createElement('div')
  wrap.innerHTML = data.value.html || ''
  const figure = wrap.querySelector('figure:has(img)')
  let image = null
  if (figure) {
    const img = figure.querySelector('img')
    image = { src: assetUrl(img.getAttribute('src')), alt: img.alt || '', caption: figure.querySelector('.image-caption')?.textContent.trim() || '', credit: figure.querySelector('.image-credit')?.textContent.trim() || '' }
    figure.remove()
  }
  wrap.querySelectorAll('img').forEach((img) => img.setAttribute('src', assetUrl(img.getAttribute('src'))))
  return { html: wrap.innerHTML, image }
})
const lead = computed(() => {
  if (!data.value) return ''
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const title = (data.value.title_words || []).map((w, i) => `<span class="sa-w" data-l="${i}">${esc(w)}</span>`).join(' ')
  const by = data.value.by_words || []
  const shown = spanish.value && by[0]?.toLowerCase() === 'by' ? ['de', ...by.slice(1)] : by
  const author = shown.map((w, i) => `<span class="sa-w" data-l="${i + (data.value.title_words || []).length}">${esc(w)}</span>`).join(' ')
  return `<h1 class="sa-title">${title || esc(data.value.title)}</h1>${author ? `<p class="sa-byline">${author}</p>` : ''}`
})
const fmt = (n) => `${Math.floor((n || 0) / 60)}:${String(Math.floor((n || 0) % 60)).padStart(2, '0')}`

function closeCard({ restoreFocus = false } = {}) {
  defVoice.stop()
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
  focusCard.value = true
}
function helpFor(el, keyboard = false) {
  if (!el || !engine || spanish.value) return
  engine.pause()
  wordAudio.pause()
  defVoice.stop()
  const def = findDefinition(el, { gloss: gloss.value, kid: kidAudio.value, passageId: props.id, vocab: data.value.vocab, syllables: syllables.value })
  if (!def) { closeCard(); const k = engine.index.get(el); if (k != null) engine.playSnippet(k); return }
  holdClips = def.clips
  card.value = { id: `help:${el.dataset.i ?? 'l' + el.dataset.l}`, hold: true, word: def.word, definition: def.text, guide: def.guide, sid: def.sid, pid: props.id, reviewItems: [...def.items, def.guideItem].filter(Boolean), canSay: def.clips.length > 0 }
  anchor.value = el
  focusCard.value = keyboard
  if (def.clips.length && !keyboard) defVoice.play(def.clips)
}
const hold = new HoldDetector({ ms: 500, moveLimit: () => 12, onHold: (el) => { window.getSelection()?.removeAllRanges(); helpFor(el) } })
function onPointerDown(e) {
  lastPointerType = e.pointerType || 'mouse'
  if (!soundOn.value || spanish.value || e.button > 0) return
  const el = e.target.closest?.('.sa-w:not(.sa-unread)')
  if (el) hold.down(el, e.clientX, e.clientY)
}
function onPointerUp() { if (hold.up().held) { suppressClick = true; setTimeout(() => { suppressClick = false }, 500) } }
function onPointerCancel() { hold.cancel() }
function onClickCapture(e) { if (suppressClick) { suppressClick = false; e.preventDefault(); e.stopPropagation() } }
function onTextKey(e) {
  const el = e.target.closest?.('.sa-w:not(.sa-unread)')
  if (el && (e.key === '?' || (e.shiftKey && e.key === 'Enter'))) { e.preventDefault(); e.stopPropagation(); helpFor(el, true) }
}
function onContext(e) { if (['touch', 'pen'].includes(lastPointerType) && e.target.closest?.('.sa-w')) e.preventDefault() }
function onDocumentKey(e) { if (e.key === 'Escape') { if (card.value) closeCard({ restoreFocus: true }); optionsOpen.value = false; wordsOpen.value = false } }
function onDocumentPointer(e) { if (card.value && !e.target.closest?.('.vpop, [data-vocab-sense-id], .sa-w, .sound-word-button')) closeCard() }
function onImageError(e) {
  const img = e.target
  if (!img.matches?.('.sound-text img')) return
  const box = document.createElement('div')
  box.className = 'sound-image-missing'
  box.setAttribute('role', 'img')
  box.setAttribute('aria-label', img.alt || 'Picture unavailable')
  box.textContent = img.alt || 'Picture unavailable'
  img.replaceWith(box)
}
function setRate(rate) { store.set('rate', rate); engine?.setRate(rate) }
function setVoice(id) { store.set('voice', id); engine?.setVoice(id) }
function setSound(on) { soundOn.value = on; store.set('soundOn', on); engine?.setEnabled(on); if (!on) closeCard() }
function sayWord(sid) {
  const v = data.value?.vocab?.[sid]
  if (!v) return
  engine?.pause()
  wordAudio.pause()
  if (v.say) { wordAudio.src = assetUrl(v.say); saying.value = sid; wordAudio.play().catch(() => { saying.value = ''; sayFromStory(sid) }) }
  else sayFromStory(sid)
}
function sayFromStory(sid) { const k = engine?.kOfSense(sid); if (k != null) engine.playSnippet(k) }
function onCardSay() { if (card.value?.hold) { engine?.pause(); defVoice.play(holdClips) } else sayWord(card.value?.id) }
function onGuideStart() { engine?.pause(); wordAudio.pause(); defVoice.stop() }

onMounted(async () => {
  document.body.classList.add('sound-active')
  try { data.value = await loadPassage(props.id) } catch { error.value = 'Could not load this passage.'; return }
  document.title = `${data.value.title} · Sound Along`
  Promise.all([loadSyllables(props.id), loadGloss(props.id), loadKidAudio()]).then(([s, g, k]) => { syllables.value = s; gloss.value = g; kidAudio.value = k; extrasReady.value = true })
  await nextTick()
  if (voices.value.length) {
    engine = new SoundAlong({ state, onVocab: openVocab, getSafeBottom: () => dockEl.value?.getBoundingClientRect().top || window.innerHeight })
    const pref = store.get('voice', 'human')
    engine.attach(textEl.value, voices.value, { voiceId: voices.value.some((v) => v.id === pref) ? pref : voices.value[0].id, rate: state.rate })
    engine.setEnabled(soundOn.value)
    ribbon = new SoundRibbon(articleEl.value, engine, { calm: () => calm.value })
  }
  document.addEventListener('pointerup', onPointerUp)
  document.addEventListener('pointercancel', onPointerCancel)
  document.addEventListener('pointerdown', onDocumentPointer, true)
  document.addEventListener('keydown', onDocumentKey)
})
onBeforeUnmount(() => {
  ribbon?.destroy(); engine?.destroy(); hold.cancel(); wordAudio.pause(); defVoice.stop()
  document.body.classList.remove('sound-active')
  document.removeEventListener('pointerup', onPointerUp)
  document.removeEventListener('pointercancel', onPointerCancel)
  document.removeEventListener('pointerdown', onDocumentPointer, true)
  document.removeEventListener('keydown', onDocumentKey)
})
watch(wordsOpen, (open) => { if (open) { engine?.pause(); closeCard() } })
</script>

<template>
  <div class="sound-shell" :lang="spanish ? 'es' : 'en'">
    <header class="sound-top"><a href="#/" class="sound-brand">ReadWorks <span>Sound Along</span></a><nav aria-label="Reader navigation"><a href="#/">All passages</a><a v-if="data && !spanish" :href="`#/kid/${id}`">Kid view</a></nav></header>
    <main v-if="error" class="sound-message"><p>{{ error }}</p><a href="#/">All passages</a></main>
    <main v-else-if="!data" class="sound-message">Loading passage…</main>
    <main v-else ref="textEl" @pointerdown="onPointerDown" @pointermove="(e) => hold.move(e.clientX, e.clientY)" @click.capture="onClickCapture" @keydown="onTextKey" @contextmenu="onContext" @error.capture="onImageError">
      <div class="sound-layout">
        <div class="sound-main">
          <div class="sound-intro"><div><p class="sound-meta">{{ gradeLabel(data.grade) }} <span>·</span> {{ data.wordcount || data.words }} {{ spanish ? 'palabras' : 'words' }}</p><div class="sound-lead" v-html="lead"></div></div><figure v-if="prepared.image && !imageFailed" class="sound-cover"><img :src="prepared.image.src" :alt="prepared.image.alt" @error="imageFailed = true"><figcaption v-if="prepared.image.caption || prepared.image.credit">{{ prepared.image.caption }} <small>{{ prepared.image.credit }}</small></figcaption></figure></div>
          <div class="sound-tools"><p>{{ spanish ? 'Toca una palabra para escuchar desde allí.' : 'Tap a word to read from there. Hold it or press ? for help.' }}</p><button type="button" :aria-pressed="calm" @click="calm = !calm">{{ calm ? 'Show sound ribbon' : 'Calm underline' }}</button></div>
          <div v-show="!wordsOpen" ref="articleEl" class="sound-article"><article class="sound-text sa-text" :class="{ 'sa-off': !soundOn }" v-html="prepared.html"></article><p class="sound-credit">{{ data.credit }}</p></div>
          <section v-if="wordsOpen" class="sound-words" aria-label="Words to know"><h2>{{ spanish ? 'Vocabulario' : 'Words to know' }}</h2><p v-if="!vocab.length">No vocabulary words in this passage.</p><div v-for="v in vocab" :key="v.id" class="sound-word"><div><button class="sound-word-button" type="button" @click="spanish ? sayFromStory(v.id) : openVocab(v.id, $event.currentTarget)">{{ v.word }}</button><span v-if="v.pos">{{ v.pos }}</span></div><SyllableGuide v-if="!spanish && syllables?.[v.id]" :entry="syllables[v.id]" :pid="id" :sid="v.id" note="full" @start="onGuideStart" /><p>{{ v.definition }}</p><p v-if="v.example" class="sound-example">{{ v.example }}</p></div></section>
        </div>
        <aside class="sound-aside"><button class="sound-section" type="button" :aria-pressed="!wordsOpen" @click="wordsOpen = false">Read passage <span aria-hidden="true">↗</span></button><button class="sound-section" type="button" :aria-pressed="wordsOpen" @click="wordsOpen = true">Words to know <strong>{{ vocab.length }}</strong></button><div class="sound-aside-detail"><p>The sound line follows the words you hear. Tap any word to start there.</p><dl><dt>Grade</dt><dd>{{ gradeLabel(data.grade) }}</dd><dt>Lexile</dt><dd>{{ data.lexile ? `${data.lexile}L` : '—' }}</dd></dl></div></aside>
      </div>
      <div v-if="voices.length" ref="dockEl" class="sound-dock"><div class="sound-player" role="group" aria-label="Sound Along player"><button class="sound-play" type="button" :aria-label="state.playing ? 'Pause narration' : 'Play narration'" :disabled="!soundOn" @click="engine?.toggle()"><svg v-if="state.playing" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4h4v16H6zm8 0h4v16h-4z"/></svg><svg v-else viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3v18l15-9z"/></svg></button><div class="sound-progress"><label for="sound-position">{{ state.playing ? 'Reading aloud' : 'Listen and read' }} <span>{{ fmt(state.time) }} / {{ fmt(state.duration) }}</span></label><input id="sound-position" type="range" min="0" :max="state.duration || 1" step="0.1" :value="state.time" aria-label="Audio position" :disabled="!soundOn" @input="engine?.seekTime(Number($event.target.value))"></div><div class="sound-desktop-settings"><div v-if="voices.length > 1" class="sound-choice" role="group" aria-label="Voice"><button v-for="v in voices" :key="v.id" type="button" :aria-pressed="state.voiceId === v.id" @click="setVoice(v.id)">{{ VOICE_NAMES[v.id] || v.label }}</button></div><div class="sound-choice" role="group" aria-label="Speed"><button v-for="rate in [0.75, 1, 1.5, 2]" :key="rate" type="button" :aria-pressed="state.rate === rate" @click="setRate(rate)">{{ rate === 1 ? '1×' : `${rate}×` }}</button></div><button class="sound-on" type="button" :aria-pressed="soundOn" @click="setSound(!soundOn)">Sound {{ soundOn ? 'on' : 'off' }}</button></div><button class="sound-options-button" type="button" :aria-expanded="optionsOpen" @click="optionsOpen = !optionsOpen">Voice &amp; speed</button></div><div v-if="optionsOpen" class="sound-options"><div v-if="voices.length > 1" class="sound-choice" role="group" aria-label="Voice"><button v-for="v in voices" :key="v.id" type="button" :aria-pressed="state.voiceId === v.id" @click="setVoice(v.id)">{{ VOICE_NAMES[v.id] || v.label }}</button></div><div class="sound-choice" role="group" aria-label="Speed"><button v-for="rate in [0.75, 1, 1.5, 2]" :key="rate" type="button" :aria-pressed="state.rate === rate" @click="setRate(rate)">{{ rate === 1 ? '1×' : `${rate}×` }}</button></div><button class="sound-on" type="button" :aria-pressed="soundOn" @click="setSound(!soundOn)">Sound {{ soundOn ? 'on' : 'off' }}</button></div><p v-if="state.error" class="sound-error">{{ state.error }} <button @click="engine?.retry()">Try again</button></p></div>
    </main>
    <VocabCard v-if="card && anchor" :card="card" :anchor="anchor" :focus-on-open="focusCard" :saying="saying === card.id" @close="closeCard({ restoreFocus: true })" @say="onCardSay" @guide-start="onGuideStart" />
  </div>
</template>
