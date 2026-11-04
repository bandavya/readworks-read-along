<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, shallowRef } from 'vue'
import { loadPassage } from '../api'
import { leadWordsHtml } from '../components/LeadWords'
import { SoundAlong } from '../soundAlong'
import { chosenTake, csv, playableTakes, timingForTake, validWordIndices } from '../compare'
import '../compare.css'

const props = defineProps({ id: String })
const doc = shallowRef(null)
const error = ref('')
const textEl = ref(null)
const state = reactive({ playing: false, time: 0, duration: 0, rate: 1, voiceId: '', error: '' })
const selectedK = ref(null)
const playedSelection = ref(false)
const observations = ref([])
const takes = computed(() => playableTakes(doc.value))
const selectedWord = computed(() => selectedK.value === null ? null : engine?.words[selectedK.value] || null)
const selectedTiming = computed(() => selectedWord.value ? timingForTake(takes.value, state.voiceId, selectedWord.value) : null)
const textHtml = computed(() => leadWordsHtml(doc.value))
let engine = null
let gone = false
let pendingReplay = null

function onReplayPlaying() {
  if (pendingReplay && engine?.range && !engine.audio.paused && !state.error &&
      engine.voice?.id === pendingReplay.take && selectedK.value === pendingReplay.word) {
    playedSelection.value = true
    pendingReplay = null
  }
}

