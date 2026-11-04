import { reviewOf } from './review'

// This option is read once for a page load. Only callers that pass it to the
// resolver participate; other readers keep their existing behavior.
export function helpChoice(search = globalThis.location?.search || '') {
  const value = new URLSearchParams(search).get('help')
  return value === 'source' || value === 'reviewed' ? value : 'current'
}

const checked = (item) => !!item && ['approved', 'checked'].includes(reviewOf(item).state)

// Candidates and provenance are explicit because a missing review item is not
// evidence that generated text or audio was checked.
export function eligibleHelp({ generated = null, source = null, guide = null,
  generatedItem = null, clipItem = null, guideItem = null,
  sourceIsOriginal = true, mode = 'current' } = {}) {
  if (mode === 'current') return { text: generated?.text ?? source?.text ?? null,
    word: generated?.word ?? source?.word ?? null,
    clips: generated?.clips ?? source?.clips ?? [], guide, generatedItem, clipItem, guideItem }
  const original = sourceIsOriginal ? source : null
  const useGenerated = mode === 'reviewed' && checked(generatedItem)
  const text = useGenerated ? generated?.text : original?.text
  const clips = mode === 'reviewed' && checked(clipItem) ? (generated?.clips || []) : (original?.clips || [])
  const useGuide = mode === 'reviewed' && checked(guideItem)
  return { text: text ?? null, word: (useGenerated ? generated?.word : original?.word) ?? generated?.word ?? original?.word ?? null,
    clips, guide: useGuide ? guide : null,
    generatedItem: useGenerated ? generatedItem : null,
    clipItem: mode === 'reviewed' && checked(clipItem) ? clipItem : null,
    guideItem: useGuide ? guideItem : null }
}
