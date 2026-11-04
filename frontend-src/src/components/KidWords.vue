<script setup>
// "Words to know": one big card per ReadWorks vocabulary word. Tap a card (or its speaker) to hear the word,
// then its meaning. Kids can't read the definition, so the audio is the point. (Research I.)
import { ref, computed } from 'vue'
import SyllableGuide from './SyllableGuide.vue'
import ReviewMark from './ReviewMark.vue'
import { PUBLIC_SAMPLE } from '../mode'
import { helpChoice, eligibleHelp } from '../helpPolicy'

const props = defineProps({ cards: Array, voice: Object, prompts: Object, speaking: Boolean })
const help = helpChoice()
const visibleCards = computed(() => (props.cards || []).map((c) => {
  if (help === 'current') return c
  const clipItem = c.reviewItems?.find((item) => item.kind === 'vocab')
  const guideItem = c.reviewItems?.find((item) => item.kind === 'syllables')
  const choice = eligibleHelp({ source: { word: c.word, text: c.definition },
    generated: { word: c.word, clips: c.defClip ? [c.defClip] : [] },
    sourceIsOriginal: !PUBLIC_SAMPLE, guide: c.guide, clipItem, guideItem, mode: help })
  return { ...c, definition: choice.text, say: PUBLIC_SAMPLE ? null : c.say,
    defClip: choice.clipItem ? c.defClip : null,
    guide: choice.guide, reviewItems: [choice.clipItem, choice.guideItem].filter(Boolean) }
}).filter((c) => c.definition || c.guide || c.say))
defineEmits(['home', 'again'])

const active = ref('')
const guides = {} // card id -> its SyllableGuide, so tapping the word can play it ("Tap one to hear it" must be true)
function setGuide(id, el) { if (el) guides[id] = el; else delete guides[id] }
// A word with a syllable guide: the guide plays the word (or just a part, or slowly); after the WHOLE word the
// spoken meaning follows. (Syllables and the slow version stand alone.)
function guideStart() { props.prompts.interrupt() }
function guideDone(c, e) {
  if (e.mode === 'whole' && e.completed && c.defClip) props.prompts.speakNow([c.defClip])
}
async function hear(c) {
  active.value = c.id
  // the recorded word, then the spoken meaning (when there is one)
  await props.prompts.speakNow([c.say, c.defClip])
  if (active.value === c.id) active.value = ''
}
</script>

<template>
  <div class="kv-read kv-wordscreen">
    <header class="kv-rail">
      <button type="button" class="kv-btn kv-home" aria-label="Home" @click="$emit('home')">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 3 1.8 12.2h3v8.3h5.4v-5.6h3.6v5.6h5.4v-8.3h3z" /></svg>
      </button>
      <button type="button" class="kv-btn kv-again" aria-label="Read the story again" @click="$emit('again')">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 4.5V1.2L7.2 5.4 12 9.6V6.3a5.7 5.7 0 1 1-5.7 5.7H3.6A8.4 8.4 0 1 0 12 4.5z" /></svg>
      </button>
    </header>

    <section class="kv-words" aria-label="Words to know">
      <div class="kv-star-row" aria-hidden="true">&#9733; &#9733; &#9733;</div>
      <ul class="kv-cards">
        <li v-for="c in visibleCards" :key="c.id" class="kv-wcard" :class="{ on: active === c.id }">
          <div v-if="c.guide" class="kv-wcard-main kv-wcard-guided">
            <button type="button" class="kv-wcard-hear" :aria-label="`Hear the word ${c.word}`" @click="guides[c.id]?.playWhole()">
              <span class="kv-wcard-word">{{ c.word }}<ReviewMark variant="kid" :items="c.reviewItems" /></span>
              <span class="kv-wcard-pic" aria-hidden="true">
                <svg viewBox="0 0 24 24"><path fill="currentColor" d="M21 19V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2zM8.5 13.5l2.5 3 3.5-4.5 4.5 6H5z" /></svg>
              </span>
            </button>
            <SyllableGuide :ref="(el) => setGuide(c.id, el)" icons-only :mark-kid="false" :entry="c.guide" @start="guideStart" @done="guideDone(c, $event)" />
          </div>
          <button v-else-if="c.say || c.defClip" type="button" class="kv-wcard-main" :aria-label="`Hear the word ${c.word}`" @click="hear(c)">
            <span class="kv-wcard-word">{{ c.word }}<ReviewMark variant="kid" :items="c.reviewItems" /></span>
            <span class="kv-wcard-pic" aria-hidden="true">
              <svg viewBox="0 0 24 24"><path fill="currentColor" d="M21 19V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2zM8.5 13.5l2.5 3 3.5-4.5 4.5 6H5z" /></svg>
            </span>
            <span class="kv-wcard-say" aria-hidden="true">
              <svg viewBox="0 0 24 24"><path fill="currentColor" d="M4 9v6h4l5 4V5L8 9H4zm12.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4zM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z" /></svg>
            </span>
          </button>
          <div v-else class="kv-wcard-main"><span class="kv-wcard-word">{{ c.word }}<ReviewMark variant="kid" :items="c.reviewItems" /></span><span class="kv-wcard-definition">{{ c.definition }}</span></div>
        </li>
      </ul>
      <p v-if="!visibleCards.length" class="kv-endmsg">The end! Great reading.</p>
    </section>
  </div>
</template>
