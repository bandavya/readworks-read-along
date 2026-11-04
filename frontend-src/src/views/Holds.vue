<script setup>
// Grown-up panel for held narration takes. Only exists when the app is built with
// VITE_HOLDS_API. Not a kid screen.
//   #/holds                       clears the next hold: opens straight onto its next flag
//   #/holds/<id>/<generated|human> that take, flag by flag, then one sentence about where it stands and one button
//   #/holds/all                   the list (secondary)
// built for clearing speed. Tap the word to hear exactly that word; two plain answers;
// answering moves on. Nothing is approved unless a person pressed "Sounds right"; the server keeps the record.
import { ref, shallowRef, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { reviewer } from '../review'
import {
  holdsRequest, readSession, saveSession, clearSession, readPref, savePref, HoldsError, wordClip, sentenceFor, summarize, outcomeText,
  speedLine, makeStopwatch, nextTake, shortState, keyAction, paragraphsOf, flagsText, isScripted, makeAnswerGate, makeAnswerQueue,
  makeClipPlayer, changedMessage,
} from '../holdsApi'
import { flash, skipped } from '../holdsFlash'
import '../review.css'
import '../holds.css'

const props = defineProps({ id: String, voice: String, all: Boolean })

const session = ref(readSession())
const loginName = ref(reviewer.get() || '')
const loginCode = ref('')
const loginError = ref('')
const signingIn = ref(false)
const msg = ref('')
const announce = ref('')          // read out by a screen reader when a new flag arrives
const busy = ref(false)

const takes = shallowRef([])
const progress = ref(null)
const loadingList = ref(false)
const queueEmpty = ref(false)
const voiceFilter = ref('all')
const onlyUnanswered = ref(false)

const data = shallowRef(null)
const detailError = ref('')
const cur = ref(0)                 // 0..n-1 = a flag; n = where the take stands
const ready = ref(false)           // the outcome screen has the server's latest word
const history = ref([])            // answers made in this sitting, for Undo
const noteOpen = ref(false)
const noteText = ref('')
const force = ref('')              // '' | 'go' | 'new' | 'restore': the second tap on a choice that needs one
const restoreSha = ref('')
const slow = ref(false)
const autoplay = ref(readPref('autoplay', true))
const playing = ref('')            // '' | 'word' | 'sentence' | 'older'
const passageOpen = ref(false)
const fullEl = ref(null)

const scripted = isScripted()
const gate = makeAnswerGate()      // an answer needs a fresh press, and not within 0.3 s of a flag arriving

const signedIn = computed(() => !!session.value)
const mode = computed(() => (!session.value ? 'login' : props.all ? 'list' : props.id ? 'take' : 'queue'))
const flags = computed(() => data.value?.flags || [])
const n = computed(() => flags.value.length)
const atOutcome = computed(() => !!data.value && cur.value >= n.value)
const flag = computed(() => (data.value && cur.value < n.value ? flags.value[cur.value] : null))
const sum = computed(() => summarize(flags.value))
const sent = computed(() => (flag.value ? sentenceFor(data.value, flag.value) : null))
const shownTakes = computed(() => takes.value.filter((t) => (
  (voiceFilter.value === 'all' || t.voice === voiceFilter.value) && (!onlyUnanswered.value || t.unanswered > 0))))
const paragraphs = computed(() => (data.value ? paragraphsOf(data.value.text, data.value.paras) : []))
const flagAt = computed(() => {
  const map = {}
  flags.value.forEach((f, i) => { map[f.text_index] = i })
  return map
})
const noteCount = computed(() => (data.value ? data.value.advisory.length + (data.value.flags_note ? 1 : 0) : 0))
const blocked = computed(() => !!data.value && data.value.blockers.length > 0 && data.value.state !== 'stale')
const allRight = computed(() => sum.value.total > 0 && sum.value.right === sum.value.total)
const speed = computed(() => (data.value ? speedLine(data.value.speed) : ''))
const sentParts = computed(() => {
  const s = sent.value
  const f = flag.value
  if (!s) return []
  const out = []
  for (let j = 0; j < s.words.length; j++) {
    if (f.kind === 'extra' && j === s.mark) out.push({ t: 'extra', text: f.heard })
    if (f.kind !== 'extra' && j === s.mark) {
      out.push({ t: 'word', text: s.words.slice(j, j + s.span).join(' ') })
      j += s.span - 1
    } else out.push({ t: 'text', text: s.words[j] })
  }
  return out
})
const heardLine = computed(() => {
  const f = flag.value
  if (!f) return ''
  if (f.kind === 'missing') return 'A listener did not hear this word. The clip plays the moment where it should be.'
  if (f.kind === 'extra') return `A listener also heard "${f.heard}" here. Tap it to hear.`
  return `A listener heard: ${f.heard}`
})
const wordLabel = computed(() => {
  const f = flag.value
  if (!f) return ''
  return f.kind === 'missing' ? `Hear where the word "${f.written}" should be` : f.kind === 'extra' ? `Hear the extra word "${f.heard}"` : `Hear the word "${f.written}"`
})

// ---------- talking to the server ----------
async function call(path, opts = {}) {
  try {
    return await holdsRequest(path, { ...opts, token: session.value?.token })
  } catch (e) {
    if (e instanceof HoldsError && e.status === 401 && session.value) {
      clearSession()
      session.value = null
      loginError.value = 'Your sign-in ended. Please sign in again.'
    }
    throw e
  }
}
const sayError = (e) => (e instanceof HoldsError ? e.message : 'Something went wrong. Try again.')
const base = () => `/api/holds/${encodeURIComponent(data.value.id)}/${data.value.voice}`

async function signIn() {
  loginError.value = ''
  signingIn.value = true
  try {
    const r = await holdsRequest('/api/holds/login', { method: 'POST', body: { passcode: loginCode.value, name: loginName.value } })
    loginCode.value = ''
    session.value = { token: r.token, name: r.name, expiresAt: r.expiresAt }
    saveSession(session.value)
    reviewer.set(r.name)
    await refresh()
  } catch (e) {
    loginError.value = e instanceof HoldsError && e.status === 401 ? 'That passcode is not right.' : sayError(e)
  } finally { signingIn.value = false }
}
function signOut() {
  stopAudio()
  clearSession()
  session.value = null
  data.value = null
  takes.value = []
}

async function loadList() {
  loadingList.value = true
  try {
    const r = await call('/api/holds')
    takes.value = r.takes
    progress.value = r.progress
  } catch (e) { if (session.value) msg.value = sayError(e) } finally { loadingList.value = false }
}
async function openNext() {
  queueEmpty.value = false
  await loadList()
  const t = nextTake(takes.value, skipped)
  if (t) window.location.replace(`#/holds/${encodeURIComponent(t.id)}/${t.voice}`)
  else queueEmpty.value = true
}
async function loadDetail({ stay = false } = {}) {
  detailError.value = ''
  try {
    const r = await call(base0())
    data.value = r
    restoreSha.value = r.superseded[0]?.sha || ''
    force.value = ''
    if (stay) cur.value = r.flags.length
    else {
      const first = r.flags.findIndex((f) => !f.answer)
      history.value = []
      go(first < 0 ? r.flags.length : first)
    }
    document.title = `Held takes · ${r.title} · Sound Along prototype`
    return true
  } catch (e) { if (session.value) detailError.value = sayError(e); return false }
}
const base0 = () => `/api/holds/${encodeURIComponent(props.id)}/${props.voice}`
async function refresh() {
  if (!session.value) return
  if (mode.value === 'list') await loadList()
  else if (mode.value === 'queue') await openNext()
  else await loadDetail()
}

// ---------- one audio, one clip at a time ----------
const audio = new Audio()
audio.preload = 'auto'
const userTapped = ref(false)
const player = makeClipPlayer(audio, { onState: (v) => { playing.value = v }, rate: () => (slow.value ? 0.7 : 1) })
const stopAudio = () => player.stop()
function playRange(url, from, to, which) {
  fullEl.value?.pause()
  player.play(url, from, to, which)
}
function hearWord() {
  const f = flag.value
  if (!f) return
  const c = wordClip(f, data.value.duration)
  playRange(data.value.audio_url, c.from, c.to, 'word')
}
function hearFlag(f) {                // any flagged word, without leaving the screen it is named on
  const c = wordClip(f, data.value.duration)
  playRange(data.value.audio_url, c.from, c.to, 'word')
}
function hearSentence() {
  if (!sent.value) return
  playRange(data.value.audio_url, sent.value.from, sent.value.to, 'sentence')
}
function hearOlder() {
  const f = flag.value
  const cmp = data.value?.compare
  if (!f || !cmp?.available || f.compare_start == null) return
  // the older take's OWN row for this word (the server only sends it when the word maps exactly)
  const c = wordClip({ kind: 'swap', start: f.compare_start, end: f.compare_end }, cmp.duration)
  playRange(cmp.audio_url, c.from, c.to, 'older')
}
function toggleSlow() {
  slow.value = !slow.value
  audio.playbackRate = slow.value ? 0.7 : 1
}
watch(autoplay, (v) => savePref('autoplay', v))

// ---------- clearing the flags ----------
const sw = makeStopwatch()
let arrival = 0
function arrive() {
  sw.start()
  gate.arrive()
  noteOpen.value = false
  noteText.value = ''
  if (flag.value) announce.value = `Flag ${cur.value + 1} of ${n.value}. ${flag.value.written ? `Written: ${flag.value.written}. ` : ''}${heardLine.value}`
  if (flag.value && autoplay.value && (userTapped.value || navigator.userActivation?.hasBeenActive)) hearWord()
}
// Moving to a flag (or to the outcome) always goes through here: a flag starts its clock and may auto-play; the outcome saves first.
function go(i) {
  player.stop()                       // a clip still loading for the flag we are leaving must never start under the new one
  cur.value = i
  const mine = ++arrival
  nextTick(() => {
    if (mine !== arrival) return
    if (flag.value) arrive()
    else if (data.value) { stopAudio(); settleAndRefresh() }
  })
}

function setAnswer(idx, ans) {
  data.value = { ...data.value, flags: flags.value.map((f, i) => (i === idx ? { ...f, answer: ans } : f)) }
}
// Each answer carries the take's fingerprint and address as they were WHEN IT WAS MADE.
const queue = makeAnswerQueue(
  (job) => call(job.url, { method: 'POST', body: job.body }),
  {
    // the server says the take changed: everything still waiting was dropped; say how many answers were lost and show the take as it is now
    async changed(count) {
      history.value = []
      await loadDetail()
      msg.value = changedMessage(count)
    },
    async failed(job, e) {
      msg.value = sayError(e)
      setAnswer(job.idx, job.prev)
      go(job.idx)
    },
  },
)
function queueSend(idx, f, answer, note, seconds, prev) {
  const body = { fingerprint: data.value.fingerprint, flag: f.key, answer, note }
  if (seconds !== undefined) body.seconds = seconds
  if (scripted) body.scripted = true
  return queue.add({ idx, prev, url: `${base()}/answers`, body })
}
function answer(ans) {
  const f = flag.value
  if (!f) return
  const seconds = sw.seconds()
  const idx = cur.value
  const prev = f.answer
  const note = noteText.value.trim()
  stopAudio()
  msg.value = ''
  setAnswer(idx, { answer: ans, by: session.value.name, note })
  history.value.push({ idx, prev })
  queueSend(idx, f, ans, note, seconds, prev)
  const open = flags.value.findIndex((x, i) => i > idx && !x.answer)      // the next flag still waiting, else where the take stands
  go(open < 0 ? n.value : open)
}
function onAnswerClick(ans) {         // a button answers only on a fresh press (pointer, or a new key press), never a held or repeated one
  if (gate.click()) answer(ans)
}
function undo() {
  const last = history.value.pop()
  if (!last) return
  stopAudio()
  const f = flags.value[last.idx]
  setAnswer(last.idx, last.prev)
  force.value = ''
  ready.value = false
  go(last.idx)
  queueSend(last.idx, f, last.prev ? last.prev.answer : 'clear', last.prev?.note || '', undefined, f.answer)
}
function step(dir) {
  stopAudio()
  go(Math.min(n.value, Math.max(0, cur.value + dir)))
}
async function settleAndRefresh() {
  ready.value = false
  await queue.idle()
  if (!data.value || cur.value < n.value) return
  await loadDetail({ stay: true })
  ready.value = true
}

// ---------- the decision ----------
async function decide(confirm) {
  if (busy.value) return
  busy.value = true
  try {
    const kind = data.value.plan.kind === 'clear_hold' ? 'clear' : 'publish'
    await call(`${base()}/${kind}`, { method: 'POST', body: { fingerprint: data.value.decision_fingerprint, confirm_not_approved: confirm } })
    flash.value = kind === 'publish' ? 'Published.' : 'Hold taken off.'
    window.location.hash = '#/holds'
  } catch (e) { msg.value = sayError(e); if (e.status === 409 && e.data.changed) await loadDetail({ stay: true }) } finally { busy.value = false }
}
async function newTake() {
  if (busy.value) return
  busy.value = true
  try {
    await call(`/api/holds/${encodeURIComponent(data.value.id)}/generated/new-take`, { method: 'POST', body: { confirm_cost: true } })
    skipped.add(`${data.value.id}.${data.value.voice}`)
    flash.value = 'New take asked for. It comes back here in about 3 minutes.'
    window.location.hash = '#/holds'
  } catch (e) { msg.value = sayError(e) } finally { busy.value = false }
}
async function restore() {
  if (busy.value) return
  busy.value = true
  try {
    await call(`${base()}/restore`, { method: 'POST', body: { fingerprint: data.value.decision_fingerprint, superseded_sha: restoreSha.value, confirm_restore: true } })
    skipped.add(`${data.value.id}.${data.value.voice}`)
    flash.value = 'Older take put back.'
    window.location.hash = '#/holds'
  } catch (e) { msg.value = sayError(e); if (e.status === 409 && e.data.changed) await loadDetail({ stay: true }) } finally { busy.value = false }
}
function leave() {
  skipped.add(`${data.value.id}.${data.value.voice}`)
  window.location.hash = '#/holds'
}

function onKey(e) {
  if (mode.value !== 'take' || !data.value) return
  const a = keyAction(e)
  if (!a) return
  if (a === 'next' || a === 'prev') { e.preventDefault(); return step(a === 'next' ? 1 : -1) }
  if (a === 'undo') { e.preventDefault(); return undo() }
  if (!flag.value) return
  e.preventDefault()
  if (a === 'right' || a === 'wrong') { if (gate.keyDown(e)) answer(a) }      // not a held key, not before the last answer's key was released
  else if (a === 'word') hearWord()
  else if (a === 'sentence') hearSentence()
}
function onTap() { userTapped.value = true }
function onKeyUp(e) { gate.keyUp(e) }
function onBlur() { gate.reset() }
function onVisibility() { if (document.hidden) sw.pause(); else sw.resume() }

const when = (iso) => (iso ? new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '')
const rightLabel = computed(() => (data.value?.plan.kind === 'clear_hold' ? 'Clear the hold' : 'Publish this take'))

watch(() => [props.id, props.voice, props.all], () => { stopAudio(); msg.value = ''; refresh() })
onMounted(() => {
  document.title = 'Held takes · Sound Along prototype'
  window.addEventListener('keydown', onKey)
  window.addEventListener('keyup', onKeyUp)
  window.addEventListener('blur', onBlur)
  window.addEventListener('pointerdown', onTap, { passive: true })
  document.addEventListener('visibilitychange', onVisibility)
  if (mode.value !== 'queue') {            // the queue only passes through: the screen it opens shows the message
    msg.value = flash.value
    flash.value = ''
  }
  if (session.value) refresh()
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('keyup', onKeyUp)
  window.removeEventListener('blur', onBlur)
  window.removeEventListener('pointerdown', onTap)
  document.removeEventListener('visibilitychange', onVisibility)
  player.stop()
  audio.removeAttribute('src')
})
</script>

<template>
  <main class="hc" aria-label="Held takes">
    <p class="hc-msg" role="status" aria-live="polite">{{ msg }}</p>
    <p class="hc-sr" aria-live="polite">{{ announce }}</p>

    <!-- sign in -->
    <section v-if="mode === 'login'" class="hc-login">
      <h1>Held takes</h1>
      <form @submit.prevent="signIn">
        <label>Your name <input v-model="loginName" type="text" autocomplete="name" maxlength="40" required /></label>
        <label>Team passcode <input v-model="loginCode" type="password" autocomplete="off" required /></label>
        <button type="submit" class="hc-btn hc-primary" :disabled="signingIn">{{ signingIn ? 'Checking…' : 'Sign in' }}</button>
        <p v-if="loginError" class="hc-error" role="alert">{{ loginError }}</p>
      </form>
    </section>

    <!-- the next hold is being found -->
    <section v-else-if="mode === 'queue'" class="hc-center">
      <p v-if="!queueEmpty">Finding the next hold…</p>
      <template v-else>
        <p>Nothing waiting.</p>
        <p><a href="#/holds/all">All holds</a></p>
      </template>
    </section>

    <!-- the list: secondary -->
    <template v-else-if="mode === 'list'">
      <header class="hc-top">
        <a href="#/holds" class="hc-link">Clear holds</a>
        <span class="hc-muted"><template v-if="progress">{{ progress.flags - progress.answered }} flags waiting · </template>{{ session.name }}</span>
        <button type="button" class="hc-link" @click="signOut">Sign out</button>
      </header>
      <div class="hc-filters" role="group" aria-label="Show">
        <button v-for="v in [['all', 'All'], ['generated', 'Generated'], ['human', 'Recordings']]" :key="v[0]" type="button" class="hc-chip" :aria-pressed="voiceFilter === v[0]" @click="voiceFilter = v[0]">{{ v[1] }}</button>
        <button type="button" class="hc-chip" :aria-pressed="onlyUnanswered" @click="onlyUnanswered = !onlyUnanswered">Flags to answer</button>
      </div>
      <p v-if="loadingList" class="hc-muted">Loading…</p>
      <ul v-else-if="shownTakes.length" class="hc-rows">
        <li v-for="t in shownTakes" :key="t.id + t.voice">
          <a :href="`#/holds/${t.id}/${t.voice}`" class="hc-row">
            <span class="hc-row-title">{{ t.title }}</span>
            <span class="hc-muted">{{ t.voice === 'human' ? 'Recording' : 'Generated' }} · {{ flagsText(t.flags_total) }} · {{ shortState(t.state) }}<template v-if="t.blocked"> · needs a new take</template></span>
          </a>
        </li>
      </ul>
      <p v-else class="hc-muted">Nothing matches.</p>
    </template>

    <!-- one take -->
    <template v-else>
      <p v-if="detailError" class="hc-error" role="alert">{{ detailError }} <a href="#/holds/all">All holds</a></p>
      <p v-else-if="!data" class="hc-muted">Loading…</p>
      <template v-else>
        <header class="hc-top">
          <a href="#/holds/all" class="hc-link">All holds</a>
          <label class="hc-auto"><input v-model="autoplay" type="checkbox" /> Auto-play</label>
        </header>
        <p class="hc-title">{{ data.title }}
          <span class="hc-muted">· {{ data.voice === 'human' ? 'Recording' : 'Generated' }}<template v-if="data.state === 'live_unanswered' || data.state === 'live_answered'"> · live now</template></span></p>

        <!-- a flag -->
        <section v-if="flag" class="hc-flag" :aria-label="`Flag ${cur + 1} of ${n}`">
          <div class="hc-prog">
            <button type="button" class="hc-nav" :disabled="cur === 0" aria-label="Previous flag" @click="step(-1)">&lsaquo;</button>
            <span>{{ cur + 1 }} of {{ n }}</span>
            <button type="button" class="hc-nav" aria-label="Next flag" @click="step(1)">&rsaquo;</button>
          </div>

          <p class="hc-sentence" @click="hearSentence">
            <template v-for="(p, j) in sentParts" :key="j">
              <button v-if="p.t === 'word'" type="button" class="hc-word" :class="{ on: playing === 'word' }" :aria-label="wordLabel" @click.stop="hearWord">{{ p.text }}</button>
              <button v-else-if="p.t === 'extra'" type="button" class="hc-word hc-extra" :class="{ on: playing === 'word' }" :aria-label="wordLabel" @click.stop="hearWord">+ {{ p.text }}</button>
              <span v-else>{{ p.text }}</span>{{ ' ' }}
            </template>
          </p>
          <p class="hc-heard">{{ heardLine }}</p>
          <p class="hc-hint">Tap the word to hear it.</p>

          <div class="hc-tools">
            <button type="button" class="hc-link" :class="{ on: playing === 'sentence' }" aria-label="Hear the sentence" @click="hearSentence">Sentence</button>
            <button type="button" class="hc-link" :aria-pressed="slow" @click="toggleSlow">Slower</button>
            <button v-if="data.compare?.available && flag.compare_start != null" type="button" class="hc-link" :class="{ on: playing === 'older' }" @click="hearOlder">Older take</button>
            <button v-if="history.length" type="button" class="hc-link" @click="undo">Undo</button>
            <button type="button" class="hc-link" :aria-expanded="noteOpen" @click="noteOpen = !noteOpen">Add a note</button>
          </div>
          <textarea v-if="noteOpen" v-model="noteText" class="hc-note" rows="2" maxlength="500" aria-label="Note about this flag (optional)" placeholder="Note (optional)"></textarea>

          <div class="hc-bar">
            <button type="button" class="hc-ans hc-wrong" :aria-pressed="flag.answer?.answer === 'wrong'" aria-keyshortcuts="n" title="Shortcut: N" @pointerdown="gate.pressed($event)" @keydown="gate.pressed($event)" @click="onAnswerClick('wrong')">Sounds wrong</button>
            <button type="button" class="hc-ans hc-right" :aria-pressed="flag.answer?.answer === 'right'" aria-keyshortcuts="y" title="Shortcut: Y" @pointerdown="gate.pressed($event)" @keydown="gate.pressed($event)" @click="onAnswerClick('right')">Sounds right</button>
          </div>
          <p class="hc-keys">Keys: Y right · N wrong · Space word · S sentence · U undo · arrows move</p>
        </section>

        <!-- where the take stands -->
        <section v-else class="hc-out" aria-live="polite">
          <p v-if="!ready" class="hc-muted">Saving…</p>
          <template v-else>
            <template v-if="data.state === 'stale'">
              <p class="hc-big">This hold is left over. What is live needs nothing from it.</p>
              <button type="button" class="hc-btn hc-primary" :disabled="busy" @click="decide(false)">Remove it</button>
            </template>
            <template v-else>
              <p class="hc-big">{{ outcomeText(sum) }}</p>
              <p v-if="speed" class="hc-muted">{{ speed }}</p>
              <p v-else-if="data.speed.scripted" class="hc-muted">Scripted run: its time is not counted.</p>
              <p v-if="blocked" class="hc-line">{{ data.blockers[0] }}</p>

              <button v-if="allRight && !blocked" type="button" class="hc-btn hc-primary" :disabled="busy" @click="decide(false)">{{ rightLabel }}</button>
              <button v-else-if="sum.unanswered && !blocked" type="button" class="hc-btn hc-primary" @click="go(flags.findIndex((f) => !f.answer))">Answer the rest</button>

              <div v-if="!allRight || blocked" class="hc-choices">
                <template v-if="data.can.new_take">
                  <button v-if="force !== 'new'" type="button" class="hc-btn" @click="force = 'new'">Ask for a new take…</button>
                  <div v-else class="hc-confirm"><p>{{ data.new_take_rule }} It costs {{ data.new_take_cost }}, about 3 minutes.</p>
                    <button type="button" class="hc-btn hc-primary" :disabled="busy" @click="newTake">Ask for a new take</button>
                    <button type="button" class="hc-link" @click="force = ''">Cancel</button></div>
                </template>
                <template v-if="data.can.restore">
                  <button v-if="force !== 'restore'" type="button" class="hc-btn" @click="force = 'restore'">Put back the older take…</button>
                  <div v-else class="hc-confirm"><p>This replaces what kids hear with the older take. Nobody has listened to it either.</p>
                    <select v-if="data.superseded.length > 1" v-model="restoreSha" aria-label="Which older take"><option v-for="s in data.superseded" :key="s.sha" :value="s.sha">Made {{ when(s.generated_at) }}</option></select>
                    <button type="button" class="hc-btn hc-primary" :disabled="busy || !restoreSha" @click="restore">Put back the older take</button>
                    <button type="button" class="hc-link" @click="force = ''">Cancel</button></div>
                </template>
                <template v-if="!blocked && !allRight">
                  <button v-if="force !== 'go'" type="button" class="hc-link" @click="force = 'go'">{{ data.plan.kind === 'clear_hold' ? 'Clear the hold anyway…' : 'Publish anyway…' }}</button>
                  <div v-else class="hc-confirm"><p>The record will say: {{ data.plan.statement }}.</p>
                    <p class="hc-muted">Not approved (tap a word to hear it):</p>
                    <ul class="hc-notok"><li v-for="f in flags.filter((x) => x.answer?.answer !== 'right')" :key="f.key">
                      <button type="button" class="hc-link" :aria-label="`Hear ${f.written || f.heard}`" @click="hearFlag(f)">{{ f.written || f.heard }}</button>
                      <span class="hc-muted">{{ f.answer ? `sounds wrong (${f.answer.by})` : 'not answered' }}</span></li></ul>
                    <button type="button" class="hc-btn hc-primary" :disabled="busy" @click="decide(true)">{{ data.plan.button }}</button>
                    <button type="button" class="hc-link" @click="force = ''">Cancel</button></div>
                </template>
              </div>
            </template>
            <p class="hc-sub"><button v-if="history.length" type="button" class="hc-link" @click="undo">Undo</button>
              <button type="button" class="hc-link" @click="leave">Leave it for now</button></p>
          </template>
        </section>

        <!-- tucked away -->
        <details v-if="noteCount || data.reasons.length" class="hc-more">
          <summary>{{ noteCount ? `${noteCount} note${noteCount === 1 ? '' : 's'}` : 'Why it was held' }}</summary>
          <p v-if="data.reasons.length" class="hc-muted">Why the check held it: {{ data.reasons.join('; ') }}</p>
          <p v-if="data.flags_note" class="hc-muted">{{ data.flags_note }}</p>
          <ul v-if="data.advisory.length"><li v-for="(a, i) in data.advisory" :key="i">{{ a.kind }}: {{ a.text }}</li></ul>
        </details>
        <details class="hc-more" @toggle="passageOpen = $event.target.open">
          <summary>Whole passage</summary>
          <template v-if="passageOpen">
            <audio ref="fullEl" class="hc-full" controls preload="none" :src="data.audio_url" @play="stopAudio"></audio>
            <p v-for="(p, pi) in paragraphs" :key="pi" class="hc-para">
              <template v-for="(w, wi) in p.words" :key="wi">
                <button v-if="flagAt[p.start + wi] !== undefined" type="button" class="hc-pw" :aria-label="`${w}, flag ${flagAt[p.start + wi] + 1}`" @click="go(flagAt[p.start + wi])">{{ w }}</button>
                <span v-else>{{ w }}</span>{{ ' ' }}
              </template>
            </p>
          </template>
        </details>
      </template>
    </template>
  </main>
</template>
