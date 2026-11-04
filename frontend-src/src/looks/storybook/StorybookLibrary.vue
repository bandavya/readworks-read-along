<script setup>
import { computed, nextTick, onMounted, ref } from 'vue'
import { assetUrl, gradeLabel, gradeNum, loadIndex, VOICE_NAMES } from '../../api'
import './storybookLibrary.css'

const items = ref([])
const loading = ref(true)
const error = ref('')
const query = ref('')
const grade = ref('all')
const shelf = ref(false)
const selectedId = ref('')
const preview = ref(null)
const failedImages = ref(new Set())

const grades = computed(() => [...new Set(items.value.map(item => gradeNum(item.grade)).filter(n => n !== null))].sort((a, b) => a - b))
const shown = computed(() => items.value.filter(item =>
  (grade.value === 'all' || gradeNum(item.grade) === Number(grade.value)) &&
  item.title.toLocaleLowerCase().includes(query.value.trim().toLocaleLowerCase())
).sort((a, b) => (gradeNum(a.grade) ?? 99) - (gradeNum(b.grade) ?? 99) || a.title.localeCompare(b.title)))
const selected = computed(() => shown.value.find(item => item.uuid === selectedId.value) || shown.value[0] || null)
const imageOkay = item => item.image && !failedImages.value.has(item.uuid)
const childRoute = item => item.lang !== 'ES'
function imageFailed(id) { failedImages.value = new Set([...failedImages.value, id]) }
async function choose(item) {
  selectedId.value = item.uuid
  await nextTick()
  preview.value?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' })
  preview.value?.focus({ preventScroll: true })
}

// Passage pictures stay in the local data bundle. The library never writes titles or art into a public asset.
async function withPicture(item) {
  try {
    const response = await fetch(assetUrl(`data/${item.uuid}.json`))
    if (!response.ok) throw new Error(String(response.status))
    const passage = await response.json()
    const fragment = document.createElement('div')
    fragment.innerHTML = passage.html || ''
    const image = fragment.querySelector('figure img')
    const path = image?.getAttribute('src')
    return { ...item, image: path ? assetUrl(path) : '', imageAlt: image?.getAttribute('alt') || '' }
  } catch {
    return { ...item, image: '', imageAlt: '' }
  }
}
onMounted(async () => {
  document.title = 'Storybook library · Sound Along'
  try {
    const index = await loadIndex()
    items.value = index.map(item => ({ ...item, image: '', imageAlt: '' }))
    loading.value = false
    items.value = await Promise.all(index.map(withPicture))
  } catch {
    error.value = 'Could not load the passage list.'
    loading.value = false
  }
})
</script>

