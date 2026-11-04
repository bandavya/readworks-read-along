import { watch } from 'vue'
import { sentenceRanges, rangeIndexOf } from '../sentences'
import { record } from '../usage'

export function useRehearsal({ id, state, getEngine }) {
  let lastReplaySentence = -1
  let replayBaseRate = null

  function restoreReplayRate() {
    if (replayBaseRate === null) return
    const rate = replayBaseRate
    replayBaseRate = null
    getEngine()?.setRate(rate)
  }
  function setRate(r) {
    const engine = getEngine()
    if (replayBaseRate !== null) engine?.cancelRange()
    replayBaseRate = null
    engine?.setRate(r)
  }
  watch(() => state.error, (message) => {
    if (message && replayBaseRate !== null) {
      getEngine()?.cancelRange()
      restoreReplayRate()
    }
  }, { flush: 'sync' })
  function replaySentence(slow = false) {
    const engine = getEngine()
    if (!engine) return
    if (replayBaseRate !== null) {
      engine.cancelRange()
      restoreReplayRate()
    }
    const words = engine.words.map((el) => ({ text: el.textContent, block: el.closest('p, h1, h2, h3, h4, h5, li, figcaption, td') }))
    const ranges = sentenceRanges(words)
    if (!ranges.length) return
    let i = engine.curK >= 0 ? rangeIndexOf(ranges, engine.curK) : lastReplaySentence
    if (i < 0) i = ranges.findIndex((r) => engine.words[r.start]?.dataset.i !== undefined)
    if (i < 0) i = 0
    lastReplaySentence = i
    if (slow) {
      replayBaseRate = state.rate
      engine.setRate(Math.min(state.rate * 0.75, 0.75))
    }
    state.error = ''
    if (engine.playRange(ranges[i].start, ranges[i].end, { onEnd: restoreReplayRate, onCancel: restoreReplayRate })) record('replay', id)
    else restoreReplayRate()
  }
  return { restoreReplayRate, setRate, replaySentence }
}
