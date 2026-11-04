<script setup>
// a small mock assignment for a made-up class.
import { ref, computed, onMounted, watch } from 'vue'
import { loadIndex, gradeLabel, VOICE_NAMES } from '../api'
import { PUBLIC_SAMPLE } from '../mode'
import { SHOWCASE } from '../presenting'
import { apiBase, apiRequest } from '../apiClient'
import '../teacher.css'

const items = ref([])
const loadingError = ref('')
const passageId = ref('')
const className = ref('Example class')
const soundOn = ref(!PUBLIC_SAMPLE)
const voice = ref('generated')
const view = ref('passage')
const saving = ref(false)
const status = ref('')
const link = ref('')
const roster = ref('')
const dashboard = ref('')
const showSample = ref(false)
const heldSample = ref(null)
const sampleError = ref('')

onMounted(async () => {
  document.title = 'Assign a passage · Sound Along prototype'
  try {
    items.value = await loadIndex()
    passageId.value = items.value[0]?.uuid || ''
  } catch { loadingError.value = 'Could not load the passage list.' }
})

const selected = computed(() => items.value.find((item) => item.uuid === passageId.value))
const availableVoices = computed(() => selected.value?.voices || [])
watch(passageId, () => {
  if (!availableVoices.value.includes(voice.value)) voice.value = availableVoices.value[0] || 'generated'
  link.value = ''
  dashboard.value = ''
})
watch([className, soundOn, voice, view, roster], () => { link.value = ''; dashboard.value = '' })

function studentLink() {
  const path = view.value === 'kid' && soundOn.value && !PUBLIC_SAMPLE ? 'kid' : 'p'
  const url = new URL(window.location.href)
  url.hash = PUBLIC_SAMPLE
    ? `/p/${passageId.value}`
    : `/${path}/${passageId.value}?sa=${soundOn.value ? 'on' : 'off'}&voice=${encodeURIComponent(voice.value)}&view=${view.value}`
  return url.href
}

async function makeLink() {
  if (!selected.value || !className.value.trim()) return
  link.value = studentLink()
  status.value = 'Student link is ready.'
  if (PUBLIC_SAMPLE) return
  saving.value = true
  const settings = { passageId: passageId.value, className: className.value.trim(), soundOn: soundOn.value, voice: voice.value, view: view.value }
  try {
    if (apiBase) {
      // Lab API on AWS (VITE_API_BASE set at build time): the saved record can be read from any device.
      const students = roster.value.split('\n').map((name) => name.trim()).filter(Boolean)
      const saved = await apiRequest('/api/assignments', { method: 'POST', body: { ...settings, students } })
      status.value = 'Student link is saved on the shared lab server and ready to open on any device.'
      if (saved.teacherKey) {
        link.value += `&a=${saved.id}`
        dashboard.value = `#/teacher/class/${saved.id}?k=${saved.teacherKey}`
        status.value = 'Send the student link to your class. Keep the class progress link to yourself.'
      }
    } else {
      const response = await fetch('http://localhost:3001/api/assignments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
        signal: AbortSignal.timeout(1500),
      })
      if (!response.ok) throw new Error('Assignment server did not save this link.')
      status.value = 'Student link is saved on this computer.'
    }
  } catch {
    status.value = apiBase ? 'Student link is ready but the shared server did not save it.' : 'Student link is ready but was not saved on this computer.'
  } finally { saving.value = false }
}

async function copyLink() {
  try { await navigator.clipboard.writeText(link.value); status.value = 'Student link copied.' }
  catch { status.value = 'Copy was unavailable. Select and copy the link below.' }
}

async function toggleSample() {
  if (PUBLIC_SAMPLE) return
  showSample.value = !showSample.value
  if (!showSample.value || heldSample.value) return
  sampleError.value = ''
  try {
    const data = apiBase ? await apiRequest('/api/content/held-sample', { timeoutMs: 1500 }) : await (async () => {
      const response = await fetch('http://localhost:3001/api/content/held-sample', { signal: AbortSignal.timeout(1500) })
      if (!response.ok) throw new Error('Sample unavailable')
      return response.json()
    })()
    if (data.sample !== true || !Array.isArray(data.passages)) throw new Error('Invalid sample')
    heldSample.value = data
  } catch { sampleError.value = apiBase ? 'The shared server did not answer.' : 'Start the local assignment server to see the sample.' }
}
</script>

