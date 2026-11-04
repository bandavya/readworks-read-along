<script setup>
import { presenting } from '../presenting'
import { ref, reactive, shallowRef, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { loadPassage, gradeLabel, VOICE_NAMES, store } from '../api'
import { SoundAlong } from '../soundAlong'
import PlayerBar from '../components/PlayerBar.vue'
import VocabCard from '../components/VocabCard.vue'
import SyllableGuide from '../components/SyllableGuide.vue'
import TeacherPreview from '../components/TeacherPreview.vue'
import RehearseBar from '../components/RehearseBar.vue'
import { loadKidAudio, loadGloss, loadSyllables } from '../kidAudio'
import { linkSettings, readerLink } from '../linkSettings'
import { record, trackPlayback } from '../usage'
import { leadWordsHtml } from '../components/LeadWords'
import { watchPassageImages } from '../components/PassageImage'
import { PUBLIC_SAMPLE } from '../mode'
import { useAutoWordCards } from '../passage/useAutoWordCards'
import { useWordHelp } from '../passage/useWordHelp'
import { useRehearsal } from '../passage/useRehearsal'

const props = defineProps({ id: String })

const data = shallowRef(null) // large timing arrays: no deep reactivity
const error = ref('')
const tab = ref('passage')
const assigned = reactive(linkSettings())
const soundOn = ref(PUBLIC_SAMPLE ? false : (assigned.fromTeacher ? assigned.soundOn : store.get('soundOn', true)))
const textEl = ref(null)
const dockEl = ref(null)
const state = reactive({ playing: false, time: 0, duration: 0, rate: store.get('rate', 1), voiceId: '', error: '' })
state.rate = Math.min(2, Math.max(0.75, Number(state.rate) || 1))
let engine = null
const engineRef = shallowRef(null) // the same engine, reactive for the sentence-practice bar
const practiceActive = ref(false)
let stopWatchingImages = null
function onNarrationPlay() {
  if (!engine?._snippet) record('play_started', props.id)
}
function onWordActivation(e) {
  if (!soundOn.value || !engine || (e.type === 'keydown' && (e.repeat || !['Enter', ' '].includes(e.key)))) return
  const word = e.target.closest?.('.sa-w:not(.sa-unread)')
  if (word && engine.index.has(word)) record('word_tap', props.id)
}

// Shared lead-word markup and ReadWorks' passage HTML.
const textHtml = computed(() => leadWordsHtml(data.value))

const voices = computed(() => data.value?.voices || [])
const spanish = computed(() => data.value?.lang === 'ES')
// Interaction state and handlers; the layout stays below.
const { autoWords, autoCard, autoAnchor, autoAnnouncement, dismissAutoCard, onCurrentWord, onReadingEnded } =
  useAutoWordCards({ id: props.id, data, soundOn, state, spanish, tab, getEngine: () => engine })
const { card, cardAnchor, cardFocus, syl, gloss, kidAudio, extrasReady, saying, reviewSummary,
  openCard, closeCard, offerMeaning, meaningHint, onGuideStart, onHoldDown, onHoldMove, onHoldUp, onHoldCancel, swallowClick,
  onContextMenu, onCardSay, sayWord, sayFromStory, consumeOutsideClick, dispose: disposeWordHelp } =
  useWordHelp({ id: props.id, data, soundOn, spanish, getEngine: () => engine, dismissAutoCard, closeOnOutsideWord: true })
const { restoreReplayRate, setRate: setReplayRate, replaySentence } =
  useRehearsal({ id: props.id, state, getEngine: () => engine })
const vocabList = computed(() =>
  Object.entries(data.value?.vocab || {})
    .map(([id, v]) => ({ id, ...v }))
    .sort((a, b) => a.word.localeCompare(b.word)),
)
// Narrow, manually screened pairs from the existing vocabulary data. This is a draft
// teaching hint, not a reviewed translation list or an automatic spelling rule.
const cognatePairs = new Set([
  'ocean|océano', 'solution|solución', 'victory|victoria',
  'process|proceso', 'democratic|democrático', 'magic|magia',
  'competition|competencia', 'erosion|erosión',
  'architecture|arquitectura', 'population|población',
  'recipe|receta',
])
const showCognates = ref(false)
const isCognate = (v) => cognatePairs.has(`${v.word?.trim().toLowerCase()}|${v.spanish?.trim().toLowerCase()}`)
const cognateCount = computed(() => spanish.value ? 0 : vocabList.value.filter(isCognate).length)
const byline = computed(() => (data.value?.authors || []).join(', '))
const showPlayer = computed(() => soundOn.value && voices.value.length > 0)
const showDock = computed(() => !!data.value && showPlayer.value)
const effectivePreviewSettings = computed(() => ({
  ...assigned,
  soundOn: soundOn.value,
  voice: assigned.fromTeacher ? (state.voiceId || assigned.voice) : store.get('kid-voice', undefined),
}))

// A tap on blank space in the passage pauses or resumes (design note: on a big screen the play button is far
// from the word you were looking at). If a popover is open, the first outside tap only closes it.
const flash = ref(null) // { x, y, icon, n }
let flashN = 0
function onReaderClick(e) {
  if (consumeOutsideClick()) return
  if (!engine || !soundOn.value) return
  if (e.target.closest('.sa-w, [data-vocab-sense-id], a, button, img, input, select, .sa-ph-box')) return
  if (window.getSelection()?.toString()) return // the reader was selecting text, not tapping
  if (!engine.started) return
  const willPlay = !state.playing
  engine.toggle()
  flash.value = { x: e.clientX, y: e.clientY, icon: willPlay ? 'play' : 'pause', n: ++flashN }
  setTimeout(() => { if (flash.value?.n === flashN) flash.value = null }, 650)
}

onMounted(async () => {
  if (assigned.fromTeacher && assigned.soundOn && assigned.view === 'kid') {
    window.location.hash = window.location.hash.replace(/^#\/p\//, '#/kid/')
    return
  }
  try {
    data.value = await loadPassage(props.id)
    record('opened', props.id)
  } catch (e) {
    error.value = 'Could not load this passage.'
    return
  }
  // Keep a saved Reading helper choice for English passages; Spanish stays in its translated passage view.
  if (!assigned.fromTeacher && data.value.lang !== 'ES' && store.get('readingHelper', false)) { window.location.hash = `#/focus/${props.id}`; return }
  // Optional extras: never block the passage if they are missing.
  Promise.all([loadSyllables(props.id), loadGloss(props.id), loadKidAudio()]).then(([s, g, k]) => {
    syl.value = s
    gloss.value = g
    kidAudio.value = k
    extrasReady.value = true
  })
  document.title = `${data.value.title} · Sound Along`
  await nextTick()
  const el = textEl.value
  el.addEventListener('pointerdown', onHoldDown)
  el.addEventListener('pointermove', onHoldMove)
  el.addEventListener('contextmenu', onContextMenu)
  el.addEventListener('click', swallowClick, true)
  document.addEventListener('pointerup', onHoldUp)
  document.addEventListener('pointercancel', onHoldCancel)
  stopWatchingImages = watchPassageImages(el, data.value.lang)

  if (voices.value.length) {
    engine = new SoundAlong({
      state,
      onVocab: openCard,
      onTapWord: offerMeaning,
      onCurrent: onCurrentWord,
      onEnded: onReadingEnded,
      getSafeBottom: () => (dockEl.value ? dockEl.value.getBoundingClientRect().top : window.innerHeight),
    })
    const pref = assigned.voice || store.get('voice', 'human')
    engine.attach(el, voices.value, { voiceId: voices.value.some((v) => v.id === pref) ? pref : voices.value[0].id, rate: state.rate })
    if (spanish.value) el.querySelectorAll('.sa-unread').forEach((word) => { word.title = 'No se lee en voz alta' })
    engine.setEnabled(soundOn.value)
    engine.audio.addEventListener('play', onNarrationPlay)
    trackPlayback(engine.audio, props.id)
    engineRef.value = engine
    // Run after the engine's delegated handlers so a word counts only when it was activated.
    el.addEventListener('click', onWordActivation)
    el.addEventListener('keydown', onWordActivation)
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('hashchange', onLinkChange)
  dismissAutoCard()
  restoreReplayRate()
  engine?.destroy()
  stopWatchingImages?.()
  textEl.value?.removeEventListener('click', onWordActivation)
  textEl.value?.removeEventListener('keydown', onWordActivation)
  dockObserver.disconnect()
  disposeWordHelp()
  document.removeEventListener('pointerup', onHoldUp)
  document.removeEventListener('pointercancel', onHoldCancel)
  // clear the shared dock height only if this instance set it last: a later Passage (e.g. after a route change) owns it
  if (document.documentElement.dataset.dockOwner === dockOwner) {
    document.documentElement.style.removeProperty('--dock-h')
    delete document.documentElement.dataset.dockOwner
  }
})

watch(soundOn, (on) => {
  if (!assigned.fromTeacher) store.set('soundOn', on)
  engine?.setEnabled(on)
  if (!on) dismissAutoCard()
})

function onLinkChange() {
  if (!window.location.hash.startsWith(`#/p/${props.id}?`) && window.location.hash !== `#/p/${props.id}`) return
  const next = linkSettings()
  Object.assign(assigned, next)
  if (next.fromTeacher && next.soundOn && next.view === 'kid') {
    window.location.hash = window.location.hash.replace(/^#\/p\//, '#/kid/')
    return
  }
  soundOn.value = PUBLIC_SAMPLE ? false : (next.fromTeacher ? next.soundOn : store.get('soundOn', true))
  if (next.fromTeacher && !next.soundOn) tab.value = 'passage'
  if (engine) {
    // A teacher's next link can arrive during a bounded sentence replay.
    restoreReplayRate()
    if (engine.range || engine.quiet) {
      const wasPlaying = !engine.audio.paused || !!engine.pending?.play
      engine.cancelRange({ pause: false })
      // cancelRange leaves the bounded stop time in place. Seeking at the
      // current position clears it and returns a finished replay to reading.
      engine.seekTime(engine.audio.currentTime)
      const pref = next.voice || store.get('voice', 'human')
      const nextVoice = voices.value.some((v) => v.id === pref) ? pref : voices.value[0]?.id
      if (nextVoice === state.voiceId && wasPlaying && soundOn.value) engine.resume()
    }
    const pref = next.voice || store.get('voice', 'human')
    const voice = voices.value.some((v) => v.id === pref) ? pref : voices.value[0]?.id
    if (voice && voice !== state.voiceId) engine.setVoice(voice)
  }
  closeCard()
  dismissAutoCard()
}
window.addEventListener('hashchange', onLinkChange)
watch(tab, (t) => { if (t !== 'passage') { engine?.pause(); closeCard(); dismissAutoCard() } })

// Keep the last passage lines and the meaning offer above the fixed player as its height changes.
// dockOwner marks which Passage instance wrote the shared height last.
const dockOwner = Math.random().toString(36).slice(2)
function updateDockHeight() {
  const h = dockEl.value ? dockEl.value.offsetHeight : 0
  document.documentElement.style.setProperty('--dock-h', `${h}px`)
  document.documentElement.dataset.dockOwner = dockOwner
}
const dockObserver = new ResizeObserver(updateDockHeight)
watch(dockEl, (el, old) => {
  if (old) dockObserver.unobserve(old)
  if (el) dockObserver.observe(el)
  updateDockHeight()
})

function useHelper() { store.set('readingHelper', true); window.location.hash = `#/focus/${props.id}` }
function setRate(r) { store.set('rate', r); setReplayRate(r) }
function setVoice(id) {
  store.set('voice', id)
  // A bounded sentence replay must become ordinary narration before a voice switch.
  // Clear the range and its stop marker while keeping the audio position and play state.
  restoreReplayRate()
  if (engine?.range) {
    engine.cancelRange({ pause: false })
    engine.seekTime(engine.audio.currentTime)
  }
  engine?.setVoice(id)
}

</script>

<template>
  <header class="topbar">
    <div class="topbar-in">
      <a class="brand" href="#/">Sound Along</a>
      <a class="back" href="#/">&larr; {{ spanish ? 'Buscar lecturas' : 'Find content' }}</a>
      <div id="passage-feedback-slot" class="passage-feedback-slot"></div>
    </div>
  </header>

  <main class="page" v-if="error">
    <p class="notice">{{ error }} <a href="#/">Back to the list</a></p>
  </main>
  <p v-else-if="!data" class="page notice">Loading&hellip;</p>

  <main v-else class="passage-wrap" :class="{ 'assigned-plain': assigned.fromTeacher && !soundOn }" :lang="spanish ? 'es' : 'en'">
    <div v-if="!assigned.fromTeacher || soundOn" class="tabbar">
      <div class="tabbar-in">
        <div class="tabs" role="tablist" :aria-label="spanish ? 'Secciones de la lectura' : 'Passage sections'">
          <button role="tab" :aria-selected="tab === 'passage'" :class="{ on: tab === 'passage' }" @click="tab = 'passage'">{{ spanish ? 'Lectura' : 'Passage' }}</button>
          <button role="tab" :aria-selected="tab === 'vocab'" :class="{ on: tab === 'vocab' }" @click="tab = 'vocab'">{{ spanish ? 'Vocabulario' : 'Vocabulary' }}</button>
          <button v-if="!presenting" role="tab" :aria-selected="tab === 'questions'" :class="{ on: tab === 'questions' }" @click="tab = 'questions'">{{ spanish ? 'Preguntas' : 'Question Set' }}</button>
        </div>
        <div v-if="!spanish" class="actions">
          <button v-if="!assigned.fromTeacher" type="button" role="switch" aria-checked="false" class="btn" title="A calmer page for reading: bigger text, the same word help" @click="useHelper">Reading helper: off</button>
          <a v-if="!assigned.fromTeacher && soundOn" class="btn" :href="readerLink('kid', props.id, assigned)">Open kid view</a>
          <button v-if="!presenting" type="button" class="btn primary inert" aria-disabled="true" title="Not part of this prototype">Assign</button>
          <button v-if="!presenting" type="button" class="btn inert" aria-disabled="true" title="Not part of this prototype">Print</button>
        </div>
        <div v-else class="actions">
          <button type="button" class="btn primary inert" aria-disabled="true" title="No está disponible en este prototipo">Asignar</button>
          <button type="button" class="btn inert" aria-disabled="true" title="No está disponible en este prototipo">Imprimir</button>
        </div>
      </div>
    </div>

    <div class="page layout">
      <p v-if="assigned.fromTeacher" class="assigned-note">Set by your teacher</p>
      <div class="main-col">
        <section v-show="tab === 'passage'" class="panel reader" role="tabpanel" @click="onReaderClick">
          <!-- ReadWorks' own HTML. Clicks and keys are handled by the SoundAlong engine via delegation. -->
          <div ref="textEl" class="sa-text" :class="{ 'sa-off': !soundOn }" :lang="data.lang === 'ES' ? 'es' : 'en'" v-html="textHtml"></div>
          <p class="credit">{{ spanish ? 'Texto y grabación: ReadWorks (readworks.org).' : data.credit }}</p>
        </section>

        <section v-if="tab === 'vocab'" class="panel" role="tabpanel">
          <h1 class="panel-h">{{ spanish ? 'Vocabulario' : 'Vocabulary' }}</h1>
          <p v-if="!spanish && !presenting" class="muted rv-vocab-link">Word help: {{ reviewSummary }} <a :href="`#/review/${id}`">Review it</a></p>
          <div v-if="cognateCount" class="cognate-control">
            <button type="button" class="cognate-toggle" :aria-pressed="showCognates" @click="showCognates = !showCognates">{{ showCognates ? 'Hide' : 'Show' }} Spanish look-alike words ({{ cognateCount }})</button>
            <p v-if="showCognates" class="muted">Selected word pairs that look and mean something alike. Draft hint; a person has not reviewed it.</p>
          </div>
          <dl v-if="vocabList.length" class="vocab-list">
            <template v-for="v in vocabList" :key="v.id">
              <dt v-if="!spanish && syl?.[v.id]">
                <span class="vocab-word">{{ v.word }}</span>
                <span v-if="v.pos" class="say-pos">{{ v.pos }}</span>
              </dt>
              <dt v-else>
                <button v-if="!PUBLIC_SAMPLE || voices.length" type="button" class="say-word" :class="{ on: saying === v.id }" :aria-label="spanish ? `Escuchar la palabra ${v.word}` : `Hear the word ${v.word}`" @click="spanish ? sayFromStory(v.id) : sayWord(v.id)">
                  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M4 9v6h4l5 4V5L8 9H4zm12.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4zM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z"/></svg>
                  <span>{{ v.word }}</span>
                </button>
                <span v-else class="vocab-word">{{ v.word }}</span>
                <span v-if="v.pos" class="say-pos">{{ v.pos }}</span>
              </dt>
              <dd>
                <SyllableGuide v-if="!spanish && syl?.[v.id]" :entry="syl[v.id]" :pid="id" :sid="v.id" note="full" @start="onGuideStart" />
                <span>{{ v.definition }}</span>
                <small v-if="PUBLIC_SAMPLE && !spanish"> (draft; needs a person's check)</small>
                <em v-if="v.example">{{ v.example }}</em>
                <span v-if="!spanish && v.spanish" class="vocab-spanish" lang="es">En español: {{ v.spanish }} <small v-if="!presenting" lang="en">(draft; needs a person's check)</small></span>
                <span v-if="showCognates && isCognate(v)" class="cognate-hint">Look-alike word: <span lang="en">{{ v.word }}</span> = <span lang="es">{{ v.spanish }}</span> <small>(draft; needs a person's check)</small></span>
              </dd>
            </template>
          </dl>
          <p v-else class="muted">{{ spanish ? 'Esta lectura no tiene palabras de vocabulario.' : 'This passage has no vocabulary words.' }}</p>
        </section>

        <section v-if="tab === 'questions'" class="panel" role="tabpanel">
          <h1 class="panel-h">{{ spanish ? 'Preguntas' : 'Question Set' }}</h1>
          <p class="muted">{{ spanish ? 'No están disponibles en este prototipo.' : 'Not part of this prototype.' }}</p>
        </section>
      </div>

      <aside v-if="!assigned.fromTeacher || soundOn" class="side">
        <TeacherPreview v-if="!spanish && !presenting" :id="props.id" :data="data" :gloss="gloss" :syl="syl" :kid="kidAudio" :ready="extrasReady" :settings="effectivePreviewSettings" />
        <div v-if="!assigned.fromTeacher || soundOn" class="panel">
          <h2 class="panel-h">{{ spanish ? 'Detalles' : 'Details' }}</h2>
          <dl class="details">
            <dt>{{ spanish ? 'Grado' : 'Grade' }}</dt><dd>{{ spanish ? `Grado ${data.grade}` : gradeLabel(data.grade) }}</dd>
            <dt>Lexile</dt><dd>{{ data.lexile ? data.lexile + 'L' : (spanish ? 'No disponible' : 'Not available') }}</dd>
            <dt>{{ spanish ? 'Palabras' : 'Word count' }}</dt><dd>{{ data.wordcount || data.words }}</dd>
            <dt>{{ spanish ? 'Autoría' : 'Author' }}</dt><dd>{{ byline || (spanish ? 'Sin indicar' : 'Not listed') }}</dd>
            <dt>{{ spanish ? 'Voces' : 'Voices' }}</dt>
            <dd>
              <template v-if="voices.length"><span v-for="v in voices" :key="v.id" class="voice-line">{{ spanish ? (v.id === 'human' ? 'Grabación de una persona' : 'Voz generada') : (VOICE_NAMES[v.id] || v.label) }}</span></template>
              <template v-else>{{ spanish ? 'Ninguna todavía' : 'None yet' }}</template>
            </dd>
          </dl>
          <div v-if="!assigned.fromTeacher" class="teacher">
            <p class="teacher-h">{{ spanish ? 'Solo en este navegador' : 'This browser only' }}</p>
            <button
              type="button"
              role="switch"
              class="switch"
              :aria-checked="soundOn"
              :disabled="!voices.length"
              @click="soundOn = !soundOn"
            >
              <span class="knob" aria-hidden="true"></span>
              <span class="switch-label">{{ spanish ? `Lectura con audio ${soundOn ? 'activada' : 'desactivada'} en este navegador` : `Sound Along is ${soundOn ? 'on' : 'off'} in this browser` }}</span>
            </button>
          </div>
          <div v-if="soundOn && !spanish" class="auto-word-setting">
            <label><input v-model="autoWords" type="checkbox" /> Show word cards as they're read</label>
          </div>
        </div>
      </aside>
    </div>

    <VocabCard
      v-if="card && cardAnchor && tab === 'passage'"
      :card="card"
      :anchor="cardAnchor"
      :focus-on-open="cardFocus"
      :saying="saying === card.id"
      @close="closeCard({ restoreFocus: true })"
      @say="onCardSay"
      @guide-start="onGuideStart"
    />
    <VocabCard v-if="autoCard && autoAnchor && !card" :card="autoCard" :anchor="autoAnchor" compact @close="dismissAutoCard" />
    <p class="sa-visually-hidden" aria-live="polite" aria-atomic="true">{{ autoAnnouncement }}</p>
    <p class="sa-visually-hidden" aria-live="polite">{{ meaningHint }}</p>
    <div v-if="flash" :key="flash.n" class="tap-flash" :style="{ left: flash.x + 'px', top: flash.y + 'px' }" aria-hidden="true">
      <svg v-if="flash.icon === 'pause'" viewBox="0 0 24 24" width="30" height="30"><path fill="currentColor" d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/></svg>
      <svg v-else viewBox="0 0 24 24" width="30" height="30"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>
    </div>

    <div v-if="showDock" ref="dockEl" class="dock">
      <div class="dock-in">
        <PlayerBar v-if="showPlayer" :state="state" :voices="voices" :practice-active="practiceActive" :lang="spanish ? 'es' : 'en'" @toggle="engine?.toggle()" @rate="setRate" @voice="setVoice" @seek="(t) => engine?.seekTime(t)" @retry="engine?.retry()">
          <div class="sentence-actions">
            <button type="button" class="sentence-replay" @click="replaySentence(false)">{{ spanish ? 'Escuchar la oración de nuevo' : 'Hear the sentence again' }}</button>
          </div>
          <RehearseBar v-if="!spanish" :engine="engineRef" @active-change="practiceActive = $event" />
        </PlayerBar>
      </div>
    </div>
  </main>
</template>
