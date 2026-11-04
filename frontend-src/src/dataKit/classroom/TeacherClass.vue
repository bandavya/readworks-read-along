<script setup>
// The teacher's dashboard for one assignment. The link holds the teacher key after #, so it never reaches a server's
// logs; anyone with this link can see the class, so it stays with the teacher. `demo` shows made-up students.
import { ref, onMounted } from 'vue'
import TeacherDashboard from '../TeacherDashboard.vue'
import { DATA_OPTIONS } from '../options.js'
import { apiRequest } from '../../apiClient'

const props = defineProps({ id: String })
const isDemo = props.id === 'demo'
const data = ref(null)
const error = ref('')

const DEMO = { className: 'Made-up class', students: [
  { name: 'Ada', progress: { opened: 1, playback: 3, word_card_opened: 1 } },
  { name: 'Ben', progress: { opened: 1, playback: 1, word_tap: 1, word_card_opened: 1, replay: 1 } },
  { name: 'Cam', progress: { opened: 1, audio_trouble: 1 } },
  { name: 'Dee', progress: {} },
  { name: 'Eli', progress: { opened: 1 } },
  { name: 'Fay', progress: { opened: 1, playback: 2, word_tap: 1 } },
] }

async function load() {
  error.value = ''
  if (isDemo) { data.value = DEMO; return }
  try {
    const teacherKey = new URLSearchParams(window.location.hash.split('?')[1] || '').get('k')
    data.value = await apiRequest('/api/class-progress', { method: 'POST', body: { assignmentId: props.id, teacherKey } })
  } catch { error.value = "Couldn't load this class. The link may have expired or be incomplete." }
}
onMounted(() => { document.title = 'Class progress · Sound Along prototype'; load() })
</script>

<template>
  <header class="topbar"><div class="topbar-in"><a class="brand" href="#/teacher/">Sound Along</a><span class="topbar-title">Class progress</span></div></header>
  <main class="page">
    <h1>{{ data?.className || 'Class progress' }}</h1>
    <p v-if="isDemo" role="note"><b>Mock data. Every student here is made up.</b></p>
    <p v-if="error" role="alert">{{ error }}</p>
    <TeacherDashboard v-if="data" :options="DATA_OPTIONS" :students="data.students" />
    <button v-if="data && !isDemo" type="button" @click="load">Refresh</button>
  </main>
</template>
