<script setup>
// The Reading helper's audio rail (grades 3-5): one calm bar at the top of the page.
// Play, time, a plain scrubber, a labeled Speed choice, a "Text size" choice, and the voice in "Settings".
// No stars, no cartoon cues. Every control is at least 44 px. ()
import { ref } from 'vue'
import { VOICE_NAMES } from '../api'
import SpeedSlider from './SpeedSlider.vue'

defineProps({ state: Object, voices: Array, size: Number, sizes: Array, reading: Object })
const emit = defineEmits(['toggle', 'rate', 'voice', 'seek', 'size'])

const open = ref(false)
const fmt = (s) => {
  s = Math.max(0, Math.floor(s || 0))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
</script>

<template>
  <section class="fx-rail-top" aria-label="Audio controls">
    <div class="fx-row fx-row-main">
      <button class="fx-play" type="button" :aria-label="state.playing ? 'Pause' : 'Play'" @click="emit('toggle')">
        <svg v-if="!state.playing" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M8 5v14l11-7z" fill="currentColor" /></svg>
        <svg v-else viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z" fill="currentColor" /></svg>
      </button>
      <span class="fx-time" aria-hidden="true">{{ fmt(state.time) }} / {{ fmt(state.duration) }}</span>
      <input
        class="fx-scrub"
        type="range"
        min="0"
        :max="state.duration || 0"
        step="0.1"
        :value="state.time"
        aria-label="Position in the recording"
        :aria-valuetext="`${fmt(state.time)} of ${fmt(state.duration)}`"
        @input="emit('seek', Number($event.target.value))"
      />
    </div>
    <p v-if="state.error" class="fx-error" role="alert">{{ state.error }}</p>
  </section>

  <section class="fx-rail-opts" aria-label="Reading options">
    <div class="fx-row fx-row-set">
      <SpeedSlider :value="state.rate" @change="emit('rate', $event)" />

      <div class="fx-field" role="group" aria-labelledby="fx-size-lab">
        <span id="fx-size-lab" class="fx-lab">Text size</span>
        <div class="fx-sizes">
          <button
            v-for="(s, i) in sizes"
            :key="s"
            type="button"
            class="fx-size"
            :class="{ on: size === s }"
            :aria-pressed="size === s"
            :aria-label="['Regular text', 'Large text', 'Extra large text', 'Very large text', 'Largest text'][i] || `Text size ${i + 1}`"
            @click="emit('size', s)"
          ><span aria-hidden="true" :style="{ fontSize: 15 + i * 3 + 'px' }">A</span></button>
        </div>
      </div>

      <button type="button" class="fx-more" :aria-expanded="open" aria-controls="fx-settings" @click="open = !open">
        Settings <span aria-hidden="true">{{ open ? '▴' : '▾' }}</span>
      </button>
    </div>

    <div v-if="open" id="fx-settings" class="fx-settings">
      <div v-if="voices.length > 1" class="fx-field" role="group" aria-labelledby="fx-voice-lab">
        <span id="fx-voice-lab" class="fx-lab">Voice</span>
        <div class="fx-seg">
          <button
            v-for="v in voices"
            :key="v.id"
            type="button"
            :aria-pressed="state.voiceId === v.id"
            :class="{ on: state.voiceId === v.id }"
            @click="emit('voice', v.id)"
          >{{ v.id === 'human' ? 'Human' : v.id === 'generated' ? 'Generated' : (VOICE_NAMES[v.id] || v.label) }}</button>
        </div>
      </div>
      <div class="fx-reading-settings" role="group" aria-label="Reading appearance">
        <label class="fx-field"><span class="fx-lab">Font</span><select class="fx-select" v-model="reading.font"><option value="merriweather">Merriweather</option><option value="andika">Andika</option><option value="sans">Simple sans</option></select></label>
        <button type="button" class="fx-btn" :aria-pressed="reading.spacing" @click="reading.spacing = !reading.spacing">Extra spacing {{ reading.spacing ? 'on' : 'off' }}</button>
        <button type="button" class="fx-btn" :aria-pressed="reading.tint" @click="reading.tint = !reading.tint">Calm paper {{ reading.tint ? 'on' : 'off' }}</button>
      </div>
    </div>

  </section>
</template>
