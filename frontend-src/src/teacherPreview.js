// Teacher preview: the plain facts about what a child opening this passage in the kid view will get.
// Pure function (no DOM, no storage reads) so a Node harness can check it: tests/teacher_preview_harness.mjs.
// Rule: say only what the data in hand backs. A review field we don't recognize is shown as written, never as approval.
// ( See reviews_2026-10-31/REPORT_E2_evolve_experience.md C1 / survivor 4.)

// 'unchecked' = the data itself says no person has looked; 'unknown' = no review field at all; 'other' = something else, shown as written.
export function reviewState(raw) {
  if (raw === undefined || raw === null || raw === '') return { kind: 'unknown', text: 'Review status not recorded' }
  const s = String(raw)
  if (/needs human check|not reviewed|unreviewed/i.test(s)) return { kind: 'unchecked', text: 'Not yet checked by a person' }
  return { kind: 'other', text: `Marked: ${s}` }
}

// Combine several entries' review fields into one state.
function combine(raws) {
  const states = raws.map(reviewState)
  const kinds = new Set(states.map((s) => s.kind))
  if (kinds.size === 1) return states[0]
  return { kind: 'mixed', text: 'Review status differs between entries' }
}

const SIZE_NAMES = { S: 'small', M: 'medium', L: 'large' }

// Voice names are the app's own (api.js VOICE_NAMES); source text comes from the data's `source` field.
function describeVoice(v) {
  const human = v.id === 'human'
  return {
    id: v.id,
    name: human ? 'Human voice' : 'Generated voice',
    detail: human ? 'ReadWorks volunteer recording' : 'Amazon Polly',
    // Word timing in both cases is computed by a program; no field says a person checked it.
    timing: 'word timing computed automatically',
  }
}

/**
 * @param {object} a
 * @param {object} a.data     the passage JSON (voices, vocab, lang, ...)
 * @param {object|null} a.gloss     gloss/<id>.json (kid-friendly meanings) or null
 * @param {object|null} a.syl       syllables/<id>.json (by sense id) or null
 * @param {object|null} a.kid       kid_audio.json or null
 * @param {string} a.passageId
 * @param {object} a.saved    this browser's saved kid settings: { voice, rate, size } (undefined = never chosen)
 */
export function buildPreview({ data, gloss, syl, kid, passageId, saved = {} }) {
  const voices = (data?.voices || []).map(describeVoice)
  const lang = (data?.lang || 'EN').toUpperCase()

  // Which voice the kid view opens with: the saved grown-up choice if that voice exists here, else the first voice
  // (same rule as KidView.vue: settings.voice falls back to voices[0]; default pref is 'human').
  const want = saved.voice || 'human'
  const first = voices.find((v) => v.id === want) || voices[0] || null
  const childVoice = first && {
    ...first,
    chosen: !!saved.voice && first.id === saved.voice, // true = a grown-up picked it on this device
    fallback: !!first && first.id !== want,
  }

  // Word help
  const vocab = Object.entries(data?.vocab || {})
  const glossEntries = gloss?.entries || []
  const glossClips = kid?.gloss?.[passageId]
  const vocabClips = kid?.vocab?.[passageId]
  const spokenVocab = vocab.filter(([id]) => vocabClips?.[id]?.audio).length
  const sylEntries = syl ? Object.values(syl) : []
  const sylClips = sylEntries.filter((e) => e?.audio?.whole).length

  const meanings = glossEntries.length
    ? {
        key: 'meanings',
        count: glossEntries.length,
        spoken: !!glossClips?.length,
        review: reviewState(gloss.review),
        // Written by Claude as drafts (the file says so); show the maker as recorded.
        maker: gloss.made_by || null,
      }
    : null
  const readworksWords = vocab.length
    ? { key: 'readworks', count: vocab.length, spokenCount: spokenVocab }
    : null
  const syllables = sylEntries.length
    ? { key: 'syllables', count: sylEntries.length, clips: sylClips, review: combine(sylEntries.map((e) => e.review)) }
    : null

  // Is anything word-help-shaped still unchecked? (Drives the one line at the top.)
  const reviews = [meanings?.review, syllables?.review].filter(Boolean)
  const anyUnchecked = reviews.some((r) => r.kind === 'unchecked' || r.kind === 'mixed')
  // The kid view's audio manifest (spoken meanings, prompts) states its own review field; surface it once.
  const spokenReview = (meanings?.spoken || spokenVocab > 0) ? reviewState(kid?.review) : null

  // Spanish
  let spanish
  if (lang === 'ES') {
    spanish = {
      kind: 'es-passage',
      text: 'This passage is in Spanish. Its word meanings are written in Spanish and spoken by a computer voice. In the kid view, the buttons and spoken instructions are still in English.',
    }
  } else {
    const n = vocab.filter(([, v]) => v.spanish).length
    spanish = n
      ? { kind: 'translations', count: n, total: vocab.length, text: `${n} of ${vocab.length} vocabulary words show a Spanish word in the teacher view's meaning popup. The kid view does not show them.` }
      : { kind: 'none', text: 'No Spanish support for this passage.' }
  }

  return {
    voices,
    childVoice,
    kidView: { available: true }, // the kid view route works for every passage
    settings: {
      rate: saved.rate ?? 1,
      size: SIZE_NAMES[saved.size] || 'medium',
      rateChosen: saved.rate !== undefined,
      sizeChosen: saved.size !== undefined,
    },
    help: { meanings, readworksWords, syllables, spokenReview, none: !meanings && !readworksWords && !syllables, anyUnchecked },
    spanish,
  }
}
