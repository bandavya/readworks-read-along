<script setup>
// Kid view. Owns: loading, the three screens
// (start / reading / words to know), the one spoken-clip player, the grown-ups settings, and the screen scale.
import { ref, reactive, shallowRef, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { loadPassage, store } from '../api'
import { loadKidAudio, loadGloss, loadSyllables, ClipVoice } from '../kidAudio'
import { syllableItem, vocabItem } from '../review'
import KidStart from '../components/KidStart.vue'
import KidReader from '../components/KidReader.vue'
import KidWords from '../components/KidWords.vue'
import KidGrownups from '../components/KidGrownups.vue'
import '../kid.css'
import { linkSettings, setTeacherReturnLink } from '../linkSettings'
import { record } from '../usage'
import { PUBLIC_SAMPLE } from '../mode'

const props = defineProps({ id: String })
const assigned = reactive(linkSettings())
const autoWords = ref(assigned.demo ? assigned.vocabAutoShow : false)
try { if (!assigned.demo) autoWords.value = globalThis.localStorage?.getItem('soundAlong.autoWordCards.v1') === 'true' } catch { /* storage unavailable */ }
watch(autoWords, (on) => { try { if (!assigned.demo) globalThis.localStorage?.setItem('soundAlong.autoWordCards.v1', String(on)) } catch { /* storage unavailable */ } })

const data = shallowRef(null)
const gloss = shallowRef(null)
const kid = shallowRef(null)
const syllables = shallowRef(null)
const error = ref('')
const screen = ref('start') // 'start' | 'read' | 'words'
const mode = ref(PUBLIC_SAMPLE ? 'self' : 'listen') // 'listen' (Read to me) | 'self' (Read on my own)
const readKey = ref(0)
const reader = ref(null)
const viewEl = ref(null)
const needsTap = ref(false)

// Grown-ups settings, remembered with the app's store (own keys: the teacher view's saved choices are untouched).
const settings = reactive({
  voice: assigned.voice || store.get('kid-voice', 'human'),
  rate: store.get('kid-rate', 1),
  size: assigned.demo ? assigned.size : store.get('kid-size', 'M'),
  font: assigned.demo ? assigned.font : store.get('kid-reading-font', 'andika'),
  spacing: assigned.demo ? assigned.spacing : store.get('reading-spacing', false),
  tint: assigned.demo ? assigned.contrast : store.get('reading-tint', false),
  lineGuide: store.get('kid-line-guide', false),
})
settings.rate = Math.min(1.25, Math.max(0.75, Number(settings.rate) || 1))
if (!['S', 'M', 'L', 'XL', 'XXL'].includes(settings.size)) settings.size = 'M'
if (!['andika', 'sans'].includes(settings.font)) settings.font = 'andika'
settings.spacing = settings.spacing === true
settings.tint = settings.tint === true
settings.lineGuide = settings.lineGuide === true
watch(() => settings.voice, (v) => { if (assigned.demo) window.dispatchEvent(new CustomEvent('teacherDemo:choice', { detail: { studentId: assigned.student, key: 'voice', value: v } })); else if (!assigned.fromTeacher) store.set('kid-voice', v) })
watch(() => settings.rate, (v) => store.set('kid-rate', v))
watch(() => settings.size, (v) => { if (!assigned.demo) store.set('kid-size', v) })
watch(() => settings.font, (v) => { if (!assigned.demo) store.set('kid-reading-font', v) })
watch(() => settings.spacing, (v) => { if (!assigned.demo) store.set('reading-spacing', v) })
watch(() => settings.tint, (v) => { if (!assigned.demo) store.set('reading-tint', v) })
watch(() => settings.lineGuide, (v) => store.set('kid-line-guide', v))
const sizeMul = computed(() => ({ S: 0.88, M: 1, L: 1.2, XL: 1.4, XXL: 1.6 })[settings.size] || 1)

// One visit = one mount of this view. At most ONE help hint is spoken per visit (visit.hinted).
const visit = reactive({ said: {}, played: false, hinted: false })

/* ---------- screen scale: everything is in rem; rem grows on big screens (TV) ---------- */
const z = ref(1)
function measure() {
  const s = Math.max(1, Math.min(3, Math.min(window.innerWidth / 1100, window.innerHeight / 760)))
  z.value = Math.round(s * 100) / 100
  document.documentElement.style.fontSize = `${16 * z.value}px`
}

/* ---------- spoken clips: one player, prompts queue and never overlap ---------- */
const voice = new ClipVoice()
let chain = Promise.resolve()
let epoch = 0
const prompts = {
  // Queue a prompt. hooks.before() runs just before it speaks, hooks.after(completed) when it finished
  // (neither runs if something interrupted it). Resolves when this item is done or skipped.
  say(key, hooks = {}) {
    const my = epoch
    chain = chain.then(async () => {
      if (my !== epoch) return
      const clip = kid.value?.prompts?.[key]
      if (!clip) return
      hooks.before?.()
      const ok = await voice.play([clip.audio])
      if (my === epoch) hooks.after?.(ok)
    })
    return chain
  },
  // Say each hint only once per visit.
  once(key, hooks) {
    if (visit.said[key]) return Promise.resolve()
    visit.said[key] = true
    return this.say(key, hooks)
  },
  interrupt() {
    epoch++
    voice.stop()
  },
  // Cut in front of everything: definitions and word cards.
  speakNow(urls) {
    this.interrupt()
    return voice.play(urls)
  },
  get speaking() { return voice.speaking },
}
const speaking = ref(false)
voice.onChange = (on) => { speaking.value = on }

/* ---------- loading ---------- */
onMounted(async () => {
  if (assigned.fromTeacher && (!assigned.soundOn || assigned.view === 'passage')) {
    window.location.hash = window.location.hash.replace(/^#\/kid\//, '#/p/')
    return
  }
  measure()
  window.addEventListener('resize', measure)
  try {
    const [d, g, k, s] = await Promise.all([loadPassage(props.id), loadGloss(props.id), loadKidAudio(), loadSyllables(props.id)])
    syllables.value = s
    data.value = d
    gloss.value = g
    kid.value = k
    record('opened', props.id)
  } catch (e) {
    error.value = 'Could not load this passage.'
    return
  }
  document.title = `${data.value.title} · Sound Along kid view`
  if (!voices.value.some((v) => v.id === settings.voice)) settings.voice = voices.value[0]?.id || 'human'
  if (!assigned.demo && assigned.soundOn !== false) speakWelcome()
})
onBeforeUnmount(() => {
  window.removeEventListener('hashchange', onLinkChange)
  window.removeEventListener('resize', measure)
  document.documentElement.style.removeProperty('font-size')
  document.removeEventListener('pointerdown', retryWelcome, true)
  prompts.interrupt()
})

function onLinkChange() {
  if (!window.location.hash.startsWith(`#/kid/${props.id}?`) && window.location.hash !== `#/kid/${props.id}`) return
  const next = linkSettings()
  Object.assign(assigned, next)
  if (next.fromTeacher && (!next.soundOn || next.view === 'passage')) {
    window.location.hash = window.location.hash.replace(/^#\/kid\//, '#/p/')
    return
  }
  settings.voice = next.voice || store.get('kid-voice', 'human')
  if (next.demo) { settings.size = next.size; settings.font = next.font; settings.spacing = next.spacing; settings.tint = next.contrast; autoWords.value = next.vocabAutoShow }
  else {
    settings.size = store.get('kid-size', 'M'); settings.font = store.get('kid-reading-font', 'andika')
    settings.spacing = store.get('reading-spacing', false); settings.tint = store.get('reading-tint', false)
    try { autoWords.value = globalThis.localStorage?.getItem('soundAlong.autoWordCards.v1') === 'true' } catch { autoWords.value = false }
  }
  if (voices.value.length && !voices.value.some((v) => v.id === settings.voice)) settings.voice = voices.value[0].id
  if (next.fromTeacher && !next.soundOn) {
    prompts.interrupt()
    document.removeEventListener('pointerdown', retryWelcome, true)
    needsTap.value = false
    reader.value?.pauseAll?.()
  }
}
window.addEventListener('hashchange', onLinkChange)

const voices = computed(() => data.value?.voices || [])

function speakWelcome() {
  prompts.say('welcome').then(() => {
    // The browser may refuse sound until someone touches the page: the first tap anywhere says it then.
    if (voice.blocked && screen.value === 'start') {
      needsTap.value = true
      document.addEventListener('pointerdown', retryWelcome, true)
    }
  })
}
function retryWelcome(e) {
  document.removeEventListener('pointerdown', retryWelcome, true)
  needsTap.value = false
  voice.blocked = false
  if (screen.value !== 'start') return
  if (e.target.closest?.('.kv-choice, .kv-gear, .kv-panel')) return // the choice speaks its own label
  prompts.interrupt()
  prompts.say('welcome')
}

/* ---------- screens ---------- */
async function choose(m) {
  document.removeEventListener('pointerdown', retryWelcome, true)
  needsTap.value = false
  voice.blocked = false
  prompts.interrupt()
  // No spoken label here: "Read to me" starts reading from this very tap (KidReader), so nothing talks first.
  mode.value = PUBLIC_SAMPLE && !voices.value.length ? 'self' : m
  readKey.value++
  screen.value = 'read'
  await nextTick()
  // The choice button was removed. Give keyboard and switch users a live control on the new screen.
  viewEl.value?.querySelector(m === 'listen' ? '.kv-play' : '.kv-choose')?.focus({ preventScroll: true })
}
async function goHome() {
  prompts.interrupt()
  screen.value = 'start'
  await nextTick()
  viewEl.value?.querySelector('.kv-choice')?.focus({ preventScroll: true })
  if (!assigned.demo) speakWelcome()
}
async function toWords() {
  prompts.interrupt()
  screen.value = 'words'
  await nextTick()
  viewEl.value?.querySelector('.kv-wordscreen .kv-home')?.focus({ preventScroll: true })
  prompts.say('words_to_know')
}
async function readAgain() {
  prompts.interrupt()
  readKey.value++
  screen.value = 'read'
  await nextTick()
  viewEl.value?.querySelector(mode.value === 'listen' ? '.kv-play' : '.kv-choose')?.focus({ preventScroll: true })
}

/* ---------- grown-ups corner ---------- */
const panelOpen = ref(false)
// The grown-ups panel is teleported and owns its markup. Set the real href so
// copying it or opening it in another tab keeps the teacher's choices too.
watch([panelOpen, () => settings.voice, () => assigned.fromTeacher, () => assigned.soundOn], async () => {
  if (!panelOpen.value) return
  await nextTick()
  if (panelOpen.value) setTeacherReturnLink(document, props.id, assigned, settings.voice)
}, { flush: 'post' })
function openPanel() {
  prompts.interrupt()
  reader.value?.pauseAll?.()
  panelOpen.value = true
}

// The words for the end screen, in the order they first appear.
const vocabCards = computed(() => {
  const d = data.value
  if (!d) return []
  const order = []
  for (const m of d.html.matchAll(/data-vocab-sense-id="(\d+)"/g)) if (!order.includes(m[1])) order.push(m[1])
  for (const id of Object.keys(d.vocab || {})) if (!order.includes(id)) order.push(id)
  return order
    .filter((id) => d.vocab?.[id])
    .map((id) => {
      const v = d.vocab[id]
      const defClip = kid.value?.vocab?.[props.id]?.[id]?.audio || null
      const guide = syllables.value?.[id] || null
      // what a person has (or hasn't) checked behind this card: our spoken meaning and our syllable guide
      const reviewItems = [vocabItem(props.id, id, v, kid.value?.vocab?.[props.id]?.[id]), guide ? syllableItem(props.id, id, guide) : null].filter(Boolean)
      return { id, word: v.word, say: v.say || null, defClip, definition: v.definition, guide, reviewItems }
    })
})
</script>

<template>
  <main
    ref="viewEl"
    class="kv"
    :class="{ 'kv-speaking': speaking, 'kv-font-sans': settings.font === 'sans', 'kv-spaced': settings.spacing, 'kv-calm': settings.tint && !assigned.demo, 'td-kid-contrast': assigned.demo && settings.tint }"
    :style="{ '--z': z, '--size-mul': sizeMul }"
    @contextmenu.prevent
  >
    <div v-if="error" class="kv-msg">
      <p>{{ error }}</p>
      <a class="kv-link" :href="assigned.demo ? `#/class-demo?as=${assigned.student || 'teacher'}` : '#/'">Back to the list</a>
    </div>
    <div v-else-if="!data" class="kv-msg" role="status"><p>Loading&hellip;</p></div>

    <section v-else-if="assigned.fromTeacher && !assigned.soundOn" class="kv-plain">
      <p v-if="!assigned.demo" class="kv-assigned-note">Set by your teacher</p>
      <h1>{{ data.title }}</h1>
      <div :lang="data.lang === 'ES' ? 'es' : 'en'" v-html="data.html"></div>
    </section>
    <template v-else>
      <p v-if="assigned.fromTeacher && !assigned.demo" class="kv-assigned-note">Set by your teacher</p>
      <KidStart v-if="screen === 'start'" :title="data.title" :need-tap="needsTap" :has-voice="!PUBLIC_SAMPLE || voices.length > 0" @choose="choose" />
      <KidReader
        v-else-if="screen === 'read'"
        ref="reader"
        :key="readKey"
        :data="data"
        :gloss="gloss"
        :kid="kid"
        :syllables="syllables"
        :mode="mode"
        :settings="settings"
        :voice="voice"
        :prompts="prompts"
        :visit="visit"
        :passage-id="props.id"
        :auto-words="autoWords"
        @home="goHome"
        @done="toWords"
      />
      <KidWords
        v-else
        :cards="vocabCards"
        :voice="voice"
        :prompts="prompts"
        :speaking="speaking"
        @home="goHome"
        @again="readAgain"
      />
      <KidGrownups
        v-if="!assigned.demo"
        v-model:open="panelOpen"
        :settings="settings"
        :auto-words="autoWords"
        :voices="voices"
        :passage-id="props.id"
        @update:autoWords="autoWords = $event"
        @request-open="openPanel"
      />
    </template>
    <a v-if="assigned.demo" class="kv-demo-back" :href="`#/class-demo?as=${assigned.student || 'teacher'}`">Back to my reading</a>
    <div id="kid-feedback-slot" class="kv-feedback-slot"></div>
  </main>
</template>
