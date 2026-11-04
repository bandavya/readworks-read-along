// Press-and-hold detection, shared by the kid view and the teacher passage page.
// down(el, x, y) starts a timer; if the pointer stays within moveLimit() for `ms`, onHold(el) fires once.
// Moving farther (a swipe, a text selection drag) cancels it. up() says whether a hold fired.
export class HoldDetector {
  constructor({ ms = 500, moveLimit = () => 12, onHold }) {
    this.ms = ms
    this.moveLimit = moveLimit
    this.onHold = onHold
    this.d = null
  }

  down(el, x, y) {
    this.cancel()
    const d = { el, x, y, held: false, moved: false, timer: 0 }
    d.timer = setTimeout(() => {
      if (this.d !== d || d.moved) return
      d.held = true
      this.onHold(el, d)
    }, this.ms)
    this.d = d
  }

  move(x, y) {
    const d = this.d
    if (!d || d.moved) return
    if (Math.hypot(x - d.x, y - d.y) > this.moveLimit()) {
      d.moved = true
      clearTimeout(d.timer)
    }
  }

  // Ends the press. Returns { held, moved, el }.
  up() {
    const d = this.d
    this.d = null
    if (!d) return { held: false, moved: false, el: null }
    clearTimeout(d.timer)
    return { held: d.held, moved: d.moved, el: d.el }
  }

  cancel() {
    if (this.d) clearTimeout(this.d.timer)
    this.d = null
  }
}
