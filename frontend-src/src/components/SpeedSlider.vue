<script setup>
import { computed } from 'vue'
const props = defineProps({ value: Number, kid: Boolean, lang: { type: String, default: 'en' } })
const emit = defineEmits(['change'])
const stops = computed(() => props.kid ? [0.75, 1, 1.25] : [0.75, 1, 2])
const names = computed(() => props.lang === 'es' ? ['Más despacio', 'Normal', 'Más rápido'] : ['Slower', 'Normal', 'Faster'])
const min = computed(() => stops.value[0])
const max = computed(() => stops.value[2])
const current = computed(() => Math.min(max.value, Math.max(min.value, Number(props.value) || 1)))
function onInput(event) {
  const raw = Number(event.target.value)
  // A small detent makes 1x easy to choose by touch. Arrow keys can leave it in one step.
  const value = raw >= 0.9 && raw <= 1.1 ? 1 : raw
  event.target.value = String(value)
  emit('change', value)
}
function onKeydown(event) {
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
  event.preventDefault()
  const dir = ['ArrowRight', 'ArrowUp'].includes(event.key) ? 1 : -1
  const step = current.value === 1 ? 0.1 : 0.05
  const next = Math.min(max.value, Math.max(min.value, Math.round((current.value + dir * step) * 100) / 100))
  event.target.value = String(next)
  emit('change', next)
}
const valueText = computed(() => {
  const n = current.value
  if (n === 1) return names.value[1]
  if (n === min.value) return names.value[0]
  if (n === max.value) return names.value[2]
  const multiple = n.toFixed(2).replace(/0$/, '')
  return props.lang === 'es' ? `${multiple} veces la velocidad normal` : `${multiple} times normal speed`
})
</script>

<template>
  <div class="speed-slider" :class="{ 'speed-slider-kid': kid }">
    <label class="speed-slider-label" :for="kid ? 'kid-speed' : 'passage-speed'">{{ lang === 'es' ? 'Velocidad' : 'Speed' }}</label>
    <input :id="kid ? 'kid-speed' : 'passage-speed'" type="range" :min="min" :max="max" step="0.05" :value="current"
      :aria-valuetext="valueText" @input="onInput" @keydown="onKeydown" />
    <div class="speed-stops" aria-hidden="true"><span v-for="(name, i) in names" :key="name"
      :style="{ left: `${(stops[i] - min) / (max - min) * 100}%`, transform: `translateX(${i === 0 ? '0' : i === 2 ? '-100%' : '-50%'})` }">{{ name }}</span></div>
  </div>
</template>
