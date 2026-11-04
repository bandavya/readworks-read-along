<script setup>
// Grown-up review screen for word help (#/review/<passage id>).
// Every definition and syllable guide we generated shows here with its spoken clip. A person reads/listens, then picks
// "Approve" or "Needs a fix" (+ a note). Choices are saved in this browser and can be exported as JSON; a script
// (prototype/tools/apply_reviews.py) writes the approvals back into the data files. Not a kid screen: plain text, no hold.
import { ref, shallowRef, computed, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { loadPassage, assetUrl } from '../api'
import { PUBLIC_SAMPLE } from '../mode'
import { apiBase, sendReviews } from '../apiClient'
import { holdsBase } from '../holdsApi'
import { loadKidAudio, loadGloss, loadSyllables } from '../kidAudio'
import { claimGuide, releaseGuide } from '../guideBus'
import SyllableGuide from '../components/SyllableGuide.vue'
import { itemsForPassage, reviewOf, setReview, clearReview, tally, buildExport, reviewer, STATE_TEXT, verifyAudio, needsAudioVerification, nextReviewKey, saveReviewNote } from '../review'
import '../review.css'

const props = defineProps({ id: String })

const data = shallowRef(null)
const items = shallowRef([])
const syl = shallowRef(null)
const error = ref('')
const filter = ref('todo') // todo | fix | done | all
const limit = ref(30)
const who = ref(reviewer.get())
const exportText = ref('')
const status = ref('')
const playErr = ref('')
const notes = ref({}) // key -> text being typed

const counts = computed(() => tally(items.value))
const shown = computed(() => {
  const f = filter.value
  return items.value.filter((it) => {
    const s = reviewOf(it).state
    return f === 'all' || (f === 'todo' && s === 'draft') || (f === 'fix' && s === 'fix') || (f === 'done' && (s === 'approved' || s === 'checked'))
  })
})
const page = computed(() => shown.value.slice(0, limit.value))

// A few words around the word, so a reviewer can judge the meaning in this sentence.
const words = []
function context(it) {
  if (it.kind !== 'gloss' || !words.length) return null
  const i = it.indices?.[0]
  if (i === undefined || !words[i]) return null
  return { before: words.slice(Math.max(0, i - 7), i).join(' '), word: words[i], after: words.slice(i + 1, i + 8).join(' ') }
}

// ---------- one clip at a time ----------
const clip = new Audio()
const playing = ref('') // item key + clip path
function stopClip() {
  clip.pause()
  playing.value = ''
}
clip.addEventListener('ended', () => { playing.value = '' })
clip.addEventListener('error', () => {
  if (clip.getAttribute('src')) { playing.value = ''; playErr.value = 'That clip would not play.' }
})
function playClip(it, path) {
  const k = it.key + '|' + path
  playErr.value = ''
  if (playing.value === k) return stopClip()
  claimGuide(stopClip)
  clip.src = assetUrl(path)
  playing.value = k
  const p = clip.play()
  if (p && p.catch) p.catch(() => { playing.value = ''; playErr.value = 'That clip would not play.' })
}

// ---------- decisions ----------
async function focusNext(before) {
  await nextTick()
  const targetKey = nextReviewKey(before, page.value)
  if (targetKey) {
    const row = [...document.querySelectorAll('.rv-item')].find((el) => el.dataset.key === targetKey)
    row?.querySelector('.rv-actions button')?.focus()
  } else document.querySelector('.rv-tabs button[aria-pressed="true"]')?.focus()
}
async function approve(it) {
  const before = shown.value.findIndex((row) => row.key === it.key)
  try {
    await verifyAudio(it)
    setReview(it, 'approved', notes.value[it.key] ?? reviewOf(it).note)
    status.value = `Approved "${it.word}".`
    await focusNext(before)
  } catch {
    status.value = `Could not check the recording for "${it.word}". Approval was not saved.`
  }
}
async function needsFix(it) {
  const before = shown.value.findIndex((row) => row.key === it.key)
  setReview(it, 'fix', notes.value[it.key] ?? reviewOf(it).note)
  status.value = `Marked "${it.word}" as needing a fix.`
  await focusNext(before)
}
function undo(it) {
  clearReview(it)
  delete notes.value[it.key]
  status.value = `Cleared your choice for "${it.word}".`
}
function noteFor(it) {
  return notes.value[it.key] ?? reviewOf(it).note
}
async function saveNote(it) {
  if (reviewOf(it).state === 'draft' && !needsAudioVerification(it)) return // kept until a choice is made
  const saved = await saveReviewNote(it, notes.value[it.key] ?? reviewOf(it).note)
  if (!saved && reviewOf(it).state !== 'fix') status.value = `Could not check the recording for "${it.word}". Your note remains in the box.`
}
function saveName() {
  reviewer.set(who.value)
}

// ---------- export ----------
function makeExport() {
  saveName()
  exportText.value = JSON.stringify(buildExport(items.value), null, 2)
  return exportText.value
}
function download() {
  const text = makeExport()
  const blob = new Blob([text], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `word-help-review-${props.id.slice(0, 8)}-${new Date().toISOString().slice(0, 10)}.json`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 4000)
  status.value = 'Saved a JSON file. It holds every choice made in this browser, for all passages.'
}
async function sendToServer() {
  saveName()
  const exported = buildExport(items.value)
  if (!exported.decisions.length) { status.value = 'No choices to send yet.'; return }
  try {
    const r = await sendReviews(exported)
    status.value = `Sent ${r.stored} choice${r.stored === 1 ? '' : 's'} to the shared lab server${r.skippedOlder ? ` (${r.skippedOlder} skipped: the server already had newer ones)` : ''}. They are received, not approved: nothing changes in the data files until a person checks each word here and saves their own file.`
  } catch { status.value = 'Could not reach the shared server. Your choices are still saved in this browser.' }
}
async function copy() {
  const text = makeExport()
  try {
    await navigator.clipboard.writeText(text)
    status.value = 'Copied the JSON.'
  } catch {
    status.value = 'Could not copy automatically. Select the text below and copy it.'
  }
}

const kindLabel = { gloss: 'Kid-level meaning', syllables: 'Word parts (syllables)', vocab: PUBLIC_SAMPLE ? 'Sample vocabulary meaning' : 'Spoken meaning (ReadWorks definition)' }
const stateLabel = (s) => ({ draft: 'Not checked yet', fix: 'Needs a fix', checked: 'Approved (this device)', approved: 'Approved' })[s]

onMounted(async () => {
  document.title = 'Check word help · Sound Along prototype'
  try {
    const [d, g, k, s] = await Promise.all([loadPassage(props.id), loadGloss(props.id), loadKidAudio(), loadSyllables(props.id)])
    data.value = d
    syl.value = s
    const doc = new DOMParser().parseFromString(d.html || '', 'text/html')
    doc.querySelectorAll('[data-i]').forEach((el) => { words[Number(el.dataset.i)] = el.textContent.trim() })
    items.value = itemsForPassage(props.id, { gloss: g, syllables: s, kid: k, data: d })
    for (const item of items.value) if (needsAudioVerification(item)) verifyAudio(item).catch(() => {})
  } catch (e) {
    error.value = 'Could not load this passage.'
  }
})
onBeforeUnmount(() => {
  releaseGuide(stopClip)
  clip.pause()
  clip.removeAttribute('src')
})
</script>

<template>
  <main class="rv" aria-labelledby="rv-title">
    <a class="rv-back" :href="`#/p/${id}`">&larr; Back to the passage</a>
    <a v-if="holdsBase" class="rv-back" href="#/holds">&nbsp;&middot;&nbsp;Held narration takes (team passcode)</a>
    <p v-if="error" class="muted" role="alert">{{ error }}</p>
    <template v-else-if="data">
      <h1 id="rv-title">Check word help: {{ data.title }}</h1>
      <p class="rv-lede">
        For grown-ups. The meanings, word parts and voice clips below were made by a computer. Read or listen, then choose
        <strong>Approve</strong> or <strong>Needs a fix</strong>. Your choices are saved in this browser only. Use
        <strong>Save as JSON</strong> to hand them to whoever updates the data files.
      </p>

      <div class="rv-bar">
        <ul class="rv-tally" aria-label="Progress">
          <li><b>{{ counts.approved }}</b> checked</li>
          <li><b>{{ counts.fix }}</b> need a fix</li>
          <li><b>{{ counts.draft }}</b> still to check</li>
          <li>of <b>{{ counts.total }}</b></li>
        </ul>
        <label>Your name or initials (saved on this device)
          <input v-model="who" type="text" autocomplete="off" @change="saveName" />
        </label>
      </div>

      <div class="rv-tabs" role="group" aria-label="Show">
        <button type="button" class="rv-btn" :aria-pressed="filter === 'todo'" @click="filter = 'todo'; limit = 30">Still to check</button>
        <button type="button" class="rv-btn" :aria-pressed="filter === 'fix'" @click="filter = 'fix'; limit = 30">Needs a fix</button>
        <button type="button" class="rv-btn" :aria-pressed="filter === 'done'" @click="filter = 'done'; limit = 30">Checked</button>
        <button type="button" class="rv-btn" :aria-pressed="filter === 'all'" @click="filter = 'all'; limit = 30">All</button>
      </div>

      <p class="rv-status" role="status" aria-live="polite">{{ status || playErr }}</p>

      <ol v-if="page.length" class="rv-list">
        <li v-for="it in page" :key="it.key" class="rv-item" :class="'s-' + reviewOf(it).state" :data-key="it.key">
          <div class="rv-head">
            <h2 class="rv-word">{{ it.word }}</h2>
            <span class="rv-kind">{{ kindLabel[it.kind] }}<template v-if="it.pos"> · {{ it.pos }}</template></span>
            <span class="rv-state" :data-state="reviewOf(it).state">{{ stateLabel(reviewOf(it).state) }}</span>
          </div>

          <template v-if="it.kind === 'syllables'">
            <SyllableGuide :entry="syl[it.sid]" :pid="id" :sid="it.sid" />
            <p v-if="syl[it.sid].uncertainty" class="rv-ctx">Maker's note: {{ syl[it.sid].uncertainty }}</p>
          </template>
          <template v-else>
            <p class="rv-text">{{ it.text }}</p>
            <p v-if="context(it)" class="rv-ctx">In the story: &hellip;{{ context(it).before }} <mark>{{ context(it).word }}</mark> {{ context(it).after }}&hellip;</p>
            <button
              v-if="it.clips.length"
              type="button"
              class="rv-btn rv-play"
              :class="{ on: playing === it.key + '|' + it.clips[0] }"
              :aria-pressed="playing === it.key + '|' + it.clips[0]"
              :aria-label="`Play the spoken clip for ${it.word}`"
              @click="playClip(it, it.clips[0])"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M4 9v6h4l5 4V5L8 9H4zm12.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4zM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z" /></svg>
              <span>Play clip</span>
            </button>
            <p v-else class="rv-noclip">No spoken clip for this meaning yet.</p>
          </template>

          <p v-if="reviewOf(it).changed" class="rv-changed">This was edited after someone chose, so the old choice no longer counts. Please look again.</p>

          <div class="rv-actions">
            <button type="button" class="rv-btn" :aria-pressed="reviewOf(it).state === 'approved' || reviewOf(it).state === 'checked'" @click="approve(it)">Approve</button>
            <button type="button" class="rv-btn" :aria-pressed="reviewOf(it).state === 'fix'" @click="needsFix(it)">Needs a fix</button>
            <textarea
              class="rv-note-in"
              rows="2"
              :aria-label="`Note about ${it.word} (optional)`"
              placeholder="Note (optional): what should change?"
              :value="noteFor(it)"
              @input="notes[it.key] = $event.target.value"
              @change="saveNote(it)"
            ></textarea>
            <button v-if="reviewOf(it).state === 'fix' || reviewOf(it).state === 'checked'" type="button" class="rv-btn" @click="undo(it)">Undo</button>
          </div>
        </li>
      </ol>
      <p v-else class="rv-lede">Nothing here{{ filter === 'todo' ? ': every item has a choice.' : '.' }}</p>
      <button v-if="shown.length > limit" type="button" class="rv-btn" @click="limit += 30">Show {{ Math.min(30, shown.length - limit) }} more ({{ shown.length - limit }} left)</button>

      <section class="rv-export" aria-labelledby="rv-ex-h">
        <h2 id="rv-ex-h">Save your choices</h2>
        <div class="rv-actions">
          <button type="button" class="rv-btn" @click="download">Save as JSON</button>
          <button type="button" class="rv-btn" @click="copy">Copy JSON</button>
          <button v-if="apiBase" type="button" class="rv-btn" @click="sendToServer">Send to shared server</button>
          <button type="button" class="rv-btn" @click="makeExport">Show JSON</button>
        </div>
        <textarea v-if="exportText" readonly aria-label="Exported JSON" :value="exportText"></textarea>
        <p class="rv-lede">{{ STATE_TEXT.checked }} Approvals only change what this browser shows. They reach the data files when someone runs <code>apply_reviews.py</code> on the saved file.</p>
      </section>
    </template>
    <p v-else class="muted">Loading&hellip;</p>
  </main>
</template>