<template>
  <div class="sbl-shell">
    <header class="sbl-header"><a class="sbl-brand" href="#/look/storybook/">ReadWorks <span>Sound Along</span></a></header>
    <main>
      <section class="sbl-intro" aria-labelledby="sbl-title">
        <div class="sbl-intro-copy"><h1 id="sbl-title">Open a story.<br><em>Follow every word.</em></h1><p>Choose a passage for reading and listening, or open its bigger picture book view for younger readers.</p></div>
        <div class="sbl-intro-art" aria-hidden="true"><div class="sbl-drawn-book"><span></span><span></span><span></span></div><div class="sbl-intro-caption">Sound Along<br>story collection</div></div>
      </section>

      <section class="sbl-library" aria-labelledby="sbl-library-title">
        <div class="sbl-heading"><div><h2 id="sbl-library-title">The library</h2></div><label class="sbl-shelf-switch"><input v-model="shelf" type="checkbox" role="switch" /><span class="sbl-switch-track" aria-hidden="true"><span></span></span><span>Try the bookshelf</span></label></div>
        <form class="sbl-filters" @submit.prevent aria-label="Find a passage"><label><span>Find a title</span><input v-model="query" type="search" placeholder="Search stories" /></label><label><span>Grade</span><select v-model="grade"><option value="all">All grades</option><option v-for="n in grades" :key="n" :value="String(n)">{{ gradeLabel(n) }}</option></select></label><p aria-live="polite">{{ shown.length }} {{ shown.length === 1 ? 'passage' : 'passages' }}</p></form>
        <p v-if="loading" class="sbl-state" role="status">Opening the library…</p><p v-else-if="error" class="sbl-state" role="alert">{{ error }}</p><p v-else-if="!shown.length" class="sbl-state">No titles found. Try a different search or grade.</p>

        <div v-if="shown.length && !shelf" class="sbl-covers">
          <article v-for="(item, i) in shown" :key="item.uuid" class="sbl-cover-entry" :class="{ 'sbl-first': i === 0 }">
            <div class="sbl-cover" :class="`sbl-color-${i % 5}`"><div class="sbl-cover-picture"><img v-if="imageOkay(item)" :src="item.image" :alt="item.imageAlt" loading="lazy" @error="imageFailed(item.uuid)" /><div v-else class="sbl-cover-fallback" aria-hidden="true"><svg viewBox="0 0 180 150"><path d="M23 113c31-20 52-20 67-3 18-16 40-17 67 3V39C131 25 105 31 90 44 67 29 44 25 23 39z" fill="none" stroke="currentColor" stroke-width="3"/><path d="M90 44v80M23 113v10c30-18 54-16 67 0 18-17 39-18 67 0v-10" fill="none" stroke="currentColor" stroke-width="3"/></svg></div></div><div class="sbl-cover-label"><span>{{ gradeLabel(item.grade) }}</span><h3>{{ item.title }}</h3></div></div>
            <div class="sbl-entry-bottom"><p>{{ item.words }} words <span aria-hidden="true">·</span> {{ item.voices.map(v => VOICE_NAMES[v] || v).join(' & ') }}</p><div class="sbl-entry-actions"><a :href="`#/look/storybook/p/${item.uuid}`">Read and listen <span aria-hidden="true">→</span></a><a v-if="childRoute(item)" :href="`#/look/storybook/kid/${item.uuid}`">Kid view <span aria-hidden="true">→</span></a></div></div>
          </article>
        </div>

        <div v-if="shown.length && shelf" class="sbl-shelf-experiment">
          <p class="sbl-shelf-hint">Pick a spine to pull out a book.</p>
          <div class="sbl-shelf-layout"><div class="sbl-shelves" aria-label="Bookshelf"><div v-for="(row, rowNumber) in Math.ceil(shown.length / 6)" :key="rowNumber" class="sbl-shelf-row"><button v-for="(item, j) in shown.slice(rowNumber * 6, rowNumber * 6 + 6)" :key="item.uuid" class="sbl-spine" :class="[`sbl-color-${(rowNumber * 6 + j) % 5}`, { 'sbl-spine-selected': selected?.uuid === item.uuid }]" type="button" :aria-label="`Pull out ${item.title}`" :aria-pressed="selected?.uuid === item.uuid" @click="choose(item)"><span>{{ item.title }}</span><small>{{ gradeLabel(item.grade) }}</small></button></div></div>
            <article v-if="selected" ref="preview" class="sbl-pulled-book" tabindex="-1" aria-label="Selected book preview" aria-live="polite"><div class="sbl-pulled-picture"><img v-if="imageOkay(selected)" :src="selected.image" :alt="selected.imageAlt" @error="imageFailed(selected.uuid)" /><div v-else class="sbl-cover-fallback" aria-hidden="true"><svg viewBox="0 0 180 150"><path d="M23 113c31-20 52-20 67-3 18-16 40-17 67 3V39C131 25 105 31 90 44 67 29 44 25 23 39z" fill="none" stroke="currentColor" stroke-width="3"/><path d="M90 44v80" stroke="currentColor" stroke-width="3"/></svg></div></div><div class="sbl-pulled-copy"><p>{{ gradeLabel(selected.grade) }} <span aria-hidden="true">·</span> {{ selected.words }} words</p><h3>{{ selected.title }}</h3><p>{{ selected.voices.map(v => VOICE_NAMES[v] || v).join(' & ') }}</p><div class="sbl-entry-actions"><a :href="`#/look/storybook/p/${selected.uuid}`">Read and listen <span aria-hidden="true">→</span></a><a v-if="childRoute(selected)" :href="`#/look/storybook/kid/${selected.uuid}`">Kid view <span aria-hidden="true">→</span></a></div></div></article></div>
        </div>
      </section>
    </main>
    </div>
</template>
