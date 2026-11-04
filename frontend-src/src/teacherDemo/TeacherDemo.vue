<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import TeacherDashboard from '../dataKit/TeacherDashboard.vue'
import { DATA_OPTIONS } from '../dataKit/options.js'
import { ASSIGNMENT, CLASS_WORDS, GROUPS, STUDENTS } from './classData.js'
import { DEFAULTS, SUPPORTS, resolveSettings } from './resolve.js'
import { teacherTab, liveClassSettings, sessionFor, readerHref, setStudentChoice } from './session.js'

const props = defineProps({ person: { type: String, default: 'teacher' } })
const person = computed(() => ['teacher', 'maya', 'diego', 'jordan', 'priya'].includes(props.person) ? props.person : 'teacher')
const student = computed(() => STUDENTS.find(s => s.id === person.value))
const isTeacher = computed(() => person.value === 'teacher')
const isPriya = computed(() => person.value === 'priya')
const tab = teacherTab
const heading = ref(null)
const passageMissing = ref(false)
onMounted(async () => {
  document.title = `${isTeacher.value ? 'Class 4B' : isPriya.value ? 'Content work' : 'Your reading'} · Sound Along`
  nextTick(() => heading.value?.focus({ preventScroll: true }))
  try {
    const response = await fetch(new URL(`data/${ASSIGNMENT.passageId}.json`, document.baseURI))
    if (!response.ok || !(await response.json()).html) passageMissing.value = true
  } catch { passageMissing.value = true }
})
watch(person, () => { document.title = `${isTeacher.value ? 'Class 4B' : isPriya.value ? 'Content work' : 'Your reading'} · Sound Along`; nextTick(() => heading.value?.focus({ preventScroll: true })) })
const classOnly = computed(() => resolveSettings({ defaults: DEFAULTS, classSettings: liveClassSettings }))
const sunrise = computed(() => resolveSettings({ defaults: DEFAULTS, classSettings: liveClassSettings, groupSettings: GROUPS.sunrise.settings }))
const maya = computed(() => sessionFor(STUDENTS.find(s => s.id === 'maya')))
const jordan = computed(() => sessionFor(STUDENTS.find(s => s.id === 'jordan')))
const own = computed(() => student.value && sessionFor(student.value))
const supportColumns = computed(() => [
  { label: 'Class', result: classOnly.value }, { label: 'Sunrise', result: sunrise.value },
  { label: 'Maya', result: maya.value }, { label: 'Jordan', result: jordan.value },
])
const dashboardOptions = DATA_OPTIONS.filter(o => ['opened', 'playback'].includes(o.id))
const dashboardRows = computed(() => STUDENTS.map(s => ({ name: s.name, status: s.status, progress: { opened: s.opened ? 1 : 0, playback: s.audioLevel } })))
const attention = computed(() => STUDENTS.filter(s => ['not started', 'stopped early', 'audio trouble'].includes(s.status)))
const statusCounts = computed(() => ({
  'not started': STUDENTS.filter(s => s.status === 'not started').length,
  'in progress': STUDENTS.filter(s => ['in progress', 'stopped early', 'audio trouble'].includes(s.status)).length,
  finished: STUDENTS.filter(s => s.status === 'finished').length,
}))
const valueText = (key, v) => {
  if (key === 'voice') return v === 'human' ? 'Human' : 'Generated'
  if (key === 'readerMode') return v === 'kid' ? 'Big page' : 'Standard page'
  if (key === 'font') return v === 'sans' ? 'Simple sans' : 'Andika'
  if (key === 'textSize') return ({ S:'Small', M:'Medium', L:'Large', XL:'Extra large', XXL:'Largest' })[v] || v
  return v ? 'On' : 'Off'
}
const switchRoles = [
  { id: 'teacher', name: 'Ms. Rivera' }, { id: 'maya', name: 'Maya' },
  { id: 'diego', name: 'Diego' }, { id: 'jordan', name: 'Jordan' }, { id: 'priya', name: 'Priya' },
]
</script>

