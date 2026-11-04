// Draws the currently spoken line from the engine's real word timings. All
// geometry is outside the text flow, so highlighting never moves a letter.

// The box of the letters themselves. Word spans carry padding for bigger tap
// targets (32 px tall on 19 px text), which hid the gap between lines.
const range = document.createRange()
function glyphRect(el) {
  range.selectNodeContents(el)
  const r = range.getBoundingClientRect()
  return r.width > 0 ? r : el.getBoundingClientRect()
}

export class SoundRibbon {
  constructor(root, engine, { calm = () => false, kid = false } = {}) {
    this.root = root
    this.engine = engine
    this.calm = calm
    this.kid = kid
    this.lineKey = ''
    this.parts = []
    this.rail = document.createElement('div')
    this.rail.className = 'sound-rail'
    this.rail.setAttribute('aria-hidden', 'true')
    this.dot = document.createElement('span')
    this.rail.append(this.dot)
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    this.svg.classList.add('sound-ribbon')
    this.svg.setAttribute('aria-hidden', 'true')
    this.svg.addEventListener('click', (e) => {
      const part = e.target.closest('[data-k]')
      if (!part) return
      const k = Number(part.getAttribute('data-k'))
      if (Number.isInteger(k) && this.engine.enabled) this.engine.playFrom(k)
    })
    root.append(this.rail, this.svg)
    this.frame = 0
    this.run = this.run.bind(this)
    this.frame = requestAnimationFrame(this.run)
    this.resize = () => { this.lineKey = '' }
    window.addEventListener('resize', this.resize)
  }

  run() {
    const e = this.engine
    const k = e.curK
    if (k >= 0 && e.words[k]?.dataset.i !== undefined) {
      const word = e.words[k]
      const block = word.closest('p, h1, h2, h3, h4, h5, li')
      if (block) {
        const r = glyphRect(word)
        const key = `${k}:${r.top}:${r.left}:${this.root.offsetWidth}:${e.voice?.id}:${this.calm()}`
        if (key !== this.lineKey) this.draw(k, block, r, key)
        this.paint(e.audio.currentTime, k)
      }
    } else this.hide()
    this.frame = requestAnimationFrame(this.run)
  }

  draw(k, block, currentRect, key) {
    this.lineKey = key
    const e = this.engine
    const rootRect = this.root.getBoundingClientRect()
    const blockWords = e.words.map((el, i) => ({ el, i, rect: glyphRect(el) }))
      .filter(({ el, rect }) => el.closest('p, h1, h2, h3, h4, h5, li') === block && rect.width > 0 && rect.height > 0)
    const currentCenter = (currentRect.top + currentRect.bottom) / 2
    // Inline emphasis and vocabulary wrappers can shift a word's top edge a
    // few pixels without putting it on another printed line.
    const words = blockWords.filter(({ rect }) =>
      Math.abs((rect.top + rect.bottom) / 2 - currentCenter) < Math.min(rect.height, currentRect.height) * .6)
    if (!words.length) return this.hide()
    const left = Math.min(...words.map(({ rect }) => rect.left))
    const right = Math.max(...words.map(({ rect }) => rect.right))
    const bottom = Math.max(...words.map(({ rect }) => rect.bottom))
    // Find the next printed line by its center, not by its top edge. A taller
    // inline box on the current line can otherwise be mistaken for that line.
    const nextTop = Math.min(...blockWords.filter(({ rect }) =>
      (rect.top + rect.bottom) / 2 > currentCenter + currentRect.height * .6)
      .map(({ rect }) => rect.top), Infinity)
    const width = Math.max(1, right - left)
    const laneHeight = Number.isFinite(nextTop) ? nextTop - bottom - 8 : (this.kid ? 17 : 12)
    const br = block.getBoundingClientRect()
    this.rail.style.left = `${br.left - rootRect.left - 18}px`
    this.rail.style.top = `${br.top - rootRect.top}px`
    this.rail.style.height = `${br.height}px`
    this.dot.style.top = `${Math.max(0, Math.min(br.height - 8, currentRect.top - br.top + currentRect.height / 2 - 4))}px`
    this.rail.hidden = false
    if (laneHeight < (this.kid ? 10 : 8)) { this.svg.style.display = 'none'; this.parts = []; return }
    const svgHeight = Math.min(this.kid ? 17 : 12, laneHeight)
    const barHeight = this.calm() ? 2 : (this.kid ? 8 : 5)
    const barY = (svgHeight - barHeight) / 2
    const y = bottom + 4 - rootRect.top
    const x = left - rootRect.left
    this.svg.style.left = `${x}px`
    this.svg.style.top = `${y}px`
    this.svg.setAttribute('width', width)
    this.svg.setAttribute('height', svgHeight)
    this.svg.setAttribute('viewBox', `0 0 ${width} ${svgHeight}`)
    this.svg.replaceChildren()
    const ns = 'http://www.w3.org/2000/svg'
    this.parts = []
    for (const { el, i, rect } of words) {
      const timing = e._timing(e.voice, el)
      const x0 = rect.left - left
      // Spoken duration changes each segment's length; the word's printed
      // width caps it so the line stays aligned with the actual letters.
      const w = timing
        ? Math.max(4, Math.min(rect.width - 3, 8 + (timing[1] - timing[0]) * 70))
        : Math.max(4, rect.width - 3)
      const base = document.createElementNS(ns, 'rect')
      base.setAttribute('x', x0)
      base.setAttribute('y', barY)
      base.setAttribute('width', w)
      base.setAttribute('height', barHeight)
      base.setAttribute('rx', barHeight / 2)
      base.setAttribute('class', 'sound-segment')
      base.setAttribute('data-k', i)
      const fill = document.createElementNS(ns, 'rect')
      fill.setAttribute('x', x0)
      fill.setAttribute('y', barY)
      fill.setAttribute('width', 0)
      fill.setAttribute('height', barHeight)
      fill.setAttribute('rx', barHeight / 2)
      fill.setAttribute('class', 'sound-segment-fill')
      fill.setAttribute('data-k', i)
      this.svg.append(base, fill)
      if (timing) this.parts.push({ i, start: timing[0], end: timing[1], width: w, fill })
    }
    this.svg.style.display = ''
  }

  paint(time, k) {
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
    for (const part of this.parts) {
      const fraction = reduced || this.calm() ? Number(part.i === k) : Math.max(0, Math.min(1, (time - part.start) / Math.max(.01, part.end - part.start)))
      part.fill.setAttribute('width', part.width * fraction)
    }
  }

  hide() { this.svg.style.display = 'none'; this.rail.hidden = true; this.lineKey = '' }
  destroy() { cancelAnimationFrame(this.frame); window.removeEventListener('resize', this.resize); this.svg.remove(); this.rail.remove() }
}
