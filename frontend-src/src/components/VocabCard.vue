<script setup>
// The vocabulary card as a popover AT the word (design note: "If you click on a word, your eye is going to be
// there, and it's going to want the information there"). Prefers the space ABOVE the word, because narration keeps
// reading downward and above is text already read; flips below when there's no room. Follows the word on scroll.
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import SyllableGuide from './SyllableGuide.vue'
import ReviewMark from './ReviewMark.vue'
import { verifyAudio, needsAudioVerification } from '../review'
import { PUBLIC_SAMPLE } from '../mode'

const props = defineProps({ card: Object, anchor: Object, focusOnOpen: Boolean, saying: Boolean, compact: Boolean })
const emit = defineEmits(['close', 'say', 'guide-start'])
// card.guide = syllable entry (replaces the single speaker button); card.hold = opened by press-and-hold;
// card.canSay = a spoken meaning exists (hold cards)
const showHear = (c) => (c.hold ? !!c.canSay : !c.guide) && !!(c.canSay || ((!c.helpMode || c.helpMode === 'current') && !PUBLIC_SAMPLE) || (c.helpMode && c.helpMode !== 'current' && !PUBLIC_SAMPLE && c.say))
const reviewSources = computed(() => {
  const groups = new Map()
  for (const item of props.card?.reviewItems || []) {
    if (!item) continue
    const pid = item.pid || props.card?.pid
    if (!groups.has(pid)) groups.set(pid, [])
    groups.get(pid).push(item)
  }
  return [...groups].map(([pid, items]) => ({ pid, items }))
})
watch(() => props.card?.reviewItems, (items) => {
  if (props.card?.helpMode && props.card.helpMode !== 'current') return
  for (const item of items || []) if (needsAudioVerification(item)) verifyAudio(item).catch(() => {})
}, { immediate: true })

// Optional word sticker. It records only a word the reader chose to save, on this device.
// Saving is exploration, not a claim that the child has learned or mastered the word.
const WORDS_KEY = 'soundAlong.exploredWords.v1'
const saved = ref(false)
const wordKey = computed(() => String(props.card?.word || '').trim().toLocaleLowerCase('en-US'))
function readSaved() {
  try {
    const words = JSON.parse(globalThis.localStorage?.getItem(WORDS_KEY) || '[]')
    return Array.isArray(words) ? words.filter((word) => typeof word === 'string') : []
  } catch { return [] }
}
watch(wordKey, (word) => { saved.value = !!word && readSaved().includes(word) }, { immediate: true })
function toggleSaved() {
  const word = wordKey.value
  if (!word) return
  const words = new Set(readSaved())
  if (words.has(word)) words.delete(word)
  else words.add(word)
  try {
    if (!globalThis.localStorage) return
    globalThis.localStorage.setItem(WORDS_KEY, JSON.stringify([...words]))
    saved.value = words.has(word)
  } catch { /* Storage can be disabled. The word card still works. */ }
}

const pop = ref(null)
const hearBtn = ref(null)
const pos = ref({ top: -9999, left: 0, arrow: 0, below: false, hidden: true })
let raf = 0

function bottomSafe() {
  const dock = document.querySelector('.dock')
  return dock ? dock.getBoundingClientRect().top : window.innerHeight
}

function place() {
  const el = pop.value
  const a = props.anchor
  if (!el || !a || !a.isConnected) return
  const r = a.getBoundingClientRect()
  const w = el.offsetWidth
  const h = el.offsetHeight
  const gap = 10
  const top0 = 8
  const bot = bottomSafe() - 8
  const offscreen = r.bottom < top0 || r.top > bot
  const roomAbove = r.top - top0
  const below = roomAbove < h + gap && bot - r.bottom > roomAbove
  const top = below ? r.bottom + gap : r.top - gap - h
  const cx = (r.left + r.right) / 2
  const left = Math.max(8, Math.min(window.innerWidth - w - 8, cx - w / 2))
  pos.value = { top, left, arrow: Math.max(16, Math.min(w - 16, cx - left)), below, hidden: offscreen }
}

