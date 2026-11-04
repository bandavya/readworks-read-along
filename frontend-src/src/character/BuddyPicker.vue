<script setup>
// The switcher in the top bar: the chosen character's face with next and back, and a tray of all of them. A tap switches
// straight away and the voice keeps going, so characters can be compared on the same sentence.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { BUDDIES, MOUTH_STYLES, buddyChoice, chooseBuddy, chooseMouth, mouthStyle } from './buddies.js'

const open = ref(false)
const faces = ref({})
const root = ref(null)
const nowButton = ref(null)
const list = computed(() => [{ id: '', name: 'No buddy' }, ...BUDDIES])
const current = computed(() => list.value.find((b) => b.id === buddyChoice.value) || list.value[0])
const painted = computed(() => current.value.family === 'painted')

function step(by) {
  const at = list.value.findIndex((b) => b.id === buddyChoice.value)
  chooseBuddy(list.value[(at + by + list.value.length) % list.value.length].id)
}
function close(focus = true) {
  open.value = false
  if (focus) nowButton.value?.focus()
}
// Keys used in the switcher stay in the switcher: the reader listens for Escape, Space and arrows to control the voice.
const onKey = (e) => {
  if (open.value && e.key === 'Escape') { e.stopPropagation(); close(); return }
  if (root.value?.contains(e.target)) e.stopPropagation()
}
const onDown = (e) => { if (open.value && !root.value?.contains(e.target)) close(false) }
// Faces load only when the switcher is on screen; a face that fails to load leaves the name.
onMounted(async () => {
  window.addEventListener('keydown', onKey, true)
  document.addEventListener('pointerdown', onDown, true)
  try { faces.value = (await import('./chars/portraits.js')).default } catch { faces.value = {} }
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey, true)
  document.removeEventListener('pointerdown', onDown, true)
})
watch(open, (on) => {
  if (on) requestAnimationFrame(() => root.value?.querySelector('.bp-face[aria-pressed="true"]')?.focus())
})
</script>

<template>
  <div ref="root" class="bp">
    <button type="button" class="bp-step" aria-label="Previous reading buddy" @click="step(-1)">‹</button>
    <button ref="nowButton" type="button" class="bp-now" :aria-expanded="open" aria-controls="bp-tray" :aria-label="`Reading buddy: ${current.name}. Choose another`" @click="open = !open">
      <img v-if="faces[current.id]" :src="faces[current.id]" alt="" class="bp-now-img">
      <span v-else class="bp-none" aria-hidden="true"></span>
      <span class="bp-name">{{ current.name }}</span>
      <span aria-hidden="true">{{ open ? '▴' : '▾' }}</span>
    </button>
    <button type="button" class="bp-step" aria-label="Next reading buddy" @click="step(1)">›</button>
    <div v-if="open" id="bp-tray" class="bp-tray" role="group" aria-label="Choose a reading buddy">
      <div class="bp-grid">
        <button v-for="b in list" :key="b.id" type="button" class="bp-face" :aria-pressed="b.id === buddyChoice" @click="chooseBuddy(b.id)">
          <img v-if="faces[b.id]" :src="faces[b.id]" alt="">
          <span v-else class="bp-none" aria-hidden="true"></span>
          <span>{{ b.name }}</span>
        </button>
      </div>
      <div v-if="painted" class="bp-mouth" role="group" aria-label="How the mouth moves">
        <span class="bp-mouth-label">Mouth</span>
        <button v-for="m in MOUTH_STYLES" :key="m.id" type="button" class="bp-chip" :title="m.hint" :aria-pressed="m.id === mouthStyle" @click="chooseMouth(m.id)">{{ m.name }}</button>
      </div>
      <button type="button" class="bp-done" @click="close()">Done</button>
    </div>
  </div>
</template>

<style scoped>
.bp { display:flex; align-items:center; gap:0; min-width:0; }
.bp-step { min-width:44px; min-height:44px; padding:0; border:0; border-radius:5px; background:none; color:var(--tb-muted); font:inherit; font-size:22px; line-height:1; cursor:pointer; }
.bp-step:hover, .bp-now:hover, .bp-face:hover { background:var(--tb-hover); }
.bp-now { display:inline-flex; align-items:center; gap:6px; min-height:44px; min-width:0; padding:0 8px 0 4px; border:1px solid var(--tb-line); border-radius:5px; background:var(--tb-ground); color:var(--tb-ink); font:inherit; font-size:13px; cursor:pointer; }
.bp-now-img { width:34px; height:34px; object-fit:contain; flex:none; border-radius:4px; background:#fff; }
.bp-none { display:inline-block; width:34px; height:34px; flex:none; border-radius:50%; border:2px dashed var(--tb-line); box-sizing:border-box; }
.bp-name { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:150px; }
.bp-tray { position:absolute; left:0; right:0; top:100%; display:grid; gap:10px; max-height:min(70dvh, 560px); overflow:auto; padding:12px 16px; background:var(--tb-ground); border-bottom:1px solid var(--tb-line); box-shadow:0 8px 16px rgba(20,34,42,.18); }
.bp-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(84px, 1fr)); gap:6px; }
.bp-face { display:grid; justify-items:center; gap:4px; min-height:44px; padding:6px 4px; border:2px solid transparent; border-radius:6px; background:none; color:var(--tb-ink); font:inherit; font-size:12px; line-height:1.2; cursor:pointer; }
.bp-face img { width:64px; height:64px; object-fit:contain; border-radius:6px; background:#fff; }
.bp-face .bp-none { width:64px; height:64px; }
.bp-face[aria-pressed="true"] { border-color:var(--tb-on); background:var(--tb-hover); font-weight:700; }
.bp-mouth { display:flex; flex-wrap:wrap; align-items:center; gap:6px; padding-top:8px; border-top:1px solid var(--tb-line); }
.bp-mouth-label { color:var(--tb-muted); font-size:13px; }
.bp-chip { min-height:44px; padding:0 12px; border:1px solid var(--tb-line); border-radius:5px; background:none; color:var(--tb-ink); font:inherit; font-size:13px; cursor:pointer; }
.bp-chip[aria-pressed="true"] { background:var(--tb-on); color:var(--tb-on-ink); border-color:var(--tb-on); }
.bp-done { justify-self:end; min-height:44px; padding:0 16px; border:1px solid var(--tb-line); border-radius:5px; background:none; color:var(--tb-ink); font:inherit; cursor:pointer; }
.bp button:focus-visible { outline:3px solid #007693; outline-offset:1px; }
@media (max-width: 520px) { .bp-name { display:none; } .bp-now { gap:2px; padding:0 2px; } .bp-now-img, .bp-now .bp-none { width:30px; height:30px; } }
@media (prefers-color-scheme: dark) { .bp button:focus-visible { outline-color:#83d8e6; } }
</style>
