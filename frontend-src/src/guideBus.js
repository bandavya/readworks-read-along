// Only one syllable guide speaks at a time: a guide that starts stops whichever one was playing.
let stopCurrent = null
export function claimGuide(stopFn) {
  if (stopCurrent && stopCurrent !== stopFn) stopCurrent()
  stopCurrent = stopFn
}
export function releaseGuide(stopFn) {
  if (stopCurrent === stopFn) stopCurrent = null
}
