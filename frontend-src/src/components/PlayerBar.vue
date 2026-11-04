<script setup>
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'
import SpeedSlider from './SpeedSlider.vue'
import { VOICE_NAMES } from '../api'

const props = defineProps({ state: Object, voices: Array, practiceActive: Boolean, lang: { type: String, default: 'en' } })
const es = () => props.lang === 'es'
const voiceName = (v) => es() ? (v.id === 'human' ? 'Grabación de una persona' : 'Voz generada') : (VOICE_NAMES[v.id] || v.label)
const errorText = () => es() ? (props.state.error.includes('played') ? 'No se pudo reproducir el audio.' : 'No se pudo cargar el audio.') : props.state.error
const emit = defineEmits(['toggle', 'rate', 'voice', 'seek', 'retry'])

const moreOpen = ref(false)
const moreButton = ref(null)
const moreOptions = ref(null)
// Practice can start on a wide screen and continue after the device rotates.
// Its controls move into More on compact screens, so keep that panel open.
watch(() => props.practiceActive, (active) => { if (active) moreOpen.value = true })
function onOutsidePointer(e) {
  if (moreOpen.value && !props.practiceActive && e.target !== moreButton.value && !moreButton.value?.contains(e.target) &&
      !moreOptions.value?.contains(e.target)) moreOpen.value = false
}
function onEscape(e) {
  if (!moreOpen.value || props.practiceActive || e.key !== 'Escape') return
  moreOpen.value = false
  moreButton.value?.focus()
}
onMounted(() => {
  document.addEventListener('pointerdown', onOutsidePointer)
  document.addEventListener('keydown', onEscape)
})
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onOutsidePointer)
  document.removeEventListener('keydown', onEscape)
})
const fmt = (s) => {
  s = Math.max(0, Math.floor(s || 0))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
</script>

<template>
  <section class="player" :lang="lang" :aria-label="es() ? 'Reproductor de lectura' : 'Sound Along player'">
    <button class="play" type="button" :aria-label="es() ? (state.playing ? 'Pausar' : 'Reproducir') : (state.playing ? 'Pause' : 'Play')" @click="emit('toggle')">
      <svg v-if="!state.playing" viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path d="M8 5v14l11-7z" fill="currentColor" /></svg>
      <svg v-else viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z" fill="currentColor" /></svg>
    </button>

    <div class="scrub">
      <input
        type="range"
        min="0"
        :max="state.duration || 0"
        step="0.1"
        :value="state.time"
        :aria-label="es() ? 'Posición en la grabación' : 'Position in recording'"
        @input="emit('seek', Number($event.target.value))"
      />
      <span class="time" aria-live="off">{{ fmt(state.time) }} / {{ fmt(state.duration) }}</span>
    </div>

    <button ref="moreButton" type="button" class="player-more" :aria-expanded="moreOpen" aria-controls="player-more-options" @click="moreOpen = practiceActive || !moreOpen">{{ es() ? 'Más' : 'More' }}</button>
    <div ref="moreOptions" id="player-more-options" class="player-more-options" :class="{ open: moreOpen, practicing: practiceActive }">
      <span class="mobile-time" aria-live="off">{{ fmt(state.time) }} / {{ fmt(state.duration) }}</span>
      <div class="opts">
        <div v-if="voices.length > 1" class="seg" role="group" :aria-label="es() ? 'Voz' : 'Voice'">
          <button v-for="v in voices" :key="v.id" type="button" :aria-pressed="state.voiceId === v.id"
            :class="{ on: state.voiceId === v.id }" :title="voiceName(v)" @click="emit('voice', v.id)">{{ es() ? (v.id === 'human' ? 'Persona' : 'Generada') : (v.id === 'human' ? 'Human' : 'Generated') }}</button>
        </div>
        <span v-else-if="voices.length === 1" class="one-voice">{{ voiceName(voices[0]) }}</span>
        <SpeedSlider :value="state.rate" :lang="lang" @change="emit('rate', $event)" />
      </div>
      <slot />
    </div>
    <p v-if="state.error" class="player-error" role="alert">
      {{ errorText() }}
      <button type="button" class="player-retry" @click="emit('retry')">{{ es() ? 'Reintentar' : 'Try again' }}</button>
    </p>
  </section>
</template>
