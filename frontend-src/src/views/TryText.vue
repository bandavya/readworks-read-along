<script setup>
import { ref, computed } from 'vue'

const draft = ref('')
const preview = ref('')
const active = ref(-1)
const words = computed(() => preview.value.trim().match(/\S+/gu) || [])
function showPreview() { preview.value = draft.value.slice(0, 5000); active.value = -1 }
</script>

<template>
  <header class="topbar"><div class="topbar-in"><a class="brand" href="#/">Sound Along</a><span class="topbar-title">Try your own text</span></div></header>
  <main class="page try-page">
    <h1>Try your own text</h1>
    <p>Paste a short passage to see a silent reading preview. Nothing is saved or sent. There is no voice, pronunciation, or word meaning here.</p>
    <label for="try-input">Your text</label>
    <textarea id="try-input" v-model="draft" rows="7" maxlength="5000" placeholder="Paste text here"></textarea>
    <button type="button" class="try-action" :disabled="!draft.trim()" @click="showPreview">Show reading view</button>
    <section v-if="words.length" aria-label="Silent reading preview">
      <h2>Reading view</h2>
      <p>The times below are evenly spaced placeholders, not recorded or verified speech timing.</p>
      <div class="try-words" role="group" aria-label="Passage words">
        <button v-for="(word, i) in words" :key="i" type="button" class="try-word" :aria-pressed="active === i" @click="active = i">{{ word }}</button>
      </div>
      <button type="button" class="try-action" :disabled="active >= words.length - 1" @click="active++">Next word</button>
      <span aria-live="polite">{{ active < 0 ? 'Choose a word to begin.' : `Word ${active + 1} of ${words.length}: ${words[active]}` }}</span>
      <p v-if="active >= 0">Mock timing: {{ (active * 0.5).toFixed(1) }}–{{ ((active + 1) * 0.5).toFixed(1) }} seconds. No audio plays.</p>
    </section>
  </main>
</template>

<style scoped>
.try-page { max-width: 850px; }
.try-page label { display: block; font-weight: 700; margin: 18px 0 8px; }
.try-page textarea { display: block; width: 100%; box-sizing: border-box; padding: 12px; font: inherit; font-size: 18px; line-height: 1.5; border: 2px solid var(--line); border-radius: 8px; background: var(--panel); color: var(--ink); }
.try-action, .try-word { min-height: 44px; padding: 8px 18px; margin: 12px 4px 12px 0; border-radius: 8px; cursor: pointer; font: inherit; }
.try-action { border: 0; background: var(--teal); color: var(--on-teal); font-weight: 700; }
.try-word { border: 1px solid var(--line); background: var(--panel); color: var(--ink); }
.try-word[aria-pressed='true'] { background: var(--hl-bg); }
.try-page :focus-visible { outline: 3px solid var(--focus); outline-offset: 2px; }
</style>
