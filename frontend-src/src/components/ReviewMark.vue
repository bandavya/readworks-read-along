<script setup>
// A small, calm "not checked by a person yet" marker for word help.
// items = the review items (see review.js) behind what is on screen; shows the least-reviewed state among them.
// variant 'adult': one plain line (teacher popover, Vocabulary tab), with a link to the review screen.
// variant 'kid': a tiny pencil in a dashed ring beside the word. Not a button, not red, nothing to decode. Shown only
//   while the help is a draft or flagged; checked help shows nothing so the page stays quiet.
import { computed } from 'vue'
import { combineStates, STATE_TEXT, KID_STATE_TEXT } from '../review'
import { presenting } from '../presenting'
import '../review.css'

const props = defineProps({ items: Array, variant: { type: String, default: 'adult' }, pid: String })
const state = computed(() => combineStates(props.items))
const show = computed(() => !presenting.value && (props.variant === 'kid' ? state.value === 'draft' || state.value === 'fix' : state.value !== 'approved'))
</script>

<template>
  <template v-if="show">
    <span v-if="variant === 'kid'" class="rv-kid" role="img" :aria-label="KID_STATE_TEXT" :title="KID_STATE_TEXT" data-review="draft">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M3 17.25V21h3.75L17.8 9.94l-3.75-3.75L3 17.25zM20.7 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" /></svg>
    </span>
    <p v-else class="rv-note" :class="'rv-' + state" :data-review="state">
      <span>{{ STATE_TEXT[state] }}<template v-if="pid && state !== 'checked'"> <a :href="`#/review/${pid}`">Check it</a></template></span>
    </p>
  </template>
</template>
