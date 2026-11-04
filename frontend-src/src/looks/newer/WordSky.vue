<script setup>
import { computed, ref, watch } from 'vue'

const props = defineProps({ passage: Object })
const emit = defineEmits(['close'])
const selected = ref(-1)
const opened = ref(new Set())
const stars = computed(() => props.passage?.vocab || [])
watch(() => props.passage?.uuid, () => { selected.value = -1; opened.value = new Set() })
function reveal(i) {
  selected.value = i
  opened.value = new Set([...opened.value, i])
}
function onKey(e) { if (e.key === 'Escape') emit('close') }
</script>

<template>
  <section class="nw-sky" aria-labelledby="nw-sky-title" @keydown="onKey">
    <div class="nw-sky-head">
      <div><p>Word sky</p><h2 id="nw-sky-title">{{ passage.title }}</h2></div>
      <button type="button" class="nw-sky-close" @click="emit('close')">Close word sky <span aria-hidden="true">×</span></button>
    </div>
    <div v-if="stars.length" class="nw-sky-message" aria-live="polite">
      <template v-if="selected >= 0"><strong>{{ stars[selected].word }}</strong><span>{{ stars[selected].definition }}</span><small>Word meaning from ReadWorks. Explore each word, then open the passage to hear it in the story.</small></template>
      <template v-else><strong>Choose a word.</strong><span>Each point opens one word from this passage.</span></template>
    </div>
    <div v-if="stars.length" class="nw-sky-stage">
      <div class="nw-sky-orbit" aria-hidden="true"></div>
      <svg class="nw-sky-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path d="M18 68 34 28 54 59 72 22 84 68 54 59 18 68" /></svg>
      <button v-for="(word, i) in stars" :key="`${word.word}-${i}`" class="nw-star" :class="[`nw-star-${i % 8}`, { 'is-open': opened.has(i), 'is-selected': selected === i }]" type="button" :aria-pressed="selected === i" :aria-label="`Explore ${word.word}`" @click="reveal(i)">
        <span class="nw-star-shape" aria-hidden="true"><svg viewBox="0 0 80 80"><path d="M40 2 72 24 60 70H20L8 24Z"/></svg></span><span class="nw-star-word">{{ word.word }}</span>
      </button>
    </div>
    <p v-else class="nw-sky-empty">This story has no words to know.</p>
    <div class="nw-sky-actions"><a :href="`#/look/newer/p/${passage.uuid}`">Read this passage <span aria-hidden="true">→</span></a><a v-if="passage.lang !== 'ES'" :href="`#/look/newer/kid/${passage.uuid}`">Open kid view <span aria-hidden="true">→</span></a></div>
    <p class="nw-sky-note">Exploring a word lights a point here. It does not mark the word learned or save progress.</p>
  </section>
</template>
