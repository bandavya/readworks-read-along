// Runs one reading buddy on the live reader. It only reads from the engine (the audio clock, the word spans, the timing
// tables) and draws in its own layer over the text; it writes nothing back, so the reader behaves the same with it on
// or off. A buddy is the same object the character lab uses: { room, css, setup, frame, on, layout }.
import { buildPath, mouthShut } from './readingHead.js'
import { timing } from '../engine/timing.js'

export function place(el, x, y, { ax = 0, ay = 0, rot = 0, sx = 1, sy = 1 } = {}) {
  el.style.transformOrigin = `${ax}px ${ay}px`
  el.style.transform = `translate(${x - ax}px, ${y - ay}px) rotate(${rot}deg) scale(${sx}, ${sy})`
}

export function svg(markup, { w, h, className = '' } = {}) {
  const el = document.createElement('div')
  el.className = className
  el.style.position = 'absolute'
  el.style.left = '0'
  el.style.top = '0'
  if (w) el.style.width = `${w}px`
  if (h) el.style.height = `${h}px`
  el.innerHTML = markup
  return el
}

// The letters' own box. A word span's box includes its padding, so it is taller than the letters.
function letterBox(el, base) {
  const range = document.createRange()
  range.selectNodeContents(el)
  const r = range.getClientRects()[0]
  if (!r || (!r.width && !r.height)) return null
  return { x: r.left - base.left, y: r.top - base.top, w: r.width, h: r.height }
}

