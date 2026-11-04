import { ref, shallowRef, computed } from 'vue'
import { HoldDetector } from '../hold'
import { findDefinition } from '../defs'
import { itemsForPassage, tally, syllableItem } from '../review'
import { ClipVoice } from '../kidAudio'
import { record } from '../usage'
import { helpChoice, eligibleHelp } from '../helpPolicy'
import { PUBLIC_SAMPLE } from '../mode'

export function useWordHelp({ id, data, soundOn, spanish, getEngine, dismissAutoCard = () => {},
  onMeaning = () => {}, onClose = () => {}, restoreAnchorFocus = false, closeOnOutsideWord = false }) {
  const card = ref(null)
  const help = typeof helpChoice === 'function' ? helpChoice() : 'current'
  const cardAnchor = shallowRef(null)
  const cardFocus = ref(false)
  const syl = shallowRef(null)
  const gloss = shallowRef(null)
  const kidAudio = shallowRef(null)
  const extrasReady = ref(false)
  const saying = ref('')
  const sayAudio = new Audio()
  sayAudio.addEventListener('ended', () => { saying.value = '' })
  sayAudio.addEventListener('pause', () => { saying.value = '' })
  const defVoice = new ClipVoice()
  const reviewSummary = computed(() => {
    if (!data.value) return ''
    const t = tally(itemsForPassage(id, { gloss: gloss.value, syllables: syl.value, kid: kidAudio.value, data: data.value }))
    if (!t.total) return 'No computer-made word help for this passage.'
    return `${t.approved} of ${t.total} checked by a grown-up${t.fix ? `, ${t.fix} flagged for a fix` : ''}.`
  })
  let lastKeyboard = false
  const onAnyKey = () => { lastKeyboard = true }
  const onAnyPointer = () => { lastKeyboard = false }
  document.addEventListener('keydown', onAnyKey, true)
  document.addEventListener('pointerdown', onAnyPointer, true)

  function openCard(senseId, el) {
    if (!soundOn.value) return
    dismissAutoCard()
    clearOffer()
    if (spanish.value) return
    const v = data.value?.vocab?.[senseId]
    const guide = syl.value?.[senseId] || null
    const choice = help === 'current' ? null : eligibleHelp({ source: { word: v?.word, text: v?.definition },
      sourceIsOriginal: !PUBLIC_SAMPLE, guide, guideItem: guide ? syllableItem(id, senseId, guide) : null, mode: help })
    card.value = v ? { id: senseId, sid: senseId, pid: id, ...v, spanish: v.spanish ? `${v.spanish} (borrador; sin revisión humana)` : null, guide: syl.value?.[senseId] || null, reviewItems: syl.value?.[senseId] ? [syllableItem(id, senseId, syl.value[senseId])] : [] } : null
    if (choice) card.value = choice.text || choice.guide ? { ...card.value, definition: choice.text,
      guide: choice.guide, reviewItems: [choice.guideItem].filter(Boolean),
      spanish: null,
      canSay: !PUBLIC_SAMPLE && (!!v?.say || getEngine()?.kOfSense(senseId) != null), helpMode: help } : null
    cardAnchor.value = card.value ? el : null
    cardFocus.value = lastKeyboard
    if (card.value) record('word_card_opened', id)
  }
  function closeCard({ restoreFocus = false } = {}) {
    clearOffer()
    defVoice.stop()
    const a = cardAnchor.value
    card.value = null
    cardAnchor.value = null
    onClose()
    if (restoreFocus) (restoreAnchorFocus ? a : (a?.querySelector('.sa-w') || a))?.focus?.()
  }
  function onGuideStart() {
    getEngine()?.pause()
    sayAudio.pause()
    defVoice.stop()
  }
  let holdClips = []
  let suppressClick = false
  let lastPointerType = 'mouse'
  const hold = new HoldDetector({ ms: 500, moveLimit: () => 12, onHold: onHoldWord })
  function narratedWord(e) {
    const el = e.target.closest?.('.sa-w')
    return el && !el.classList.contains('sa-unread') ? el : null
  }
  function onHoldDown(e) {
    lastPointerType = e.pointerType || 'mouse'
    if (!getEngine() || !soundOn.value || spanish.value || e.button > 0) return
    const el = narratedWord(e)
    if (el) hold.down(el, e.clientX, e.clientY)
  }
  function onHoldMove(e) { hold.move(e.clientX, e.clientY) }
  function onHoldUp() {
    if (hold.up().held) {
      suppressClick = true
      setTimeout(() => { suppressClick = false }, 500)
    }
  }
  function onHoldCancel() { hold.cancel() }
  function swallowClick(e) {
    if (!suppressClick) return
    suppressClick = false
    e.stopPropagation()
    e.preventDefault()
  }
  function onContextMenu(e) {
    if (e.target.closest?.('.sa-w:not(.sa-unread)') && (lastPointerType === 'touch' || lastPointerType === 'pen')) e.preventDefault()
  }
  function onHoldWord(el) {
    clearOffer()
    const engine = getEngine()
    if (!engine) return
    engine.pause()
    sayAudio.pause()
    defVoice.stop()
    window.getSelection()?.removeAllRanges()
    const def = findDefinition(el, { gloss: gloss.value, kid: kidAudio.value, passageId: id, vocab: data.value.vocab, syllables: syl.value, help })
    if (!def) {
      closeCard()
      const k = engine.index.get(el)
      if (k !== undefined) engine.playSnippet(k)
      return
    }
    holdClips = def.clips
    const original = help === 'current' && def.sid ? data.value?.vocab?.[def.sid] : null
    card.value = { id: `hold:${el.dataset.i ?? 'l' + el.dataset.l}`, hold: true, word: def.word, definition: def.text,
      pos: original?.pos, example: original?.example,
      spanish: original?.spanish ? `${original.spanish} (borrador; sin revisión humana)` : null,
      guide: def.guide, sid: def.sid, pid: id, reviewItems: [...def.items, def.guideItem].filter(Boolean),
      canSay: def.clips.length > 0, helpMode: help }
    cardAnchor.value = el
    cardFocus.value = lastKeyboard
    onMeaning(def)
    record('word_card_opened', id)
    if (def.clips.length) defVoice.play(def.clips)
  }
  const meaningHint = ref('')
  let offerButton = null
  function clearOffer() {
    offerButton?.remove()
    offerButton = null
    meaningHint.value = ''
  }
  function offerMeaning(el) {
    clearOffer()
    if (!el || !soundOn.value || spanish.value) return
    const def = findDefinition(el, { gloss: gloss.value, kid: kidAudio.value, passageId: id,
      vocab: data.value?.vocab, syllables: syl.value, help })
    if (!def) return
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'word-meaning-prompt'
    button.textContent = 'What does it mean?'
    button.setAttribute('aria-label', `Meaning of ${def.word}`)
    button.addEventListener('click', (event) => {
      event.stopPropagation()
      clearOffer()
      onHoldWord(el)
    })
    el.insertAdjacentElement('afterend', button)
    offerButton = button
    queueMicrotask(() => {
      if (offerButton === button) meaningHint.value = `Meaning of ${def.word}: What does it mean? button available.`
    })
  }
  function onCardSay() {
    if (card.value?.hold) { getEngine()?.pause(); if (holdClips.length) defVoice.play(holdClips) } else sayWord(card.value.id)
  }
  function sayWord(senseId) {
    const v = data.value?.vocab?.[senseId]
    if (!v) return
    getEngine()?.pause()
    sayAudio.pause()
    if (v.say) {
      sayAudio.src = v.say
      saying.value = senseId
      sayAudio.play().catch(() => { saying.value = ''; sayFromStory(senseId) })
    } else sayFromStory(senseId)
  }
  function sayFromStory(senseId) {
    const engine = getEngine()
    const k = engine?.kOfSense(senseId)
    if (k !== null && k !== undefined) engine.playSnippet(k)
  }
  let swallowNext = false
  function onDocPointerDown(e) {
    if (!card.value) return
    const popEl = document.querySelector('.vpop')
    if (popEl?.contains(e.target)) return
    if (!closeOnOutsideWord && e.target.closest?.('[data-vocab-sense-id]')) return
    swallowNext = !e.target.closest?.('.sa-w, button, a, input, select')
    closeCard()
  }
  function consumeOutsideClick() {
    if (!swallowNext) return false
    swallowNext = false
    return true
  }
  function onEsc(e) {
    if (e.key === 'Escape' && card.value) closeCard({ restoreFocus: true })
  }
  document.addEventListener('pointerdown', onDocPointerDown, true)
  document.addEventListener('keydown', onEsc)
  function dispose() {
    clearOffer()
    sayAudio.pause()
    defVoice.stop()
    hold.cancel()
    document.removeEventListener('keydown', onEsc)
    document.removeEventListener('keydown', onAnyKey, true)
    document.removeEventListener('pointerdown', onAnyPointer, true)
    document.removeEventListener('pointerdown', onDocPointerDown, true)
  }
  return { card, cardAnchor, cardFocus, syl, gloss, kidAudio, extrasReady, saying, reviewSummary,
    openCard, closeCard, offerMeaning, meaningHint, onGuideStart, onHoldDown, onHoldMove, onHoldUp, onHoldCancel, swallowClick,
    onContextMenu, onCardSay, sayWord, sayFromStory, showMeaning: onHoldWord, consumeOutsideClick, dispose }
}
