import { ref, shallowRef, watch, nextTick } from 'vue'
import { record } from '../usage'
import { helpChoice, eligibleHelp } from '../helpPolicy'
import { PUBLIC_SAMPLE } from '../mode'

export function useAutoWordCards({ id, data, soundOn, state, spanish, tab, getEngine }) {
  const help = typeof helpChoice === 'function' ? helpChoice() : 'current'
  const autoWords = ref(false)
  try { autoWords.value = globalThis.localStorage?.getItem('soundAlong.autoWordCards.v1') === 'true' } catch { /* private browsing */ }
  const autoCard = shallowRef(null)
  const autoAnchor = shallowRef(null)
  const autoAnnouncement = ref('')
  const announcedWords = new Set()
  let autoTimer = 0

  function dismissAutoCard() {
    clearTimeout(autoTimer)
    autoCard.value = null
    autoAnchor.value = null
  }
  watch(autoWords, (on) => {
    try { globalThis.localStorage?.setItem('soundAlong.autoWordCards.v1', String(on)) } catch { /* private browsing */ }
    if (!on) dismissAutoCard()
  })
  function onCurrentWord(k, prevK) {
    if (k === 0 && prevK !== 0) announcedWords.clear()
    if (!autoWords.value || !soundOn.value || !state.playing || spanish.value || tab.value !== 'passage') return
    const word = getEngine()?.words[k]
    const anchor = word?.closest('[data-vocab-sense-id]')
    const senseId = anchor?.dataset.vocabSenseId
    const vocab = senseId && data.value?.vocab?.[senseId]
    if (!vocab?.definition || !anchor) return
    const choice = help === 'current' ? null : eligibleHelp({ source: { word: vocab.word, text: vocab.definition },
      sourceIsOriginal: !PUBLIC_SAMPLE, mode: help })
    if (choice && !choice.text) return
    dismissAutoCard()
    autoCard.value = { id: senseId, word: vocab.word, definition: choice ? choice.text : vocab.definition, pid: id }
    autoAnchor.value = anchor
    if (!announcedWords.has(k)) {
      announcedWords.add(k)
      autoAnnouncement.value = ''
      nextTick(() => { autoAnnouncement.value = `${vocab.word}: ${choice ? choice.text : vocab.definition}` })
    }
    autoTimer = setTimeout(dismissAutoCard, 3000)
  }
  function onReadingEnded({ snippet }) {
    if (snippet) return
    record('reached_end', id)
    announcedWords.clear()
    dismissAutoCard()
    autoAnnouncement.value = ''
  }
  watch(() => state.playing, (on) => {
    const engine = getEngine()
    if (on && engine?.curK >= 0) onCurrentWord(engine.curK, engine.curK)
  })
  return { autoWords, autoCard, autoAnchor, autoAnnouncement, dismissAutoCard, onCurrentWord, onReadingEnded }
}