<template>
  <main class="td-page">
    <header class="td-head">
      <a class="td-brand" :href="`#/class-demo?as=${person}`">Sound Along</a>
      <h1 ref="heading" tabindex="-1">{{ isTeacher ? 'Class 4B' : isPriya ? 'Content work' : 'Your reading' }}</h1>
      <nav class="td-roles" aria-label="Presenter: View as">
        <span>Presenter · View as</span>
        <a v-for="role in (isPriya ? switchRoles.filter(r => ['teacher','priya'].includes(r.id)) : switchRoles)" :key="role.id" :href="`#/class-demo?as=${role.id}`" :aria-current="person === role.id ? 'page' : undefined">{{ role.name }}</a>
      </nav>
    </header>
    <p v-if="passageMissing" class="td-missing" role="status">The sample passage is not available here. Please try again later.</p>

    <template v-if="isTeacher">
      <p class="td-sample">Sample class. All students are made up.</p>
      <p>Reading support and class patterns are a direction for ReadWorks to explore.</p>
      <div class="td-tabs" role="group" aria-label="Teacher screens">
        <button type="button" :aria-pressed="tab === 'assignment'" @click="tab = 'assignment'">Assignment</button>
        <button type="button" :aria-pressed="tab === 'supports'" @click="tab = 'supports'">Supports</button>
        <button type="button" :aria-pressed="tab === 'words'" @click="tab = 'words'">Class words</button>
      </div>
      <section v-if="tab === 'assignment'" aria-labelledby="td-assignment-h">
        <h2 id="td-assignment-h">{{ ASSIGNMENT.title }}</h2>
        <p>One passage for Class 4B. Sample data. It doesn't change when someone reads.</p>
        <div class="td-counts">
          <p><strong>{{ statusCounts['not started'] }}</strong> not started</p>
          <p><strong>{{ statusCounts['in progress'] }}</strong> in progress</p>
          <p><strong>{{ statusCounts.finished }}</strong> finished</p>
        </div>
        <h3>Needs attention</h3>
        <p>Check in with readers who have not started or stopped early. For audio trouble, offer a way to read without sound.</p>
        <ul class="td-attention">
          <li v-for="s in attention" :key="s.id"><span>{{ s.name }}</span><span>{{ s.status }}</span></li>
        </ul>
        <h3>Class list</h3>
        <TeacherDashboard :options="dashboardOptions" :students="dashboardRows" show-status note="Not opened here may mean absent, reading on paper, or a network problem. Audio played shows player use, not what a child heard or read." />
      </section>
      <section v-else-if="tab === 'supports'" aria-labelledby="td-supports-h">
        <h2 id="td-supports-h">Reading supports</h2>
        <p>Change the class setting, then view a reader. A student choice applies only where allowed. A lock always stays on.</p>
        <div class="td-control-row">
          <button type="button" class="td-toggle" :aria-pressed="liveClassSettings.soundOn" @click="liveClassSettings.soundOn = !liveClassSettings.soundOn">Class read aloud: {{ liveClassSettings.soundOn ? 'On' : 'Off' }}</button>
          <button type="button" class="td-toggle" :aria-pressed="liveClassSettings.contrast" @click="liveClassSettings.contrast = !liveClassSettings.contrast">Class high contrast: {{ liveClassSettings.contrast ? 'On' : 'Off' }}</button>
          <button type="button" class="td-toggle" :aria-pressed="liveClassSettings.readerMode === 'kid'" @click="liveClassSettings.readerMode = liveClassSettings.readerMode === 'kid' ? 'standard' : 'kid'">Class reader view: {{ liveClassSettings.readerMode === 'kid' ? 'Big page' : 'Standard page' }}</button>
        </div>
        <p class="td-lock-summary">Jordan: read aloud stays on <strong>🔒 Locked</strong></p>
        <div class="td-support-content">
        <div class="td-table-wrap">
          <p class="td-scroll-hint">Scroll the table to see Maya and Jordan.</p>
          <table class="td-support-table">
            <caption>Where each reader setting comes from</caption>
            <thead><tr><th scope="col">Support</th><th v-for="col in supportColumns" :key="col.label" scope="col">{{ col.label }}</th></tr></thead>
            <tbody><tr v-for="support in SUPPORTS" :key="support.key">
              <th scope="row">{{ support.label }}</th>
              <td v-for="col in supportColumns" :key="col.label" :data-test="`${col.label.toLowerCase()}-${support.key}`">
                <strong>{{ valueText(support.key, col.result.values[support.key]) }}</strong>
                <small>{{ col.result.source[support.key] }}</small>
                <span v-if="col.result.locked[support.key]" class="td-locked">&#128274; Locked</span>
              </td>
            </tr></tbody>
          </table>
        </div>
        <section class="td-card td-preview" aria-label="Preview as Maya" data-test="maya-preview">
          <h3>Preview as Maya</h3>
          <div class="td-mini-story" :class="{ 'td-mini-contrast': maya.values.contrast, 'td-mini-spaced': maya.values.spacing, 'td-mini-sans': maya.values.font === 'sans' }" :style="{ fontSize: ({ S: '16px', M: '19px', L: '23px', XL: '27px', XXL: '30px' })[maya.values.textSize] }"><strong>{{ ASSIGNMENT.title }}</strong><p>He also has a charity foundation.</p></div>
          <p>Read aloud: {{ valueText('soundOn', maya.values.soundOn) }}. Maya's text choice is {{ valueText('textSize', maya.values.textSize).toLowerCase() }}.</p>
          <a v-if="!passageMissing" class="td-action" :href="readerHref(STUDENTS.find(s => s.id === 'maya'), maya)">Open Maya's reader</a>
        </section>
        </div>
      </section>
      <section v-else aria-labelledby="td-words-h">
        <h2 id="td-words-h">Class words</h2>
        <p>Words at least three readers tapped in {{ ASSIGNMENT.title }}. Use these sentences to plan a short class discussion.</p>
        <ul class="td-words"><li v-for="item in CLASS_WORDS" :key="item.word"><div><strong>{{ item.word }}</strong><p>{{ item.sentence }}</p></div><span>{{ item.students }} readers</span></li></ul>
      </section>
    </template>

    <section v-else-if="isPriya" aria-labelledby="td-priya-h">
      <h2 id="td-priya-h">Word help queue</h2>
      <p>Sample content queue. Open the word help review for this passage.</p>
      <ul class="td-queue">
        <li><strong>{{ ASSIGNMENT.title }}</strong><a v-if="!passageMissing" class="td-action" :href="`#/review/${ASSIGNMENT.passageId}?td=1`">Open word help review</a></li>
        <li><strong>Held take: The Moon Garden</strong><span>Check the word help before sharing.</span></li>
        <li><strong>Held take: A River of Stars</strong><span>Waiting for a clear recording.</span></li>
      </ul>
    </section>

    <section v-else aria-label="Reading assignment">
      <article class="td-card td-assignment">
        <h3>{{ ASSIGNMENT.title }}</h3>
        <p>Read a story about a soccer player.</p>
        <a v-if="!passageMissing" class="td-action" data-test="student-reader-link" :href="readerHref(student, own)">Open story</a>
      </article>
      <section v-if="ASSIGNMENT.adjustable.textSize" class="td-choice" aria-label="Text size">
        <label for="td-text-size">Text size</label>
        <select id="td-text-size" :value="own.values.textSize" @change="setStudentChoice(student.id, 'textSize', $event.target.value)">
          <option value="M">Medium</option><option value="L">Large</option><option value="XL">Extra large</option>
        </select>
      </section>
    </section>
  </main>
