<script setup>
// Feedback (design note: "have them be able to see the audio, demo it, and give feedback"). A kid taps a
// face; a grown-up can add words. Saved to the artifact's shared store when this viewer may write (the owner signed
// in); otherwise kept on this device with a "Copy all" so it can be texted over. Never blocks the page.
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { route } from '../router'
import { PUBLIC_SAMPLE } from '../mode'
import { apiBase, apiRequest } from '../apiClient'

defineProps({ pill: { type: Boolean, default: true } })
const open = ref(false)
const who = ref('')        // 'kid' | 'grown-up'
const name = ref('')
const face = ref('')       // 'love' | 'ok' | 'not'
const note = ref('')
const status = ref('')     // shown after Send
const sending = ref(false)
const local = ref([])
const panel = ref(null)
const opener = ref(null)
let db = null
let canWrite = null        // null = not told yet

const FACES = [
  { id: 'love', label: 'I liked it', glyph: '😀' },
  { id: 'ok', label: 'It was okay', glyph: '😐' },
  { id: 'not', label: "I didn't like it", glyph: '🙁' },
]
const SCREENS = { kid: 'Kid view', passage: 'Teacher view', library: 'Story list' }
const where = computed(() => `${route.value.name === 'look' ? `${route.value.look} ${route.value.screen}` : SCREENS[route.value.name] || route.value.name} · ${document.title.replace(/ · Sound Along.*$/, '')}`)
const ready = computed(() => !!face.value || note.value.trim().length > 0)

function readLocal() {
  try { local.value = JSON.parse(localStorage.getItem('sa-feedback') || '[]') } catch { local.value = [] }
}
function writeLocal(entry) {
  readLocal()
  local.value = [entry, ...local.value].slice(0, 200)
  try { localStorage.setItem('sa-feedback', JSON.stringify(local.value)) } catch { /* private window: keep in memory */ }
}

onMounted(async () => {
  document.addEventListener('focusin', keepFocus)
  readLocal()
  if (PUBLIC_SAMPLE) return
  try {
    const c = window.claude
    if (!c || !c.use) return
    const [d, user] = await Promise.all([c.use('db'), c.use('user')])
    db = d
    if (user) canWrite = await user.can('data.write')
  } catch { db = null }
})
onBeforeUnmount(() => document.removeEventListener('focusin', keepFocus))

const focusable = () => [...(panel.value?.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), summary, [tabindex]:not([tabindex="-1"])') || [])]
  .filter((el) => el.getClientRects().length && !el.closest('[hidden]'))
function keepFocus(event) {
  if (open.value && panel.value && !panel.value.contains(event.target)) {
    ;(focusable()[0] || panel.value).focus()
  }
}
function onDialogKey(event) {
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return }
  if (event.key !== 'Tab') return
  const items = focusable()
  if (!items.length) { event.preventDefault(); panel.value?.focus(); return }
  const first = items[0]
  const last = items[items.length - 1]
  if (event.shiftKey && (document.activeElement === first || !items.includes(document.activeElement))) {
    event.preventDefault(); last.focus()
  } else if (!event.shiftKey && (document.activeElement === last || !items.includes(document.activeElement))) {
    event.preventDefault(); first.focus()
  }
}

onMounted(() => window.addEventListener('sa-feedback-open', show))
onBeforeUnmount(() => window.removeEventListener('sa-feedback-open', show))
async function show() {
  opener.value = document.activeElement
  open.value = true
  status.value = ''
  await nextTick()
  panel.value?.querySelector('button')?.focus()
}
async function close() {
  open.value = false
  await nextTick()
  if (opener.value?.isConnected) opener.value?.focus()
}

