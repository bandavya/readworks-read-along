<script setup>
import { shallowRef } from 'vue'
import { display } from './usage.js'

const props = defineProps({ usage: { type: Object, required: true } })
const options = props.usage.allowedOptions()
const columns = shallowRef(props.usage.activeOptions())
const rows = shallowRef(props.usage.summary())

function refresh() {
  columns.value = props.usage.activeOptions()
  rows.value = props.usage.summary()
}
function toggle(id, on) {
  props.usage.setRecording(id, on)
  refresh()
}
function clearAll() {
  props.usage.clear()
  refresh()
}

function downloadCsv() {
  refresh()
  const header = ['passage_id', ...columns.value.map((option) => option.id)]
  const body = rows.value.map((row) => [row.passageId, ...columns.value.map((option) => display(option, row[option.id]))])
  const lines = [header, ...body].map((line) => line.join(','))
  const url = URL.createObjectURL(new Blob([lines.join('\r\n') + '\r\n'], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = 'sound-along-this-device.csv'
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
</script>

<template>
  <section class="usage-panel page" aria-labelledby="usage-heading">
    <h2 id="usage-heading">This device</h2>
    <p>Passage activity on this browser. These are action counts, not students or reading scores.</p>
    <fieldset v-if="options.length" class="usage-options">
      <legend>What this device keeps</legend>
      <label v-for="option in options" :key="option.id"><input type="checkbox" :checked="columns.includes(option)" @change="toggle(option.id, $event.target.checked)" /> {{ option.label }}</label>
      <p>Turning one off also deletes what it kept here. "How much audio played" is about the player, not what a child heard or read.</p>
    </fieldset>
    <div class="usage-table-wrap">
      <table>
        <thead><tr><th scope="col">Passage ID</th><th v-for="option in columns" :key="option.id" scope="col">{{ option.label }}</th></tr></thead>
        <tbody>
          <tr v-for="row in rows" :key="row.passageId"><th scope="row">{{ row.passageId }}</th><td v-for="option in columns" :key="option.id">{{ display(option, row[option.id]) }}</td></tr>
        </tbody>
      </table>
    </div>
    <p v-if="!rows.length">No activity recorded here yet.</p>
    <button type="button" @click="downloadCsv">Download as CSV</button>
    <button type="button" @click="clearAll">Delete these counts</button>
    <p>Counts on this device only; these are not sent anywhere.</p>
  </section>
</template>

<style scoped>
.usage-panel { min-width: 0; max-width: min(100%, 1000px); margin: 24px auto; padding: 20px; border: 1px solid var(--line, #ccc); border-radius: 8px; }
.usage-panel h2 { margin-top: 0; }
.usage-options { display: flex; flex-wrap: wrap; gap: 6px 16px; margin: 0 0 14px; border: 1px solid var(--line, #ccc); border-radius: 4px; }
.usage-options p { flex-basis: 100%; margin: 4px 0 0; }
.usage-table-wrap { max-width: 100%; overflow-x: auto; overscroll-behavior-inline: contain; }
table { border-collapse: collapse; width: 100%; font-size: .9rem; }
th, td { padding: 8px; border-bottom: 1px solid var(--line, #ccc); text-align: left; }
th:first-child { overflow-wrap: anywhere; min-width: 160px; }
button { min-height: 44px; padding: 10px 16px; margin-right: 8px; border: 1px solid var(--teal); border-radius: 4px; background: var(--teal); color: var(--on-teal); font-weight: 700; cursor: pointer; }
</style>
