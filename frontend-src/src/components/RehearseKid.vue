<script setup>
// Kid view: one big "practice this sentence" button in the top rail. When it is pressed, a bar covers the rail:
// Listen (the narrator reads the sentence) -> Your turn (the sentence stays lit, quiet; the child reads it out loud)
// -> Listen again -> two choices (again / keep reading). No microphone, no scoring, no timer, nothing to read
// (the words are for the grown-up; the pictures say it).
import { reactive, watch, computed, ref, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { Rehearsal, sentencesForEngine } from '../rehearsal'
import '../rehearse.css'

const props = defineProps({
  engine: Object, // the SoundAlong engine (null until the passage has narration)
  startK: Function, // () => narrated word index to practice (current word on this page, else the page's first)
  pageOf: Function, // (k) => the page that narrated word k is on
  page: Number, // the page being shown
  before: Function, // called just before it starts (stops spoken tips)
})
const st = reactive({ phase: 'idle', index: -1, count: 0, lead: 0, note: '' })
const overEl = ref(null)
const openEl = ref(null)
let reh = null

watch(
  () => props.engine,
  (e) => {
    reh?.dispose()
    // a beginner gets a phrase, not a paragraph: sentences longer than 14 words are split at a comma or dash
    reh = e ? new Rehearsal(e, st, sentencesForEngine(e, { maxWords: 14 })) : null
  },
  { immediate: true },
)

const active = computed(() => st.phase !== 'idle')
const say = computed(() => ({
  listen: 'Listen.',
  turn: 'Your turn. Read the sentence out loud.',
  again: 'Listen again.',
  done: 'Finished. Practice it again, or keep reading.',
}[st.phase] || ''))

// A phase change can remove the focused button. Keep focus in the practice controls.
watch(() => st.phase, async (phase, previous) => {
  const focused = document.activeElement
  const wasInside = !!overEl.value?.contains(focused)
  if (!wasInside) return
  await nextTick()
  // A page arrow can keep focus while practice exits. Only rescue focus when its control vanished.
  if (focused.isConnected && document.activeElement !== document.body) return
  if (phase === 'idle') openEl.value?.focus({ preventScroll: true })
  else overEl.value?.querySelector('button')?.focus({ preventScroll: true })
})

async function open() {
  if (!reh) return
  props.before?.()
  reh.start(props.startK?.())
  await nextTick()
  overEl.value?.focus()
}
async function leave() {
  const focused = document.activeElement
  const wasInside = !!overEl.value?.contains(focused)
  reh?.exit()
  await nextTick()
  if (wasInside && (!focused.isConnected || document.activeElement === document.body)) openEl.value?.focus({ preventScroll: true })
}

// A page turned by hand: stop practicing. (Narration reaching the next page by itself keeps going.)
watch(() => props.page, () => {
  if (!reh || !reh.active) return
  if (st.phase === 'turn' || st.phase === 'done') return reh.exit()
  const k = props.engine?.curK
  if (k == null || k < 0 || props.pageOf?.(k) !== props.page) reh.exit()
})

function onKey(e) {
  if (e.key === 'Escape' && reh?.active) { e.preventDefault(); reh.exit() }
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  reh?.dispose()
})
</script>

<template>
  <button
    ref="openEl"
    type="button"
    class="kv-btn rk-open"
    aria-label="Practice this sentence"
    :disabled="!engine"
    @click="open"
  >
    <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M4 4h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9l-5 4v-4H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" /></svg>
  </button>

  <div v-if="active" ref="overEl" class="rk-over" :class="`rk-${st.phase}`" tabindex="-1" role="group" aria-label="Practice a sentence">
    <div class="rk-cue" aria-hidden="true">
      <svg v-if="st.phase === 'turn'" viewBox="0 0 24 24"><path fill="currentColor" d="M4 4h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9l-5 4v-4H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" /></svg>
      <svg v-else viewBox="0 0 24 24"><path fill="currentColor" d="M3 9v6h4l5 4V5L7 9H3z" /><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" d="M15.2 8.8a4.6 4.6 0 0 1 0 6.4M17.8 6.2a8.2 8.2 0 0 1 0 11.6M20.4 3.6a11.8 11.8 0 0 1 0 16.8" /></svg>
      <span v-if="st.phase === 'turn'">Your turn!</span>
      <span v-else-if="st.phase === 'done'">All done</span>
      <span v-else>Listen</span>
    </div>

    <!-- your turn: one big button to hear it again -->
    <div v-if="st.phase === 'turn'" class="rk-col">
      <button type="button" class="rk-b" aria-label="Listen again" @click="reh.listenAgain()">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 4.5V1.2L7.2 5.4 12 9.6V6.3a5.7 5.7 0 1 1-5.7 5.7H3.6A8.4 8.4 0 1 0 12 4.5z" /></svg>
      </button>
      <span class="rk-b-label" aria-hidden="true">Listen again</span>
    </div>

    <!-- the end: practice it again, or go on -->
    <template v-if="st.phase === 'done'">
      <div class="rk-col">
        <button type="button" class="rk-b" aria-label="Practice it again" @click="reh.listenAgain()">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 4.5V1.2L7.2 5.4 12 9.6V6.3a5.7 5.7 0 1 1-5.7 5.7H3.6A8.4 8.4 0 1 0 12 4.5z" /></svg>
        </button>
        <span class="rk-b-label" aria-hidden="true">Again</span>
      </div>
      <div class="rk-col">
        <button type="button" class="rk-b go" aria-label="Keep reading" @click="leave">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M9.5 4.5 17 12l-7.5 7.5-2.2-2.2L12.6 12 7.3 6.7z" /></svg>
        </button>
        <span class="rk-b-label" aria-hidden="true">Keep reading</span>
      </div>
    </template>

    <!-- while listening: a small way out; and always a way back to the story -->
    <div v-if="st.phase !== 'done'" class="rk-col">
      <button type="button" class="rk-b small" aria-label="Back to the story" @click="leave">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M6.4 5 12 10.6 17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4L12 13.4 6.4 19 5 17.6 10.6 12 5 6.4z" /></svg>
      </button>
      <span class="rk-b-label" aria-hidden="true">Back</span>
    </div>
    <p class="rh-sr" aria-live="polite">{{ say }}</p>
  </div>
</template>
