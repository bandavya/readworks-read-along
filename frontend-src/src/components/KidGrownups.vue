<script setup>
// Grown-ups corner (research A): a small gear, top right. A plain click, tap, Enter or Space opens a short second step
// ("Open settings" / "Not now"), so a child does not stumble in and nobody needs a timed hold (WCAG 2.1.1, 2.5.1).
// The old press-and-hold (1.5 s, with a filling ring) still works as a shortcut for a pointer user.
import { ref, computed, watch, nextTick, onBeforeUnmount } from 'vue'
import { VOICE_NAMES } from '../api'
import { PUBLIC_SAMPLE } from '../mode'
import { presenting } from '../presenting'
import SpeedSlider from './SpeedSlider.vue'

const props = defineProps({ open: Boolean, settings: Object, voices: Array, passageId: String, autoWords: Boolean })
const emit = defineEmits(['update:open', 'request-open', 'update:autoWords'])

const HOLD_MS = 1500
const holding = ref(false)
const confirming = ref(false)
let timer = 0
let heldOpened = false
const doneBtn = ref(null)
const gearBtn = ref(null)
const confirmEl = ref(null)

function start() {
  if (holding.value) return
  holding.value = true
  timer = setTimeout(() => {
    holding.value = false
    heldOpened = true // the click that follows letting go must not also show the second step
    emit('request-open')
  }, HOLD_MS)
}
function stop() {
  holding.value = false
  clearTimeout(timer)
}
// A click (mouse, touch, Enter, Space, or a switch's select) shows the second step.
async function onGearClick() {
  if (heldOpened) { heldOpened = false; return }
  stop()
  confirming.value = true
  await nextTick()
  confirmEl.value?.focus() // on the box, not a button: a stray second Enter does nothing
}
function closeConfirm({ refocus = true } = {}) {
  confirming.value = false
  if (refocus) nextTick(() => gearBtn.value?.focus?.({ preventScroll: true }))
}
function openFromConfirm() {
  closeConfirm({ refocus: false })
  emit('request-open')
}
function close() {
  emit('update:open', false)
}
watch(() => props.open, async (on) => {
  if (on) { await nextTick(); doneBtn.value?.focus() } else gearBtn.value?.focus?.({ preventScroll: true })
})
// Escape closes; Tab stays inside the box (it is modal) for both the second step and the settings.
function trapKeys(e, closer) {
  if (e.key === 'Escape') { e.stopPropagation(); closer(); return }
  if (e.key !== 'Tab') return
  const box = e.currentTarget.querySelector('.kv-panel')
  const items = [...box.querySelectorAll('button, a[href]')].filter((n) => !n.disabled)
  if (!items.length) return
  const first = items[0]
  const last = items[items.length - 1]
  const a = document.activeElement
  if (e.shiftKey && (a === first || a === box)) { e.preventDefault(); last.focus() }
  else if (!e.shiftKey && a === last) { e.preventDefault(); first.focus() }
  else if (!box.contains(a)) { e.preventDefault(); first.focus() }
}
onBeforeUnmount(stop)

// Human voice first, then the generated one
const orderedVoices = computed(() => [...(props.voices || [])].sort((a, b) => (a.id === 'human' ? -1 : 0) - (b.id === 'human' ? -1 : 0)))
const SIZES = ['S', 'M', 'L', 'XL', 'XXL']
const SIZE_NAMES = { S: 'Small', M: 'Medium', L: 'Large', XL: 'Extra large', XXL: 'Largest' }
</script>