async function send() {
  if (!ready.value || sending.value) return
  sending.value = true
  const entry = {
    who: who.value || 'not said', name: apiBase ? '' : name.value.trim().slice(0, 40), face: face.value || 'none',
    note: note.value.trim().slice(0, 2000), where: where.value, route: route.value.name, passage: route.value.id || '',
    at: new Date().toISOString(),
  }
  let saved = false
  if (!PUBLIC_SAMPLE && db && canWrite !== false) {
    try { await db.collection('feedback').add(entry); saved = true } catch { canWrite = false }
  }
  // Lab API on AWS (VITE_API_BASE set at build time): any device can send; it is read back through the API.
  if (!saved && apiBase) {
    try { await apiRequest('/api/feedback', { method: 'POST', body: entry }); saved = true } catch { /* keep it on the device below */ }
  }
  if (!saved) writeLocal(entry)
  status.value = PUBLIC_SAMPLE ? 'Thank you! Saved on this device. Use "Copy all" below to share it.' : saved ? 'Thank you! Your feedback was sent.' : 'Thank you! Saved on this device. Use "Copy all" below to send it to the team.'
  face.value = ''
  note.value = ''
  sending.value = false
}

function asText(list) {
  return list.map((e) => `${e.at.slice(0, 16).replace('T', ' ')} | ${e.who}${e.name ? ' (' + e.name + ')' : ''} | ${e.face} | ${e.where}${e.note ? ' | ' + e.note : ''}`).join('\n')
}
const copied = ref(false)
async function copyAll() {
  const text = asText(local.value)
  try { await navigator.clipboard.writeText(text); copied.value = true } catch {
    const ta = panel.value?.querySelector('#fb-all')
    if (ta) { ta.focus(); ta.select() }
  }
}
</script>

<template>
  <aside class="fb-root" aria-label="Feedback">
  <Teleport :to="route.name === 'passage' ? '#passage-feedback-slot' : route.name === 'kid' ? '#kid-feedback-slot' : 'body'">
    <button v-if="pill" type="button" class="fb-pill" :class="{ 'fb-up': route.name === 'passage', 'fb-kid': route.name === 'kid' }" aria-label="Give feedback" @click="show">
      <span aria-hidden="true">💬</span><span class="fb-pill-text">Feedback</span>
    </button>
  </Teleport>
  <div v-if="open" class="fb-scrim" @click.self="close" @keydown="onDialogKey">
    <div ref="panel" class="fb-card" role="dialog" aria-modal="true" aria-labelledby="fb-h" tabindex="-1">
      <div class="fb-head">
        <h2 id="fb-h">How was it?</h2>
        <button type="button" class="fb-x" aria-label="Close" @click="close">&times;</button>
      </div>
      <p class="fb-where">About: {{ where }}</p>
      <p v-if="apiBase" class="fb-where">This goes to a shared list. Please do not write names or other private details.</p>

      <div class="fb-row" role="group" aria-label="Who is giving feedback">
        <button type="button" class="fb-chip" :aria-pressed="who === 'kid'" @click="who = 'kid'">Kid</button>
        <button type="button" class="fb-chip" :aria-pressed="who === 'grown-up'" @click="who = 'grown-up'">Grown-up</button>
        <label v-if="!apiBase" class="fb-name"><span class="sr">Name or age (optional)</span>
          <input id="fb-name" v-model="name" type="text" maxlength="40" placeholder="Name or age (optional)" />
        </label>
      </div>

      <div class="fb-faces" role="group" aria-label="How did you like it?">
        <button v-for="f in FACES" :key="f.id" type="button" class="fb-face" :aria-pressed="face === f.id" :aria-label="f.label" @click="face = f.id">
          <span class="fb-glyph" aria-hidden="true">{{ f.glyph }}</span>
          <span class="fb-flabel">{{ f.label }}</span>
        </button>
      </div>

      <label class="fb-note">What did you like, or what was hard or confusing?
        <textarea id="fb-note" v-model="note" rows="3" maxlength="2000" :placeholder="PUBLIC_SAMPLE ? 'For example: I liked this story, a word was hard to read, I could not find a word meaning…' : 'For example: the highlight was too fast, I liked hearing the word, I couldn\'t find the play button…'"></textarea>
      </label>

      <div class="fb-actions">
        <button type="button" class="fb-send" :disabled="!ready || sending" @click="send">{{ PUBLIC_SAMPLE ? 'Save feedback' : 'Send feedback' }}</button>
        <p v-if="status" class="fb-status" role="status">{{ status }}</p>
      </div>

      <details v-if="local.length" class="fb-local">
        <summary>Saved on this device ({{ local.length }})</summary>
        <textarea id="fb-all" readonly rows="5" :value="asText(local)"></textarea>
        <button type="button" class="fb-copy" @click="copyAll">{{ copied ? 'Copied' : 'Copy all' }}</button>
      </details>
    </div>
  </div>
  </aside>
