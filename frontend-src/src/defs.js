// What to show and say for a held word (kid view and teacher view share this).
// Order: the kid-level gloss entry whose `indices` include the word's data-i; else the ReadWorks sense when the
// word sits inside a vocabulary span; else null (the caller just says the word).
// `guide` is the syllable entry when the word is inside a vocabulary span (any source of definition).
// `items` = the reviewable things behind the definition (our gloss entry / our spoken clip), `guideItem` = the guide's;
// see review.js. ReadWorks' own written definition and recordings are theirs and carry no marker.
import { glossItem, syllableItem, vocabItem } from './review'
import { sharedWordHelp } from './api'
import { PUBLIC_SAMPLE } from './mode'
import { eligibleHelp } from './helpPolicy'

export function findDefinition(el, { gloss, kid, passageId, vocab, syllables, sayFallback = false, help = 'current' }) {
  const sid = el.closest('[data-vocab-sense-id]')?.dataset.vocabSenseId || null
  const v = sid ? vocab?.[sid] : null
  const shared = sharedWordHelp(v ? v.word : el.textContent, passageId) // passageId: prefer this story's own guide on a tie
  const guide = (sid ? syllables?.[sid] : null) || shared.guide || null
  const guideItem = guide ? syllableItem(guide._wordBankPid || passageId, guide._wordBankSid || sid, guide) : null
  const source = v ? { word: v.word, text: v.definition, clips: sayFallback && v.say ? [v.say] : [] } : null
  function selected(generated, generatedItem = null, clipItem = null) {
    const result = eligibleHelp({ generated, source, guide, generatedItem, clipItem, guideItem,
      sourceIsOriginal: !PUBLIC_SAMPLE, mode: help })
    if (!result.text && !result.guide) return null
    return { word: result.word || guide?.word || el.textContent.trim(), text: result.text || 'Hear this word.', clips: result.clips,
      sid, guide: result.guide, guideItem: result.guideItem,
      items: [result.generatedItem, result.clipItem].filter(Boolean) }
  }
  const di = el.dataset.i
  const g = gloss?.entries
  if (g && di !== undefined) {
    const n = Number(di)
    const idx = g.findIndex((en) => en.indices?.includes(n))
    if (idx >= 0) {
      const clip = kid?.gloss?.[passageId]?.[idx]?.audio || null
      if (help !== 'current') {
        const item = glossItem(passageId, g[idx], idx, clip, gloss.review)
        return selected({ word: g[idx].word, text: g[idx].def, clips: clip ? [clip] : [] }, item, clip ? item : null)
      }
      return { word: g[idx].word, text: g[idx].def, clips: clip ? [clip] : [], sid, guide, guideItem, items: [glossItem(passageId, g[idx], idx, clip, gloss.review)] }
    }
  }
  if (v) {
    const defClip = kid?.vocab?.[passageId]?.[sid]?.audio || null
    // Kid view: ReadWorks' spoken definition when we have it, else their recorded word clip.
    // Teacher view (sayFallback false): the spoken definition when we have it, else text only.
    const clips = defClip ? [defClip] : sayFallback && v.say ? [v.say] : []
    const vi = defClip ? vocabItem(passageId, sid, v, kid.vocab[passageId][sid]) : null
    if (help !== 'current') return selected({ word: v.word, text: v.definition, clips: defClip ? [defClip] : [] },
      PUBLIC_SAMPLE ? vocabItem(passageId, sid, v, kid?.vocab?.[passageId]?.[sid]) : null, vi)
    return { word: v.word, text: v.definition, clips, sid, guide, guideItem, items: vi ? [vi] : [] }
  }
  if (guide) {
    if (help !== 'current') return selected(null)
    return { word: guide.word || el.textContent.trim(), text: 'Hear this word in parts.', clips: [], sid, guide, guideItem, items: [] }
  }
  return null
}
