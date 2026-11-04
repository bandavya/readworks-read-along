<script setup>
// The Reading helper (#/focus/<uuid>): a calmer reader for grades 3-5, chosen by the READER with the
// "Reading helper" switch on the passage page, never by the passage's grade.
// Same support as the kid view (big highlight, tap a word to hear from it, press-and-hold or the M key for its meaning,
// syllable guide), same engine, same word-help components; an older, text-first look (ReadWorks' own feel: teal,
// slate ink, Merriweather, a quiet rule under the title; no stars, no cartoon cues).
// Word help is shared with the passage reader.
import { ref, reactive, shallowRef, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { loadPassage, store } from '../api'
import { SoundAlong } from '../soundAlong'
import FocusRail from '../components/FocusRail.vue'
import VocabCard from '../components/VocabCard.vue'
import SyllableGuide from '../components/SyllableGuide.vue'
import { loadKidAudio, loadGloss, loadSyllables } from '../kidAudio'
import { useWordHelp } from '../passage/useWordHelp'
import { leadWordsHtml } from '../components/LeadWords'
import { watchPassageImages } from '../components/PassageImage'
import '../focus.css'

const props = defineProps({ id: String })

const SIZES = [22, 26, 32, 38, 44] // px: regular through largest
const data = shallowRef(null)
const error = ref('')
const soundOn = ref(store.get('soundOn', true)) // the same browser setting the passage page's teacher switch writes
const size = ref(SIZES.includes(store.get('focusSize', 22)) ? store.get('focusSize', 22) : 22)
const reading = reactive({
  font: store.get('focus-reading-font', 'merriweather'),
  spacing: store.get('reading-spacing', false),
  tint: store.get('reading-tint', false),
})
if (!['merriweather', 'andika', 'sans'].includes(reading.font)) reading.font = 'merriweather'
reading.spacing = reading.spacing === true
reading.tint = reading.tint === true
watch(() => reading.font, (v) => store.set('focus-reading-font', v))
watch(() => reading.spacing, (v) => store.set('reading-spacing', v))
watch(() => reading.tint, (v) => store.set('reading-tint', v))
const textEl = ref(null)
const selectedWord = shallowRef(null)
let meaningButton = null
const railWrap = ref(null)
const vocabOpen = ref(false)
const vocabEl = ref(null)
const ended = ref(false)
const announce = ref('') // read out by screen readers when a meaning opens without taking focus
const state = reactive({ playing: false, time: 0, duration: 0, rate: store.get('rate', 1), voiceId: '', error: '' })
state.rate = Math.min(2, Math.max(0.75, Number(state.rate) || 1))
let engine = null
let stopWatchingImages = null

// Shared lead-word markup and ReadWorks' passage HTML.
const textHtml = computed(() => leadWordsHtml(data.value))
const voices = computed(() => data.value?.voices || [])
const audioOn = computed(() => soundOn.value && voices.value.length > 0)
const { card, cardAnchor, cardFocus, syl, gloss, kidAudio, saying,
  closeCard, onGuideStart, onHoldDown, onHoldMove, onHoldUp, onHoldCancel,
  swallowClick, onContextMenu, onCardSay, sayWord, dispose, showMeaning } = useWordHelp({
  id: props.id, data, soundOn: audioOn, spanish: ref(false), getEngine: () => engine,
  onMeaning: (def) => { announce.value = `${def.word}: ${def.text}` },
  onClose: () => { announce.value = '' },
  restoreAnchorFocus: true,
  closeOnOutsideWord: true,
})
const vocabList = computed(() =>
  Object.entries(data.value?.vocab || {})
    .map(([id, v]) => ({ id, ...v }))
    .sort((a, b) => a.word.localeCompare(b.word)),
)

/* ---------- Focus-specific keyboard selection; useWordHelp handles the card and hold ---------- */
// M or the nearby Meaning button opens help for the focused word; Enter hears from it through the engine.
function onTextKey(e) {
  // A switch sends Tab. Give the selected word's action the very next scan step even if
  // the passage markup groups words inside another element.
  if (e.key === 'Tab' && !e.shiftKey && meaningButton && e.target === selectedWord.value) {
    e.preventDefault()
    meaningButton.focus()
    return
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return
  if (e.key !== 'm' && e.key !== 'M') return
  const el = e.target.closest?.('.sa-w')
  if (!el || el.classList.contains('sa-unread')) return
  e.preventDefault()
  showMeaning(el)
}
function onWordFocus(e) {
  const el = e.target.closest?.('.sa-w:not(.sa-unread)')
  if (el && textEl.value?.contains(el)) {
    selectedWord.value = el
    if (meaningButton) {
      meaningButton.setAttribute('aria-label', `Meaning of ${el.textContent.trim()}`)
      // Keep the action one Tab press from the word, including for switch scanning.
      const host = el.closest('a, button') || el
      host.after(meaningButton)
    }
  }
}
function meaningForSelected() {
  if (!selectedWord.value) return
  showMeaning(selectedWord.value)
}
/* ---------- vocabulary section ---------- */
async function showVocab() {
  vocabOpen.value = true
  await nextTick()
  vocabEl.value?.scrollIntoView({ block: 'start' })
  vocabEl.value?.querySelector('summary')?.focus()
}

/* ---------- following the reading (the engine's own follow is off: our rail covers the top of the page) ---------- */
let lastUserScroll = 0
let ignoreScrollUntil = 0
const noteUser = () => { lastUserScroll = performance.now() }
const noteScroll = () => { if (performance.now() > ignoreScrollUntil) lastUserScroll = performance.now() }
function follow(k) {
  const el = engine?.words[k]
  if (!el || !state.playing) return
  const now = performance.now()
  if (now - lastUserScroll < 2500) return
  // the sticky part of the rail: the whole bar on wide screens, just the play row on phones (the wrapper is display: contents there)
  const wrapBox = railWrap.value?.getBoundingClientRect()
  const topBox = railWrap.value?.querySelector('.fx-rail-top')?.getBoundingClientRect()
  const top = Math.max(wrapBox && wrapBox.height ? wrapBox.bottom : 0, topBox ? topBox.bottom : 0) + 16
  const bottom = window.innerHeight - 16
  const r = el.getBoundingClientRect()
  if (r.top >= top && r.bottom <= bottom) return
  ignoreScrollUntil = now + 200
  window.scrollBy({ top: r.top - (top + (bottom - top) * 0.3), behavior: 'instant' })
}

/* ---------- audio controls ---------- */
function toggle() { engine?.toggle() }
function setRate(r) { store.set('rate', r); engine?.setRate(r) }
function setVoice(id) { store.set('voice', id); engine?.setVoice(id) }
function setSize(s) { size.value = s; store.set('focusSize', s) }
function listenAgain() {
  ended.value = false
  engine?.rewind()
  window.scrollTo({ top: 0, behavior: 'instant' })
  engine?.resume()
}
function leaveHelper() {
  store.set('readingHelper', false)
  window.location.hash = `#/p/${props.id}`
}

watch(() => state.playing, (p) => { if (p) ended.value = false })

onMounted(async () => {
  try {
    data.value = await loadPassage(props.id)
  } catch (e) {
    error.value = 'Could not load this passage.'
    return
  }
  Promise.all([loadSyllables(props.id), loadGloss(props.id), loadKidAudio()]).then(([s, g, k]) => {
    syl.value = s
    gloss.value = g
    kidAudio.value = k
  })
  document.title = `${data.value.title} · Reading helper`
  await nextTick()
  const el = textEl.value
  el.addEventListener('pointerdown', onHoldDown)
  el.addEventListener('pointermove', onHoldMove)
  el.addEventListener('contextmenu', onContextMenu)
  el.addEventListener('click', swallowClick, true)
  el.addEventListener('keydown', onTextKey)
  el.addEventListener('focusin', onWordFocus)
  meaningButton = document.createElement('button')
  meaningButton.type = 'button'
  meaningButton.className = 'fx-btn fx-meaning'
  meaningButton.textContent = 'Meaning'
  meaningButton.addEventListener('click', meaningForSelected)
  stopWatchingImages = watchPassageImages(el, data.value.lang)
  document.addEventListener('pointerup', onHoldUp)
  document.addEventListener('pointercancel', onHoldCancel)
  window.addEventListener('wheel', noteUser, { passive: true })
  window.addEventListener('touchmove', noteUser, { passive: true })
  window.addEventListener('scroll', noteScroll, { passive: true })

  if (voices.value.length) {
    engine = new SoundAlong({
      state,
      follow: false,
      onVocab: () => {}, // a tap hears the word; a hold, M, or the Meaning button opens help
      onCurrent: follow,
      onEnded: ({ snippet }) => { if (!snippet) ended.value = true },
    })
    const pref = store.get('voice', 'human')
    engine.attach(el, voices.value, { voiceId: voices.value.some((v) => v.id === pref) ? pref : voices.value[0].id, rate: state.rate })
    engine.setEnabled(soundOn.value)
  }
})

onBeforeUnmount(() => {
  meaningButton?.remove()
  meaningButton = null
  engine?.destroy()
  stopWatchingImages?.()
  dispose()
  document.removeEventListener('pointerup', onHoldUp)
  document.removeEventListener('pointercancel', onHoldCancel)
  window.removeEventListener('wheel', noteUser)
  window.removeEventListener('touchmove', noteUser)
  window.removeEventListener('scroll', noteScroll)
})
</script>

<template>
  <header class="topbar">
    <div class="topbar-in">
      <a class="brand" href="#/">Sound Along</a>
      <a class="back" href="#/">&larr; Find content</a>
      <button type="button" role="switch" aria-checked="true" class="fx-helper" @click="leaveHelper">
        <span class="fx-helper-knob" aria-hidden="true"></span>
        <span>Reading helper</span>
      </button>
    </div>
  </header>

  <main v-if="error" class="page"><p class="notice">{{ error }} <a href="#/">Back to the list</a></p></main>
  <p v-else-if="!data" class="page notice">Loading&hellip;</p>

  <main v-else class="fx-page" :class="{ 'fx-font-andika': reading.font === 'andika', 'fx-font-sans': reading.font === 'sans', 'fx-spaced': reading.spacing, 'fx-calm': reading.tint }" :style="{ '--fx-fs': size + 'px' }">
    <div ref="railWrap" class="fx-railwrap">
      <FocusRail v-if="audioOn" :state="state" :voices="voices" :size="size" :sizes="SIZES" :reading="reading" @toggle="toggle" @rate="setRate" @voice="setVoice" @seek="(t) => engine?.seekTime(t)" @size="setSize" />
      <section v-else class="fx-rail-top fx-rail-quiet" aria-label="Text size">
        <p class="fx-quiet">{{ voices.length ? 'Read-along sound is turned off in this browser.' : 'This passage has no recording yet.' }}
          <a :href="`#/p/${props.id}`" @click="leaveHelper">Open the full page</a><template v-if="voices.length"> to turn it on.</template></p>
        <div class="fx-field" role="group" aria-labelledby="fx-size-lab2">
          <span id="fx-size-lab2" class="fx-lab">Text size</span>
          <div class="fx-sizes">
            <button v-for="(s, i) in SIZES" :key="s" type="button" class="fx-size" :class="{ on: size === s }" :aria-pressed="size === s"
              :aria-label="['Regular text', 'Large text', 'Extra large text', 'Very large text', 'Largest text'][i]" @click="setSize(s)"><span aria-hidden="true" :style="{ fontSize: 15 + i * 3 + 'px' }">A</span></button>
          </div>
        </div>
        <div class="fx-reading-settings" role="group" aria-label="Reading appearance">
          <label class="fx-field"><span class="fx-lab">Font</span><select class="fx-select" v-model="reading.font"><option value="merriweather">Merriweather</option><option value="andika">Andika</option><option value="sans">Simple sans</option></select></label>
          <button type="button" class="fx-btn" :aria-pressed="reading.spacing" @click="reading.spacing = !reading.spacing">Extra spacing {{ reading.spacing ? 'on' : 'off' }}</button>
          <button type="button" class="fx-btn" :aria-pressed="reading.tint" @click="reading.tint = !reading.tint">Calm paper {{ reading.tint ? 'on' : 'off' }}</button>
        </div>
      </section>
      <p v-if="ended" class="fx-done" role="status">
        <span class="fx-done-t">Audio finished.</span>
        <button type="button" class="fx-btn" @click="listenAgain">Listen again</button>
        <button v-if="vocabList.length" type="button" class="fx-btn" @click="showVocab">Vocabulary</button>
      </p>
    </div>

    <article class="fx-article">
      <p v-if="audioOn" id="fx-keys" class="fx-hint">Tap a word to hear it. Select a word, then use its Meaning button for what it means. You can also press and hold a word.
        <span class="fx-keyhint">With a keyboard: Tab to the text, arrow keys move between words, Enter hears from that word, M shows its meaning, Escape closes it. Tab from a word to its Meaning button.</span></p>
      <div
        ref="textEl"
        class="sa-text fx-text"
        :class="{ 'sa-off': !audioOn }"
        :lang="data.lang === 'ES' ? 'es' : 'en'"
        :aria-describedby="audioOn ? 'fx-keys' : undefined"
        v-html="textHtml"
      ></div>
      <p class="credit fx-credit">{{ data.credit }}</p>

      <details v-if="vocabList.length" ref="vocabEl" class="fx-vocab" :open="vocabOpen" @toggle="vocabOpen = $event.target.open">
        <summary>Vocabulary ({{ vocabList.length }})</summary>
        <dl class="fx-vocab-list">
          <template v-for="v in vocabList" :key="v.id">
            <dt v-if="syl?.[v.id]"><span class="vocab-word">{{ v.word }}</span><span v-if="v.pos" class="say-pos">{{ v.pos }}</span></dt>
            <dt v-else>
              <button type="button" class="fx-say" :class="{ on: saying === v.id }" :aria-label="`Hear the word ${v.word}`" @click="sayWord(v.id)">
                <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M4 9v6h4l5 4V5L8 9H4zm12.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4zM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z"/></svg>
                <span>{{ v.word }}</span>
              </button>
              <span v-if="v.pos" class="say-pos">{{ v.pos }}</span>
            </dt>
            <dd>
              <SyllableGuide v-if="syl?.[v.id]" :entry="syl[v.id]" note="short" @start="onGuideStart" />
              <span>{{ v.definition }}</span>
              <em v-if="v.example">{{ v.example }}</em>
            </dd>
          </template>
        </dl>
      </details>
    </article>

    <p class="fx-sr" role="status" aria-live="polite">{{ announce ? `Meaning. ${announce}. Press Escape to close.` : '' }}</p>
    <VocabCard
      v-if="card && cardAnchor"
      :card="card"
      :anchor="cardAnchor"
      :focus-on-open="cardFocus"
      :saying="false"
      @close="closeCard({ restoreFocus: true })"
      @say="onCardSay"
      @guide-start="onGuideStart"
    />
  </main>
</template>
