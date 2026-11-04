<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { assetUrl, loadIndex, gradeNum, gradeLabel, VOICE_NAMES } from '../api'
import { route } from '../router'
import { SHOWCASE } from '../presenting'
import Teacher from './Teacher.vue'
import UsagePanel from '../dataKit/UsagePanel.vue'
import { usage } from '../usage'
import { PUBLIC_SAMPLE } from '../mode'

const items = ref([])
const error = ref('')
const grade = ref('all')
const lang = ref('all')
const showAll = ref(false)
const narrow = ref(false)
function measureWidth() { narrow.value = window.innerWidth <= 560 || (window.innerHeight <= 500 && window.innerWidth <= 900) }

onMounted(async () => {
  measureWidth()
  window.addEventListener('resize', measureWidth)
  document.title = SHOWCASE ? 'Sound Along' : PUBLIC_SAMPLE ? 'Sound Along (public sample)' : 'Sound Along'
  try { items.value = await loadIndex() } catch (e) { error.value = 'Could not load the passage list.' }
})

const gradeOptions = computed(() => {
  const set = new Map()
  for (const it of items.value) set.set(gradeNum(it.grade), gradeLabel(it.grade))
  return [...set.entries()].sort((a, b) => (a[0] ?? 99) - (b[0] ?? 99))
})
const langOptions = computed(() => [...new Set(items.value.map((i) => i.lang))].sort())

const shown = computed(() =>
  items.value
    .filter((i) => (grade.value === 'all' || String(gradeNum(i.grade)) === grade.value) && (lang.value === 'all' || i.lang === lang.value))
    .sort((a, b) => (gradeNum(a.grade) ?? 99) - (gradeNum(b.grade) ?? 99) || a.title.localeCompare(b.title)),
)
onBeforeUnmount(() => window.removeEventListener('resize', measureWidth))
watch([grade, lang], () => { showAll.value = false })
const visible = computed(() => narrow.value && !showAll.value ? shown.value.slice(0, 8) : shown.value)
const isEarly = (it) => { const n = gradeNum(it.grade); return n !== null && n <= 2 }
const langName = (l) => (l === 'ES' ? 'Spanish' : l === 'EN' ? 'English' : l)
</script>

<template>
  <template v-if="route.teacher">
    <Teacher />
    <details v-if="SHOWCASE" class="page team-tools"><summary>This device</summary><UsagePanel :usage="usage" /></details>
    <UsagePanel v-else :usage="usage" />
  </template>
  <template v-else>
  <header class="topbar">
    <div class="topbar-in">
      <a class="brand" href="#/">Sound Along</a>
      <span class="topbar-title">Find content</span>
      <a class="back" href="#/teacher/">Assign a passage</a>
    </div>
  </header>

  <main class="page lib">
    <h1 class="lib-h">Passages</h1>
    <p v-if="PUBLIC_SAMPLE" class="lib-intro">Pick a story and read it on your own. The three sample stories have no audio. Younger readers can tap <strong>Kid view</strong> for a simpler reading screen.</p>
    <p v-else class="lib-intro">Pick a story. Younger readers: tap <strong>Kid view</strong> and then the big play button. Older readers: open the
      story and press play, or tap any word to hear from there.</p>
    <p v-if="PUBLIC_SAMPLE"><a class="card-kid" href="#/try">Try your own text (silent preview)</a></p>
    <form class="filters" @submit.prevent>
      <label>Grade
        <select v-model="grade">
          <option value="all">All grades</option>
          <option v-for="[n, label] in gradeOptions" :key="n" :value="String(n)">{{ label }}</option>
        </select>
      </label>
      <label>Language
        <select v-model="lang">
          <option value="all">All languages</option>
          <option v-for="l in langOptions" :key="l" :value="l">{{ langName(l) }}</option>
        </select>
      </label>
      <p class="count" aria-live="polite">{{ shown.length }} of {{ items.length }} passages</p>
    </form>

    <p v-if="error" class="notice">{{ error }}</p>
    <ul class="cards">
      <li v-for="it in visible" :key="it.uuid" class="card">
        <img v-if="!PUBLIC_SAMPLE" class="card-cover" :src="assetUrl(`img/${it.uuid}-1.webp`)" alt="" loading="lazy" @error="$event.target.remove()" />
        <h2 class="card-title"><a :href="`#/p/${it.uuid}`">{{ it.title }}</a></h2>
        <p class="meta">
          <span>{{ gradeLabel(it.grade) }}</span>
          <span v-if="it.lexile">{{ it.lexile }}L</span>
          <span>{{ it.words }} words</span>
          <span v-if="it.lang !== 'EN'">{{ langName(it.lang) }}</span>
        </p>
        <p class="badges">
          <span v-for="v in it.voices" :key="v" class="badge" :class="v">{{ VOICE_NAMES[v] || v }}</span>
        </p>
        <a v-if="isEarly(it)" class="card-kid" :href="`#/kid/${it.uuid}`">Kid view</a>
      </li>
    </ul>
    <button v-if="narrow && shown.length > visible.length" type="button" class="lib-more" @click="showAll = true">Show all {{ shown.length }} passages</button>
    <p v-if="!error && items.length && !shown.length" class="notice">No passages match these filters.</p>
  </main>
  </template>
</template>

<style scoped>
.card-cover { display: block; width: 100%; aspect-ratio: 16 / 9; object-fit: cover; border-radius: 6px; margin-bottom: 10px; }
.card-title a { display: inline-flex; align-items: center; min-height: 44px; }
</style>
