<script setup>
// One bar above every screen: pick a theme, pick a screen. The story stays the same, and on the Read screen so does the
// place in the narration.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { route } from '../router'
import { loadIndex } from '../api'
import { SoundAlong } from '../soundAlong'
import { THEMES, SCREENS, DEFAULT_THEME, themeHref, placeOf } from '../themes'
import BuddyPicker from '../character/BuddyPicker.vue'
import { BUDDY_UI } from '../character/buddies.js'

const place = computed(() => placeOf(route.value))
const lastId = ref('')
const firstId = ref('')
const storyId = computed(() => place.value?.id || lastId.value || firstId.value)
watch(() => place.value?.id, (id) => { if (id) lastId.value = id }, { immediate: true })
// Full-screen kid pages start below the bar, so its height is published to the page.
const bar = ref(null)
const root = document.documentElement
const sizer = new ResizeObserver(() => root.style.setProperty('--tb-h', `${bar.value?.offsetHeight || 0}px`))
watch(bar, (el) => { sizer.disconnect(); if (el) sizer.observe(el); root.classList.toggle('has-tb', !!el) })
onBeforeUnmount(() => { sizer.disconnect(); root.classList.remove('has-tb') })
onMounted(async () => { try { firstId.value = (await loadIndex())[0]?.uuid || '' } catch { /* the bar still switches themes */ } })

const theme = computed(() => place.value?.theme || DEFAULT_THEME)
const screen = computed(() => place.value?.screen || 'library')
const href = (t, s) => themeHref(t, s, storyId.value)

// Carry the narration across a theme change: the old reader stops as it unmounts, the new one picks up where it stopped.
function carryPlace() {
  const old = SoundAlong.latest
  if (screen.value !== 'p' || !old?.audio || old.audio.currentTime < 0.2) return
  const time = old.audio.currentTime
  const playing = !old.audio.paused
  const started = Date.now()
  const wait = setInterval(() => {
    const next = SoundAlong.latest
    if (Date.now() - started > 8000) return clearInterval(wait)
    if (next === old || !next?.audio || next.audio.readyState < 1 || !next.words?.length) return
    clearInterval(wait)
    next.seekTime(time)
    if (playing) next.resume()
  }, 100)
}
function pickTheme(t) {
  if (t === theme.value) return
  carryPlace()
  window.location.hash = href(t, screen.value)
}
const feedback = () => window.dispatchEvent(new CustomEvent('sa-feedback-open'))
// Closed by default so the screen stays clean; once opened it stays open for comparing themes, until closed.
const read = () => { try { return sessionStorage.getItem('sa-demo-open') === '1' } catch { return false } }
const open = ref(read())
function toggleOpen() { open.value = !open.value; try { sessionStorage.setItem('sa-demo-open', open.value ? '1' : '0') } catch { /* stays for this page only */ } }
</script>

<template>
  <nav ref="bar" class="tb" aria-label="Demo controls">
    <div class="tb-strip">
      <span class="tb-proto" :class="{ 'tb-proto-tight': BUDDY_UI }"><span class="tb-proto-long">Prototype for ReadWorks · not the live site</span><span class="tb-proto-short">Prototype · not the live site</span></span>
      <BuddyPicker v-if="BUDDY_UI" />
      <button type="button" class="tb-open" :aria-expanded="open" aria-controls="tb-panel" @click="toggleOpen"><span class="tb-open-long">Demo controls </span><span class="tb-open-short">Demo </span><span aria-hidden="true">{{ open ? '▴' : '▾' }}</span></button>
    </div>
    <div v-if="open" id="tb-panel" class="tb-panel">
    <div class="tb-themes" role="group" aria-label="Theme">
      <span class="tb-label" aria-hidden="true">Theme</span>
      <a v-for="t in THEMES" :key="t.id" class="tb-chip" :href="href(t.id, screen)" :aria-current="t.id === theme ? 'true' : undefined" @click.prevent="pickTheme(t.id)">
        <i class="tb-swatch" :style="{ background: t.swatch }" aria-hidden="true"></i>{{ t.name }}
      </a>
    </div>
    <div class="tb-screens" role="group" aria-label="Screen">
      <a v-for="s in SCREENS" :key="s.id" class="tb-screen" :href="href(theme, s.id)" :aria-current="s.id === screen ? 'page' : undefined">{{ s.name }}</a>
    </div>
    <div class="tb-screens tb-more" role="group" aria-label="Other screens">
      <a class="tb-screen" href="#/teacher/">Assign</a>
      <a v-if="storyId" class="tb-screen" :href="`#/review/${storyId}`">Word review</a>
      <a class="tb-screen" href="#/listen/">Listening test</a>
      <a class="tb-screen" href="#/experiments">Experiments</a>
      <button type="button" class="tb-feedback" @click="feedback">Feedback</button>
    </div>
    </div>
  </nav>