export function runBuddy(engine, def, { kid = false, mouthStyle = null } = {}) {
  const host = engine.container
  const before = { position: host.style.position, lineHeight: host.style.lineHeight, paddingTop: host.style.paddingTop, paddingLeft: host.style.paddingLeft, paddingRight: host.style.paddingRight, paddingBottom: host.style.paddingBottom }
  if (getComputedStyle(host).position === 'static') host.style.position = 'relative'
  const room = def.room || {}
  // A paged reader has already fitted its text to its pages and clips what overflows, so its layout is left alone. A
  // scrolling reader can make room: words stay clear of a character parked at a side or along the bottom.
  if (engine.follow) {
    if (room.lineHeight) host.style.lineHeight = String(room.lineHeight)
    if (room.top) host.style.paddingTop = `${room.top}px`
    if (room.left) host.style.paddingLeft = `${room.left}px`
    if (room.right) host.style.paddingRight = `${room.right}px`
    if (room.bottom) host.style.paddingBottom = `${room.bottom}px`
  }
  // A reader that follows the voice keeps the current word above its safe line: move that line above the character too.
  const safeBottom = engine.getSafeBottom
  engine.getSafeBottom = () => safeBottom() - (engine.follow ? room.bottom || 0 : 0)

  const layer = document.createElement('div')
  layer.className = 'buddy-layer'
  layer.setAttribute('aria-hidden', 'true')
  layer.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:3;'
  host.append(layer)
  // The character's home: pinned to the screen, so it stays put in its corner while the text scrolls under it. It sits
  // below the reader's own controls and passes every tap through.
  const dock = document.createElement('div')
  dock.className = 'buddy-dock'
  dock.setAttribute('aria-hidden', 'true')
  dock.style.cssText = 'position:fixed;left:0;top:0;width:100vw;height:100dvh;pointer-events:none;z-index:40;overflow:hidden;'
  document.body.append(dock)
  // On a scrolling reader the character at the bottom stands on its own band, so text scrolls behind the band and never
  // behind the character. A paged reader has room on the page and needs none.
  const band = document.createElement('div')
  if (room.bottom && engine.follow) {
    let ground = 'transparent'
    for (let el = host; el && (ground === 'transparent' || ground === 'rgba(0, 0, 0, 0)'); el = el.parentElement) ground = getComputedStyle(el).backgroundColor
    band.style.cssText = `position:absolute;left:0;right:0;height:${room.bottom}px;background:${ground === 'rgba(0, 0, 0, 0)' ? 'Canvas' : ground};border-top:1px solid rgba(90,110,120,.25);`
    dock.append(band)
  }
  let style = null
  if (def.css) {
    style = document.createElement('style')
    style.textContent = def.css
    document.head.append(style)
  }

  // The prototype's theme bar, when it is on screen: the dock starts below it.
  const topInset = () => Math.max(0, parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--tb-h')) - scrollY || 0)
  const fired = {}
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)')
  const darkMode = matchMedia('(prefers-color-scheme: dark)')
  let path = null
  let known = new Set()
  let lastT = 0
  let clock = 0
  let cur = -1
  let lastPhase = ''
  let raf = 0
  let voice = null
  const ctx = {
    layer, dock, D: { w: 0, h: 0, bottomInset: 0 }, state: {}, words: [], lines: [], t: 0, dt: 0, wall: 0, head: null, playing: false, W: 0, H: 0, svg, place,
    headAt: (t) => path.at(t),
    // A point on the text (layer coordinates) in the dock's coordinates, right now.
    toDock: (p) => { const b = host.getBoundingClientRect(); return { x: p.x + b.left, y: p.y + b.top - topInset() } },
    since: (type) => (fired[type] === undefined ? Infinity : clock - fired[type]),
    lastEvent: (type) => fired[`${type}:data`],
    get calm() { return reducedMotion.matches },
    get dark() { return darkMode.matches },
    get rate() { return engine.audio.playbackRate },
    get mouthStyle() { return mouthStyle?.() ?? 'drawn' },
    kid,
  }
  const call = (name, ...a) => {
    try { return def[name]?.call(def, ctx, ...a) } catch (e) { console.error(`[buddy ${def.id}]`, e); return undefined }
  }
  const fire = (type, data) => {
    fired[type] = clock
    fired[`${type}:data`] = data
    call('on', type, data)
  }

  // The player bar sits along the bottom of the screen, so a character at the bottom stands on top of it.
  // A paged reader can't make room, so the character goes where the words aren't: on the reading panel's floor if the
  // space below this page's text is big enough, otherwise standing just above the text, over the picture.
  function pagedFloor() {
    const panel = host.parentElement.getBoundingClientRect().bottom
    if (!ctx.lines.length) return panel
    const base = host.getBoundingClientRect().top
    const textTop = base + Math.min(...ctx.lines.map((l) => l.y))
    const textBottom = base + Math.max(...ctx.lines.map((l) => l.y + l.h))
    return panel - textBottom >= (room.bottom || 0) ? panel : textTop - 6
  }

  function measureDock() {
    const floor = engine.follow ? safeBottom() : pagedFloor()
    const top = topInset()
    dock.style.top = `${top}px`
    dock.style.height = `${innerHeight - top}px`
    ctx.D = { w: innerWidth, h: Math.min(innerHeight, floor) - top }
    band.style.top = `${ctx.D.h - (room.bottom || 0)}px`
  }

  function measure() {
    voice = engine.voice
    const base = host.getBoundingClientRect()
    const items = []
    for (const k of engine.order) {
      const el = engine.words[k]
      const box = letterBox(el, base)
      if (!box) continue // on another page of a paged reader
      const [start, end] = timing(engine.voice, el)
      items.push({ k, text: el.textContent, start, end, page: 0, ...box })
    }
    if (!items.length) { path = null; return }
    items.sort((a, b) => a.start - b.start)
    path = buildPath(items)
    known = new Set(items.map((w) => w.k))
    ctx.words = items
    ctx.lines = path.lines
    ctx.W = host.clientWidth
    ctx.H = host.clientHeight
    measureDock()
  }

  function loop() {
    raf = requestAnimationFrame(loop)
    if (engine.voice !== voice || !path) measure()
    if (!path) return
    const t = engine.audio.currentTime
    const k = engine.curK
    // A word on a page we haven't measured means the page turned.
    if (k >= 0 && !known.has(k)) {
      measure()
      if (!path) return
      fire('page', { page: 0 })
      call('layout')
    }
    ctx.dt = Math.max(0, Math.min(t - lastT, 0.2))
    lastT = t
    clock = t
    ctx.t = t
    ctx.wall = performance.now() / 1000
    measureDock()
    ctx.playing = !engine.audio.paused
    const placed = ctx.calm ? path.calmAt(t, k) : path.forHighlight(t, k)
    const h = engine.audio.paused || engine.audio.ended ? mouthShut(placed) : placed
    ctx.head = h
    if (ctx.calm) { // Everything a character reads from the clock holds still until the word changes.
      ctx.t = h.word.start
      ctx.wall = h.word.start
    }
    // Nothing is lit (sound turned off, or a replay just ended): no dot either.
    layer.style.visibility = engine.quiet || !engine.enabled ? 'hidden' : ''
    if (k !== cur) {
      const prev = cur
      cur = k
      // Text can shift without the box changing size (a centered page settling, a late font): trust the letters.
      const stored = k >= 0 ? ctx.words.find((x) => x.k === k) : null
      const live = stored ? letterBox(engine.words[k], host.getBoundingClientRect()) : null
      if (live && (Math.abs(live.x - stored.x) > 1 || Math.abs(live.y - stored.y) > 1)) {
        measure()
        const moved = ctx.calm ? path.calmAt(t, k) : path.forHighlight(t, k)
        ctx.head = engine.audio.paused || engine.audio.ended ? mouthShut(moved) : moved
        call('layout')
      }
      if (k >= 0) {
        fire('word', { k, prev })
        const w = ctx.words.find((x) => x.k === k)
        const was = prev >= 0 ? ctx.words.find((x) => x.k === prev) : null
        if (was && w && was.line !== w.line) fire('line', { line: w.line, prev: was.line })
        if (h.long) fire('long', { k })
        if (prev < 0) fire('start', {})
        if (was && /[.!?]\W*$/.test(was.text)) fire('sentence', { k: prev })
      } else if (prev >= 0) fire('end', {})
    }
    if (h.phase === 'rest' && lastPhase !== 'rest') fire('pause', { seconds: h.gapLeft })
    lastPhase = h.phase
    call('frame')
  }

  const onTap = (e) => {
    const el = e.target.closest?.('.sa-w')
    if (el && engine.index.has(el)) fire('tap', { k: engine.index.get(el), from: cur })
  }
  host.addEventListener('click', onTap)
  const relayout = new ResizeObserver(() => { measure(); if (path) call('layout') })
  relayout.observe(host)
  measure()
  call('setup')
  raf = requestAnimationFrame(loop)

  return function stop() {
    cancelAnimationFrame(raf)
    relayout.disconnect()
    host.removeEventListener('click', onTap)
    call('teardown')
    layer.remove()
    dock.remove()
    style?.remove()
    Object.assign(host.style, before)
    engine.getSafeBottom = safeBottom
  }
}