</template>

<style scoped>
.td-page { max-width: 1120px; margin: auto; padding: 20px clamp(14px,3vw,32px) 70px; color: var(--ink,#1a2b32); }
.td-head { display: grid; gap: 12px; border-bottom: 2px solid var(--line,#ccc); padding-bottom: 18px; }
.td-brand { display: inline-flex; align-items: center; min-height: 44px; width: max-content; font-weight: 800; font-size: 1.1rem; }
h1 { margin: 0; font-size: clamp(1.8rem,5vw,2.6rem); line-height: 1.15; }
h1:focus { outline: 3px solid #a54f00; outline-offset: 3px; }
h2 { margin-top: 28px; }
h3 { margin-bottom: 8px; }
.td-roles,.td-tabs,.td-control-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.td-roles span { display: block; flex-basis: 100%; font-weight: 700; }
.td-roles a,.td-tabs button,.td-action,.td-toggle,.td-choice select { display: inline-flex; align-items: center; justify-content: center; min-height: 44px; padding: 9px 14px; border: 2px solid var(--teal,#24627a); border-radius: 10px; background: #fff; color: #153e53; font: inherit; font-weight: 700; text-decoration: none; cursor: pointer; }
.td-roles a[aria-current=page],.td-tabs button[aria-pressed=true],.td-action { color: #fff; background: #205e77; }
.td-page :is(a,button,select):focus-visible { outline: 3px solid #a54f00; outline-offset: 3px; }
.td-sample { font-weight: 800; border-left: 4px solid #205e77; padding-left: 12px; }
.td-missing { border-left: 4px solid #a54f00; padding: 12px; background: #fff5e8; }
.td-counts { display: grid; grid-template-columns: repeat(auto-fit,minmax(min(100%,220px),1fr)); gap: 12px; }
.td-counts p,.td-card { border: 1px solid var(--line,#bbb); border-radius: 12px; padding: 16px; margin: 0; }
.td-counts strong { display: block; font-size: 1.8rem; }
.td-attention,.td-queue,.td-words { list-style: none; padding: 0; }
.td-attention li,.td-words li,.td-queue li { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 4px 20px; padding: 10px 0; border-bottom: 1px solid var(--line,#ccc); }
.td-table-wrap { overflow-x: auto; margin: 16px 0; }
.td-support-content { display: grid; grid-template-columns: minmax(0, 1fr) minmax(250px, 320px); align-items: start; gap: 16px; }
.td-lock-summary { margin: 12px 0 0; }
.td-lock-summary strong { white-space: nowrap; }
.td-support-table { border-collapse: collapse; width: 100%; min-width: 660px; }
.td-support-table caption { text-align: left; font-weight: 700; margin-bottom: 8px; }
.td-support-table th,.td-support-table td { padding: 6px; border-bottom: 1px solid var(--line,#ccc); text-align: left; vertical-align: top; }
.td-support-table small,.td-locked { display: block; }
.td-locked { font-weight: 700; }
.td-mini-story { background: #fff; border: 1px solid var(--line,#ccc); border-radius: 8px; padding: 12px; max-width: 490px; font-size: 1.15rem; line-height: 1.6; }
.td-mini-story p { margin: 8px 0 0; }
.td-mini-story:not(.td-mini-sans) { font-family: Andika, Verdana, system-ui, sans-serif; }
.td-mini-story.td-mini-sans { font-family: 'Trebuchet MS', Verdana, system-ui, sans-serif; }
.td-mini-story.td-mini-spaced { line-height: 2.2; letter-spacing: .06em; word-spacing: .14em; }
.td-mini-story.td-mini-contrast { background: #111; color: #fff; border-color: #fff; }
.td-action { margin: 12px 0 0; }
.td-choice { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin: 18px 0; }
.td-choice label { font-weight: 700; }
.td-words p { margin: 5px 0 0; }
@media(max-width:500px) { .td-roles a { flex: 1 1 80px; } }
@media(max-width:900px) { .td-support-content { grid-template-columns: minmax(0, 1fr); } }
.td-scroll-hint { margin: 0 0 4px; font-size: .9rem; }
@media(min-width:800px) { .td-scroll-hint { display: none; } }
@media(max-width:500px) { .td-roles a:first-of-type { flex-basis: 110px; white-space: nowrap; } }
</style>
