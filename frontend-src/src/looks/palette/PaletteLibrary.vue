<script setup>
import { computed, onMounted, ref } from 'vue'
import { assetUrl, gradeLabel, gradeNum, loadIndex, store } from '../../api'
import './palette-library.css'
const items = ref([]), loading = ref(true), error = ref('')
const search = ref(''), grade = ref('all'), language = ref('all'), audio = ref('all'), bookmarksOnly = ref(false)
const bookmarks = ref(new Set(store.get('paletteBookmarks', []))), failedImages = ref(new Set())
const grades = computed(() => [...new Map(items.value.map(i => [gradeNum(i.grade), gradeLabel(i.grade)])).entries()].filter(([n]) => n !== null).sort((a,b) => a[0]-b[0]))
const shown = computed(() => items.value.filter(i => (!search.value.trim() || i.title.toLowerCase().includes(search.value.trim().toLowerCase())) && (grade.value === 'all' || gradeNum(i.grade) === Number(grade.value)) && (language.value === 'all' || i.lang === language.value) && (audio.value === 'all' || i.voices.includes(audio.value)) && (!bookmarksOnly.value || bookmarks.value.has(i.uuid))).sort((a,b) => (gradeNum(a.grade) ?? 99) - (gradeNum(b.grade) ?? 99) || a.title.localeCompare(b.title)))
const url = (i, screen = 'p') => '#/look/palette/' + screen + '/' + i.uuid
function toggleBookmark(id) { const next = new Set(bookmarks.value); next.has(id) ? next.delete(id) : next.add(id); bookmarks.value = next; store.set('paletteBookmarks', [...next]) }
function clearFilters() { search.value = ''; grade.value = 'all'; language.value = 'all'; audio.value = 'all'; bookmarksOnly.value = false }
function imageFailed(id) { failedImages.value = new Set([...failedImages.value, id]) }
onMounted(async () => {
 document.title = 'Find passages · Sound Along'
 try {
  const index = await loadIndex()
  items.value = index.map(i => ({ ...i, image: null, imageAlt: '' }))
  loading.value = false
  await Promise.all(index.map(async i => {
   try {
    const r = await fetch(assetUrl('data/' + i.uuid + '.json'))
    if (!r.ok) return
    const d = await r.json(), body = document.createElement('div')
    body.innerHTML = d.html || ''
    const img = body.querySelector('figure img')
    if (img?.getAttribute('src')) items.value = items.value.map(row => row.uuid === i.uuid ? { ...row, image: assetUrl(img.getAttribute('src')), imageAlt: img.getAttribute('alt') || '' } : row)
   } catch { /* Browsing still works without artwork. */ }
  }))
 } catch { error.value = 'Could not load the passage list.'; loading.value = false }
})
</script>
<template>
<div class="palette-library">
 <header class="pl-top"><a class="pl-brand" href="#/look/palette/">ReadWorks <span>Sound Along</span></a></header>
 <main>
  <div class="pl-heading"><div><p class="pl-crumb">Find Content <span aria-hidden="true">/</span> Sound Along</p><h1>Find a passage</h1><p>Choose a passage to read and listen, or open the kid view.</p></div><div class="pl-heading-mark" aria-hidden="true"><svg viewBox="0 0 96 96"><path d="M16 27h27c8 0 13 3 13 10v40c-4-5-9-7-16-7H16zM80 27H62c-8 0-13 3-13 10v40c4-5 9-7 16-7h15z" fill="none" stroke="currentColor" stroke-width="3"/><path d="M22 38h17M22 47h17M61 38h13M61 47h13" stroke="currentColor" stroke-width="2"/></svg></div></div>
  <div class="pl-layout">
   <aside class="pl-filters" aria-label="Passage filters"><h2>Filter passages</h2>
    <label><span>Search</span><input v-model="search" type="search" placeholder="Title"></label>
    <label><span>Grade</span><select v-model="grade"><option value="all">All grades</option><option v-for="[n,label] in grades" :key="n" :value="String(n)">{{ label }}</option></select></label>
    <label><span>Language</span><select v-model="language"><option value="all">All languages</option><option value="EN">English</option><option value="ES">Spanish</option></select></label>
    <label><span>Audio</span><select v-model="audio"><option value="all">All audio</option><option value="human">Human voice</option><option value="generated">Generated voice</option></select></label>
    <label class="pl-check"><input v-model="bookmarksOnly" type="checkbox"><span>Bookmarked only</span></label>
    <button class="pl-reset" type="button" @click="clearFilters">Clear filters</button>
    
   </aside>
   <section class="pl-results" aria-labelledby="pl-results-title"><div class="pl-results-head"><div><h2 id="pl-results-title">Passages</h2><p aria-live="polite">{{ shown.length }} {{ shown.length === 1 ? 'result' : 'results' }}</p></div></div>
    <p v-if="loading" class="pl-status">Loading passages…</p><p v-else-if="error" class="pl-status" role="alert">{{ error }}</p><p v-else-if="!shown.length" class="pl-status">No passages match these filters. <button type="button" @click="clearFilters">Show all passages</button></p>
    <div v-else class="pl-list"><article v-for="item in shown" :key="item.uuid" class="pl-row">
     <div class="pl-picture"><img v-if="item.image && !failedImages.has(item.uuid)" :src="item.image" :alt="item.imageAlt" loading="lazy" @error="imageFailed(item.uuid)"><div v-else class="pl-picture-empty" aria-hidden="true"><svg viewBox="0 0 80 60"><path d="M7 48 27 28l12 10 11-18 23 28H7Z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="23" cy="17" r="5" fill="none" stroke="currentColor" stroke-width="2"/></svg></div></div>
     <div class="pl-row-main"><h3><a :href="url(item)">{{ item.title }}</a></h3><p>{{ gradeLabel(item.grade) }} <span aria-hidden="true">·</span> {{ item.lexile ? item.lexile + 'L' : 'Lexile not listed' }} <span aria-hidden="true">·</span> {{ item.words }} words <template v-if="item.lang === 'ES'"><span aria-hidden="true">·</span> Spanish</template></p><p class="pl-voices">{{ item.voices.includes('human') ? 'Human voice' : 'Generated voice' }}<template v-if="item.voices.includes('human') && item.voices.includes('generated')"> and generated voice</template></p><div class="pl-actions"><a :href="url(item)">Read and listen <span aria-hidden="true">→</span></a><a v-if="item.lang !== 'ES'" :href="url(item, 'kid')">Kid view <span aria-hidden="true">→</span></a></div></div>
     <button class="pl-bookmark" type="button" :aria-label="(bookmarks.has(item.uuid) ? 'Remove bookmark for ' : 'Bookmark ') + item.title" :aria-pressed="bookmarks.has(item.uuid)" @click="toggleBookmark(item.uuid)"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3h14v18l-7-5-7 5z" :fill="bookmarks.has(item.uuid) ? 'currentColor' : 'none'" stroke="currentColor" stroke-width="2"/></svg></button>
    </article></div>
   </section>
  </div>
 </main></div>
</template>