<template>
  <header class="topbar"><div class="topbar-in"><a class="brand" href="#/">Sound Along</a><span class="topbar-title">Assign a passage</span></div></header>
  <main class="page teacher-page">
    <h1>Make a student link</h1>
    <template v-if="!SHOWCASE"><p>This is a mock assignment for a made-up class. A child can open the link without signing in.</p>
    <p class="muted">{{ PUBLIC_SAMPLE ? 'The link opens a silent sample passage. This is a mock link, not a class assignment.' : 'The link opens the selected reader with these Sound Along and voice settings. This is a mock link, not a class assignment.' }}</p>
    <p class="muted">To open the link on another device, use a host that device can reach. A localhost link or QR code only works on this computer.</p></template>
    <p v-if="loadingError" role="alert">{{ loadingError }}</p>
    <form v-else class="teacher-form" @submit.prevent="makeLink">
      <label>Passage
        <select v-model="passageId" required>
          <option v-for="item in items" :key="item.uuid" :value="item.uuid">{{ item.title }} · {{ gradeLabel(item.grade) }}</option>
        </select>
      </label>
      <label>{{ SHOWCASE ? 'Class name' : 'Class name (made up)' }}
        <input v-model="className" required maxlength="80" autocomplete="off" />
      </label>
      <label v-if="!PUBLIC_SAMPLE" class="teacher-check"><input v-model="soundOn" type="checkbox" /> Sound Along on for this link</label>
      <label v-if="!PUBLIC_SAMPLE">Voice
        <select v-model="voice" :disabled="!soundOn">
          <option v-for="id in availableVoices" :key="id" :value="id">{{ VOICE_NAMES[id] || id }}</option>
        </select>
      </label>
      <label v-if="!PUBLIC_SAMPLE">Student view
        <select v-model="view" :disabled="!soundOn">
          <option value="passage">Passage</option>
          <option value="kid">Kid view</option>
        </select>
      </label>
      <p v-if="!PUBLIC_SAMPLE && !soundOn" class="muted">With Sound Along off, the link opens the passage without its player.</p>
      <label v-if="apiBase">Student names or nicknames, one per line (optional; made-up names only in this prototype)
        <textarea v-model="roster" rows="5" maxlength="2400" autocomplete="off"></textarea>
      </label>
      <button type="submit" :disabled="!selected || saving">Make student link</button>
    </form>
    <section v-if="link" class="teacher-link" aria-label="Student link">
      <label for="student-link">Student link</label>
      <input id="student-link" :value="link" readonly @focus="$event.target.select()" />
      <div class="teacher-actions"><button type="button" @click="copyLink">Copy link</button><a :href="link">Open student view</a></div>
    </section>
    <p v-if="dashboard"><a :href="dashboard">Open class progress</a></p>
    <p role="status" aria-live="polite">{{ status }}</p>
    <p v-if="SHOWCASE" class="muted">A sample link for this prototype, not a class assignment. A child can open it without signing in.</p>
    <component :is="SHOWCASE ? 'details' : 'div'" v-if="!PUBLIC_SAMPLE" class="team-tools"><summary v-if="SHOWCASE">Content-team sample</summary>
    <section class="teacher-sample" aria-labelledby="teacher-sample-heading">
      <h2 id="teacher-sample-heading">Content-team sample</h2>
      <p>Illustrative held passages only. This is not a live pipeline status list.</p>
      <button type="button" :aria-expanded="showSample" @click="toggleSample">{{ showSample ? 'Hide sample' : 'Show sample' }}</button>
      <div v-if="showSample">
        <p v-if="sampleError" role="status">{{ sampleError }}</p>
        <ul v-else-if="heldSample">
          <li v-for="item in heldSample.passages" :key="item.id"><strong>{{ item.title }}</strong>: {{ item.state }}. {{ item.reason }}</li>
        </ul>
        <p v-else role="status">Loading sample…</p>
      </div>
    </section>
    </component>
  </main>
</template>