function updateUrl(id) {
  const url = new URL(window.location.href)
  if (id) url.searchParams.set('take', id)
  else url.searchParams.delete('take')
  history.replaceState(null, '', url)
}
function choose(id) {
  if (!engine || !takes.value.some(t => t.id === id)) return
  if (id !== state.voiceId) { playedSelection.value = false; pendingReplay = null }
  engine.setVoice(id) // pauses old media and transfers the narrated word index
  updateUrl(id)
}
function onWord(e) {
  if (e.type === 'keydown' && (e.repeat || !['Enter', ' '].includes(e.key))) return
  const word = e.target.closest?.('.sa-w:not(.sa-unread)')
  if (!word || !engine?.index.has(word)) return
  selectedK.value = engine.index.get(word)
  playedSelection.value = false
  pendingReplay = null
}
function replay() {
  if (selectedK.value === null) return
  playedSelection.value = false
  pendingReplay = null
  engine.pause() // a fresh playback start gives this replay its own 'playing' event
  pendingReplay = { take: state.voiceId, word: selectedK.value }
  if (!engine.playRange(Math.max(0, selectedK.value - 1), Math.min(engine.words.length - 1, selectedK.value + 1),
    { onCancel: () => { pendingReplay = null }, onEnd: () => { pendingReplay = null } })) pendingReplay = null
}
function observe(value) {
  if (selectedK.value === null || !playedSelection.value || state.error || !selectedTiming.value || !engine?.voice) return
  const word = selectedWord.value
  const voice = engine.voice
  const index = word.dataset.l !== undefined ? `lead:${word.dataset.l}` : `body:${word.dataset.i}`
  observations.value.push({ passage_id: props.id, take_id: voice.id, audio: voice.audio,
    recording_source: voice.id === 'human' ? 'ReadWorks human recording' : 'Generated recording',
    timing_source: voice.source || 'Unspecified in passage record', word_index: index,
    word: word.textContent, start_s: selectedTiming.value[0], end_s: selectedTiming.value[1],
    observation: value, sample_count: 1, observation_provenance: 'Adult listener; subjective audio replay, no reference onset',
    observed_at: new Date().toISOString() })
}
function download() {
  const blob = new Blob([csv(observations.value)], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `take-observations-${props.id}.csv`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
function reset() {
  engine?.pause()
  selectedK.value = null
  playedSelection.value = false
  pendingReplay = null
  observations.value = []
  if (takes.value.length) choose(takes.value[0].id)
  else updateUrl(null)
  engine?.rewind()
}
onMounted(async () => {
  try { doc.value = await loadPassage(props.id) } catch { error.value = 'Could not load this passage.'; return }
  if (gone) return
  document.title = `${doc.value.title} · Compare recordings`
  await nextTick()
  if (!takes.value.length) return
  if (!validWordIndices([...textEl.value.querySelectorAll('.sa-w:not(.sa-unread)')], doc.value)) {
    error.value = 'This passage has words that do not match its timing rows.'
    return
  }
  const requested = new URL(window.location.href).searchParams.get('take')
  const take = chosenTake(takes.value, requested)
  updateUrl(take.id)
  engine = new SoundAlong({ state, follow: false })
  engine.attach(textEl.value, takes.value, { voiceId: take.id, rate: 1 })
  engine.audio.addEventListener('playing', onReplayPlaying)
  textEl.value.addEventListener('click', onWord)
  textEl.value.addEventListener('keydown', onWord)
})
onBeforeUnmount(() => {
  gone = true
  textEl.value?.removeEventListener('click', onWord)
  textEl.value?.removeEventListener('keydown', onWord)
  engine?.audio.removeEventListener('playing', onReplayPlaying)
  engine?.destroy()
})
</script>

<template>
  <main class="take-compare">
    <a href="#/">Library</a>
    <header><p class="eyebrow">Adult listening check</p><h1>Compare recordings</h1>
      <p>Listen to the same passage in each available recording. Timing and voice change together here, so this cannot tell which timing method is more accurate.</p>
      <a href="#/listen">Blind voice listening</a>
    </header>
    <p v-if="error" role="alert">{{ error }}</p>
    <template v-else-if="doc">
      <div v-if="!takes.length" role="status">No playable takes with valid audio and word timing are available for this passage.</div>
      <section v-else aria-label="Comparison controls">
        <label>Recording <select :value="state.voiceId" @change="choose($event.target.value)"><option v-for="take in takes" :key="take.id" :value="take.id">{{ take.label || take.id }}</option></select></label>
        <p>Recording: {{ state.voiceId === 'human' ? 'ReadWorks human recording' : 'Generated recording' }}<br>Timing: {{ engine?.voice?.source || 'Unspecified in passage record' }}</p>
        <p>Timing method: passage timing only. A second method for this exact audio is not verified in this route.</p>
        <div class="controls">
          <button type="button" @click="engine?.toggle()">{{ state.playing ? 'Pause' : 'Play' }}</button>
          <label>Speed <select :value="state.rate" @change="engine?.setRate(Number($event.target.value))"><option :value="0.75">0.75×</option><option :value="1">1×</option><option :value="1.25">1.25×</option><option :value="1.5">1.5×</option></select></label>
          <button type="button" @click="reset">Reset comparison</button>
        </div>
        <p v-if="state.error" role="alert">{{ state.error }} <button type="button" @click="engine?.retry()">Try recording again</button></p>
        <p aria-live="polite">{{ state.time.toFixed(1) }} / {{ state.duration.toFixed(1) }} seconds · active word {{ engine?.curK >= 0 ? engine.curK + 1 : 'none' }}</p>
      </section>
      <section v-if="takes.length" class="compare-reader" aria-label="Passage words" ref="textEl" v-html="textHtml"></section>
      <section v-if="takes.length" aria-label="Word observation">
        <h2>Check a word</h2><p>Select a word in the passage, then replay it with its neighbors. An observation is a listener's impression, not a measured onset.</p>
        <p v-if="selectedWord">{{ selectedWord.textContent }} · {{ selectedWord.dataset.l !== undefined ? 'lead-in' : 'body' }} index {{ selectedWord.dataset.l ?? selectedWord.dataset.i }} · {{ selectedTiming ? `${selectedTiming[0].toFixed(3)}–${selectedTiming[1].toFixed(3)} s` : 'not spoken in this recording' }}</p>
        <div class="controls" v-if="selectedTiming"><button type="button" @click="replay">Replay nearby words</button><button v-for="value in ['early','late','on-time','uncertain']" :key="value" type="button" :disabled="!playedSelection || !!state.error" @click="observe(value)">{{ value }}</button></div>
        <p>{{ observations.length }} observations, from this comparison only.</p>
        <button type="button" :disabled="!observations.length" @click="download">Download observations CSV</button>
      </section>
    </template>
    <p v-else role="status">Loading passage…</p>
  </main>
</template>