function focusFirst() {
  ;(hearBtn.value || pop.value?.querySelector('.sg-tile'))?.focus()
}

function loop() {
  place()
  raf = requestAnimationFrame(loop)
}

onMounted(async () => {
  await nextTick()
  loop()
  if (props.focusOnOpen) focusFirst()
})
onBeforeUnmount(() => cancelAnimationFrame(raf))
watch(() => [props.card, props.anchor], async () => {
  await nextTick()
  place()
  if (props.focusOnOpen) focusFirst()
})

defineExpose({ el: pop })
</script>

<template>
  <Teleport to="body">
    <div
      ref="pop"
      class="vpop"
      :class="{ below: pos.below, hidden: pos.hidden }"
      :role="compact ? 'group' : 'dialog'"
      :aria-modal="compact ? undefined : 'false'"
      aria-labelledby="vpop-word"
      :style="{ top: pos.top + 'px', left: pos.left + 'px', '--arrow-x': pos.arrow + 'px' }"
    >
      <div class="vpop-body">
      <div class="vpop-head">
        <button v-if="!compact && showHear(card)" ref="hearBtn" type="button" class="vpop-hear" :class="{ on: saying }" :aria-label="card.hold ? `Hear what ${card.word} means` : `Hear the word ${card.word}`" @click="emit('say')">
          <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path fill="currentColor" d="M4 9v6h4l5 4V5L8 9H4zm12.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4zM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z"/></svg>
        </button>
        <p id="vpop-word" class="vpop-word">{{ card.word }}</p>
        <span v-if="card.pos" class="vpop-pos">{{ card.pos }}</span>
        <button type="button" class="vpop-close" aria-label="Close" @click="emit('close')">&times;</button>
      </div>
      <ReviewMark v-for="source in compact ? [] : reviewSources" :key="source.pid" :items="source.items" :pid="source.pid" />
      <!-- The opted-in card already carries the eligible guide item in reviewSources. Hide the
           guide's fallback draft note while leaving its pid blank to avoid a mount-time fetch. -->
      <SyllableGuide v-if="!compact && card.guide" :key="card.id" class="vpop-guide" :class="{ 'vpop-guide-policy': card.helpMode && card.helpMode !== 'current' }" :entry="card.guide" :pid="!card.helpMode || card.helpMode === 'current' ? card.pid : ''" :sid="card.sid" :mark-kid="false" @start="emit('guide-start')" />
      <p v-if="card.definition" class="vpop-def">{{ card.definition }}</p>
      <p v-if="!compact && card.example" class="vpop-ex">{{ card.example }}</p>
      <p v-if="card.spanish" class="vpop-es" lang="es">En español: {{ card.spanish }}</p>
      <button v-if="!compact && wordKey" type="button" class="vpop-save" :aria-pressed="saved" :aria-label="saved ? `Remove ${card.word} from my words` : `Save ${card.word} to my words`" @click="toggleSaved">
        <span aria-hidden="true">{{ saved ? '★' : '☆' }}</span> {{ saved ? 'Saved in my words' : 'Save to my words' }}
      </button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.vpop-guide-policy :deep(.sg-note) { display: none; }
.vpop-save {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: .4rem;
  min-height: 44px;
  min-width: 44px;
  margin-top: .5rem;
  padding: .45rem .8rem;
  border: 1px solid currentColor;
  border-radius: .7rem;
  color: inherit;
  background: transparent;
  font: inherit;
  cursor: pointer;
}
.vpop-save[aria-pressed="true"] { background: #fff4cc; color: #3b2d12; }
.vpop-save:focus-visible { outline: 3px solid #1967d2; outline-offset: 2px; }
.vpop-save span { font-size: 1.25em; }
</style>
