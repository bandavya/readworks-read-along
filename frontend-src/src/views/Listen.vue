<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { assetUrl, loadPassage } from '../api'
import { clipForVoice, clipWords, newSeed, ratingSummary, ratingsCsv, readRatings, saveRatings, seededOrder } from '../listen'
import '../listen.css'

const config = ref(null)
const clips = ref([])
const seed = ref(0)
const sessionId = ref('')
const step = ref(0)
const heard = ref(false)
const selected = ref(0)
const wordReportOpen = ref(false)
const offWord = ref(null)
const answers = ref([])
const done = ref(false)
const error = ref('')
const persisted = ref(false)
// Facilitators open #/listen/?team directly; the listener flow never links to results.
const teamView = ref(/\?team$/.test(window.location.hash))
const storedRows = ref(readRatings())
const audio = ref(null)
const playButton = ref(null)
const doneHeading = ref(null)
const playing = ref(false)
const current = computed(() => clips.value[step.value])
const words = computed(() => current.value && config.value ? clipWords(config.value, config.value.passage, current.value) : [])
watch(selected, (rating) => {
  if (rating > 2) { wordReportOpen.value = false; offWord.value = null }
})

onMounted(async () => {
  document.title = 'Blind listening · Sound Along'
  try {
    const response = await fetch(assetUrl('data/listen/clips.json'))
    if (!response.ok) throw new Error('Listening setup did not load.')
    const setup = await response.json()
    const passage = await loadPassage(setup.passageId)
    const found = setup.sources.map((source) => clipForVoice(setup, passage, source))
    if (found.some((item) => !item)) throw new Error('One or more listening clips are unavailable.')
    config.value = { ...setup, passage }
    seed.value = newSeed()
    sessionId.value = `${Date.now().toString(36)}-${seed.value.toString(36)}`
    clips.value = seededOrder(found, seed.value)
  } catch (e) { error.value = e.message || 'Could not prepare the clips.' }
})

onBeforeUnmount(() => { audio.value?.pause() })

function atEnd() {
  if (audio.value && current.value && audio.value.currentTime >= current.value.end) audio.value.pause()
}
function audioFailed() {
  playing.value = false
  heard.value = false
  error.value = 'Audio could not load. Ask the facilitator to check the clip file.'
}

async function play() {
  if (!audio.value || !current.value) return
  if (playing.value) { audio.value.pause(); return }
  error.value = ''
  try {
    audio.value.pause()
    audio.value.currentTime = current.value.start
    await audio.value.play()
    heard.value = true
  } catch { error.value = 'This clip could not play. Try again or check the audio file.' }
}

async function rate() {
  if (!heard.value || !selected.value || !current.value) return
  audio.value?.pause()
  answers.value.push({
    session_id: sessionId.value,
    seed: seed.value,
    clip_id: config.value.clipId,
    passage_id: config.value.passageId,
    source: current.value.source,
    rating: selected.value,
    start_s: current.value.start,
    end_s: current.value.end,
    rated_at: new Date().toISOString(),
    off_word_index: offWord.value?.index ?? '',
    off_word: offWord.value?.text ?? '',
    off_word_time_s: offWord.value?.time ?? '',
  })
  if (step.value + 1 === clips.value.length) {
    try { storedRows.value = saveRatings(answers.value); persisted.value = true; done.value = true }
    catch { storedRows.value = [...storedRows.value, ...answers.value]; error.value = 'Browser storage is unavailable. Download the CSV before leaving this page.'; done.value = true }
    await nextTick()
    doneHeading.value?.focus()
    return
  }
  step.value++
  heard.value = false
  selected.value = 0
  wordReportOpen.value = false
  offWord.value = null
  await nextTick()
  audio.value?.load()
  playButton.value?.focus()
}

