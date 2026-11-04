<script setup>
import { ref, shallowRef, reactive, computed, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { cleanPassage, loadPassage, gradeLabel, VOICE_NAMES, assetUrl, store } from '../../api'
import { SoundAlong } from '../../soundAlong'
import { loadGloss, loadSyllables, loadKidAudio, ClipVoice } from '../../kidAudio'
import { HoldDetector } from '../../hold'
import { findDefinition } from '../../defs'
import { itemsForPassage, tally, syllableItem } from '../../review'
import ReviewMark from '../../components/ReviewMark.vue'
import SyllableGuide from '../../components/SyllableGuide.vue'
import './storybook.css'

const props = defineProps({ route: Object })
const id = computed(() => props.route.id)
const data = shallowRef(null)
const gloss = shallowRef(null)
const syllables = shallowRef(null)
const kidAudio = shallowRef(null)
const extrasReady = ref(false)
const error = ref('')
const section = ref('story')
const spread = ref(0)
const mobilePage = ref(0)
const turnDirection = ref('')
const settingsOpen = ref(false)
const note = ref(null)
const textEl = ref(null)
const playerEl = ref(null)
const remembered = (key, fallback) => { try { return store.get(key, fallback) } catch { return fallback } }
const remember = (key, value) => { try { store.set(key, value) } catch { /* Storage is optional. */ } }
const state = reactive({ playing: false, time: 0, duration: 0, rate: remembered('rate', 1), voiceId: '', error: '' })
const voices = computed(() => data.value?.voices || [])
const vocab = computed(() => Object.entries(data.value?.vocab || {}).map(([sid, v]) => ({ sid, ...v })).sort((a, b) => a.word.localeCompare(b.word)))
const clip = new ClipVoice()
const wordAudio = new Audio()
let engine = null
let lastWord = null
let keyboard = false
let suppressClick = false
let pointerType = 'mouse'
let noteClips = []
let turnTimer = 0
const hold = new HoldDetector({ ms: 500, moveLimit: () => 12, onHold: openWordHelp })

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const lead = (words, offset) => words.map((w, i) => `<span class="sa-w" data-l="${offset + i}">${esc(w)}</span>`).join(' ')

// Each body paragraph stays intact. Its original word spans and data indices are never rebuilt by a page turn.
const pages = computed(() => {
  const d = data.value
  if (!d) return []
  const source = document.createElement('div')
  source.innerHTML = d.html || ''
  const figures = [...source.querySelectorAll('figure')]
  const firstFigure = figures.shift()
  for (const f of [firstFigure, ...figures].filter(Boolean)) f.remove()
  const title = `<div class="sb-title-block"><h1>${lead(d.title_words || [], 0)}</h1>${d.by_words?.length ? `<p class="sb-byline">${lead(d.by_words, d.title_words.length)}</p>` : ''}</div>`
  const opening = `${title}${firstFigure?.outerHTML || ''}`
  const result = [{ html: opening, kind: 'opening' }]
  let part = []
  let count = 0
  function flush() { if (part.length) { result.push({ html: part.join(''), kind: 'body' }); part = []; count = 0 } }
  for (const child of source.children) {
    const words = child.querySelectorAll('.sa-w:not(.sa-unread)').length
    if (count && (count + words > 105 || part.length >= 2)) flush()
    part.push(child.outerHTML)
    count += words
  }
  flush()
  for (const f of figures) result.push({ html: f.outerHTML, kind: 'picture' })
  return result
})
const spreads = computed(() => Math.ceil(pages.value.length / 2))
const currentPage = computed(() => Math.min(pages.value.length, spread.value * 2 + 1))
const reviewSummary = computed(() => {
  if (!data.value) return ''
  if (!extrasReady.value) return 'Loading word-help review status…'
  const t = tally(itemsForPassage(id.value, { gloss: gloss.value, syllables: syllables.value, kid: kidAudio.value, data: data.value }))
  return t.total ? `${t.approved} of ${t.total} word-help items checked by a person${t.fix ? `; ${t.fix} flagged for a fix` : ''}.` : 'No computer-made word help for this passage.'
})
function turnTo(n) {
  const next = Math.max(0, Math.min(spreads.value - 1, n))
  if (next === spread.value) return
  turnDirection.value = next > spread.value ? 'forward' : 'back'
  spread.value = next
  mobilePage.value = next * 2
  clearTimeout(turnTimer)
  turnTimer = setTimeout(() => { turnDirection.value = '' }, 480)
  closeNote()
}
function turnPage(step) {
  if (window.matchMedia('(max-width: 600px)').matches) {
    const next = Math.max(0, Math.min(pages.value.length - 1, mobilePage.value + step))
    turnDirection.value = next > mobilePage.value ? 'forward' : 'back'
    mobilePage.value = next
    spread.value = Math.floor(next / 2)
    closeNote()
  } else turnTo(spread.value + step)
  nextTick(() => {
    const page = textEl.value?.querySelector(`[data-page="${window.matchMedia('(max-width: 600px)').matches ? mobilePage.value : spread.value * 2}"]`)
    const first = page?.querySelector('.sa-w:not(.sa-unread)')
    const k = engine?.index.get(first)
    if (k !== undefined) engine?._applyRoving(k)
  })
}
function onCurrent(k) {
  const el = engine?.words[k]
  const page = el?.closest('[data-page]')
  if (page) {
    const n = Number(page.dataset.page)
    if (Math.floor(n / 2) !== spread.value) turnTo(Math.floor(n / 2))
    mobilePage.value = n
  }
}
function closeNote(restore = false) {
  clip.stop()
  const anchor = note.value?.anchor
  note.value = null
  if (restore) (anchor?.querySelector('.sa-w') || anchor)?.focus?.()
}
function openVocab(sid, anchor) {
  const v = data.value?.vocab?.[sid]
  if (!v) return
  engine?.pause()
  closeNote()
  noteClips = []
  note.value = { anchor, sid, word: v.word, definition: v.definition, example: v.example, pos: v.pos, spanish: v.spanish, guide: syllables.value?.[sid], items: syllables.value?.[sid] ? [syllableItem(id.value, sid, syllables.value[sid])] : [] }
  if (keyboard) nextTick(() => document.querySelector('.sb-note-close')?.focus())
}
function openWordHelp(el) {
  if (!engine || !data.value) return
  engine.pause()
  wordAudio.pause()
  clip.stop()
  window.getSelection()?.removeAllRanges()
  const d = findDefinition(el, { gloss: gloss.value, kid: kidAudio.value, passageId: id.value, vocab: data.value.vocab, syllables: syllables.value })
  if (!d) { closeNote(); const k = engine.index.get(el); if (k !== undefined) engine.playSnippet(k); return }
  noteClips = d.clips
  note.value = { anchor: el, word: d.word, definition: d.text, guide: d.guide, sid: d.sid, items: [...d.items, d.guideItem].filter(Boolean), canSay: d.clips.length > 0 }
  if (d.clips.length) clip.play(d.clips)
  if (keyboard) nextTick(() => document.querySelector('.sb-note-close')?.focus())
}
function helpWord() {
  const el = document.activeElement?.closest?.('.sb-book .sa-w:not(.sa-unread)') || lastWord || textEl.value?.querySelector('.sa-now') || textEl.value?.querySelector('.sa-w:not(.sa-unread)')
  if (el) openWordHelp(el)
}
function onKey(e) {
  keyboard = true
  if (e.key === 'Escape') { closeNote(true); settingsOpen.value = false }
  if (e.key === 'F2' && textEl.value?.contains(document.activeElement)) { e.preventDefault(); helpWord() }
  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft' || e.key === 'Home' || e.key === 'End') {
    const word = document.activeElement?.closest?.('.sb-book .sa-w:not(.sa-unread)')
    const k = engine?.index.get(word)
    if (k === undefined) return
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? engine.words.length - 1 : k + (e.key === 'ArrowRight' ? 1 : -1)
    const target = engine.words[next]
    if (!target) return
    const page = Number(target.closest('[data-page]')?.dataset.page)
    if (page !== mobilePage.value || Math.floor(page / 2) !== spread.value) {
      e.preventDefault(); e.stopPropagation()
      turnTo(Math.floor(page / 2)); mobilePage.value = page
      nextTick(() => { engine?._applyRoving(next); target.focus() })
    }
  }
}
function onPointerDown(e) {
  keyboard = false
  pointerType = e.pointerType || 'mouse'
  if (!engine || e.button > 0) return
  const el = e.target.closest?.('.sa-w:not(.sa-unread)')
  if (el) { lastWord = el; hold.down(el, e.clientX, e.clientY) }
}
function onPointerUp() { if (hold.up().held) { suppressClick = true; setTimeout(() => { suppressClick = false }, 500) } }
function onTextClick(e) { if (suppressClick) { suppressClick = false; e.stopImmediatePropagation?.(); e.stopPropagation(); e.preventDefault() } }
function onContextMenu(e) { if ((pointerType === 'touch' || pointerType === 'pen') && e.target.closest('.sa-w')) e.preventDefault() }
function onOutside(e) { if (note.value && !e.target.closest('.sb-note, .sb-book [data-vocab-sense-id], .sb-help')) closeNote() }
function onImageError(e) {
  const img = e.target
  if (!(img instanceof HTMLImageElement) || img.dataset.missing) return
  img.dataset.missing = 'true'
  const box = document.createElement('div')
  box.className = 'sb-picture-missing'
  box.setAttribute('role', 'img')
  box.setAttribute('aria-label', img.alt || 'Picture unavailable')
  box.textContent = 'Picture unavailable'
  img.replaceWith(box)
}
function setVoice(value) { remember('voice', value); engine?.setVoice(value) }
function setRate(value) { const rate = Number(value); remember('rate', rate); engine?.setRate(rate) }
function sayVocab(v) {
  engine?.pause(); clip.stop(); wordAudio.pause()
  if (v.say) { wordAudio.src = assetUrl(v.say); wordAudio.play().catch(() => { const k = engine?.kOfSense(v.sid); if (k != null) engine.playSnippet(k) }) }
  else { const k = engine?.kOfSense(v.sid); if (k != null) engine.playSnippet(k) }
}
function timeText(t) { const s = Math.max(0, Math.floor(t || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` }
function onSeek(e) { engine?.seekTime(Number(e.target.value)) }

onMounted(async () => {
  document.addEventListener('keydown', onKey, true)
  document.addEventListener('pointerdown', onOutside, true)
  document.addEventListener('pointerup', onPointerUp)
  document.addEventListener('pointercancel', () => hold.cancel())
  if (props.route.screen !== 'p' || !id.value) return
  try {
    const response = await fetch(assetUrl(`data/${id.value}.json`))
    if (!response.ok) throw new Error(`Passage: ${response.status}`)
    data.value = cleanPassage(await response.json())
    if (!data.value) throw new Error('Passage unavailable')
  } catch { error.value = 'Could not load this passage.'; return }
  document.title = `${data.value.title} · Sound Along`
  loadPassage(id.value).catch(() => null)
  Promise.allSettled([loadGloss(id.value), loadSyllables(id.value), loadKidAudio()]).then(([g, s, k]) => {
    gloss.value = g.status === 'fulfilled' ? g.value : null
    syllables.value = s.status === 'fulfilled' ? s.value : null
    kidAudio.value = k.status === 'fulfilled' ? k.value : null
    extrasReady.value = true
  })
  await nextTick()
  const el = textEl.value
  el.addEventListener('error', onImageError, true)
  el.querySelectorAll('img').forEach(img => {
    const src = img.getAttribute('src')
    if (src && !/^(?:[a-z]+:|\/)/i.test(src)) img.src = assetUrl(src)
    if (img.complete && img.naturalWidth === 0) onImageError({ target: img })
  })
  el.addEventListener('pointerdown', onPointerDown)
  el.addEventListener('pointermove', e => hold.move(e.clientX, e.clientY))
  el.addEventListener('click', onTextClick, true)
  el.addEventListener('contextmenu', onContextMenu)
  if (voices.value.length) {
    engine = new SoundAlong({ state, onVocab: openVocab, onCurrent, getSafeBottom: () => playerEl.value?.getBoundingClientRect().top || window.innerHeight, follow: false })
    const pref = remembered('voice', 'human')
    engine.attach(el, voices.value, { voiceId: voices.value.some(v => v.id === pref) ? pref : voices.value[0].id, rate: state.rate })
  }
})
onBeforeUnmount(() => {
  clearTimeout(turnTimer); engine?.destroy(); clip.stop(); wordAudio.pause(); hold.cancel()
  document.removeEventListener('keydown', onKey, true)
  document.removeEventListener('pointerdown', onOutside, true)
  document.removeEventListener('pointerup', onPointerUp)
  textEl.value?.removeEventListener('error', onImageError, true)
})
</script>

<template>
  <div class="sb-shell">
    <header class="sb-header"><a href="#/look/storybook/" class="sb-brand">ReadWorks <span>Sound Along</span></a><a class="sb-all" href="#/look/storybook/">All passages</a></header>
    <main v-if="route.screen !== 'p' || !id" class="sb-empty"><h1>Sound Along</h1><a href="#/look/storybook/">Open the library</a></main>
    <main v-else-if="error" class="sb-empty"><p>{{ error }}</p><a href="#/">All passages</a></main>
    <main v-else-if="!data" class="sb-empty">Opening the book…</main>
    <main v-else class="sb-main" :lang="data.lang === 'ES' ? 'es' : 'en'">
      <div class="sb-above"><p>{{ gradeLabel(data.grade) }}<span v-if="data.lexile"> · {{ data.lexile }}L</span><span v-if="data.wordcount"> · {{ data.wordcount }} words</span></p><a :href="`#/look/storybook/kid/${id}`">Open kid view <span aria-hidden="true">↗</span></a></div>
      <div class="sb-reading-layout">
        <div class="sb-book-area">
          <nav class="sb-sections" aria-label="Book sections"><button :aria-current="section === 'story' ? 'page' : undefined" @click="section = 'story'">Read the passage</button><button :aria-current="section === 'vocab' ? 'page' : undefined" @click="section = 'vocab'; engine?.pause()">Words to know <span>{{ vocab.length }}</span></button></nav>
          <div v-show="section === 'story'">
            <p class="sb-instruction">Tap a word to hear it, or hold it for help.</p>
            <div ref="textEl" class="sb-book" :class="{ 'sb-turn-forward': turnDirection === 'forward', 'sb-turn-back': turnDirection === 'back' }" :key="id">
              <article v-for="(page, i) in pages" :key="i" class="sb-page" :class="[page.kind, { 'sb-page-visible': Math.floor(i / 2) === spread, 'sb-mobile-visible': i === mobilePage }]" :data-page="i" v-html="page.html"></article>
            </div>
            <div class="sb-page-controls"><button :disabled="spread === 0 && mobilePage === 0" @click="engine?.pause(); turnPage(-1)"><span aria-hidden="true">←</span> Previous</button><span class="sb-desktop-pages">Pages {{ currentPage }}<template v-if="currentPage + 1 <= pages.length">–{{ currentPage + 1 }}</template> of {{ pages.length }}</span><span class="sb-phone-pages">Page {{ mobilePage + 1 }} of {{ pages.length }}</span><button :disabled="spread >= spreads - 1 && mobilePage >= pages.length - 1" @click="engine?.pause(); turnPage(1)">Next <span aria-hidden="true">→</span></button></div>
            <p v-if="data.credit" class="sb-credit">{{ data.credit }}</p>
          </div>
          <section v-if="section === 'vocab'" class="sb-vocab"><h2>Words to know</h2><dl v-if="vocab.length"><template v-for="v in vocab" :key="v.sid"><dt><button @click="sayVocab(v)" :aria-label="`Hear ${v.word}`">{{ v.word }} <span aria-hidden="true">♪</span></button><small v-if="v.pos">{{ v.pos }}</small></dt><dd><SyllableGuide v-if="syllables?.[v.sid]" :entry="syllables[v.sid]" :pid="id" :sid="v.sid" note="full" @start="engine?.pause(); wordAudio.pause(); clip.stop()" /><p>{{ v.definition }}</p><p v-if="v.example">{{ v.example }}</p><p v-if="v.spanish" lang="es">En español: {{ v.spanish }} </p></dd></template></dl><p v-else>This passage has no vocabulary words.</p></section>
        </div>
        <aside class="sb-margin"><div class="sb-bookmark"><span class="sb-bookmark-notch" aria-hidden="true"></span><p>Need a word?</p><button class="sb-help" @click="helpWord">Help with a word <span>F2</span></button><div v-if="voices.length" class="sb-margin-settings"><span v-if="voices.length > 1" class="sb-choice-label">Voice</span><div v-if="voices.length > 1" class="sb-choice-list"><button v-for="v in voices" :key="v.id" :aria-pressed="state.voiceId === v.id" @click="setVoice(v.id)">{{ VOICE_NAMES[v.id] || v.label }}</button></div><span class="sb-choice-label">Speed</span><div class="sb-choice-list"><button v-for="rate in [0.75, 1, 1.25, 1.5, 2]" :key="rate" :aria-pressed="Number(state.rate) === rate" @click="setRate(rate)">{{ rate }}×</button></div></div></div></aside>
      </div>
      <aside v-if="note" class="sb-note" role="dialog" aria-modal="false" :aria-label="`Help with ${note.word}`"><div class="sb-note-top"><span>Word help</span><button class="sb-note-close" aria-label="Close word help" @click="closeNote(true)">×</button></div><h2>{{ note.word }}</h2><p v-if="note.pos" class="sb-pos">{{ note.pos }}</p><ReviewMark v-if="note.items?.length" :items="note.items" :pid="id" /><SyllableGuide v-if="note.guide" :entry="note.guide" :pid="id" :sid="note.sid || ''" note="full" @start="engine?.pause(); wordAudio.pause(); clip.stop()" /><button v-else-if="note.canSay" class="sb-say" @click="clip.play(noteClips)">Hear meaning</button><p>{{ note.definition }}</p><p v-if="note.example" class="sb-example">{{ note.example }}</p><p v-if="note.spanish" lang="es" class="sb-example">En español: {{ note.spanish }} </p></aside>
    </main>
    <div v-if="data && voices.length && section === 'story'" ref="playerEl" class="sb-player" role="region" aria-label="Player">
      <div class="sb-player-inner">
        <button class="sb-play" :aria-label="state.playing ? 'Pause narration' : 'Play narration'" @click="engine?.toggle()"><svg v-if="state.playing" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M6 4h4v16H6zm8 0h4v16h-4z" /></svg><svg v-else viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="m7 3 14 9-14 9z" /></svg></button>
        <div class="sb-progress"><label for="sb-time">{{ state.playing ? 'Reading aloud' : state.time ? 'Paused' : 'Ready to read' }} <span>{{ timeText(state.time) }} / {{ timeText(state.duration) }}</span></label><input id="sb-time" type="range" min="0" :max="Math.max(state.duration, 1)" step="0.1" :value="state.time" aria-label="Narration position" @input="onSeek" /></div>
        <button class="sb-settings-button" :aria-expanded="settingsOpen" aria-controls="sb-settings-sheet" @click="settingsOpen = !settingsOpen">Voice &amp; speed</button>
      </div>
      <div v-if="settingsOpen" id="sb-settings-sheet" class="sb-settings-sheet"><div v-if="voices.length > 1"><span class="sb-choice-label">Voice</span><div class="sb-choice-list"><button v-for="v in voices" :key="v.id" :aria-pressed="state.voiceId === v.id" @click="setVoice(v.id)">{{ VOICE_NAMES[v.id] || v.label }}</button></div></div><div><span class="sb-choice-label">Speed</span><div class="sb-choice-list"><button v-for="rate in [0.75, 1, 1.25, 1.5, 2]" :key="rate" :aria-pressed="Number(state.rate) === rate" @click="setRate(rate)">{{ rate }}×</button></div></div></div>
      <button v-if="state.error" class="sb-retry" @click="engine?.retry()">Retry audio</button>
    </div>
  </div>
</template>
