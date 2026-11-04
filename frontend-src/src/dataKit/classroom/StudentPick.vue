<script setup>
// Who's reading? A stand-in for ReadWorks' own student sign-in, which works much the same way: class code, then your name.
import { ref, onMounted } from 'vue'
import { assignmentId, loadRoster, readWithoutReporting, startReading } from './classLink'

const assignment = ref(null)

onMounted(async () => {
  try { assignment.value = await loadRoster() }
  catch { readWithoutReporting() } // never block reading over this
  if (assignment.value && !assignment.value.students?.length) readWithoutReporting()
})
function pick(student) {
  startReading({ assignmentId: assignmentId(), passageId: assignment.value.passageId, key: student.key, name: student.name })
}
</script>

<template>
  <main v-if="assignment" class="page student-pick">
    <h1>Who's reading?</h1>
    <p>Your teacher can see that you opened this, how much audio played, and which tools you used, but not which words.</p>
    <ul>
      <li v-for="student in assignment.students" :key="student.key"><button type="button" @click="pick(student)">{{ student.name }}</button></li>
    </ul>
    <button type="button" class="student-pick-other" @click="readWithoutReporting">I'm not on this list</button>
  </main>
</template>

<style scoped>
.student-pick { max-width: 640px; }
ul { list-style: none; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 10px; }
button { width: 100%; min-height: 56px; padding: 10px; font: inherit; font-weight: 700; cursor: pointer; }
.student-pick-other { width: auto; min-height: 44px; margin-top: 16px; font-weight: 400; }
</style>
