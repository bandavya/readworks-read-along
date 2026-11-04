<script setup>
// "What a child will get": a five-second, plain-words summary for a teacher.
// Read-only. It describes this passage's data and the effective link or browser settings; it changes nothing and
// claims nothing about assignments or classes, because this prototype has none. Facts come from teacherPreview.js.
import { computed } from 'vue'
import { store } from '../api'
import { buildPreview } from '../teacherPreview'
import { readerLink } from '../linkSettings'
import { PUBLIC_SAMPLE } from '../mode'

const props = defineProps({
  id: String,
  data: Object,
  gloss: Object, // kid-friendly meanings or null
  syl: Object, // syllable guide or null
  kid: Object, // kid audio manifest or null
  ready: Boolean, // the optional files (gloss, syllables, kid audio) have finished loading (found or not)
  settings: Object, // the effective settings of this passage, including a teacher link
})

// The kid view keeps its own saved choices under these keys (KidView.vue). Read when the page opens.
const saved = computed(() => ({
  voice: props.settings?.voice || store.get('kid-voice', undefined),
  rate: store.get('kid-rate', undefined),
  size: store.get('kid-size', undefined),
}))

const p = computed(() => buildPreview({ data: props.data, gloss: props.gloss, syl: props.syl, kid: props.kid, passageId: props.id, saved: saved.value }))
const kidLink = computed(() => readerLink('kid', props.id, props.settings, saved.value.voice))
const otherVoices = computed(() => p.value.voices.filter((v) => v.id !== p.value.childVoice?.id))
const mark = (k) => (k === 'unchecked' || k === 'mixed' ? 'pv-flag' : k === 'other' ? 'pv-note' : 'pv-unk')
</script>

<template>
  <section class="panel pv" aria-labelledby="pv-h">
    <h2 class="panel-h" id="pv-h">What a child will get</h2>
    <p class="pv-sub">Preview only. Nothing here is assigned to a class.</p>

    <a v-if="settings?.soundOn !== false" class="btn primary pv-open" :href="kidLink">Open kid view</a>
    <p v-else class="pv-sub">Sound Along is off for this link.</p>

    <dl class="pv-list">
      <dt>Voice</dt>
      <dd>
        <template v-if="p.childVoice">
          <strong>{{ p.childVoice.name }}</strong> ({{ p.childVoice.detail }})
          <span class="pv-small">{{ settings?.fromTeacher ? 'Chosen for this link.' : (p.childVoice.chosen ? 'A grown-up chose this on this device.' : 'Starts here unless a grown-up changes it.') }}</span>
          <span v-if="otherVoices.length" class="pv-small">Also available: {{ otherVoices.map((v) => v.name.toLowerCase()).join(', ') }}.</span>
          <span v-else class="pv-small">The only voice for this passage.</span>
          <span class="pv-small">Word timing is computed automatically.</span>
        </template>
        <template v-else>No narration yet for this passage.</template>
      </dd>

      <dt>Look</dt>
      <dd>
        Large page, big buttons.
        <span class="pv-small">{{ p.settings.rate }}× speed, {{ p.settings.size }} text{{ p.settings.rateChosen || p.settings.sizeChosen ? ' (saved on this device)' : ' (the starting settings)' }}.</span>
      </dd>

      <dt>Word help</dt>
      <dd>
        <p v-if="!ready" class="pv-small pv-block">Checking&hellip;</p>
        <template v-else>
          <ul class="pv-help">
            <li v-if="p.help.meanings">
              <strong>Kid-friendly meanings</strong>, {{ p.help.meanings.count }} words{{ p.help.meanings.spoken ? ', spoken aloud' : '' }}.
              <span :class="mark(p.help.meanings.review.kind)"><span aria-hidden="true">{{ p.help.meanings.review.kind === 'unchecked' ? '! ' : '' }}</span>{{ p.help.meanings.review.text }}.</span>
            </li>
            <li v-if="p.help.syllables">
              <strong>Say-it-in-parts guide</strong>, {{ p.help.syllables.count }} words{{ p.help.syllables.clips ? ', with audio' : '' }}.
              <span :class="mark(p.help.syllables.review.kind)"><span aria-hidden="true">{{ p.help.syllables.review.kind === 'unchecked' || p.help.syllables.review.kind === 'mixed' ? '! ' : '' }}</span>{{ p.help.syllables.review.text }}.</span>
            </li>
            <li v-if="p.help.readworksWords">
              <strong>{{ PUBLIC_SAMPLE ? 'Sample vocabulary' : 'ReadWorks vocabulary' }}</strong>, {{ p.help.readworksWords.count }} words with {{ PUBLIC_SAMPLE ? 'original draft definitions, not yet checked by a person' : "ReadWorks' own definitions" }}{{ p.help.readworksWords.spokenCount ? `; ${p.help.readworksWords.spokenCount} also spoken by a computer voice` : '' }}.
            </li>
            <li v-if="!p.help.meanings && ready">No kid-friendly meanings written for this passage. Holding a word shows {{ PUBLIC_SAMPLE ? 'a draft definition when one exists' : "ReadWorks' definition if it has one, or just says the word" }}.</li>
          </ul>
          <p v-if="p.help.spokenReview && p.help.spokenReview.kind === 'unchecked'" class="pv-small pv-block">Spoken meanings are computer-made and not yet checked by a person.</p>
          <p v-if="p.help.none" class="pv-small pv-block">No word help for this passage.</p>
        </template>
      </dd>

      <dt>Spanish</dt>
      <dd>{{ p.spanish.text }}</dd>
    </dl>

    <p class="pv-foot">
      {{ settings?.fromTeacher ? 'These settings came from the student link.' : 'The sound switch below is saved in this browser for every passage. It does not change the kid view.' }}
      Assign, Print and Question Set are not connected in this prototype.
    </p>
  </section>
</template>

<style scoped>
.pv { margin-bottom: 16px; }
.pv-sub { margin: -6px 0 12px; font-size: 14px; color: var(--muted); }
.pv-open { display: flex; justify-content: center; margin-bottom: 14px; }
.pv-list { margin: 0; display: grid; grid-template-columns: 1fr; gap: 2px 0; font-size: 15px; line-height: 1.4; }
.pv-list dt { margin-top: 10px; font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); }
.pv-list dd { margin: 0; }
.pv-small { display: block; font-size: 14px; color: var(--muted); }
.pv-block { margin: 4px 0 0; }
.pv-help { margin: 0; padding: 0; list-style: none; display: grid; gap: 8px; }
.pv-flag, .pv-note, .pv-unk { display: block; font-size: 14px; font-weight: 700; }
.pv-flag { color: var(--ink); border-left: 4px solid #c58a00; padding-left: 8px; margin-top: 2px; }
.pv-note, .pv-unk { color: var(--muted); }
.pv-foot { margin: 14px 0 0; padding-top: 12px; border-top: 1px solid var(--line); font-size: 14px; color: var(--muted); }
</style>
