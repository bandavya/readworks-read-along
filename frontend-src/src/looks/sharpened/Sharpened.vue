<script setup>
import { ref, shallowRef, reactive, computed, nextTick, onMounted, onBeforeUnmount, watch } from 'vue'
import { loadPassage, gradeLabel, VOICE_NAMES, store, assetUrl } from '../../api'
import { SoundAlong } from '../../soundAlong'
import { loadGloss, loadSyllables, loadKidAudio, ClipVoice } from '../../kidAudio'
import { HoldDetector } from '../../hold'
import { findDefinition } from '../../defs'
import { itemsForPassage, tally, syllableItem } from '../../review'
import ReviewMark from '../../components/ReviewMark.vue'
import SyllableGuide from '../../components/SyllableGuide.vue'
import KidView from './SharpenedKidView.vue'
import SharpenedLibrary from './SharpenedLibrary.vue'
import './sharpened.css'

const props = defineProps({ route: Object })
const id = computed(() => props.route.id)
const data = shallowRef(null)
const gloss = shallowRef(null)
const syllables = shallowRef(null)
const kidAudio = shallowRef(null)
const extrasReady = ref(false)
const error = ref('')
const section = ref('story')
const textEl = ref(null)
const articleWrapEl = ref(null)
const dockEl = ref(null)
const note = ref(null)
const noteTop = ref(180)
const activeParagraph = ref(0)
const rulerEnabled = ref(store.get('sharpened-ruler', false))
const rulerStrength = ref(store.get('sharpened-ruler-strength', 'soft'))
const trailEnabled = ref(false)
const tapCounts = ref({})
const sampleTaps = computed(() => {
  const source = Object.values(data.value?.vocab || {}).map(v => v.word).concat(data.value?.title_words || [])
  const words = [...new Set(source.map(w => String(w).trim().toLocaleLowerCase()).filter(Boolean))].slice(0, 3)
  return Object.fromEntries(words.map((word, i) => [word, [7, 5, 3][i]]))
})
const topTaps = computed(() => Object.entries({ ...sampleTaps.value, ...Object.fromEntries(Object.entries(tapCounts.value).map(([word, count]) => [word, count + (sampleTaps.value[word] || 0)])) }).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 6))
const maxTaps = computed(() => topTaps.value[0]?.[1] || 1)
const localTapTotal = computed(() => Object.values(tapCounts.value).reduce((sum, n) => sum + n, 0))
const rulerLine = ref(null)
const rulerTop = ref(0)
const rulerHeight = ref(0)
const paragraphCount = ref(0)
const state = reactive({ playing: false, time: 0, duration: 0, rate: store.get('rate', 1), voiceId: '', error: '' })
const soundOn = ref(store.get('soundOn', true))
const saying = ref('')
const mobileSettingsOpen = ref(false)
const clip = new ClipVoice()
const wordAudio = new Audio()
wordAudio.addEventListener('ended', () => { saying.value = '' })
let engine = null
let suppressClick = false
let pointerType = 'mouse'
let lastKeyboard = false
let noteClips = []
let lastTappedWord = null
let narratedParagraphs = []
const hold = new HoldDetector({ ms: 500, moveLimit: () => 12, onHold: openWordHelp })

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const lead = (words, offset) => words.map((w, i) => `<span class="sa-w" data-l="${offset + i}">${esc(w)}</span>`).join(' ')
const storyHtml = computed(() => data.value ? `<h1 class="sa-title">${lead(data.value.title_words || [], 0)}</h1>${data.value.by_words?.length ? `<p class="sa-byline">${lead(data.value.by_words, data.value.title_words?.length || 0)}</p>` : ''}${data.value.html}` : '')
const voices = computed(() => data.value?.voices || [])
const vocab = computed(() => Object.entries(data.value?.vocab || {}).map(([sid, v]) => ({ sid, ...v })).sort((a, b) => a.word.localeCompare(b.word)))
const progress = computed(() => paragraphCount.value ? Math.max(0, Math.min(100, (activeParagraph.value / paragraphCount.value) * 100)) : 0)
const reviewSummary = computed(() => {
  if (!data.value) return ''
  if (!extrasReady.value) return 'Loading word-help review status…'
  const t = tally(itemsForPassage(id.value, { gloss: gloss.value, syllables: syllables.value, kid: kidAudio.value, data: data.value }))
  return t.total ? `${t.approved} of ${t.total} word-help items checked by a person${t.fix ? `; ${t.fix} flagged for a fix` : ''}.` : 'No computer-made word help for this passage.'
})

