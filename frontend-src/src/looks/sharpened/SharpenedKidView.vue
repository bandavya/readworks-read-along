<script setup>
// Kid view. Owns: loading, the three screens
// (start / reading / words to know), the one spoken-clip player, the grown-ups settings, and the screen scale.
import { ref, reactive, shallowRef, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { loadPassage, store } from '../../api'
import { loadKidAudio, loadGloss, loadSyllables, ClipVoice } from '../../kidAudio'
import { syllableItem, vocabItem } from '../../review'
import KidStart from './SharpenedKidStart.vue'
import KidReader from '../../components/KidReader.vue'
import KidWords from '../../components/KidWords.vue'
import KidGrownups from '../../components/KidGrownups.vue'
import '../../kid.css'

const props = defineProps({ id: String })

const data = shallowRef(null)
const gloss = shallowRef(null)
const kid = shallowRef(null)
const syllables = shallowRef(null)
const error = ref('')
const screen = ref('start') // 'start' | 'read' | 'words'
const mode = ref('listen') // 'listen' (Read to me) | 'self' (Read on my own)
const readKey = ref(0)
const reader = ref(null)
const viewEl = ref(null)
const needsTap = ref(false)

// Grown-ups settings, remembered with the app's store (own keys: the teacher view's saved choices are untouched).
const settings = reactive({
  voice: store.get('kid-voice', 'human'),
  rate: store.get('kid-rate', 1),
  size: store.get('kid-size', 'M'),
})
watch(() => settings.voice, (v) => store.set('kid-voice', v))
watch(() => settings.rate, (v) => store.set('kid-rate', v))
watch(() => settings.size, (v) => store.set('kid-size', v))
const sizeMul = computed(() => ({ S: 0.88, M: 1, L: 1.2 })[settings.size] || 1)

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
  measure()
  window.addEventListener('resize', measure)
  try {
    const [d, g, k, s] = await Promise.all([loadPassage(props.id), loadGloss(props.id), loadKidAudio(), loadSyllables(props.id)])
    syllables.value = s
    data.value = d
    gloss.value = g
    kid.value = k
  } catch (e) {
    error.value = 'Could not load this passage.'
    return
  }
  document.title = `${data.value.title} · Sound Along kid view`
  if (!voices.value.some((v) => v.id === settings.voice)) settings.voice = voices.value[0]?.id || 'human'
  speakWelcome()
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', measure)
  document.documentElement.style.removeProperty('font-size')
  document.removeEventListener('pointerdown', retryWelcome, true)
  prompts.interrupt()
})

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
  mode.value = m
  readKey.value++
  screen.value = 'read'
  await nextTick()
  viewEl.value?.querySelector?.(m === 'listen' ? '.kv-play' : '.kv-choose')?.focus({ preventScroll: true })
}
async function goHome() {
  prompts.interrupt()
  screen.value = 'start'
  await nextTick()
  viewEl.value?.querySelector?.('.kv-choice')?.focus({ preventScroll: true })
  speakWelcome()
}
async function toWords() {
  prompts.interrupt()
  screen.value = 'words'
  await nextTick()
  viewEl.value?.querySelector?.('.kv-wordscreen .kv-home')?.focus({ preventScroll: true })
  prompts.say('words_to_know')
}
async function readAgain() {
  prompts.interrupt()
  readKey.value++
  screen.value = 'read'
  await nextTick()
  viewEl.value?.querySelector?.(mode.value === 'listen' ? '.kv-play' : '.kv-choose')?.focus({ preventScroll: true })
}

/* ---------- grown-ups corner ---------- */
const panelOpen = ref(false)
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
    :class="{ 'kv-speaking': speaking }"
    :style="{ '--z': z, '--size-mul': sizeMul }"
    @contextmenu.prevent
  >
    <div v-if="error" class="kv-msg">
      <p>{{ error }}</p>
      <a class="kv-link" href="#/">Back to the list</a>
    </div>
    <div v-else-if="!data" class="kv-msg" role="status"><p>Loading&hellip;</p></div>

    <template v-else>
      <KidStart v-if="screen === 'start'" :title="data.title" :need-tap="needsTap" @choose="choose" />
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
        v-model:open="panelOpen"
        :settings="settings"
        :voices="voices"
        :passage-id="props.id"
        @request-open="openPanel"
      />
    </template>
  </main>
</template>
