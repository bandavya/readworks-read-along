<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from 'vue'
import { assetUrl, gradeLabel, loadPassage, store, VOICE_NAMES } from '../../api'
import { SoundAlong } from '../../soundAlong'
import { HoldDetector } from '../../hold'
import { findDefinition } from '../../defs'
import { loadGloss, loadKidAudio, loadSyllables, ClipVoice } from '../../kidAudio'
import SyllableGuide from '../../components/SyllableGuide.vue'
import { SoundRibbon } from '../sound/ribbon'
import { sentenceRanges, rangeIndexOf } from '../../sentences'
import SpeedSlider from '../../components/SpeedSlider.vue'
import { focused, setFocused } from '../../focused.js'
import './mix.css'

const props = defineProps({ id: String, kid: Boolean })
const data = shallowRef(null)
const error = ref('')
const textEl = ref(null)
const articleEl = ref(null)
const storyEl = ref(null)
const dockEl = ref(null)
const gloss = shallowRef(null)
const syllables = shallowRef(null)
const kidAudio = shallowRef(null)
const state = reactive({ playing: false, time: 0, duration: 0, rate: focused.value || [0.75,1,1.5,2].includes(store.get('rate',1)) ? store.get('rate',1) : 1, voiceId: '', error: '' })
const soundOn = ref(store.get('soundOn', true))
const calm = ref(false)
const wordsOpen = ref(false)
const optionsOpen = ref(false)
const card = ref(null)
const anchor = shallowRef(null)
const focusCard = ref(false)
const imageFailed = ref(false)
const mobile = ref(window.innerWidth <= 760)
const onResize = () => { mobile.value = window.innerWidth <= 760; updateLine() }
const section = ref('read')
const toolsOpen = ref(false)
const size = ref(props.kid ? 'large' : store.get('mix-size', 'normal'))
const pen = ref(store.get('mix-pen', 'yellow'))
const follow = ref(store.get('mix-follow', 'word'))
const showVoice = ref(store.get('mix-voice-line', false))
const focus = ref(focused.value ? 'off' : store.get('mix-focus', 'off'))
const line = ref(null)
const currentWord = shallowRef(null)
const pens = { yellow:'#f9f2a4', red:'#ffe0e6', green:'#d9f2d9', purple:'#efdafa', blue:'#dceaff' }
let ranges = []
let painted = []
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
const prepared = computed(() => {
  if (!data.value) return { html: '', image: null }
  const wrap = document.createElement('div')
  wrap.innerHTML = data.value.html || ''
  const figure = wrap.querySelector('figure:has(img)')
  let image = null
  if (figure) {
    const img = figure.querySelector('img')
    image = { src: assetUrl(`look-art/p-${props.id.slice(0,8)}-1.webp`), alt: img.alt || '', caption: figure.querySelector('.image-caption')?.textContent.trim() || '', credit: '' }
    const parent = figure.parentElement
    figure.remove()
    if (parent?.classList.contains('grid-col-6') && !parent.children.length) parent.remove()
  }
  let figureNumber = image ? 1 : 0
  wrap.querySelectorAll('figure:has(img)').forEach((figure) => {
    figureNumber++
    const img = figure.querySelector('img')
    img.setAttribute('src', assetUrl(`look-art/p-${props.id.slice(0,8)}-${figureNumber}.webp`))
    const caption = figure.querySelector('figcaption') || document.createElement('figcaption')
    if (!caption.parentElement) figure.appendChild(caption)
  })
  const firstParagraph = wrap.querySelector('p:has(.sa-w[data-i])')
  const firstRemainingFigure = wrap.querySelector('figure:has(img)')
  if (firstParagraph && firstRemainingFigure && (firstRemainingFigure.compareDocumentPosition(firstParagraph) & Node.DOCUMENT_POSITION_FOLLOWING)) firstParagraph.after(firstRemainingFigure)
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
  card.value = { id: sid, sid, pid: props.id, ...v, spanish: v.spanish || null, guide }
  anchor.value = el
  focusCard.value = true
}
function helpFor(el, keyboard = false) {
  if (!el || !engine || spanish.value) return
  // Focused mode offers meanings only on the marked vocabulary words, so what you get is never a surprise.
  if (focused.value && !el.closest('[data-vocab-sense-id]')) return
  engine.pause()
  wordAudio.pause()
  defVoice.stop()
  const def = findDefinition(el, { gloss: gloss.value, kid: kidAudio.value, passageId: props.id, vocab: data.value.vocab, syllables: syllables.value })
  if (!def) { closeCard(); const k = engine.index.get(el); if (k != null) engine.playSnippet(k); return }
  holdClips = def.clips
  card.value = { id: `help:${el.dataset.i ?? 'l' + el.dataset.l}`, hold: true, word: def.word, definition: def.text, guide: def.guide, sid: def.sid, pid: props.id, canSay: !focused.value && def.clips.length > 0 }
  anchor.value = el
  focusCard.value = keyboard
  if (keyboard) nextTick(() => document.querySelector(mobile.value ? '.mix-mobile-help-close' : '.mix-note-top button')?.focus())
  if (def.clips.length && !keyboard && !focused.value) defVoice.play(def.clips)
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
function onDocumentKey(e) {
  if (e.key === 'Escape') { const panel = card.value || toolsOpen.value; if (card.value) closeCard({ restoreFocus: true }); toolsOpen.value = false; optionsOpen.value = false; wordsOpen.value = false; if (!panel && state.playing) engine?.pause(); return }
  if (e.key === ' ' && soundOn.value && !e.target.closest?.('a,button,input,select,textarea,summary,.sa-w,[role=dialog]')) { e.preventDefault(); engine?.toggle() }
}
// A tap on the page that isn't a word or a link stops the voice. It never starts it: only the Listen button does.
function pageTap(e) { if (state.playing && !e.target.closest?.('.sa-w:not(.sa-unread),a,button,[data-vocab-sense-id]')) engine?.pause() }
const pauseForOverlay = () => { engine?.pause(); wordAudio.pause(); defVoice.stop() }
function onDocumentPointer(e) { if (card.value && !e.target.closest?.('.vpop, .mix-note, .mix-mobile-help, [data-vocab-sense-id], .sa-w, .mix-word button')) closeCard() }
function onImageError(e) {
  const img = e.target
  if (!img.matches?.('.mix-text img')) return
  const box = document.createElement('div')
  box.className = 'mix-image-missing'
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
  if (engine?.kOfSense(sid) != null) { sayFromStory(sid); return }
  if (v.say) { wordAudio.src = assetUrl(v.say); saying.value = sid; wordAudio.play().catch(() => { saying.value = ''; sayFromStory(sid) }) }
  else sayFromStory(sid)
}
function sayFromStory(sid) { const k = engine?.kOfSense(sid); if (k != null) engine.playSnippet(k) }
function onCardSay() { if (card.value?.hold) { engine?.pause(); defVoice.play(holdClips) } else sayWord(card.value?.id) }
function onGuideStart() { engine?.pause(); wordAudio.pause(); defVoice.stop() }
function updateLine() {
  const word = currentWord.value, root = articleEl.value
  if (!word || !root?.contains(word)) { line.value = null; return }
  const range = document.createRange(); range.selectNodeContents(word)
  const box = range.getBoundingClientRect(), parent = root.getBoundingClientRect()
  const height = parseFloat(getComputedStyle(word.closest('p,li,h2,h3') || word).lineHeight) || box.height * 1.8
  line.value = { top: box.top - parent.top - (height - box.height)/2, height }
}
function onCurrent(k) {
  painted.forEach(el => el.classList.remove('mix-sentence')); painted = []
  currentWord.value = k >= 0 ? engine?.words[k] : null
  if (k >= 0 && follow.value === 'sentence') {
    const group = ranges[rangeIndexOf(ranges,k)]
    if (group) for (let i=group.start; i<=group.end; i++) {
      const el=engine.words[i]
      if (el?.closest('.mix-text')) { el.classList.add('mix-sentence'); painted.push(el) }
    }
  }
  updateLine()
}
function setSection(value) { section.value=value; engine?.pause(); closeCard() }
function saveSetting(key,value) { store.set('mix-'+key,value) }

onMounted(async () => {
  document.body.classList.add('mix-active')
  try { data.value = await loadPassage(props.id) } catch { error.value = 'Could not load this passage.'; return }
  document.title = `${data.value.title} · Sound Along`
  Promise.all([loadSyllables(props.id), loadGloss(props.id), loadKidAudio()]).then(([s, g, k]) => { syllables.value = s; gloss.value = g; kidAudio.value = k })
  await nextTick()
  if (voices.value.length) {
    engine = new SoundAlong({ state, onVocab: openVocab, onCurrent, onEnded: () => { currentWord.value = null; line.value = null }, getSafeBottom: () => dockEl.value?.getBoundingClientRect().top || window.innerHeight })
    const pref = store.get('voice', 'human')
    engine.attach(textEl.value, voices.value, { voiceId: voices.value.some((v) => v.id === pref) ? pref : voices.value[0].id, rate: state.rate })
    engine.setEnabled(soundOn.value)
    ranges = sentenceRanges(engine.words.map(el => ({ text: el.textContent, block: el.closest('p,h1,h2,h3,li') })))
    if (!focused.value) ribbon = new SoundRibbon(articleEl.value, engine, { calm: () => !showVoice.value })
  }
  document.addEventListener('pointerup', onPointerUp)
  document.addEventListener('pointercancel', onPointerCancel)
  document.addEventListener('pointerdown', onDocumentPointer, true)
  document.addEventListener('keydown', onDocumentKey)
  window.addEventListener('sa-feedback-open', pauseForOverlay)
  window.addEventListener('resize', onResize)
})
onBeforeUnmount(() => {
  ribbon?.destroy(); engine?.destroy(); hold.cancel(); wordAudio.pause(); defVoice.stop()
  document.body.classList.remove('mix-active')
  document.removeEventListener('pointerup', onPointerUp)
  document.removeEventListener('pointercancel', onPointerCancel)
  document.removeEventListener('pointerdown', onDocumentPointer, true)
  document.removeEventListener('keydown', onDocumentKey)
  window.removeEventListener('sa-feedback-open', pauseForOverlay)
  window.removeEventListener('resize', onResize)
})
watch(size,v=>{saveSetting('size',v);nextTick(updateLine)})
watch(pen,v=>saveSetting('pen',v))
watch(follow,v=>{saveSetting('follow',v);onCurrent(engine?.curK ?? -1)})
watch(showVoice,v=>saveSetting('voice-line',v))
watch(focus,v=>{saveSetting('focus',v);nextTick(updateLine)})
</script>

<template>
  <div class="mix-shell" :class="{'mix-kid-article':kid}" :lang="spanish ? 'es' : 'en'" :style="{'--mix-highlight':pens[pen]}">
    <header class="mix-top"><div class="mix-top-inner"><a class="mix-brand" href="#/look/mix/">ReadWorks <span>Sound Along</span></a><nav aria-label="Reader navigation"><a href="#/look/mix/">All passages</a><a v-if="!focused" href="#/class-demo">Teacher demo</a><button v-if="focused" type="button" class="mix-all-features" @click="setFocused(false)">All features</button></nav></div></header>
    <main v-if="error" class="mix-message"><p>{{ error }}</p><a href="#/look/mix/">All passages</a></main>
    <main v-else-if="!data" class="mix-message" role="status">Loading passage...</main>
    <main v-else ref="textEl" @pointerdown="onPointerDown" @pointermove="e => hold.move(e.clientX,e.clientY)" @click.capture="onClickCapture" @keydown="onTextKey" @contextmenu="onContext" @error.capture="onImageError">
      <section class="mix-hero"><div class="mix-hero-inner"><div class="mix-hero-copy"><div class="mix-lead" v-html="lead"></div></div><figure class="mix-cover"><div class="mix-cover-shape"><img v-if="prepared.image && !imageFailed" :src="prepared.image.src" :alt="prepared.image.alt" @error="imageFailed=true"><div v-else class="mix-cover-fallback" role="img" :aria-label="prepared.image?.alt || 'Picture unavailable'">{{ prepared.image?.alt || 'Picture unavailable' }}</div></div><figcaption v-if="prepared.image?.caption">{{ prepared.image.caption }}</figcaption></figure></div></section>
      <div class="mix-tabs" role="tablist" aria-label="Passage sections"><button type="button" role="tab" :aria-selected="section==='read'" @click="setSection('read')">Passage</button><button type="button" role="tab" :aria-selected="section==='words'" @click="setSection('words')">{{ spanish ? 'Vocabulario' : 'Words to know' }} <span>{{ vocab.length }}</span></button></div>
      <div class="mix-layout" @click="pageTap">
        <div class="mix-reading" v-show="section==='read'"><div ref="articleEl" class="mix-article" :class="['mix-size-'+size,'mix-focus-'+focus,{'mix-sentence-follow':follow==='sentence','mix-underline-follow':follow==='underline','mix-voice-off':!showVoice}]">
          <div v-if="focus!=='off' && line" class="mix-focus-band" :style="{top:line.top+'px',height:line.height+'px'}" aria-hidden="true"></div><div v-if="(focus==='one'||focus==='two'||focus==='spotlight') && line" class="mix-focus-above" :style="{height:Math.max(0,line.top)+'px'}" aria-hidden="true"></div><div v-if="(focus==='one'||focus==='two'||focus==='spotlight') && line" class="mix-focus-below" :style="{top:line.top+line.height*(focus==='two'?2:1)+'px'}" aria-hidden="true"></div>
          <article ref="storyEl" class="mix-text sa-text" :class="{'sa-off':!soundOn}" v-html="prepared.html"></article></div><p class="mix-credit">{{ data.credit }}</p>
          <dl class="mix-about" aria-label="About this passage"><div><dt>Grade</dt><dd>{{ gradeLabel(data.grade) }}</dd></div><div><dt>Lexile</dt><dd>{{ data.lexile ? `${data.lexile}L` : 'Not listed' }}</dd></div><div><dt>Words</dt><dd>{{ data.wordcount || data.words }}</dd></div></dl>
        </div>
        <section v-if="section==='words'" class="mix-words" aria-labelledby="mix-words-title"><h2 id="mix-words-title">{{ spanish ? 'Vocabulario' : 'Words to know' }}</h2><p v-if="!vocab.length">No vocabulary words in this passage.</p><div v-for="v in vocab" :key="v.id" class="mix-word"><button type="button" :aria-label="`Hear ${v.word}`" @click="sayWord(v.id)">{{ v.word }}</button><p>{{ v.definition }}</p><p v-if="v.spanish && !spanish" class="mix-word-es"><span>In Spanish:</span> <span lang="es">{{ v.spanish }}</span></p><SyllableGuide v-if="!spanish && syllables?.[v.id]" :entry="syllables[v.id]" :pid="id" :sid="v.id" :icons-only="true" :mark-kid="false" @start="onGuideStart" /></div></section>
        <aside v-if="card && section==='read'" class="mix-side" aria-label="Word help"><div class="mix-note" role="region" :aria-label="`Help with ${card.word}`"><div class="mix-note-top"><span>{{ focused ? 'Meaning' : 'Word help' }}</span><button type="button" aria-label="Close word help" @click="closeCard({restoreFocus:true})">Close</button></div><h2>{{ card.word }}</h2><SyllableGuide v-if="card.guide" :entry="card.guide" :pid="id" :sid="card.sid || ''" :icons-only="true" :mark-kid="false" @start="onGuideStart"/><p>{{ card.definition }}</p><button v-if="card.canSay" type="button" @click="onCardSay">Hear meaning</button><p v-if="card.spanish" class="mix-word-es"><span>In Spanish:</span> <span lang="es">{{ card.spanish }}</span></p></div></aside>
      </div>
      <div v-if="voices.length" ref="dockEl" class="mix-dock"><div class="mix-player" role="group" aria-label="Sound Along player"><button class="mix-play" :class="{'mix-playing':state.playing}" type="button" :disabled="!soundOn" :aria-label="state.playing?'Pause narration':'Play narration'" @click="engine?.toggle()"><svg v-if="state.playing" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4h4v16H6zm8 0h4v16h-4z"/></svg><svg v-else viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3v18l14-9z"/></svg><span>{{ state.playing?'Pause':'Listen' }}</span></button><div class="mix-progress"><label for="mix-seek"><span>{{ fmt(state.time) }} / {{ fmt(state.duration) }}</span></label><input id="mix-seek" type="range" min="0" :max="state.duration||1" step="0.1" :value="state.time" aria-label="Audio position" :disabled="!soundOn" @input="engine?.seekTime(Number($event.target.value))"></div><button type="button" class="mix-tools-button" :aria-expanded="toolsOpen" aria-controls="mix-tools" @click="toolsOpen=!toolsOpen">Reading tools</button></div><div v-if="toolsOpen" id="mix-tools" class="mix-tools"><div v-if="focused" class="mix-tool-group mix-tool-speed"><SpeedSlider :value="state.rate" :kid="kid" :lang="spanish ? 'es' : 'en'" @change="setRate" /></div><div v-else class="mix-tool-group"><span>Speed</span><button v-for="r in [[0.75,'Slower'],[1,'Normal'],[1.5,'Faster'],[2,'Fastest']]" :key="r[0]" type="button" :aria-pressed="state.rate===r[0]" :disabled="!soundOn" @click="setRate(r[0])">{{ r[1] }}</button></div><div v-if="voices.length>1" class="mix-tool-group"><span>Voice</span><button v-for="v in voices" :key="v.id" type="button" :aria-pressed="state.voiceId===v.id" :disabled="!soundOn" @click="setVoice(v.id)">{{ VOICE_NAMES[v.id] || v.label }}</button></div><div v-if="!kid" class="mix-tool-group"><span>Text size</span><button v-for="x in ['small','normal','large']" :key="x" type="button" :aria-pressed="size===x" @click="size=x">{{ x }}</button></div><div v-if="!focused" class="mix-tool-group"><span>Highlight color</span><button v-for="(tint,name) in pens" :key="name" type="button" class="mix-pen" :aria-label="`${name} highlight`" :aria-pressed="pen===name" @click="pen=name"><i :style="{background:tint}"></i></button></div><div class="mix-tool-group"><span>Follow along</span><button v-for="x in [['word','Highlight the word'],['underline','Underline the word'],['sentence','Highlight the sentence']]" :key="x[0]" type="button" class="mix-follow-choice" :aria-pressed="follow===x[0]" @click="follow=x[0]">{{ x[1] }}</button></div><div v-if="!focused" class="mix-tool-group"><span>Show the voice</span><button type="button" :aria-pressed="showVoice" @click="showVoice=!showVoice">{{ showVoice?'On':'Off' }}</button></div><div v-if="!focused" class="mix-tool-group"><span>Focus</span><button v-for="x in ['off','strip','spotlight','one','two']" :key="x" type="button" :aria-pressed="focus===x" @click="focus=x">{{ x==='strip'?'Reading strip':x==='one'?'One line':x==='two'?'Two lines':x }}</button></div><button v-if="!focused" type="button" class="mix-sound-toggle" :aria-pressed="soundOn" @click="setSound(!soundOn)">Sound {{ soundOn?'on':'off' }}</button></div><p v-if="state.error" class="mix-error">{{ state.error }} <button @click="engine?.retry()">Try again</button></p></div>
    </main>
    <div v-if="card && mobile" class="mix-mobile-help-back" @click.self="closeCard({restoreFocus:true})"><section class="mix-mobile-help" role="dialog" aria-modal="true" :aria-label="'Help with '+card.word"><button type="button" class="mix-mobile-help-close" @click="closeCard({restoreFocus:true})">Close</button><h2>{{ card.word }}</h2><SyllableGuide v-if="card.guide" :entry="card.guide" :pid="id" :sid="card.sid || ''" :icons-only="true" :mark-kid="false" @start="onGuideStart"/><p>{{ card.definition }}</p><button v-if="card.canSay" type="button" @click="onCardSay">Hear meaning</button><p v-if="card.spanish" class="mix-word-es"><span>In Spanish:</span> <span lang="es">{{ card.spanish }}</span></p></section></div>
  </div>
</template>