function placeNote() {
  if (!note.value?.anchor || !textEl.value) return
  const anchor = note.value.anchor.getBoundingClientRect()
  noteTop.value = Math.max(84, Math.min(anchor.top - 12, window.innerHeight - 340))
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
  note.value = { sid, anchor, word: v.word, definition: v.definition, pos: v.pos, example: v.example, spanish: v.spanish, guide: syllables.value?.[sid], items: syllables.value?.[sid] ? [syllableItem(id.value, sid, syllables.value[sid])] : [], source: 'ReadWorks vocabulary' }
  placeNote()
  if (lastKeyboard) nextTick(() => document.querySelector('.sh-note-close')?.focus())
}
function openWordHelp(el) {
  engine?.pause()
  wordAudio.pause()
  clip.stop()
  window.getSelection()?.removeAllRanges()
  const d = findDefinition(el, { gloss: gloss.value, kid: kidAudio.value, passageId: id.value, vocab: data.value.vocab, syllables: syllables.value })
  if (!d) { closeNote(); const k = engine?.index.get(el); if (k !== undefined) engine.playSnippet(k); return }
  noteClips = d.clips
  note.value = { anchor: el, word: d.word, definition: d.text, guide: d.guide, sid: d.sid, items: [...d.items, d.guideItem].filter(Boolean), source: d.sid ? 'Word in this passage' : 'Word help', canSay: d.clips.length > 0 }
  placeNote()
  if (d.clips.length) clip.play(d.clips)
  if (lastKeyboard) nextTick(() => document.querySelector('.sh-note-close')?.focus())
}
function helpFocusedWord() {
  const focused = document.activeElement?.closest?.('.sh-text .sa-w:not(.sa-unread)')
  const el = focused || lastTappedWord || textEl.value?.querySelector('.sa-now') || narratedParagraphs[0]?.querySelector('.sa-w:not(.sa-unread)')
  if (el) openWordHelp(el)
}
function onPointerDown(e) {
  pointerType = e.pointerType || 'mouse'
  if (!engine || e.button > 0) return
  const el = e.target.closest?.('.sa-w:not(.sa-unread)')
  if (el) { lastTappedWord = el; hold.down(el, e.clientX, e.clientY) }
}
function onPointerUp() {
  if (hold.up().held) { suppressClick = true; setTimeout(() => { suppressClick = false }, 500) }
}
function onPointerMove(e) { hold.move(e.clientX, e.clientY) }
function onPointerCancel() { hold.cancel() }
function onContextMenu(e) { if ((pointerType === 'touch' || pointerType === 'pen') && e.target.closest('.sa-w')) e.preventDefault() }
function onTextClick(e) {
  if (suppressClick) { suppressClick = false; e.stopImmediatePropagation?.(); e.stopPropagation(); e.preventDefault() }
  else if (trailEnabled.value) {
    const word = e.target.closest?.('.sa-w:not(.sa-unread)')?.textContent?.trim().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').toLocaleLowerCase()
    if (word) tapCounts.value = { ...tapCounts.value, [word]: (tapCounts.value[word] || 0) + 1 }
  }
}
function onTextKey(e) {
  if ((e.key === 'F2' || (e.key === 'Enter' && e.shiftKey)) && e.target.matches('.sa-w')) { e.preventDefault(); lastTappedWord = e.target; openWordHelp(e.target) }
}
function onGlobalKey(e) {
  lastKeyboard = true
  if (e.key === 'Escape' && note.value) closeNote(true)
}
function onOutside(e) {
  lastKeyboard = false
  if (note.value && !e.target.closest('.sh-note, .sh-text .sa-w, .sh-vocab button')) closeNote()
}
function onCurrent(k) {
  const el = engine?.words[k]
  const p = el?.closest('p')
  const n = narratedParagraphs.indexOf(p)
  if (n >= 0) activeParagraph.value = n + 1
  rulerLine.value = el || null
  positionRuler()
}
function positionRuler() {
  if (!rulerEnabled.value || !rulerLine.value || !articleWrapEl.value) return
  const word = rulerLine.value.getBoundingClientRect()
  const wrap = articleWrapEl.value.getBoundingClientRect()
  const lineHeight = parseFloat(getComputedStyle(rulerLine.value).lineHeight) || word.height * 1.5
  rulerTop.value = Math.max(0, word.top - wrap.top - (lineHeight - word.height) / 2)
  rulerHeight.value = lineHeight
}
function markMissing(img) {
  img.classList.add('is-missing')
  if (img.nextElementSibling?.classList.contains('sh-image-placeholder')) return
  const box = document.createElement('div')
  box.className = 'sh-image-placeholder'
  box.setAttribute('role', 'img')
  box.setAttribute('aria-label', img.alt || 'Picture unavailable')
  box.textContent = img.alt || 'Picture unavailable'
  img.after(box)
}
function onImageError(e) { if (e.target instanceof HTMLImageElement) markMissing(e.target) }
function onImageLoad(e) {
  const img = e.target
  if (!(img instanceof HTMLImageElement)) return
  img.classList.remove('is-missing')
  img.nextElementSibling?.classList.contains('sh-image-placeholder') && img.nextElementSibling.remove()
}
function setVoice(v) { store.set('voice', v); engine?.setVoice(v) }
function setRate(v) { const n = Number(v); store.set('rate', n); engine?.setRate(n) }
function sayVocab(v) {
  engine?.pause(); clip.stop(); wordAudio.pause()
  if (v.say) { wordAudio.src = assetUrl(v.say); saying.value = v.sid; wordAudio.play().catch(() => { saying.value = ''; const k = engine?.kOfSense(v.sid); if (k != null) engine.playSnippet(k) }) }
  else { const k = engine?.kOfSense(v.sid); if (k != null) engine.playSnippet(k) }
}
function sayNote() { if (noteClips.length) { engine?.pause(); clip.play(noteClips) } }

