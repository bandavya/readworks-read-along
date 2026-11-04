<script setup>
import { presenting } from '../presenting'
// Syllable guide.
// Tiles for each syllable with dots between (stressed one bold and underlined). Tap a tile = just that syllable.
// Speaker = the whole word, each syllable lighting as it is said (whole_segments). Turtle = slowly, each syllable in
// turn, then the whole word lit together (slow_phases). The audio element's clock drives the light (requestAnimationFrame
// plus timeupdate, so it stays honest when animation frames are throttled). Used in the teacher popover, the Vocabulary
// tab, and the kid view (iconsOnly: no words, just tiles + one speaker + one turtle).
import { ref, computed, onBeforeUnmount, watch } from 'vue'
import { assetUrl } from '../api'
import { claimGuide, releaseGuide } from '../guideBus'
import { syllableItem, reviewOf, verifyAudio, needsAudioVerification } from '../review'
import ReviewMark from './ReviewMark.vue'
import '../syllable.css'

const props = defineProps({
  entry: { type: Object, required: true },
  iconsOnly: Boolean,
  note: { type: String, default: '' }, // '' | 'short' | 'full' : adult-facing "not reviewed" text
  pid: { type: String, default: '' }, // passage + sense ids let the guide look up its review state (review.js);
  sid: { type: String, default: '' }, // without them it behaves as before and says "not checked yet"
  markKid: { type: Boolean, default: true }, // icons-only (kid) guides show the tiny draft marker unless the parent does
})
const emit = defineEmits(['start', 'done'])

const audio = new Audio()
const mode = ref('') // 'whole' | 'slow' | 'one:<i>' | ''
const activeIndex = ref(-1)
const wholeLit = ref(false)
let frame = 0
let finishFn = null

const parts = computed(() => props.entry.syllables || [])
const item = computed(() => (props.pid ? syllableItem(props.entry._wordBankPid || props.pid, props.entry._wordBankSid || props.sid, props.entry) : null))
const rstate = computed(() => (item.value ? reviewOf(item.value).state : 'draft'))
watch(item, (it) => { if (needsAudioVerification(it)) verifyAudio(it).catch(() => {}) }, { immediate: true })

function read() {
  if (!mode.value) return
  const t = audio.currentTime
  const m = mode.value
  activeIndex.value = -1
  wholeLit.value = false
  if (m === 'whole') {
    activeIndex.value = (props.entry.whole_segments || []).findIndex((s) => t >= s.start && t < s.end)
  } else if (m === 'slow') {
    const ph = (props.entry.slow_phases || []).find((s) => t >= s.start && t < s.end)
    if (ph?.kind === 'syllable') activeIndex.value = ph.index
    else if (ph?.kind === 'whole') wholeLit.value = true
  } else if (m.startsWith('one:')) {
    activeIndex.value = Number(m.slice(4))
  }
}
function loop() {
  read()
  frame = mode.value && !audio.paused ? requestAnimationFrame(loop) : 0
}
function reset() {
  cancelAnimationFrame(frame)
  frame = 0
  mode.value = ''
  activeIndex.value = -1
  wholeLit.value = false
}
function end(completed) {
  const m = mode.value
  const f = finishFn
  finishFn = null
  reset()
  if (m) emit('done', { mode: m, completed })
  f?.(completed)
}
audio.addEventListener('timeupdate', read)
audio.addEventListener('ended', () => end(true))
audio.addEventListener('error', () => { if (audio.getAttribute('src')) end(false) })

function stop() {
  if (!mode.value && !finishFn) return
  audio.pause()
  end(false)
}

// Start a clip. Resolves true when it played to the end, false if it was cut off or could not play.
function play(path, m) {
  if (!path) return Promise.resolve(false)
  if (mode.value === m) { stop(); return Promise.resolve(false) } // pressing the playing button stops it
  stop()
  claimGuide(stop)
  emit('start') // the parent pauses narration / other speech
  return new Promise((resolve) => {
    finishFn = resolve
    mode.value = m
    audio.src = assetUrl(path)
    const p = audio.play()
    read()
    if (p && p.catch) p.catch(() => end(false))
    frame = requestAnimationFrame(loop)
  })
}

function playWhole() { return play(props.entry.audio?.whole, 'whole') }
function playSlow() { return play(props.entry.audio?.slow, 'slow') }
function playOne(i) { return play(props.entry.audio?.syllables?.[i], `one:${i}`) }

onBeforeUnmount(() => {
  releaseGuide(stop)
  audio.pause()
  finishFn = null
  reset()
  audio.removeAttribute('src')
})

defineExpose({ playWhole, playSlow, stop })
</script>

<template>
  <div class="sg" :class="{ 'sg-icons': iconsOnly }">
    <div class="sg-row" role="group" :aria-label="`Parts of ${entry.word}`">
      <template v-for="(part, i) in parts" :key="i">
        <span v-if="i" class="sg-dot" aria-hidden="true">&middot;</span>
        <button
          type="button"
          class="sg-tile"
          :class="{ stressed: i === entry.stress_index, lit: activeIndex === i || wholeLit }"
          :aria-label="`Hear ${part}, part ${i + 1} of ${parts.length}${i === entry.stress_index ? ', strong beat' : ''}`"
          :aria-pressed="activeIndex === i || wholeLit"
          @click="playOne(i)"
        >{{ part }}</button>
      </template>
    </div>
    <div class="sg-actions">
      <button type="button" class="sg-act sg-whole" :class="{ on: mode === 'whole' }" :aria-label="`Hear the word ${entry.word}`" :aria-pressed="mode === 'whole'" @click="playWhole">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M4 9v6h4l5 4V5L8 9H4zm12.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4zM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z" /></svg>
        <span v-if="!iconsOnly" class="sg-label">Hear it</span>
      </button>
      <button type="button" class="sg-act sg-slow" :class="{ on: mode === 'slow' }" :aria-label="`Hear ${entry.word} slowly`" :aria-pressed="mode === 'slow'" @click="playSlow">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path fill="currentColor" d="M3 16a8 7 0 0 1 16 0z" />
          <circle fill="currentColor" cx="20.6" cy="13.6" r="2" />
          <rect fill="currentColor" x="5" y="15.5" width="3.2" height="3.6" rx="1.2" />
          <rect fill="currentColor" x="12.8" y="15.5" width="3.2" height="3.6" rx="1.2" />
        </svg>
        <span v-if="!iconsOnly" class="sg-label">Slowly</span>
      </button>
    </div>
    <template v-if="presenting" />
    <template v-else-if="note && !iconsOnly">
      <p v-if="rstate === 'draft'" class="sg-note" data-review="draft">
        Computer voice, not checked by a person yet.<template v-if="note === 'full' && entry.uncertainty"> {{ entry.uncertainty }}</template>
        <a v-if="pid" class="sg-check" :href="`#/review/${entry._wordBankPid || pid}`">Check it</a>
      </p>
      <ReviewMark v-else :items="[item]" :pid="entry._wordBankPid || pid" />
    </template>
    <ReviewMark v-else-if="!iconsOnly && item" :items="[item]" :pid="entry._wordBankPid || pid" />
    <p v-else-if="!iconsOnly" class="sg-note" data-review="draft">Computer voice, not checked by a person yet.</p>
    <ReviewMark v-else-if="iconsOnly && markKid && item" :items="[item]" variant="kid" />
    <p v-else-if="iconsOnly && markKid" class="sg-note" data-review="draft">Draft voice</p>
  </div>
</template>
