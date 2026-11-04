<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { assetUrl, gradeLabel, gradeNum, loadIndex, loadPassage, VOICE_NAMES } from '../../api'
import { soundMap } from './soundMap'
import './sound.css'
import './soundLibrary.css'

const items = ref([])
const error = ref('')
const grade = ref('all')
const language = ref('all')
const mapsOn = ref(false)
const maps = ref({})
const mapErrors = ref({})
const loading = ref(false)
let generation = 0

const gradeOptions = computed(() => [...new Map(items.value.map((it) => [gradeNum(it.grade), gradeLabel(it.grade)])).entries()]
  .sort((a, b) => (a[0] ?? 99) - (b[0] ?? 99)))
const languages = computed(() => [...new Set(items.value.map((it) => it.lang))].sort())
const shown = computed(() => items.value
  .filter((it) => (grade.value === 'all' || String(gradeNum(it.grade)) === grade.value) && (language.value === 'all' || it.lang === language.value))
  .sort((a, b) => (gradeNum(a.grade) ?? 99) - (gradeNum(b.grade) ?? 99) || a.title.localeCompare(b.title)))
const langName = (lang) => lang === 'ES' ? 'Spanish' : lang === 'EN' ? 'English' : lang
const canKid = (it) => it.lang !== 'ES'

onMounted(async () => {
  document.title = 'Sound Along · Passages'
  try { items.value = await loadIndex() } catch { error.value = 'Could not load the passage list.' }
})

watch([mapsOn, shown], async () => {
  const run = ++generation
  if (!mapsOn.value) { loading.value = false; return }
  const pending = shown.value.filter((it) => !(it.uuid in maps.value) && !(it.uuid in mapErrors.value))
  loading.value = pending.length > 0
  // Limit simultaneous document and optional audio-bundle requests.
  let next = 0
  async function worker() {
    while (next < pending.length && run === generation) {
      const it = pending[next++]
      try {
        const doc = await loadPassage(it.uuid)
        if (run !== generation) return
        const map = soundMap(doc)
        if (map) maps.value = { ...maps.value, [it.uuid]: map }
        else mapErrors.value = { ...mapErrors.value, [it.uuid]: 'No timed narration available.' }
      } catch {
        if (run === generation) mapErrors.value = { ...mapErrors.value, [it.uuid]: 'Sound map unavailable.' }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(2, pending.length) }, worker))
  if (run === generation) loading.value = false
})
</script>

<template>
  <div class="sound-library sound-shell">
    <header class="sound-top"><a class="sound-brand" href="#/look/sound/">ReadWorks <span>Sound Along</span></a></header>
    <main class="sl-main">
      <div class="sl-opening">
        <div>
          <h1>Find your next story.</h1>
          <p>Listen and follow each word, or choose a simpler page for a young reader.</p>
        </div>
        <div class="sl-key" aria-hidden="true"><span></span><span></span><span></span><span></span><span></span><span></span><span></span></div>
      </div>
      <section class="sl-experiment" aria-label="Sound maps">
        <div><h2>See the sound of a story</h2><p>Try a little map of each paragraph’s spoken rhythm. Longer bars are longer sounds; spaces are pauses.</p></div>
        <label class="sl-switch"><input v-model="mapsOn" type="checkbox"><span>{{ mapsOn ? 'Sound maps on' : 'Show sound maps' }}</span></label>
      </section>
      <div class="sl-section-title"><h2>Passages</h2><span aria-live="polite">{{ shown.length }} of {{ items.length }}</span></div>
      <form class="sl-filters" @submit.prevent>
        <label>Grade <select v-model="grade"><option value="all">All grades</option><option v-for="[n, label] in gradeOptions" :key="n" :value="String(n)">{{ label }}</option></select></label>
        <label>Language <select v-model="language"><option value="all">All languages</option><option v-for="lang in languages" :key="lang" :value="lang">{{ langName(lang) }}</option></select></label>
      </form>
      <p v-if="error" class="sl-notice" role="alert">{{ error }}</p>
      <p v-else-if="!items.length" class="sl-notice">Loading passages…</p>
      <p v-else-if="!shown.length" class="sl-notice">No passages match these filters.</p>
      <ul v-else class="sl-list">
        <li v-for="(it, index) in shown" :key="it.uuid" class="sl-item">
          <div class="sl-story"><img class="sl-cover" :src="assetUrl(`img/${it.uuid}-1.webp`)" alt="" loading="lazy" @error="$event.target.remove()"><h3><a :href="`#/look/sound/p/${it.uuid}`">{{ it.title }}</a></h3>
            <p class="sl-meta">{{ gradeLabel(it.grade) }}<span v-if="it.lexile"> · {{ it.lexile }}L</span> · {{ it.words }} words<span v-if="it.lang !== 'EN'"> · {{ langName(it.lang) }}</span></p>
            <p class="sl-voices">{{ it.voices.map((v) => VOICE_NAMES[v] || v).join(' · ') }}</p>
          </div>
          <div v-if="mapsOn" class="sl-map-wrap">
            <template v-if="maps[it.uuid]"><svg class="sl-map" :viewBox="`0 0 300 ${Math.min(5, maps[it.uuid].rows.length) * 15}`" role="img" :aria-label="`Timing map: ${maps[it.uuid].rows.length} paragraphs, ${maps[it.uuid].voice} voice`">
              <g v-for="(row, ri) in maps[it.uuid].rows.slice(0, 5)" :key="ri" :transform="`translate(0 ${ri * 15})`"><rect v-for="(bar, bi) in row" :key="bi" :x="bar.x" y="2" :width="bar.w" height="8" rx="2" /></g>
            </svg><span v-if="maps[it.uuid].rows.length > 5" class="sl-more">+ {{ maps[it.uuid].rows.length - 5 }} more paragraphs</span></template>
            <span v-else class="sl-map-note">{{ mapErrors[it.uuid] || 'Drawing rhythm…' }}</span>
          </div>
          <div class="sl-actions"><a :href="`#/look/sound/p/${it.uuid}`">Read along <span aria-hidden="true">→</span></a><a v-if="canKid(it)" :href="`#/look/sound/kid/${it.uuid}`">Kid view <span aria-hidden="true">→</span></a></div>
        </li>
      </ul>
      <p v-if="mapsOn && loading" class="sl-loading" role="status">Drawing sound maps from the narration timings…</p>
    </main>
    </div>
</template>