<template>
  <button
    ref="gearBtn"
    type="button"
    class="kv-gear"
    :class="{ holding }"
    aria-label="Grown-ups corner. Opens a question for a grown-up first."
    aria-haspopup="dialog"
    @pointerdown.prevent="start"
    @pointerup="stop"
    @pointerleave="stop"
    @pointercancel="stop"
    @click="onGearClick"
    @contextmenu.prevent
  >
    <svg viewBox="0 0 24 24" class="kv-gear-icon" aria-hidden="true">
      <path fill="currentColor" d="M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.61-.22l-2.39.96a7 7 0 0 0-1.62-.94l-.36-2.54a.5.5 0 0 0-.5-.42h-3.84a.5.5 0 0 0-.5.42l-.36 2.54c-.59.24-1.13.56-1.62.94l-2.39-.96a.5.5 0 0 0-.61.22L2.7 8.84a.5.5 0 0 0 .12.64l2.03 1.58c-.04.31-.07.63-.07.94s.02.63.06.94L2.82 14.52a.5.5 0 0 0-.12.64l1.92 3.32c.12.22.37.29.61.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.26.42.5.42h3.84c.24 0 .45-.18.5-.42l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.49 0 .61-.22l1.92-3.32a.5.5 0 0 0-.12-.64zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2z" />
    </svg>
    <svg viewBox="0 0 48 48" class="kv-gear-ring" aria-hidden="true">
      <circle cx="24" cy="24" r="21" fill="none" stroke-width="4" pathLength="100" />
    </svg>
  </button>

  <Teleport to="body">
    <div v-if="confirming" class="kv-panel-back" @pointerdown.self="closeConfirm()" @keydown="trapKeys($event, closeConfirm)">
      <div ref="confirmEl" class="kv-panel kv-confirm" role="dialog" aria-modal="true" aria-labelledby="kv-confirm-h" aria-describedby="kv-confirm-t" tabindex="-1">
        <h2 id="kv-confirm-h" class="kv-panel-h">Grown-ups corner</h2>
        <p id="kv-confirm-t" class="kv-panel-note">This opens the reading settings. Is a grown-up here to use them?</p>
        <div class="kv-panel-actions">
          <button type="button" class="kv-panel-btn" @click="closeConfirm()">Not now</button>
          <button type="button" class="kv-panel-btn primary" @click="openFromConfirm">Open settings</button>
        </div>
      </div>
    </div>

    <div v-if="open" class="kv-panel-back" @pointerdown.self="close" @keydown="trapKeys($event, close)">
      <div class="kv-panel" role="dialog" aria-modal="true" aria-labelledby="kv-panel-h">
        <h2 id="kv-panel-h" class="kv-panel-h">Grown-ups corner</h2>
        <p v-if="!presenting" class="kv-panel-note">{{ PUBLIC_SAMPLE ? 'Public sample. This story has no narration. Word meanings are drafts that no person has reviewed yet.' : 'Private prototype for ReadWorks. Not the live site. The spoken prompts and word meanings in the kid view are computer voices that no person has reviewed yet.' }}</p>

        <div v-if="!PUBLIC_SAMPLE || orderedVoices.length" class="kv-row">
          <p class="kv-row-h" id="kv-voice-h">Reading voice</p>
          <div class="kv-seg" role="group" aria-labelledby="kv-voice-h">
            <button
              v-for="v in orderedVoices"
              :key="v.id"
              type="button"
              :class="{ on: settings.voice === v.id }"
              :aria-pressed="settings.voice === v.id"
              @click="settings.voice = v.id"
            >{{ VOICE_NAMES[v.id] || v.label }}</button>
          </div>
        </div>

        <div v-if="!PUBLIC_SAMPLE || orderedVoices.length" class="kv-row">
          <SpeedSlider :value="settings.rate" kid @change="settings.rate = $event" />
        </div>

        <div class="kv-row">
          <p class="kv-row-h" id="kv-size-h">Text size</p>
          <div class="kv-seg kv-seg-wrap" role="group" aria-labelledby="kv-size-h">
            <button
              v-for="s in SIZES"
              :key="s"
              type="button"
              :class="{ on: settings.size === s }"
              :aria-pressed="settings.size === s"
              :aria-label="`${SIZE_NAMES[s]} text`"
              @click="settings.size = s"
            >{{ s }}</button>
          </div>
        </div>

        <div class="kv-row">
          <p class="kv-row-h" id="kv-font-h">Reading font</p>
          <div class="kv-seg" role="group" aria-labelledby="kv-font-h">
            <button type="button" :class="{ on: settings.font === 'andika' }" :aria-pressed="settings.font === 'andika'" @click="settings.font = 'andika'">Andika</button>
            <button type="button" :class="{ on: settings.font === 'sans' }" :aria-pressed="settings.font === 'sans'" @click="settings.font = 'sans'">Simple sans</button>
          </div>
        </div>
        <div class="kv-row kv-reading-options">
          <button v-if="!PUBLIC_SAMPLE || orderedVoices.length" type="button" class="kv-option" :aria-pressed="autoWords" @click="emit('update:autoWords', !autoWords)">Show word cards as they're read <span aria-hidden="true">{{ autoWords ? 'On' : 'Off' }}</span></button>
          <button type="button" class="kv-option" :aria-pressed="settings.spacing" @click="settings.spacing = !settings.spacing">Extra word and line spacing <span aria-hidden="true">{{ settings.spacing ? 'On' : 'Off' }}</span></button>
          <button type="button" class="kv-option" :aria-pressed="settings.tint" @click="settings.tint = !settings.tint">Calm paper color <span aria-hidden="true">{{ settings.tint ? 'On' : 'Off' }}</span></button>
          <button v-if="!PUBLIC_SAMPLE || orderedVoices.length" type="button" class="kv-option" :aria-pressed="settings.lineGuide" @click="settings.lineGuide = !settings.lineGuide">Follow the spoken line <span aria-hidden="true">{{ settings.lineGuide ? 'On' : 'Off' }}</span></button>
        </div>

        <div class="kv-panel-actions">
          <a class="kv-panel-btn" :href="`#/p/${passageId}`">Back to teacher view</a>
          <button ref="doneBtn" type="button" class="kv-panel-btn primary" @click="close">Done</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
