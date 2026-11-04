<script setup>
// One class, one assignment. The host loads the data; this only shows it.
// Columns come from the options table. Alphabetical, never ranked.
import { computed } from 'vue'

const props = defineProps({
  options: { type: Array, required: true },
  students: { type: Array, required: true }, // [{ name, progress: { optionId: value } }]
})
const columns = computed(() => props.options.filter((option) => option.teacher))
const rows = computed(() => [...props.students].sort((a, b) => a.name.localeCompare(b.name)))
const totals = computed(() => columns.value.map((option) => ({
  label: option.teacherLabel,
  count: props.students.filter((student) => student.progress?.[option.id] > 0).length,
})))
function cell(option, student) {
  const value = student.progress?.[option.id] ?? 0
  if (option.teacher === 'level') return value ? option.levels[value] : ''
  return value ? 'Yes' : ''
}
const opened = (student) => student.progress?.opened > 0
</script>

<template>
  <section class="dash" aria-label="Class progress">
    <div class="dash-totals">
      <template v-for="total in totals" :key="total.label">
        <span>{{ total.label }}</span>
        <span class="dash-track" :title="`${total.count} of ${students.length} students`"><i :style="{ width: `${students.length ? total.count / students.length * 100 : 0}%` }"></i></span>
        <b>{{ total.count }} of {{ students.length }}</b>
      </template>
    </div>
    <div class="dash-wrap">
      <table>
        <thead><tr><th scope="col">Student</th><th v-for="option in columns" :key="option.id" scope="col">{{ option.teacherLabel }}</th></tr></thead>
        <tbody>
          <tr v-for="student in rows" :key="student.name">
            <th scope="row">{{ student.name }}<span v-if="!opened(student)" class="dash-none"> · not opened here</span></th>
            <td v-for="option in columns" :key="option.id">{{ cell(option, student) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <p class="dash-note">"Not opened here" may mean absent, reading on paper, or a network problem. "Audio played" is about the player, not what a child heard or read. Blank tools are not a problem: a strong reader may need none. These show use, not how well anyone reads.</p>
  </section>
</template>

<style scoped>
.dash-totals { display: grid; grid-template-columns: auto 1fr auto; gap: 6px 10px; align-items: center; margin: 0 0 16px; }
.dash-track { height: 12px; background: var(--line, #ddd); border-radius: 2px; overflow: hidden; }
.dash-track i { display: block; height: 100%; background: var(--teal, #1f5f8b); }
.dash-wrap { overflow-x: auto; }
table { border-collapse: collapse; width: 100%; font-size: .92rem; }
th, td { padding: 8px; border-bottom: 1px solid var(--line, #ccc); text-align: left; }
.dash-none { font-weight: 400; opacity: .75; }
.dash-note { font-size: .9rem; opacity: .85; }
</style>
