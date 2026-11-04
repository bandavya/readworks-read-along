<script setup>
import { ref, computed, onMounted } from 'vue'
import { loadIndex, gradeNum, gradeLabel, VOICE_NAMES, assetUrl } from '../../api'

const props = defineProps({ compare: { type: Boolean, default: false } })
const items = ref([])
const error = ref('')
const query = ref('')
const grade = ref('all')
const language = ref('all')
const selected = ref('')
const grades = computed(() => [...new Map(items.value.map(it => [gradeNum(it.grade), gradeLabel(it.grade)])).entries()].sort((a, b) => (a[0] ?? 99) - (b[0] ?? 99)))
const languages = computed(() => [...new Set(items.value.map(it => it.lang))].sort())
const shown = computed(() => items.value.filter(it =>
  (grade.value === 'all' || String(gradeNum(it.grade)) === grade.value) &&
  (language.value === 'all' || it.lang === language.value) &&
  it.title.toLocaleLowerCase().includes(query.value.trim().toLocaleLowerCase())
).sort((a, b) => (gradeNum(a.grade) ?? 99) - (gradeNum(b.grade) ?? 99) || a.title.localeCompare(b.title)))
const chosen = computed(() => items.value.find(it => it.uuid === selected.value))
const languageName = l => l === 'ES' ? 'Spanish' : l === 'EN' ? 'English' : l
const missingPictures = ref({})
const firstPicture = it => assetUrl(`img/${it.uuid}-1.webp`)
function pictureMissing(id) { missingPictures.value = { ...missingPictures.value, [id]: true } }

onMounted(async () => {
  document.title = props.compare ? 'Compare the looks · Sound Along' : 'Passages · Sound Along'
  try { items.value = await loadIndex(); selected.value = items.value[0]?.uuid || '' }
  catch { error.value = 'Could not load the passage list.' }
})
</script>

<template>
  <main class="sh-library">
    <div class="sh-library-intro">
      <div>
        <p v-if="compare" class="sh-library-kicker">Design study</p>
        <h1>{{ compare ? 'One passage. Different ways to read.' : 'Choose a passage.' }}</h1>
        <p v-if="compare">Pick a passage to open the original prototype or this look. Each uses the same local reading data.</p>
        <p v-else>Listen while the words light up, or open the big kid view for an early reader.</p>
      </div>
    </div>

    <p v-if="error" class="sh-library-error" role="alert">{{ error }}</p>
    <template v-else-if="compare">
      <section class="sh-compare-chooser" aria-label="Choose a passage">
        <label for="sh-compare-passage">Passage</label>
        <select id="sh-compare-passage" v-model="selected"><option v-for="it in items" :key="it.uuid" :value="it.uuid">{{ it.title }} · {{ gradeLabel(it.grade) }}</option></select>
      </section>
      <div v-if="chosen" class="sh-compare-layout">
        <section class="sh-compare-original">
          <h2>Original prototype</h2>
          <p>The working reader and kid screen used by the team.</p>
          <div class="sh-compare-actions"><a :href="`#/p/${selected}`">Open reader <span aria-hidden="true">→</span></a><a :href="`#/kid/${selected}`">Open kid view <span aria-hidden="true">→</span></a></div>
        </section>
        <section class="sh-compare-sharpened">
          <h2>Sharpened</h2>
          <p>ReadWorks’ familiar materials, composed around the reading. Try the optional live word trail in the reader.</p>
          <div class="sh-compare-actions"><a :href="`#/look/sharpened/p/${selected}`">Open reader <span aria-hidden="true">→</span></a><a :href="`#/look/sharpened/kid/${selected}`">Open kid view <span aria-hidden="true">→</span></a></div>
        </section>
      </div>
    </template>
    <template v-else>
      <form class="sh-library-filters" @submit.prevent aria-label="Filter passages">
        <label class="sh-search">Find a passage<input v-model="query" type="search" placeholder="Search titles" /></label>
        <label>Grade<select v-model="grade"><option value="all">All grades</option><option v-for="[n, label] in grades" :key="n" :value="String(n)">{{ label }}</option></select></label>
        <label>Language<select v-model="language"><option value="all">All languages</option><option v-for="l in languages" :key="l" :value="l">{{ languageName(l) }}</option></select></label>
      </form>
      <p class="sh-library-count" aria-live="polite">{{ shown.length }} of {{ items.length }} passages</p>
      <ol class="sh-library-list">
        <li v-for="it in shown" :key="it.uuid" class="sh-library-item">
          <div class="sh-library-picture" aria-hidden="true"><img v-if="!missingPictures[it.uuid]" :src="firstPicture(it)" alt="" loading="lazy" @error="pictureMissing(it.uuid)" /><span v-else class="sh-library-picture-fallback"><svg viewBox="0 0 120 80" focusable="false"><path d="M0 62c18-19 32-24 51-12 18 12 31-2 44-19 9-11 18-13 25-11v60H0Z" fill="currentColor" opacity=".16"/><path d="M0 71c21-14 38-13 53-4 22 12 41-10 67-14v27H0Z" fill="currentColor" opacity=".22"/><circle cx="30" cy="25" r="9" fill="currentColor" opacity=".18"/></svg></span></div>
          <div class="sh-library-item-body"><h2><a :href="`#/look/sharpened/p/${it.uuid}`">{{ it.title }}</a></h2><p>{{ gradeLabel(it.grade) }} <span>·</span> {{ it.lexile ? `${it.lexile}L` : 'Lexile not listed' }} <span>·</span> {{ it.words }} words <span v-if="it.lang !== 'EN'">· {{ languageName(it.lang) }}</span></p><p class="sh-library-voices">{{ it.voices?.map(v => VOICE_NAMES[v] || v).join(' / ') || 'No audio yet' }}</p></div>
          <div class="sh-library-item-actions"><a :href="`#/look/sharpened/p/${it.uuid}`">Read & listen <span aria-hidden="true">→</span></a><a :href="`#/look/sharpened/kid/${it.uuid}`">Kid view <span aria-hidden="true">→</span></a></div>
        </li>
      </ol>
      <p v-if="items.length && !shown.length" class="sh-library-error">No passages match. Try another title, grade, or language.</p>
    </template>
  </main>
</template>