onMounted(async () => {
  document.addEventListener('keydown', onGlobalKey, true)
  document.addEventListener('pointerdown', onOutside, true)
  window.addEventListener('scroll', placeNote, { passive: true })
  window.addEventListener('resize', placeNote)
  window.addEventListener('resize', positionRuler)
  if (props.route.look !== 'sharpened' || props.route.screen !== 'p' || !id.value) return
  try { data.value = await loadPassage(id.value) } catch { error.value = 'Could not load this passage.'; return }
  document.title = `${data.value.title} · Sound Along`
  Promise.all([loadGloss(id.value), loadSyllables(id.value), loadKidAudio()]).then(([g, s, k]) => { gloss.value = g; syllables.value = s; kidAudio.value = k; extrasReady.value = true })
  await nextTick()
  const el = textEl.value
  narratedParagraphs = [...el.querySelectorAll('p')].filter(p => !p.closest('figure, .image, .image-c, .image-l, .image-r') && !p.classList.contains('sa-byline') && p.querySelector('.sa-w:not(.sa-unread)'))
  paragraphCount.value = narratedParagraphs.length
  el.querySelectorAll('img').forEach(img => {
    const src = img.getAttribute('src')
    if (src && !/^(?:[a-z]+:|\/)/i.test(src)) img.src = assetUrl(src)
    if (img.complete && img.naturalWidth === 0) markMissing(img)
  })
  el.addEventListener('error', onImageError, true)
  el.addEventListener('load', onImageLoad, true)
  el.addEventListener('pointerdown', onPointerDown)
  el.addEventListener('pointermove', onPointerMove)
  document.addEventListener('pointerup', onPointerUp)
  document.addEventListener('pointercancel', onPointerCancel)
  el.addEventListener('click', onTextClick, true)
  el.addEventListener('keydown', onTextKey, true)
  el.addEventListener('contextmenu', onContextMenu)
  if (voices.value.length) {
    engine = new SoundAlong({ state, onVocab: openVocab, onCurrent, getSafeBottom: () => dockEl.value?.getBoundingClientRect().top || window.innerHeight })
    const preferred = store.get('voice', 'human')
    engine.attach(el, voices.value, { voiceId: voices.value.some(v => v.id === preferred) ? preferred : voices.value[0].id, rate: state.rate })
    engine.setEnabled(soundOn.value)
  }
})
watch(soundOn, v => { store.set('soundOn', v); engine?.setEnabled(v) })
watch(rulerEnabled, v => { store.set('sharpened-ruler', v); nextTick(positionRuler) })
watch(rulerStrength, v => store.set('sharpened-ruler-strength', v))
watch(section, () => { engine?.pause(); closeNote() })
onBeforeUnmount(() => {
  engine?.destroy(); clip.stop(); wordAudio.pause(); hold.cancel()
  textEl.value?.removeEventListener('error', onImageError, true)
  textEl.value?.removeEventListener('load', onImageLoad, true)
  document.removeEventListener('keydown', onGlobalKey, true)
  document.removeEventListener('pointerdown', onOutside, true)
  document.removeEventListener('pointerup', onPointerUp)
  document.removeEventListener('pointercancel', onPointerCancel)
  window.removeEventListener('scroll', placeNote)
  window.removeEventListener('resize', placeNote)
  window.removeEventListener('resize', positionRuler)
})
</script>