const allRows = computed(() => storedRows.value)
const summary = computed(() => ratingSummary(allRows.value))
const csv = computed(() => ratingsCsv(allRows.value))
async function newListener() {
  audio.value?.pause()
  window.location.hash = '#/listen/'
  seed.value = newSeed()
  sessionId.value = `${Date.now().toString(36)}-${seed.value.toString(36)}`
  clips.value = seededOrder(config.value.sources.map((source) => clipForVoice(config.value, config.value.passage, source)), seed.value)
  step.value = 0
  heard.value = false
  selected.value = 0
  wordReportOpen.value = false
  offWord.value = null
  answers.value = []
  done.value = false
  persisted.value = false
  teamView.value = false
  error.value = ''
  await nextTick()
  playButton.value?.focus()
}
async function copyCsv() {
  try { await navigator.clipboard.writeText(csv.value); error.value = 'CSV copied.' }
  catch { error.value = 'Copy failed. Use Download CSV instead.' }
}
function downloadCsv() {
  const url = URL.createObjectURL(new Blob([csv.value], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = 'sound-along-listening-ratings.csv'
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
</script>

<template>
  <main class="listen-page">
    <h1>Blind listening</h1>
    <p v-if="!teamView">Listen to each short clip. Rate how much it sounds like a person. You will not see which voice it is while rating.</p>
    <p class="listen-note">ReadWorks’ current computer voice is not in this test yet. Add ReadWorks’ current voice here before using these ratings as a comparison with today’s voice.</p>
    <p v-if="error" class="listen-error" role="status">{{ error }}</p>
    <section v-if="teamView" aria-labelledby="listen-results-title">
      <h2 id="listen-results-title">Team results on this browser</h2>
      <p>n = {{ summary.listeners }} {{ summary.listeners === 1 ? 'listener session' : 'listener sessions' }}; {{ summary.ratings }} {{ summary.ratings === 1 ? 'rating' : 'ratings' }}. Each session is counted once.</p>
      <p v-if="!summary.ratings">No completed ratings are saved here yet.</p>
      <div v-else class="listen-table-wrap">
        <table>
          <caption>Sounds like a person, rated 1 to 5</caption>
          <thead><tr><th scope="col">Source</th><th scope="col">Ratings</th><th scope="col">Sessions</th><th scope="col">Mean</th><th scope="col">Spread (SD)</th><th scope="col">Range</th></tr></thead>
          <tbody><tr v-for="item in summary.sources" :key="item.source"><th scope="row">{{ item.source }}</th><td>{{ item.ratings }}</td><td>{{ item.listeners }}</td><td>{{ item.mean.toFixed(2) }}</td><td>{{ item.spread.toFixed(2) }}</td><td>{{ item.min }}–{{ item.max }}</td></tr></tbody>
        </table>
      </div>
      <p class="listen-small">Spread is the standard deviation of these ratings. These are local, descriptive numbers only; a listener who takes the test twice counts twice. Results from other browsers are not included until their CSV files are combined.</p>
      <button type="button" @click="copyCsv">Copy CSV</button>
      <button type="button" @click="downloadCsv">Download CSV</button>
      <button v-if="config" type="button" @click="newListener">Start a new listener</button>
    </section>
    <template v-else-if="current && !done">
      <p class="listen-step">Clip {{ step + 1 }} of {{ clips.length }}</p>
      <audio ref="audio" :src="assetUrl(current.audio)" preload="auto" @play="playing = true" @pause="playing = false" @timeupdate="atEnd" @ended="atEnd" @error="audioFailed" />
      <button ref="playButton" class="listen-primary" type="button" @click="play">{{ playing ? 'Pause clip' : (heard ? 'Play again' : 'Play clip') }}</button>
      <fieldset :disabled="!heard">
        <legend>How much did it sound like a person?</legend>
        <div class="listen-ratings">
          <label v-for="n in 5" :key="n"><input v-model.number="selected" type="radio" name="rating" :value="n" />{{ n }}</label>
        </div>
        <p class="listen-scale">1 = not at all · 5 = very much</p>
      </fieldset>
      <section v-if="heard && selected > 0 && selected <= 2 && words.length" class="listen-word-report" aria-label="Optional word report">
        <button type="button" :aria-expanded="wordReportOpen" @click="wordReportOpen = !wordReportOpen">{{ wordReportOpen ? 'Hide word choices' : 'Optional: mark a word that sounded off' }}</button>
        <div v-if="wordReportOpen">
          <p>Did one word sound wrong? Choose it, or skip this. This is your impression, not a checked error.</p>
          <div class="listen-words">
            <button v-for="word in words" :key="word.index" type="button" :aria-pressed="offWord?.index === word.index" @click="offWord = offWord?.index === word.index ? null : word">{{ word.text }}</button>
          </div>
          <p v-if="offWord" role="status">Marked “{{ offWord.text }}.” Tap it again to clear.</p>
        </div>
      </section>
      <button type="button" :disabled="!heard || !selected" @click="rate">{{ step + 1 === clips.length ? 'Finish' : 'Next clip' }}</button>
      <details class="listen-floor"><summary>How to run this on the floor</summary><p>Allow about two minutes per listener. Ask them to listen without seeing the source and choose a number for each clip. Do not collect names. Give each person a new session. At the end, download the CSV.</p></details>
    </template>
    <template v-else-if="done">
      <h2 ref="doneHeading" tabindex="-1">Thank you for listening.</h2>
      <p>Your {{ answers.length }} ratings {{ persisted ? 'were saved in this browser' : 'are available for CSV export on this page' }}. No name was collected.</p>
      <p>Session seed: <code>{{ seed }}</code></p>
      <button type="button" @click="copyCsv">Copy CSV</button>
      <button type="button" @click="downloadCsv">Download CSV</button>
      <button type="button" @click="newListener">Start a new listener</button>
    </template>
    <p v-else-if="!error">Preparing clips…</p>
  </main>
</template>