</template>

<style scoped>
.fb-pill {
  position: fixed; z-index: 90; left: max(12px, env(safe-area-inset-left, 0px)); bottom: calc(12px + env(safe-area-inset-bottom, 0px));
  min-height: 44px; padding: 8px 16px; border-radius: 22px; border: 1px solid var(--line); background: var(--panel); color: var(--ink);
  font: 600 15px/1 var(--ui); box-shadow: 0 2px 10px rgba(0, 0, 0, .16); cursor: pointer; display: inline-flex; gap: 6px; align-items: center;
}
.fb-pill.fb-up, .fb-pill.fb-kid { position: static; box-shadow: none; }
@media (max-width: 560px) {
  .fb-pill.fb-up { width: 44px; height: 44px; padding: 0; justify-content: center; }
  .fb-pill.fb-up .fb-pill-text { display: none; }
}
.fb-pill:focus-visible, .fb-card :focus-visible { outline: 3px solid var(--focus); outline-offset: 2px; }
.fb-scrim { position: fixed; inset: 0; z-index: 95; background: rgba(0, 0, 0, .45); display: grid; place-items: center; padding: 16px; }
.fb-card {
  width: min(520px, 100%); max-height: calc(100% - 16px); overflow: auto; background: var(--panel); color: var(--ink);
  border-radius: 14px; border-top: 6px solid var(--teal); padding: 14px 18px 18px; font-family: var(--ui); display: grid; gap: 12px;
}
.fb-head { display: flex; align-items: center; justify-content: space-between; }
.fb-head h2 { margin: 0; font-size: 22px; }
.fb-x { width: 44px; height: 44px; border: 0; background: none; font-size: 30px; color: var(--muted); border-radius: 8px; cursor: pointer; }
.fb-where { margin: 0; color: var(--muted); font-size: 14px; }
.fb-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.fb-chip { min-height: 44px; padding: 0 18px; border-radius: 22px; border: 2px solid var(--teal); background: var(--panel); color: var(--teal); font: 700 16px var(--ui); cursor: pointer; }
.fb-chip[aria-pressed='true'] { background: var(--teal); color: var(--on-teal); }
.fb-name { flex: 1 1 160px; min-width: 0; }
.fb-name input, .fb-note textarea, .fb-local textarea {
  width: 100%; min-height: 44px; padding: 8px 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--page); color: var(--ink); font: 16px var(--ui);
}
.fb-faces { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
.fb-face {
  display: grid; justify-items: center; gap: 4px; padding: 10px 4px; border-radius: 14px; border: 2px solid var(--line); background: var(--page);
  color: var(--ink); cursor: pointer;
}
.fb-face[aria-pressed='true'] { border-color: var(--teal); background: var(--soft); box-shadow: 0 0 0 3px var(--hl-bg); }
.fb-glyph { font-size: 48px; line-height: 1; }
.fb-flabel { font: 600 14px var(--ui); text-align: center; }
.fb-note { display: grid; gap: 6px; font-weight: 600; font-size: 15px; }
.fb-actions { display: grid; gap: 8px; }
.fb-send { min-height: 52px; border: 0; border-radius: 10px; background: var(--teal); color: var(--on-teal); font: 700 18px var(--ui); cursor: pointer; }
.fb-send:disabled { opacity: .45; cursor: default; }
.fb-status { margin: 0; font-weight: 600; }
.fb-local summary { cursor: pointer; color: var(--muted); }
.fb-local { display: grid; gap: 8px; }
.fb-copy { justify-self: start; min-height: 44px; padding: 0 16px; border-radius: 8px; border: 1px solid var(--teal); background: var(--panel); color: var(--teal); font-weight: 700; cursor: pointer; }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
</style>
