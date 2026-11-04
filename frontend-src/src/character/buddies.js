// Which reading buddies exist and which one is on. The showcase builds (the live demo) offer the switcher, starting with no
// character. Any other build has none of this on screen and runs nothing, unless the address says `?buddy=<id>` or the
// build sets VITE_BUDDY. Nothing runs until a character is chosen.
import { ref } from 'vue'
import { store } from '../api'
import { CAST, LOADERS } from './chars/index.js'
import { knownBuddy } from './readingHead.js'

export const BUDDIES = CAST

const fromAddress = new URLSearchParams(window.location.search).get('buddy')
const buildDefault = import.meta.env?.VITE_BUDDY || ''
const showcase = import.meta.env?.VITE_SHOWCASE === '1'
export const BUDDY_UI = fromAddress !== null || !!buildDefault || showcase
const ids = CAST.map((b) => b.id)
const saved = BUDDY_UI ? store.get('buddy', buildDefault) : ''
if (saved && !knownBuddy(saved, ids)) store.set('buddy', '')
export const buddyChoice = ref(knownBuddy(fromAddress ?? saved, ids))
// How a painted character's mouth is drawn; lets the styles be compared with a real voice.
export const MOUTH_STYLES = [
  { id: 'drawn', name: 'Smooth', hint: 'A drawn mouth whose shape changes continuously' },
  { id: 'stretch', name: 'Painted, stretching', hint: 'Painted mouths that blend quickly and open as they do' },
  { id: 'fade', name: 'Painted, blending', hint: 'Painted mouths that blend quickly' },
  { id: 'flip', name: 'Painted, flipping', hint: 'Swaps straight between painted mouths' },
]
export const mouthStyle = ref(BUDDY_UI ? store.get('buddy-mouth', 'drawn') : 'drawn')
export function chooseMouth(id) {
  mouthStyle.value = id
  store.set('buddy-mouth', id)
}

export function chooseBuddy(id) {
  buddyChoice.value = id
  store.set('buddy', id)
}

export async function buddyDef(id) {
  const entry = CAST.find((b) => b.id === id)
  if (!entry) return null
  const cast = (await LOADERS[entry.family]()).default
  return cast.find((c) => c.id === id) || null
}