</template>

<style>
html.has-tb .kv { top: var(--tb-h, 0px) !important; bottom: 0 !important; height: auto; }
html.has-tb .sk { min-height: calc(100dvh - var(--tb-h, 0px)); }
</style>

<style scoped>
.tb { --tb-ink:#344048; --tb-muted:#576b78; --tb-ground:#fff; --tb-line:#dcdee0; --tb-on:#1c3b49; --tb-on-ink:#fff; --tb-hover:#eef4f5;
  background:var(--tb-ground); border-bottom:1px solid var(--tb-line); color:var(--tb-ink); font:500 14px/1 Roboto, Helvetica, Arial, sans-serif; }
.tb-strip { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:0 16px; min-height:44px; }
.tb-proto { color:var(--tb-muted); font-size:13px; font-weight:400; white-space:nowrap; }
.tb-proto-short { display:none; }
.tb-open { min-height:44px; padding:0 8px; border:0; background:none; color:var(--tb-muted); font:inherit; font-size:13px; cursor:pointer; white-space:nowrap; }
.tb-open:hover { color:var(--tb-ink); }
.tb-panel { display:flex; flex-wrap:wrap; align-items:center; gap:4px 14px; padding:4px 16px 6px; border-top:1px solid var(--tb-line); }
.tb-themes { display:flex; flex-wrap:wrap; align-items:center; gap:2px; min-width:0; }
.tb-label { color:var(--tb-muted); margin-right:8px; font-size:13px; }
.tb-chip, .tb-screen, .tb-feedback { display:inline-flex; align-items:center; gap:7px; min-height:44px; padding:0 11px; border-radius:5px; color:inherit; text-decoration:none; white-space:nowrap; font:inherit; background:none; border:0; cursor:pointer; }
.tb-chip:hover, .tb-screen:hover, .tb-feedback:hover { background:var(--tb-hover); }
.tb-chip[aria-current], .tb-screen[aria-current] { background:var(--tb-on); color:var(--tb-on-ink); }
.tb-swatch { width:13px; height:13px; border-radius:3px; box-shadow:inset 0 0 0 1px rgba(52,64,72,.28); flex:none; }
.tb-screens { display:flex; flex-wrap:wrap; gap:2px; padding-left:12px; border-left:1px solid var(--tb-line); }
.tb-feedback { color:var(--tb-muted); }
.tb-more { padding-left:0; border-left:0; }
.tb-open-short { display:none; }
.tb:has(.bp) { position:relative; z-index:60; }
@media (max-width: 520px) { .tb:has(.bp) .tb-open-long { display:none; } .tb:has(.bp) .tb-open-short { display:inline; } .tb:has(.bp) .tb-strip { gap:2px; padding:0 6px; } .tb:has(.bp) .tb-open { padding:0 2px; } .tb-proto-tight { font-size:11px; white-space:normal; line-height:1.15; flex:0 1 72px; min-width:0; } }
.tb a:focus-visible, .tb button:focus-visible { outline:3px solid #007693; outline-offset:1px; }
@media (max-width: 760px) { .tb-proto-long { display:none; } .tb-proto-short { display:inline; } .tb-screens { padding-left:0; border-left:0; } .tb-screen, .tb-chip { padding:0 9px; } }
@media (prefers-color-scheme: dark) {
  .tb { --tb-ink:#e5eef0; --tb-muted:#b7c9cf; --tb-ground:#14222a; --tb-line:#33474f; --tb-on:#d7f5ff; --tb-on-ink:#10262e; --tb-hover:#1f323b; }
  .tb a:focus-visible, .tb button:focus-visible { outline-color:#83d8e6; }
}
</style>
