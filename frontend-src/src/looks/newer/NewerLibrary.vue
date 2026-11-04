<script setup>
import { computed, onMounted, ref } from 'vue'
import { gradeLabel, gradeNum, VOICE_NAMES } from '../../api'
import { isEarly, loadLibrary } from './libraryData'
import WordSky from './WordSky.vue'
import './newer-library.css'

const items = ref([])
const error = ref('')
const loading = ref(true)
const grade = ref('all')
const language = ref('all')
const query = ref('')
const sky = ref(null)
const failedImages = ref(new Set())
const gradeOptions = computed(() => [...new Map(items.value.map(it => [gradeNum(it.grade), gradeLabel(it.grade)])).entries()].sort((a, b) => (a[0] ?? 99) - (b[0] ?? 99)))
const shown = computed(() => items.value.filter(it =>
  (grade.value === 'all' || String(gradeNum(it.grade)) === grade.value) &&
  (language.value === 'all' || it.lang === language.value) &&
  (!query.value || it.title.toLocaleLowerCase().includes(query.value.trim().toLocaleLowerCase()))
).sort((a, b) => (gradeNum(a.grade) ?? 99) - (gradeNum(b.grade) ?? 99) || a.title.localeCompare(b.title)))
const featured = computed(() => shown.value[0] || null)
const remaining = computed(() => shown.value.slice(1))
function imageFailed(id) { failedImages.value = new Set([...failedImages.value, id]) }
function showSky(item) { sky.value = item; requestAnimationFrame(() => document.getElementById('nw-sky-title')?.scrollIntoView({ block: 'start' })) }
onMounted(async () => {
  document.title = 'Passages · Sound Along'
  try { items.value = await loadLibrary(index => { items.value = index; loading.value = false }) } catch { error.value = 'Could not load the passage list.' }
  loading.value = false
})
</script>

<template>
  <div class="nw-lib">
    <header class="nw-lib-top"><a class="nw-lib-brand" href="#/look/newer/">ReadWorks <span>Sound Along</span></a></header>
    <main>
      <section class="nw-lib-hero"><div class="nw-lib-hero-in"><div class="nw-lib-heading"><p>Stories to listen to and read</p><h1>Find a story<br><em>to hear and read.</em></h1><span>Choose a story for the older reader or open the kid view. The words stay at the center of both.</span></div><div class="nw-lib-hero-mark" aria-hidden="true"><svg viewBox="0 0 260 260"><path d="M130 12 248 94 206 246H54L12 94Z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M130 47 211 105 182 210H78L49 105Z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M130 77 184 116 164 184H96L76 116Z" fill="none" stroke="currentColor" stroke-width="2"/></svg></div></div></section>
      <div class="nw-lib-layout">
        <aside class="nw-lib-intro"><span class="nw-lib-cut" aria-hidden="true"></span><h2>Follow every word.</h2><p>Listen as the words light up. Tap a word to hear it again. Word help is available when you need it.</p></aside>
        <div class="nw-lib-main">
          <form class="nw-lib-filters" @submit.prevent aria-label="Find a passage"><label class="nw-lib-search"><span>Search passages</span><input v-model="query" type="search" placeholder="Search by title" /></label><label><span>Grade</span><select v-model="grade"><option value="all">All grades</option><option v-for="[n,label] in gradeOptions" :key="n" :value="String(n)">{{ label }}</option></select></label><label><span>Language</span><select v-model="language"><option value="all">All languages</option><option value="EN">English</option><option value="ES">Spanish</option></select></label></form>
          <div class="nw-lib-results"><h2>Passages</h2><p aria-live="polite">{{ shown.length }} {{ shown.length === 1 ? 'passage' : 'passages' }}</p></div>
          <p v-if="loading" class="nw-lib-state">Loading passages…</p><p v-else-if="error" class="nw-lib-state" role="alert">{{ error }}</p><p v-else-if="!shown.length" class="nw-lib-state">No passages match. Try another search or filter.</p>
          <WordSky v-if="sky" :passage="sky" @close="sky = null" />
          <template v-if="featured">
            <article class="nw-lib-feature"><div class="nw-lib-feature-art"><img v-if="featured.image && !failedImages.has(featured.uuid)" :src="featured.image" :alt="featured.imageAlt" @error="imageFailed(featured.uuid)" /><div v-else class="nw-lib-art-fallback" aria-hidden="true"><svg viewBox="0 0 160 160"><path d="M80 8 150 58 125 148H35L10 58Z" fill="none" stroke="currentColor" stroke-width="2"/></svg></div></div><div class="nw-lib-feature-copy"><p class="nw-lib-kind">Featured passage · {{ gradeLabel(featured.grade) }}</p><h3>{{ featured.title }}</h3><p>{{ featured.words }} words <span aria-hidden="true">·</span> {{ featured.voices.map(v => VOICE_NAMES[v] || v).join(' & ') }}</p><div class="nw-lib-actions"><a :href="`#/look/newer/p/${featured.uuid}`">Read and listen <span aria-hidden="true">→</span></a><a v-if="featured.lang !== 'ES'" :href="`#/look/newer/kid/${featured.uuid}`">Kid view <span aria-hidden="true">→</span></a><button type="button" :aria-pressed="sky?.uuid === featured.uuid" @click="showSky(featured)">Explore word sky <span aria-hidden="true">✦</span></button></div></div></article>
            <div class="nw-lib-list"><article v-for="it in remaining" :key="it.uuid" class="nw-lib-row"><div class="nw-lib-thumb"><img v-if="it.image && !failedImages.has(it.uuid)" :src="it.image" :alt="it.imageAlt" loading="lazy" @error="imageFailed(it.uuid)" /><span v-else class="nw-lib-mini-fallback" aria-hidden="true">◇</span></div><div class="nw-lib-row-info"><p>{{ gradeLabel(it.grade) }} <span aria-hidden="true">·</span> {{ it.words }} words <template v-if="it.lang === 'ES'">· Spanish</template></p><h3>{{ it.title }}</h3><small>{{ it.voices.map(v => VOICE_NAMES[v] || v).join(' & ') }}</small></div><div class="nw-lib-row-actions"><a :href="`#/look/newer/p/${it.uuid}`">Read and listen <span aria-hidden="true">→</span></a><a v-if="it.lang !== 'ES'" :href="`#/look/newer/kid/${it.uuid}`">Kid view <span aria-hidden="true">→</span></a><button type="button" :aria-pressed="sky?.uuid === it.uuid" @click="showSky(it)">Explore word sky <span aria-hidden="true">✦</span></button></div></article></div>
          </template>
        </div>
      </div>
    </main></div>
</template>