<template>
  <div class="sh-shell">
    <header class="sh-header">
      <div class="sh-header-inner"><a class="sh-brand" href="#/look/sharpened/">ReadWorks <span>Sound Along</span></a><a v-if="route.screen !== 'library'" class="sh-back" href="#/look/sharpened/">← All passages</a></div>
    </header>
    <main v-if="route.look !== 'sharpened'" class="sh-empty"><a href="#/look/sharpened/">Open the library</a></main>
    <template v-else-if="route.screen === 'kid' && id"><div class="sh-kid"><KidView :id="id" /></div></template>
    <SharpenedLibrary v-else-if="route.screen === 'library' || route.screen === 'compare'" :compare="route.screen === 'compare'" />
    <main v-else-if="route.screen !== 'p' || !id" class="sh-empty"><h1>Sound Along</h1><p>Open a passage from the <a href="#/look/sharpened/">passage library</a>.</p></main>
    <main v-else-if="error" class="sh-empty">{{ error }} <a href="#/">Back to the library</a></main>
    <main v-else-if="!data" class="sh-empty">Loading passage…</main>
    <main v-else class="sh-main">
      <div class="sh-heading"><div class="sh-heading-row"><p class="sh-meta">{{ gradeLabel(data.grade) }} <span>·</span> {{ data.lexile ? `${data.lexile}L` : 'Lexile not listed' }} <span>·</span> {{ data.wordcount || data.words }} words <span>·</span> {{ voices.length ? voices.map(v => VOICE_NAMES[v.id] || v.label).join(' / ') : 'No audio yet' }}</p><a class="sh-kid-link" :href="`#/look/sharpened/kid/${id}`">Open kid view <span aria-hidden="true">↗</span></a></div></div>
      <div class="sh-reader-tools"><nav class="sh-tabs" aria-label="Passage sections"><button :aria-current="section === 'story' ? 'page' : undefined" @click="section = 'story'">Passage</button><button :aria-current="section === 'vocab' ? 'page' : undefined" @click="section = 'vocab'">Words to know <span>{{ vocab.length }}</span></button></nav><div class="sh-reader-options"><div class="sh-ruler-control"><button class="sh-ruler-switch" type="button" :aria-pressed="rulerEnabled" @click="rulerEnabled = !rulerEnabled"><span class="sh-ruler-icon" aria-hidden="true"><i></i></span><span>Reading ruler</span><strong>{{ rulerEnabled ? 'On' : 'Off' }}</strong></button><label v-if="rulerEnabled" class="sh-ruler-strength">Strength <select v-model="rulerStrength"><option value="soft">Soft</option><option value="strong">Strong</option></select></label></div></div></div>
      <div v-show="section === 'story'" class="sh-grid">
        <div ref="articleWrapEl" class="sh-article-wrap"><p class="sh-instruction">Tap any word to hear it. Hold a word to learn it.</p><p v-if="rulerEnabled" class="sh-ruler-hint">Reading ruler is on. The spoken line stays clear while surrounding lines soften.</p><details class="sh-keyboard-help"><summary>Keyboard help</summary><p>Tab to a word, use arrow keys to move between words, and press F2 for help.</p></details><article ref="textEl" class="sa-text sh-text" :class="{ 'sa-off': !soundOn }" :lang="data.lang === 'ES' ? 'es' : 'en'" v-html="storyHtml"></article><p v-if="data.credit" class="sh-credit">{{ data.credit }}</p><div v-if="rulerEnabled && rulerLine" class="sh-ruler-overlay" :class="`sh-ruler-${rulerStrength}`" :style="{ '--ruler-top': `${rulerTop}px`, '--ruler-height': `${rulerHeight}px` }" aria-hidden="true"><i class="sh-ruler-above"></i><i class="sh-ruler-band"></i><i class="sh-ruler-below"></i></div></div>
        <aside class="sh-margin" aria-label="Reading tools"><div class="sh-margin-static"><span class="sh-side-rule"></span><p>Press and hold a word to see what it means.</p><button @click="helpFocusedWord">Help with a word <span>F2</span></button></div></aside>
        <aside v-if="note" class="sh-note" :style="{ '--note-top': `${noteTop}px` }" role="dialog" aria-modal="false" :aria-label="`Help with ${note.word}`"><div class="sh-note-head"><span>{{ note.source }}</span><button class="sh-note-close" aria-label="Close word help" @click="closeNote(true)">×</button></div><h3>{{ note.word }}</h3><p v-if="note.pos" class="sh-pos">{{ note.pos }}</p><ReviewMark v-if="note.items?.length" :items="note.items" :pid="id" /><SyllableGuide v-if="note.guide" :key="note.sid || note.word" :entry="note.guide" :pid="id" :sid="note.sid || ''" note="short" @start="engine?.pause(); clip.stop(); wordAudio.pause()" /><button v-else-if="note.canSay" class="sh-hear" @click="sayNote">Hear meaning</button><p class="sh-def">{{ note.definition }}</p><p v-if="note.example" class="sh-example">{{ note.example }}</p><p v-if="note.spanish" lang="es" class="sh-example">En español: {{ note.spanish }}</p></aside>
      </div>
      <section v-if="section === 'vocab'" class="sh-vocab"><div><h2>Words to know</h2></div><dl v-if="vocab.length"><template v-for="v in vocab" :key="v.sid"><dt><button @click="sayVocab(v)" :aria-label="`Hear ${v.word}`">{{ v.word }} <span aria-hidden="true">↗</span></button><small>{{ v.pos }}</small></dt><dd><SyllableGuide v-if="syllables?.[v.sid]" :entry="syllables[v.sid]" :pid="id" :sid="v.sid" note="short" @start="engine?.pause(); wordAudio.pause()" /><p>{{ v.definition }}</p><p v-if="v.example" class="sh-example">{{ v.example }}</p></dd></template></dl><p v-else>This passage has no vocabulary words.</p></section>
    </main>
    <div v-if="data && section === 'story' && voices.length" ref="dockEl" class="sh-dock" role="region" aria-label="Player"><div class="sh-dock-inner"><button class="sh-play" :disabled="!soundOn" :aria-label="state.playing ? 'Pause narration' : 'Play narration'" @click="engine?.toggle()"><svg v-if="state.playing" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h3v14H7zm7 0h3v14h-3z" fill="currentColor" /></svg><svg v-else viewBox="0 0 24 24" aria-hidden="true"><path d="M8 4.5v15l12-7.5z" fill="currentColor" /></svg></button><div class="sh-position"><span>{{ state.playing ? 'Listening' : state.time > 0 ? 'Paused' : 'Ready to listen' }}</span><strong>Paragraph {{ activeParagraph || 1 }} of {{ paragraphCount || 1 }}</strong><div class="sh-progress" role="progressbar" :aria-valuenow="activeParagraph" :aria-valuemin="0" :aria-valuemax="paragraphCount" :aria-label="`Paragraph ${activeParagraph} of ${paragraphCount}`"><i :style="{ width: progress + '%' }"></i></div></div><div class="sh-dock-options"><label v-if="voices.length > 1">Voice<select :disabled="!soundOn" :value="state.voiceId" @change="setVoice($event.target.value)"><option v-for="v in voices" :key="v.id" :value="v.id">{{ VOICE_NAMES[v.id] || v.label }}</option></select></label><label>Speed<select :disabled="!soundOn" :value="state.rate" @change="setRate($event.target.value)"><option :value="0.75">0.75×</option><option :value="1">1×</option><option :value="1.25">1.25×</option><option :value="1.5">1.5×</option><option :value="2">2×</option></select></label><button class="sh-sound" :aria-pressed="soundOn" @click="soundOn = !soundOn">Sound {{ soundOn ? 'on' : 'off' }}</button></div><button class="sh-mobile-settings" :aria-expanded="mobileSettingsOpen" aria-controls="sh-mobile-options" @click="mobileSettingsOpen = !mobileSettingsOpen">{{ state.rate }}× <span aria-hidden="true">⌃</span></button><button v-if="state.error" class="sh-retry" @click="engine?.retry()">Retry audio</button></div><div v-if="mobileSettingsOpen" id="sh-mobile-options" class="sh-mobile-options"><label>Speed<select :disabled="!soundOn" :value="state.rate" @change="setRate($event.target.value)"><option :value="0.75">Slower · 0.75×</option><option :value="1">Normal · 1×</option><option :value="1.25">Faster · 1.25×</option><option :value="1.5">Faster · 1.5×</option><option :value="2">Fastest · 2×</option></select></label><label v-if="voices.length > 1">Voice<select :disabled="!soundOn" :value="state.voiceId" @change="setVoice($event.target.value)"><option v-for="v in voices" :key="v.id" :value="v.id">{{ VOICE_NAMES[v.id] || v.label }}</option></select></label><button class="sh-sound" :aria-pressed="soundOn" @click="soundOn = !soundOn">Sound {{ soundOn ? 'on' : 'off' }}</button></div></div>
  </div>
</template>
