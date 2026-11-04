// Kid reader: what narration should do when the child turns a page by hand, and when the final star may end the
// story. Pure functions (no DOM, no audio) so tests/engine_harness.mjs can check them. KidReader.vue calls them.
// Rule: what the child SEES (the page) and what they HEAR (the word being read) never disagree.

// The child pressed Next / Previous / swiped / used an arrow key. `playing` = narration is going right now.
//   'none'      narration was silent: nothing to do (Play will start the page that is showing)
//   'play-page' it was reading: carry on reading from the first word of the page now showing
//   'pause'     it was playing, but there is nothing to read on the new page (or no read-along): stop
export function turnPlan({ listen, playing, firstK }) {
  if (!playing) return 'none'
  if (listen && firstK !== undefined && firstK !== null) return 'play-page'
  return 'pause'
}

// The child pressed the final star (or the story's audio ended: that passes heardEnd = true).
//   'end'            end the story
//   'keep-listening' narration is on the last page: let it finish, then the story ends by itself
//   'play-last'      the last page hasn't been heard: start (or resume) it instead of ending
export function finishPlan({ listen, hasNarration, heardEnd, playingLastPage, lastFirstK }) {
  if (!listen || !hasNarration || heardEnd) return 'end'
  if (playingLastPage) return 'keep-listening'
  if (lastFirstK !== undefined && lastFirstK !== null) return 'play-last'
  return 'end'
}
