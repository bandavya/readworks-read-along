<script setup>
// Teacher view: sentence rehearsal ("Listen, your turn, listen again") for one sentence at a time.
// No microphone and no scoring: while it is "your turn" the sentence stays lit and the audio is quiet.
//
import { reactive, watch, computed, ref, nextTick, onBeforeUnmount } from 'vue'
import { Rehearsal, sentencesForEngine } from '../rehearsal'
import '../rehearse.css'

const props = defineProps({ engine: Object })
const emit = defineEmits(['active-change'])
const st = reactive({ phase: 'idle', index: -1, count: 0, lead: 0, note: '' })
const panelEl = ref(null)
const openEl = ref(null)
let reh = null

watch(
  () => props.engine,
  (e) => {
    reh?.dispose()
    reh = e ? new Rehearsal(e, st, sentencesForEngine(e)) : null
  },
  { immediate: true },
)
onBeforeUnmount(() => reh?.dispose())

const active = computed(() => st.phase !== 'idle')
watch(active, (value) => emit('active-change', value))
const where = computed(() => (st.index < st.lead ? 'Title' : `Sentence ${st.index + 1 - st.lead} of ${st.count - st.lead}`))
const cue = computed(() => ({
  listen: { icon: 'ear', text: 'Listen', say: 'Listen.' },
  turn: { icon: 'say', text: 'Your turn', say: 'Your turn. Read the sentence out loud.' },
  again: { icon: 'ear', text: 'Listen again', say: 'Listen again.' },
  done: { icon: 'check', text: 'All done', say: 'Finished. Practice it again, go to the next sentence, or finish.' },
}[st.phase] || null))

// Keep the practiced sentence in view above the practice panel or dock.
function showSentence() {
  const r = reh?.ranges[st.index]
  const el = r && props.engine?.words[r.start]
  if (!el) return
  const practice = document.querySelector('.player-more-options.practicing')
  const dock = document.querySelector('.dock')
  const bottom = (practice || dock)?.getBoundingClientRect().top ?? window.innerHeight
  const top = el.getBoundingClientRect().top
  const last = props.engine.words[r.end]?.getBoundingClientRect().bottom ?? top
  if (top >= 12 && last <= bottom) return
  window.scrollBy({ top: top - Math.max(12, (bottom - 12) * 0.25), behavior: 'instant' })
}
watch(() => [st.phase, st.index], ([ph]) => {
  if (ph === 'turn' || ph === 'done') setTimeout(showSentence, 80) // after the dock has been re-measured
})

async function open() {
  if (!reh) return
  reh.start()
  await nextTick()
  panelEl.value?.focus()
}
async function done() {
  reh?.exit()
  await nextTick()
  openEl.value?.focus()
}
function onKey(e) {
  if (e.key === 'Escape') { e.stopPropagation(); done() }
}
</script>

<template>
  <section class="rh" :class="`rh-${st.phase}`" aria-label="Sentence practice" @keydown="onKey">
    <template v-if="!active">
      <button ref="openEl" type="button" class="rh-open" :disabled="!engine" @click="open">
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M4 4h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9l-5 4v-4H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" /></svg>
        Practice a sentence
      </button>
      <span v-if="st.note" class="rh-hint" role="status">{{ st.note }}</span>
      <span v-else class="rh-hint">Hear one sentence, read it out loud yourself, then hear it again.</span>
    </template>

    <div v-else ref="panelEl" class="rh-panel" tabindex="-1">
      <span class="rh-cue">
        <svg v-if="cue.icon === 'ear'" viewBox="0 0 24 24" width="30" height="30" aria-hidden="true"><path fill="currentColor" d="M3 9v6h4l5 4V5L7 9H3z" /><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" d="M15.2 8.8a4.6 4.6 0 0 1 0 6.4M17.8 6.2a8.2 8.2 0 0 1 0 11.6" /></svg>
        <svg v-else-if="cue.icon === 'say'" viewBox="0 0 24 24" width="30" height="30" aria-hidden="true"><path fill="currentColor" d="M4 4h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9l-5 4v-4H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" /></svg>
        <svg v-else viewBox="0 0 24 24" width="30" height="30" aria-hidden="true"><path fill="currentColor" d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z" /></svg>
        {{ cue.text }}
        <small>{{ where }}</small>
      </span>

      <button v-if="st.phase === 'turn'" type="button" class="rh-b primary" @click="reh.listenAgain()">
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M12 4.5V1.2L7.2 5.4 12 9.6V6.3a5.7 5.7 0 1 1-5.7 5.7H3.6A8.4 8.4 0 1 0 12 4.5z" /></svg>
        Listen again
      </button>
      <button v-if="st.phase === 'done'" type="button" class="rh-b primary" @click="reh.listenAgain()">
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M12 4.5V1.2L7.2 5.4 12 9.6V6.3a5.7 5.7 0 1 1-5.7 5.7H3.6A8.4 8.4 0 1 0 12 4.5z" /></svg>
        Practice it again
      </button>
      <button type="button" class="rh-b" :disabled="st.index <= 0" aria-label="Previous sentence" @click="reh.prev()">Previous</button>
      <button type="button" class="rh-b" :disabled="st.index >= st.count - 1" aria-label="Next sentence" @click="reh.next()">Next sentence</button>
      <button type="button" class="rh-b quiet" @click="done">Done</button>
    </div>

    <p class="rh-sr" aria-live="polite">{{ cue ? `${cue.say} ${where}.` : '' }}</p>
  </section>
</template>
