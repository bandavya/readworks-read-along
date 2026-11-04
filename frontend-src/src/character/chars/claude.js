// Copied from prototype/character_lab/chars/claude.js by character_lab/tools/to_app.py. Edit the lab file.
import { svg, place } from '../buddyDriver.js'
const cast = []
const CharLab = { register: (c) => cast.push(c), svg, place };
// Claude Opus's docked reading buddies. Each character stays put in ctx.dock and talks; the only thing on the text is
// its dot, in ctx.layer. Parts move by transform or opacity only. (The walking versions are saved outside the repo.)
(() => {
  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v))
  const lerp = (a, b, p) => a + (b - a) * p
  const ease = (p) => p * p * (3 - 2 * p)
  const DEG = 57.2958
  const STOP = /[.!?]+["')]?$/
  const INK = 'var(--ink)'

  // A filled shape with a line that is heavier on its lower right, the way a brush line sits under a drawing.
  const shape = (d, fill, w = 2.2, extra = '') => `<path d="${d}" fill="none" stroke="${INK}" stroke-width="${w + 1.3}" stroke-linecap="round" stroke-linejoin="round" transform="translate(.7 .9)"/><path d="${d}" fill="${fill}" stroke="${INK}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" ${extra}/>`
  const line = (d, w = 2, color = INK, extra = '') => `<path d="${d}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" ${extra}/>`

  function rig(ctx, markup) {
    const wrap = document.createElement('div')
    wrap.style.cssText = 'position:absolute;inset:0'
    wrap.innerHTML = `<svg width="100%" height="100%">${markup}</svg>`
    ctx.dock.append(wrap)
    const parts = {}
    wrap.querySelectorAll('[data-p]').forEach((e) => { parts[e.dataset.p] = e })
    return parts
  }
  const T = (el, x, y, r = 0, sx = 1, sy = sx) => {
    const s = `translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${r.toFixed(1)}) scale(${sx.toFixed(3)} ${sy.toFixed(3)})`
    if (el._t !== s) { el._t = s; el.setAttribute('transform', s) }
  }
  const O = (el, v) => { const s = clamp(v).toFixed(2); if (el._o !== s) { el._o = s; el.style.opacity = s } }
  const span = (el, x0, y0, x1, y1, amp = 1) => { const dx = x1 - x0; const dy = y1 - y0; T(el, x0, y0, Math.atan2(dy, dx) * DEG, Math.max(0.01, Math.hypot(dx, dy)), amp) }

  // The dot is its own small element in ctx.layer, painted once and only moved after that.
  function makeDot(c, size, inner) {
    const el = c.svg(`<svg width="${size}" height="${size}" viewBox="${-size / 2} ${-size / 2} ${size} ${size}">${inner}</svg>`, { w: size, h: size })
    el._s = size
    c.layer.append(el)
    const parts = {}
    el.querySelectorAll('[data-p]').forEach((e) => { parts[e.dataset.p] = e })
    el._parts = parts
    return el
  }
  const put = (c, el, x, y, rot = 0, sx = 1, sy = sx) => c.place(el, x, y, { ax: el._s / 2, ay: el._s / 2, rot, sx, sy })

  // Where the dot rides: under the letters. Line change: 'hop' goes out here and comes on there, with no travel;
  // otherwise it runs left in the gap between the lines, then drops in the margin, so it never crosses unread letters.
  function ride(c, r, hop) {
    const h = c.head; const w = h.word; const n = h.next
    const k = h.h / 36
    const under = (q) => q.y + q.h + (r - 1) * k
    if (c.calm) return { x: w.x + Math.min(w.w, 30) / 2, y: under(w), o: 1, k, moving: false }
    if (h.phase === 'page' || (hop && h.phase === 'sweep')) {
      const here = h.p < 0.5
      return { x: here ? w.x + w.w : n.x, y: under(here ? w : n), o: Math.abs(1 - h.p * 2), k, moving: true }
    }
    if (h.phase === 'sweep') {
      const x1 = w.x + w.w; const x0 = n.x - 13 * k; const y0 = under(w); const y1 = under(n)
      if (h.p < 0.72) return { x: lerp(x1, x0, ease(h.p / 0.72)), y: y0, o: 1, k, moving: true }
      const e = ease((h.p - 0.72) / 0.28)
      return { x: lerp(x0, n.x, e), y: lerp(y0, y1, e), o: 1, k, moving: true }
    }
    return { x: h.x, y: under(w), o: 1, k, moving: false }
  }

  // Turns toward the dot gently, from a point in the dock. Degrees; -90 is straight up.
  function aim(c, key, ox, oy, target, rate = 5) {
    const s = c.state
    const p = c.toDock({ x: target.x, y: target.y })
    const a = Math.atan2(p.y - oy, p.x - ox) * DEG
    if (s[key] === undefined || c.calm) s[key] = a
    else s[key] += (((a - s[key] + 540) % 360) - 180) * (1 - Math.exp(-c.dt * rate))
    return s[key]
  }
  // The mouth: 'shut' is a line that has this character's attitude; 'open' is a shape centered on (x, y).
  function say(c, m, x, y, base = 1) {
    const h = c.head
    const lips = c.calm ? { open: 0, wide: 0, round: 0 } : h.lips
    const on = clamp(lips.open * 7)
    const sx = 1 + lips.wide * 0.3 - lips.round * 0.32
    const sy = (1 - lips.wide * 0.42) * lips.open * 1.25
    O(m.shut, 1 - on); O(m.open, on)
    if (on > 0) T(m.open, x, y, 0, sx * base, Math.max(0.12, sy) * base)
  }
  const blinking = (c, seed, every = 4.1) => !c.calm && ((c.playing ? c.t : c.wall) + seed) % every < 0.13
  const startled = (c) => { const s = c.since('tap'); return s >= 0 && s < 0.5 ? 1 - s / 0.5 : 0 }
  const after = (c) => ({ te: c.t - c.head.word.end, gap: c.head.next ? c.head.next.start - c.head.word.end : 99 })
  // Back from the dock to a point on the text (the two differ only by a shift).
  const fromDock = (c, x, y) => { const o = c.toDock({ x: 0, y: 0 }); return { x: x - o.x, y: y - o.y } }

  // ---------------------------------------------------------------- Otis
  CharLab.register({
    id: 'claude-otis-dock', name: 'Otis', author: 'Claude Opus',
    tagline: 'A snail who keeps a stove in his shell. The light from his little window lands on the word',
    notes: 'The dot is a tiny lit window, so it is his and nobody else\'s. There is no beam: at a line change the light goes out at one end and comes on at the other. Risk: two eyes on stalks are fun to watch, so they only turn, slowly.',
    room: { top: 26, bottom: 120, lineHeight: 2.3 },
    setup(c) {
      const s = c.state
      const lidHalf = (r) => `M${-r - 0.5}-1C${-r}-${r}-${r / 2}-${r + 3} 0-${r + 3}C${r / 2}-${r + 3} ${r}-${r} ${r + 0.5}-1C${r / 2}-6-${r / 2}-6-${r + 0.5}-1Z`
      const lidShut = (r) => `M${-r - 0.5}-1C${-r}-${r}-${r / 2}-${r + 3} 0-${r + 3}C${r / 2}-${r + 3} ${r}-${r} ${r + 0.5}-1C${r} ${r - 2} ${r / 2} ${r} 0 ${r}C-${r / 2} ${r}-${r} ${r - 2}-${r + 0.5}-1Z`
      const lid = (name, r) => `<path data-p="${name}" d="${lidHalf(r)}" fill="#a7b35a" stroke="${INK}" stroke-width="1.5" stroke-linejoin="round"/><g data-p="${name}S"><path d="${lidShut(r)}" fill="#a7b35a" stroke="${INK}" stroke-width="1.5" stroke-linejoin="round"/>${line(`M${-r + 2} 1C-3 ${r / 2 + 1} 3 ${r / 2 + 1} ${r - 2} 1`, 1.8)}</g>`
      s.p = rig(c, `<defs><radialGradient id="cod-g"><stop offset="0" stop-color="#ffc23d" stop-opacity=".75"/><stop offset="1" stop-color="#ffc23d" stop-opacity="0"/></radialGradient></defs>
        <g data-p="root">
          <g data-p="puffs"><path data-p="pf1" d="M-6 0C-8-5-2-8 1-5C4-7 8-3 6 0C7 4 2 6 0 3C-3 6-8 4-6 0Z" fill="var(--muted)"/><path data-p="pf2" d="M-6 0C-8-5-2-8 1-5C4-7 8-3 6 0C7 4 2 6 0 3C-3 6-8 4-6 0Z" fill="var(--muted)"/></g>
          <g data-p="sB">${line('M0 0C-1-10-1-20 0-27', 7.5)}${line('M0 0C-1-10-1-20 0-27', 4, '#bcc86f')}
            <g transform="translate(0 -33)">${shape('M-9-1C-9-8-4-11 0-11C5-11 9-7 9-1C9 6 5 9 0 9C-5 9-9 6-9-1Z', '#fffdf4', 1.7)}
              <g data-p="irisB"><circle r="4.8" fill="#27576b"/><circle r="2.9" fill="#0f1417"/><circle cx="-1.5" cy="-1.8" r="1.2" fill="#fff"/></g>
              ${lid('lidB', 9)}</g></g>
          ${shape('M0 0C6-5 18-8 34-8H72C82-8 86-16 86-30C86-45 91-55 101-56C113-57 121-45 120-29C119-14 116-4 107 0Z', '#bcc86f')}
          ${line('M12-3C30-5 60-5 104-3', 1.4, '#7f8a3e')}${line('M22-1L20 2M40-1L39 2M58-1L58 2M76-1L77 2M94-1L96 2', 1.3)}
          <circle cx="104" cy="-24" r="5" fill="#e9a06a" opacity=".6"/>
          <g data-p="shut">${line('M103-16C107-12 113-13 117-18', 2)}</g>
          <g data-p="open">${shape('M-5-3C-3-6 3-6 5-3C6 1 3 5 0 5C-3 5-6 1-5-3Z', '#5a1d12', 1.5)}<path d="M-2.5 3C-1 1.5 1 1.5 2.5 3C1.5 4.5-1.5 4.5-2.5 3Z" fill="#e0705f"/></g>
          <g transform="rotate(-9 30 -78)">${shape('M23-74L25-96H38L40-74Z', '#6d5a4a', 2)}${shape('M20-96C24-99 39-99 43-96C44-93 43-92 41-92H22C20-92 19-93 20-96Z', '#3c3029', 1.6)}${line('M28-90L28-78', 1.3, '#8d7867')}</g>
          ${shape('M10-30C3-54 21-85 51-85C79-85 95-60 87-35C80-14 60-6 39-6C24-6 15-15 10-30Z', '#d0603c')}
          <path d="M87-35C80-14 60-6 39-6C24-6 15-15 10-30C21-17 36-13 50-15C67-17 80-25 87-35Z" fill="#a8402a"/>
          ${line('M47-47C51-52 59-49 58-42C57-33 43-30 36-38C27-48 34-65 49-66C66-67 78-53 74-37', 3.6, '#fbe6c8')}
          ${line('M15-44C17-58 26-72 39-78', 2.6, '#fff', 'opacity=".5"')}
          ${line('M90-50L95-52M92-42L97-43M64-82L66-87M78-73L82-77', 1.3)}
          <circle data-p="glow" cx="63" cy="-22" r="22" fill="url(#cod-g)"/>
          ${shape('M55-13V-25C55-34 71-34 71-25V-13C66-11 60-11 55-13Z', '#ffd978', 1.7)}${line('M63-32V-12M55-22H71', 1.3)}
          <g data-p="sA">${line('M0 0C1-12 0-24 0-34', 7.5)}${line('M0 0C1-12 0-24 0-34', 4, '#bcc86f')}
            <g transform="translate(0 -41)">${shape('M-10-1C-10-9-5-12 0-12C6-12 10-8 10-1C10 7 5 10 0 10C-5 10-10 7-10-1Z', '#fffdf4', 1.8)}
              <g data-p="irisA"><circle r="5.3" fill="#27576b"/><circle r="3.2" fill="#0f1417"/><circle cx="-1.7" cy="-2" r="1.3" fill="#fff"/></g>
              ${lid('lidA', 10)}</g></g>
        </g>`)
      s.dot = makeDot(c, 30, `<defs><radialGradient id="cod-d"><stop offset="0" stop-color="#ffb52e" stop-opacity=".7"/><stop offset="1" stop-color="#ffb52e" stop-opacity="0"/></radialGradient></defs>
        <circle r="10" fill="url(#cod-d)"/><path d="M-6.5 5.5V-1.5C-6.5-7.5 6.5-7.5 6.5-1.5V5.5Z" fill="#ec9a00"/>
        <path d="M0-5.5V5.5M-6.5-.5H6.5" stroke="#fff6d8" stroke-width="1.5"/>`)
    },
    frame(c) {
      const h = c.head; const s = c.state; const p = s.p
      const ax = 16; const ay = c.D.h - 9
      T(p.root, ax, ay)
      const d = ride(c, 7, true)
      const start = c.calm ? 0 : startled(c)
      const settle = c.calm || h.phase !== 'word' ? 1 : clamp(h.wordP * 7)
      O(s.dot, h.phase === 'after' ? d.o * (1 - clamp((c.t - h.word.end - 0.8) / 0.4)) : d.o)
      put(c, s.dot, d.x, d.y, (d.x / Math.max(c.W, 1) - 0.5) * 8, d.k * (1.14 - 0.14 * settle))
      O(p.glow, lerp(0.35, 1, d.o))
      const a = (aim(c, 'aA', ax + 108, ay - 52, d, 3.5) + 90) * 0.65
      if (h.phase !== 'word' || s.aB === undefined) aim(c, 'aB', ax + 94, ay - 52, d, 3)
      const b = (s.aB + 90) * 0.6
      const rest = !c.calm && h.phase === 'rest'
      T(p.sA, 108, -52, clamp(a, -48, 42), 1, 1 + start * 0.1)
      T(p.sB, 94, -52, clamp(rest ? b - 18 * ease(clamp(h.p * 3)) : b, -52, 24), 1, 1 + start * 0.12)
      const pup = rest ? -2.4 : -3.2
      T(p.irisA, 0, pup, 0, 1 + start * 0.15); T(p.irisB, 0, pup)
      const done = h.phase === 'after' && c.t - h.word.end > 1
      const shutA = blinking(c, 1.3, 3.7) || done; const shutB = blinking(c, 1.45, 3.7) || done
      O(p.lidA, start > 0 || shutA ? 0 : 1); O(p.lidAS, shutA ? 1 : 0)
      O(p.lidB, start > 0 || shutB ? 0 : 1); O(p.lidBS, shutB ? 1 : 0)
      say(c, p, 110, -18)
      // Business only in a silence: a puff from the stove.
      const puff = rest ? h.p : start > 0 ? 1 - start : -1
      O(p.puffs, puff >= 0 && puff < 1 ? 0.55 * (1 - puff) : 0)
      if (puff >= 0) {
        T(p.pf1, 30 - puff * 3, -102 - puff * 14, 0, 0.7 + puff * 0.5)
        T(p.pf2, 26 - puff * 7, -104 - puff * 7, 0, 0.3 + puff * 0.6)
      }
    },
  })

  // ---------------------------------------------------------------- Pearl
  CharLab.register({
    id: 'claude-pearl-dock', name: 'Pearl', author: 'Claude Opus',
    tagline: 'A dung beetle in pearls, sitting on the giant period she pushed here, bouncing the sun off her hand mirror',
    notes: 'Her mirror catches the light and the glint lands on the word. A thin wedge of light shows only during a line change, and she taps her period with one foot at the end of a sentence. Risk: she is vain and funny, so everything but her mouth and mirror holds still while she reads.',
    room: { top: 26, bottom: 136, lineHeight: 2.3 },
    setup(c) {
      const s = c.state
      s.p = rig(c, `<defs><radialGradient id="cpd-m" cx=".35" cy=".3"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#b9d3dc"/></radialGradient></defs>
        <g data-p="beam" opacity="0"><path d="M0-1L1 0L0 1Z" fill="#f0b400" opacity=".3"/></g>
        <g data-p="root">
          <g data-p="kick">${line('M0 0C-5 4-10 8-11 14', 3)}${line('M-11 14L-16 15', 3)}</g>
          <circle cx="-30" cy="-22" r="23" fill="${INK}" stroke="var(--card)" stroke-width="2.5"/>
          ${line('M-46-28C-44-35-38-40-31-41', 2.2, 'var(--card)', 'opacity=".55"')}<circle cx="-22" cy="-10" r="1.4" fill="var(--card)" opacity=".5"/><circle cx="-36" cy="-12" r="1" fill="var(--card)" opacity=".4"/>
          ${line('M-44-42C-50-36-55-30-56-22L-61-20', 3)}
          ${shape('M-12-58C-10-78-24-92-42-88C-58-84-64-66-58-52C-53-40-38-36-26-40C-17-43-13-50-12-58Z', '#1d7f71')}
          <path d="M-12-58C-13-50-17-43-26-40C-38-36-53-40-58-52C-48-42-34-42-25-47C-18-51-14-54-12-58Z" fill="#12564c"/>
          ${line('M-22-82C-34-77-45-63-48-44', 1.8)}
          <path d="M-25-84C-36-87-48-81-52-69C-46-77-36-82-25-84Z" fill="#7bdcc6" opacity=".85"/>
          <g data-p="head">
            ${line('M-58-104C-61-110-66-112-71-110M-71-110L-77-114M-71-110L-78-109M-71-110L-76-105', 1.9)}
            ${line('M-46-105C-46-112-50-116-55-116M-55-116L-59-121M-55-116L-61-117M-55-116L-61-113', 1.9)}
            ${shape('M-38-92C-38-104-50-110-62-106C-74-102-80-90-78-78L-81-74L-77-72L-78-68L-73-67C-66-62-52-62-44-68C-39-73-38-82-38-92Z', '#176a5e')}
            <g data-p="shut">${line('M-77-74C-72-71-68-71-63-74', 2)}</g>
            <g data-p="open">${shape('M-5-3C-3-5 3-5 5-3C6 1 3 4 0 4C-3 4-6 1-5-3Z', '#3a120c', 1.4)}</g>
            ${shape('M-72-92C-72-100-66-104-60-104C-53-104-48-99-48-92C-48-85-53-80-60-80C-67-80-72-85-72-92Z', '#fffdf4', 1.7)}
            <g data-p="pupil"><circle r="4.3" fill="#141a1d"/><circle cx="-1.4" cy="-1.6" r="1.3" fill="#fff"/></g>
            <path data-p="lid" d="M-73-92C-73-101-66-105-60-105C-53-105-47-100-47-92C-53-97-66-97-73-92Z" fill="#12564c" stroke="${INK}" stroke-width="1.5" stroke-linejoin="round"/>
            <g data-p="lidFull"><path d="M-73-92C-73-101-66-105-60-105C-53-105-47-100-47-92C-48-84-53-79-60-79C-67-79-72-84-73-92Z" fill="#176a5e" stroke="${INK}" stroke-width="1.5" stroke-linejoin="round"/>${line('M-70-90C-65-85-55-85-50-90', 2)}</g>
            ${line('M-75-103C-69-109-58-111-51-108', 2.6)}
          </g>
          <g fill="#fff" stroke="#27333a" stroke-width=".9"><circle cx="-41" cy="-83" r="3.1"/><circle cx="-39.5" cy="-77" r="3.1"/><circle cx="-41" cy="-71" r="3.1"/><circle cx="-45" cy="-66" r="3.1"/><circle cx="-50.5" cy="-63" r="3.1"/></g>
          <g data-p="mirror">
            ${line('M0 2C0-6 0-14 0-23', 3.6, '#a8762a')}
            ${shape('M-12-37C-12-45-7-51 0-51C7-51 12-45 12-37C12-29 7-23 0-23C-7-23-12-29-12-37Z', '#e8ae3d', 2)}
            <path d="M-8.5-37C-8.5-43-5-47 0-47C5-47 8.5-43 8.5-37C8.5-31 5-27 0-27C-5-27-8.5-31-8.5-37Z" fill="url(#cpd-m)"/>
            <path d="M3-46C4-42 5-41 8-40C5-39 4-38 3-34C2-38 1-39-2-40C1-41 2-42 3-46Z" fill="#fff"/>
          </g>
          ${line('M-50-60C-62-55-78-54-91-57', 3.2)}
        </g>`)
      s.dot = makeDot(c, 30, `<defs><radialGradient id="cpd-d"><stop offset="0" stop-color="#ffc21f" stop-opacity=".7"/><stop offset="1" stop-color="#ffc21f" stop-opacity="0"/></radialGradient></defs>
        <circle r="10" fill="url(#cpd-d)"/><path d="M0-8C1-2.5 2.5-1 8 0C2.5 1 1 2.5 0 8C-1 2.5-2.5 1-8 0C-2.5-1-1-2.5 0-8Z" fill="#e39a00"/><circle r="1.8" fill="#fff8d8"/>`)
    },
    frame(c) {
      const h = c.head; const s = c.state; const p = s.p
      const ax = c.D.w - 12; const ay = c.D.h - 9
      T(p.root, ax, ay)
      const d = ride(c, 7, false)
      const { te, gap } = after(c)
      const stop = !c.calm && STOP.test(h.word.text) && h.phase !== 'word' && h.phase !== 'before'
      const ping = stop ? Math.sin(clamp(te / 0.3) * Math.PI) : 0
      const start = c.calm ? 0 : startled(c)
      O(s.dot, h.phase === 'after' ? 1 - clamp((te - 0.7) / 0.4) : d.o)
      const size = d.k * 0.88 * (1 + ping * 0.2 + start * 0.2 + (c.calm || h.phase !== 'word' ? 0 : (1 - clamp(h.wordP * 8)) * 0.08))
      put(c, s.dot, d.x, d.y, c.calm ? 0 : d.x * 0.9, size)
      // The mirror turns toward the glint. At the very end she turns it back and has a look at herself.
      const hx = -92; const hy = -58
      const a = aim(c, 'a', ax + hx, ay + hy, d, 4.5) + 90
      const vain = h.phase === 'after' ? ease(clamp((te - 0.9) / 0.5)) : 0
      const rot = lerp(clamp(a * 0.7, -62, -6), 28, vain)
      T(p.mirror, hx, hy, rot)
      p.head.setAttribute('transform', `rotate(${clamp((a + 35) * 0.1, -5, 5).toFixed(1)} -42 -72)`)
      // Beam: a thin wedge of light from the mirror, only while the glint moves between lines.
      const beam = h.phase === 'sweep' && !c.calm ? Math.sin(h.p * Math.PI) : 0
      O(p.beam, beam)
      if (beam > 0) {
        const r = rot / DEG
        const t = c.toDock({ x: d.x, y: d.y })
        span(p.beam, ax + hx + 37 * Math.sin(r), ay + hy - 37 * Math.cos(r), t.x, t.y, 6)
      }
      // Eye on the glint, in head space.
      const dd = c.toDock(d)
      const look = Math.atan2(dd.y - (ay - 92), dd.x - (ax - 60))
      const toMirror = vain > 0.4
      T(p.pupil, -60 + (toMirror ? -3.5 : Math.cos(look) * 3.6), -92 + (toMirror ? 2 : Math.sin(look) * 3.6), 0, 1 + start * 0.2)
      const blink = blinking(c, 0.7, 3.3) || (h.phase === 'rest' && gap > 0.7 && te > 0.3 && te < 0.55)
      O(p.lidFull, blink ? 1 : 0)
      O(p.lid, start > 0 ? 0 : 1)
      say(c, p, -71, -71)
      // A small "tok" with her foot on the period at the end of a sentence.
      T(p.kick, -40, -38, stop ? -Math.sin(clamp(te / 0.35) * Math.PI) * 26 : 0)
    },
  })

  // ---------------------------------------------------------------- Q
  const letterU = (fill) => `<path d="M-12-15H-5V-3C-5 2 2 3 4-1V-15H11V7H4V4C-1 9-12 8-12-3Z" fill="${fill}"/>`
  CharLab.register({
    id: 'claude-q-dock', name: 'Q', author: 'Claude Opus',
    tagline: 'The letter Q, sliding down each page with a flashlight, searching every word for her lost U',
    notes: 'A letter with a problem a six-year-old can explain. Her light is a round dot until a word has a u in it; then the dot turns into a tiny u and she gasps, so children start hunting for it too. At the very end her u comes home. Risk: the gasp pulls the eye, so it is only her eyes and the dot.',
    room: { top: 26, right: 74, bottom: 24, lineHeight: 2.3 },
    setup(c) {
      const s = c.state
      s.p = rig(c, `<defs><linearGradient id="cqd-b"><stop offset="0" stop-color="#ffc23d" stop-opacity=".55"/><stop offset="1" stop-color="#ffc23d" stop-opacity="0"/></linearGradient></defs>
        <g data-p="root">
          <g data-p="scarf">${shape('M1 0C-7 3-12 2-18 6L-20 16C-13 11-7 12 2 10Z', '#d4472f', 1.6)}${line('M-8 3L-9 11M-14 5L-15 13', 2, '#fff3d8')}</g>
          <ellipse rx="18" ry="26" transform="rotate(-12)" fill="#ffd978"/>
          <g data-p="eyes"><g transform="translate(-8 -9)"><ellipse data-p="eL" rx="5.4" ry="7.2" fill="#141a1d"/><circle cx="-1.5" cy="-2.8" r="1.8" fill="#fff"/></g>
            <g transform="translate(5 -11)"><ellipse data-p="eR" rx="5.4" ry="7.2" fill="#141a1d"/><circle cx="-1.5" cy="-2.8" r="1.8" fill="#fff"/></g></g>
          <path data-p="lids" d="M-15-10C-14-20-3-21-2-13C-5-10-11-9-15-10ZM-1-13C0-23 11-23 12-14C8-11 3-10-1-13Z" fill="#e8b84a" stroke="${INK}" stroke-width="1.5" stroke-linejoin="round"/>
          ${line('M-16-19C-13-23-7-24-4-22M1-25C4-27 9-27 12-24', 2.2, '#7a4a12')}
          <g data-p="shut">${line('M-9 8C-5 12 1 12 6 6', 2.2, '#5a2c0a')}</g>
          <g data-p="open"><path d="M-5-3C-3-6 3-6 5-3C6 2 3 5 0 5C-3 5-6 2-5-3Z" fill="#5a1d12"/><path d="M-3 3C-1 1.5 1 1.5 3 3C1 5-1 5-3 3Z" fill="#e0705f"/></g>
          <path d="M3-33C22-33 34-18 33 1C32 20 18 33-3 33C-22 33-34 18-33-1C-32-20-17-33 3-33ZM-5-26C-15-24-20-11-18 4C-16 17-9 28 4 26C14 24 20 10 18-4C15-17 8-28-5-26Z" fill-rule="evenodd" fill="${INK}" stroke="var(--card)" stroke-width="2" paint-order="stroke"/>
          <path d="M3 15C10 21 20 28 26 35C31 45 18 57-2 57C-8 57-13 56-18 53C-12 53-7 52-2 51C14 51 23 44 20 38C15 31 8 25-1 20Z" fill="${INK}"/>
          <g data-p="torch">
            <path d="M19-7L31-10V10L19 7Z" fill="url(#cqd-b)"/>
            ${shape('M-7-4.5H11L17-8V8L11 4.5H-7Z', '#d4472f', 1.6)}
            ${shape('M17-8C20-4 20 4 17 8C15 4 15-4 17-8Z', '#ffd978', 1.3)}
            ${line('M-2-5V5M2-5V5', 2.2)}
          </g>
        </g>
        <g data-p="u"><g transform="scale(1.35)">${letterU(INK)}</g><circle cx="-11" cy="-12" r="3.1" fill="#fff"/><circle cx="10" cy="-12" r="3.1" fill="#fff"/><circle cx="-12" cy="-12" r="1.7" fill="#141a1d"/><circle cx="9" cy="-12" r="1.7" fill="#141a1d"/></g>`)
      s.dot = makeDot(c, 30, `<defs><radialGradient id="cqd-d"><stop offset="0" stop-color="#ffb52e" stop-opacity=".7"/><stop offset="1" stop-color="#ffb52e" stop-opacity="0"/></radialGradient></defs>
        <circle r="9.500" fill="url(#cqd-d)"/><g data-p="round"><circle r="5" fill="#ec9a00"/><circle cx="-1.5" cy="-1.5" r="1.3" fill="#fff6d8"/></g>
        <g data-p="uu"><g transform="scale(.56) translate(.5 3)">${letterU('#d07f00')}</g></g>`)
    },
    frame(c) {
      const h = c.head; const s = c.state; const p = s.p; const w = h.word
      const { te } = after(c)
      const ending = h.phase === 'after' && !c.calm
      const q = ending ? ease(clamp((te - 0.6) / 0.8)) : 0
      const ax = c.D.w - 40 - q * 34; const ay = clamp(c.D.h * 0.6, 120, c.D.h - 72)
      T(p.root, ax, ay)
      const d = ride(c, 7, false)
      // The dot: round, or a little u when the word has one.
      const hasU = /u/i.test(w.text)
      const gasp = !c.calm && hasU && h.phase === 'word' ? ease(clamp(h.wordP * 4)) : 0
      const sigh = !c.calm && hasU && h.phase !== 'word' && h.phase !== 'before' ? 1 - clamp(te / 0.45) : 0
      const uShow = c.calm ? (hasU ? 1 : 0) : gasp
      O(s.dot._parts.round, 1 - uShow); O(s.dot._parts.uu, uShow)
      O(s.dot, ending ? 1 - clamp((te - 0.4) / 0.3) : d.o)
      put(c, s.dot, d.x, d.y, 0, d.k * (1 + (c.calm ? 0 : uShow * 0.16)))
      // Flashlight: rotation only; the tail holds it.
      const tx = -18; const ty = 53
      const a = aim(c, 'a', ax + tx, ay + ty, d, 4.5)
      T(p.torch, tx, ty, ending ? lerp(a, -20, q) : a)
      T(p.scarf, -23, -24, h.phase === 'rest' ? Math.sin(c.t * 6) * 3 : 0)
      const dd = c.toDock(d)
      const look = Math.atan2(dd.y - ay, dd.x - ax)
      const start = c.calm ? 0 : startled(c)
      T(p.eyes, q > 0.05 ? 3 : Math.cos(look) * 2.6, q > 0.05 ? 0 : Math.sin(look) * 3)
      const big = (1 + gasp * 0.22 + start * 0.28).toFixed(2)
      p.eL.setAttribute('transform', `scale(${big})`); p.eR.setAttribute('transform', `scale(${big})`)
      O(p.lids, sigh > 0.02 || blinking(c, 0.4, 3.1) ? 1 : 0)
      say(c, p, -1, 10, 1.05)
      // The end of the story: her u comes home, and for one moment they are a Qu.
      O(p.u, q > 0 ? 1 : 0)
      if (q > 0) {
        const from = c.toDock({ x: w.x + w.w, y: w.y + w.h + 8 })
        T(p.u, lerp(from.x, ax + 56, q), lerp(from.y, ay + 18, q) - Math.sin(q * Math.PI) * 26, Math.sin(q * Math.PI * 3) * 8 * (1 - q), lerp(0.4, 1, q))
      }
    },
  })

  // ---------------------------------------------------------------- Longfellow
  CharLab.register({
    id: 'claude-longfellow-dock', name: 'Mr. Longfellow', author: 'Claude Opus',
    tagline: 'So tall he has to lean in upside down from the top corner. His pet firefly does the pointing',
    notes: 'A firefly leaves his jar, sits under each word, and flies home at the end, with nothing joining them at all. Talking upside down is silly on its own, so the fun is up in the corner while the firefly is on the word. Risk: the firefly is lively, so it barely flutters while the voice speaks.',
    room: { top: 118, bottom: 24, lineHeight: 2.3 },
    setup(c) {
      const s = c.state
      const stripes = (d) => `${line(d, 11)}${line(d, 7.5, '#fff3d8')}${line(d, 7.5, '#d4472f', 'stroke-dasharray="7 8" style="stroke-linecap:butt"')}`
      s.p = rig(c, `<defs><radialGradient id="cld-j"><stop offset="0" stop-color="#d8f04a" stop-opacity=".9"/><stop offset="1" stop-color="#d8f04a" stop-opacity="0"/></radialGradient></defs>
        <g data-p="root">
          <g data-p="jar">
            ${stripes('M-112-6C-111 8-112 20-112 34')}
            <circle data-p="jarGlow" cx="-112" cy="68" r="26" fill="url(#cld-j)"/>
            ${shape('M-126 50C-128 56-128 80-125 87C-120 91-104 91-99 87C-96 80-96 56-98 50Z', 'rgba(170,215,225,.28)', 1.8)}
            ${shape('M-127 44H-97V50H-127Z', '#b08a4e', 1.6)}
            ${line('M-121 56C-122 64-122 74-120 82', 2.4, '#fff', 'opacity=".75"')}
            ${shape('M-119 44C-121 38-119 32-114 31C-109 30-105 33-105 38C-105 41-105 43-106 44Z', '#8f9de6', 1.8)}${line('M-114 36V43M-110 36V43', 1.3)}
          </g>
          <g data-p="neck">${line('M0-10V13', 25)}${line('M0-10V13', 21, '#fff3d8')}${line('M0-10V13', 21, '#d4472f', 'stroke-dasharray="6 7" style="stroke-linecap:butt"')}</g>
          <g data-p="head">
            ${shape('M-37 42C-48 34-52 58-37 60Z', '#7584d4', 1.8)}${shape('M37 42C48 34 52 58 37 60Z', '#7584d4', 1.8)}
            ${shape('M-27 12C-35 34-41 58-37 74C-29 92 29 92 37 74C41 58 35 34 27 12C14 5-14 5-27 12Z', '#8f9de6')}
            <path d="M37 74C29 92-29 92-37 74C-29 84 29 84 37 74Z" fill="#7584d4"/>
            <circle cx="-23" cy="42" r="6" fill="#e9829a" opacity=".5"/><circle cx="23" cy="42" r="6" fill="#e9829a" opacity=".5"/>
            <g data-p="shut">${line('M-13 26C-7 20 7 20 13 26', 2.6)}${line('M-16 28C-15 26-14 26-13 26M16 28C15 26 14 26 13 26', 1.6)}</g>
            <g data-p="open">${shape('M-7 3C-4 6 4 6 7 3C8-2 4-7 0-7C-4-7-8-2-7 3Z', '#4a1c28', 1.7)}<path d="M-4-3C-2-6 2-6 4-3C2-1-2-1-4-3Z" fill="#e0705f"/></g>
            ${shape('M-5 49C-8 43-13 38-7 33C-2 29 7 29 9 35C11 40 7 44 5 49', '#7584d4', 1.7)}
            <g transform="translate(-16 58)">${shape('M-10 0C-10-7-6-11 0-11C6-11 10-7 10 0C10 8 6 12 0 12C-6 12-10 8-10 0Z', '#fffdf4', 1.8)}<g data-p="pL"><circle r="4.8" fill="#141a1d"/><circle cx="1.5" cy="1.6" r="1.4" fill="#fff"/></g></g>
            <g transform="translate(16 58)">${shape('M-10 0C-10-7-6-11 0-11C6-11 10-7 10 0C10 8 6 12 0 12C-6 12-10 8-10 0Z', '#fffdf4', 1.8)}<g data-p="pR"><circle r="4.8" fill="#141a1d"/><circle cx="1.5" cy="1.6" r="1.4" fill="#fff"/></g></g>
            <g data-p="lidL"><path d="M-27 58C-27 66-22 71-16 71C-10 71-5 66-5 58C-5 50-10 46-16 46C-22 46-27 50-27 58Z" fill="#7584d4" stroke="${INK}" stroke-width="1.7"/>${line('M-24 55C-20 51-12 51-8 55', 2)}</g>
            <path d="M-31 70C-26 78-11 78-5 72C-13 73-25 74-31 70ZM31 70C26 78 11 78 5 72C13 73 25 74 31 70Z" fill="#54382a" stroke="${INK}" stroke-width="1.5" stroke-linejoin="round"/>
            ${line('M-13 82C-5 85 5 85 13 82M-7 86C-3 87 3 87 7 86', 1.3)}${line('M0 87V93', 1.6)}
            <g data-p="hat">${shape('M-13 0H13L10 2C9 9 5 12 0 12S-9 9-10 2Z', '#2e3a44', 1.5)}${line('M-16 0H16', 3)}${line('M-10 4H10', 2.4, '#d4472f')}</g>
          </g>
        </g>`)
      s.dot = makeDot(c, 34, `<defs><radialGradient id="cld-d"><stop offset="0" stop-color="#d8f04a" stop-opacity=".95"/><stop offset=".45" stop-color="#d8f04a" stop-opacity=".4"/><stop offset="1" stop-color="#d8f04a" stop-opacity="0"/></radialGradient></defs>
        <circle cx="-3" r="9" fill="url(#cld-d)"/>
        <g data-p="wing"><path d="M-1-2C-4-6-2-8 1-7C3-6 3-4 1-2Z" fill="#cfe6ee" stroke="#27333a" stroke-width=".8"/></g>
        <path d="M-7 0C-7-3-3-4 0-3C3-3 4-1 4 1C4 2 2 3 0 3C-4 3-7 3-7 0Z" fill="#b6d300" stroke="#27333a" stroke-width="1"/>
        <path d="M-1-3C1-4 6-3 6 0C6 2 3 3 0 3C1 1 1-1-1-3Z" fill="#2b2118"/><circle cx="4.5" cy="-.5" r="1" fill="#fff"/>`)
    },
    frame(c) {
      const h = c.head; const s = c.state; const p = s.p
      const ax = c.D.w - 62; const ay = 0
      T(p.root, ax, ay)
      const { te, gap } = after(c)
      const d = ride(c, 8, false)
      const jar = fromDock(c, ax - 112, ay + 68)
      const first = c.words[0]
      let x = d.x; let y = d.y; let o = d.o; let home = 0
      if (!c.calm && h.phase === 'before') { // Out of the jar, along the band above the text, down in the margin.
        const f = clamp(c.t / Math.max(first.start, 0.01))
        const mx = first.x - 12; const band = Math.max(8, first.y - 12)
        if (f < 0.72) { const e = ease(f / 0.72); x = lerp(jar.x, mx, e); y = lerp(jar.y, band, e) - Math.sin(e * Math.PI) * 14 } else { const e = ease((f - 0.72) / 0.28); x = lerp(mx, first.x, e); y = lerp(band, d.y, e) }
        o = clamp(f * 8)
        home = 1 - f
      }
      if (!c.calm && h.phase === 'after') { // Home again.
        const f = ease(clamp((te - 0.5) / 0.9))
        x = lerp(d.x, jar.x, f); y = lerp(d.y, jar.y, f) - Math.sin(f * Math.PI) * 30
        o = 1 - clamp((f - 0.9) * 10)
        home = f
      }
      const moving = d.moving || h.phase === 'before' || h.phase === 'after'
      s.face = c.dt > 0 && Math.abs(h.vx) > 30 ? Math.sign(h.vx) : (s.face || 1)
      const flip = h.phase === 'before' || h.phase === 'after' ? -1 : s.face
      O(s.dot, o)
      const rest = h.phase === 'rest'
      const breathe = rest ? 1 + Math.sin(clamp(h.p) * Math.PI) * 0.12 : 1
      put(c, s.dot, x, y, 0, flip * d.k * breathe, d.k * breathe)
      T(s.dot._parts.wing, 0, 0, c.calm ? 0 : moving ? Math.sin(c.t * 46) * 26 : rest ? -8 : Math.sin(c.t * 18) * 5)
      O(p.jarGlow, c.calm ? 0.45 : lerp(0.3, 1, home))
      // He tips his head a little toward it, and looks.
      const px = c.toDock({ x, y })
      const lean = clamp((px.x - ax) * 0.02, -6, 6)
      s.lean = s.lean === undefined || c.calm ? lean : h.phase === 'word' ? s.lean : lerp(s.lean, lean, 1 - Math.exp(-c.dt * 4))
      p.head.setAttribute('transform', `rotate(${(-s.lean).toFixed(2)} 0 8)`)
      const look = Math.atan2(px.y - (ay + 58), px.x - ax)
      const lx = Math.cos(look) * 3.8; const ly = Math.sin(look) * 4.4
      T(p.pL, lx, ly); T(p.pR, lx, ly)
      const start = c.calm ? 0 : startled(c)
      const wink = h.phase === 'after' && te > 1.6 && te < 2.1
      O(p.lidL, wink || blinking(c, 0.2, 2.9) ? 1 : 0)
      say(c, p, 0, 26, 1.15)
      // The hat dangles from its strap; it only swings when he stops talking, or if a tap makes him jump.
      const pauseSwing = rest && gap > 0.7 ? Math.sin(te * 5.2) * 11 * Math.exp(-te * 0.8) : 0
      T(p.hat, 0, 92, pauseSwing + start * Math.sin(c.t * 22) * 16, 1.25)
    },
  })

  // ---------------------------------------------------------------- Gladys
  CharLab.register({
    id: 'claude-gladys-dock', name: 'Gladys', author: 'Claude Opus',
    tagline: 'A deep-sea anglerfish in reading glasses, in a fishbowl, reading by her own light',
    notes: 'The bulb on her head and the dot on the word are the same light: they glow together, swell together on a long word, and go dim together at a line change. No beam is needed to see they belong to each other. Risk: an underbite is funny up close and a lot to look at, so her jaw moves only a little.',
    room: { top: 26, bottom: 136, lineHeight: 2.3 },
    setup(c) {
      const s = c.state
      s.p = rig(c, `<defs><radialGradient id="cgd-b"><stop offset="0" stop-color="#2be0cf" stop-opacity=".85"/><stop offset="1" stop-color="#2be0cf" stop-opacity="0"/></radialGradient></defs>
        <g data-p="root">
          <path d="M6-70C2-62 1-54 1-46C1-20 22 0 54 0C86 0 107-20 107-46C107-54 106-62 102-70C88-64 72-74 54-70C36-66 20-76 6-70Z" fill="#7fd0de" opacity=".42"/>
          ${line('M12-8C26 0 36 2 54 2C72 2 84 0 96-8', 2, '#c9b78a')}
          <path d="M22-5C26-9 32-9 34-5ZM40-2C44-6 50-6 52-2ZM64-3C68-7 74-7 76-3ZM80-6C83-9 88-9 89-7Z" fill="#c9b78a"/>
          <g transform="translate(10 -3) scale(.88)"><g data-p="tail">${shape('M4 2C-1-8-5-14-5-20C-2-16 1-14 2-14C0-20 0-26 2-32C5-27 9-22 12-18Z', '#6a4a93', 1.8)}</g>
          ${shape('M10-30C8-52 28-68 54-67C78-66 96-54 96-36C97-30 96-27 95-24C96-16 92-11 84-9C66-5 44-5 28-12C18-16 11-22 10-30Z', '#4b2f6e')}
          <path d="M28-12C44-5 66-5 84-9C90-11 94-14 95-20C80-14 58-14 42-18C32-20 22-24 14-26C17-20 22-15 28-12Z" fill="#8a68ad"/>
          <g fill="#6fe7da"><circle cx="24" cy="-44" r="1.5"/><circle cx="34" cy="-52" r="1.5"/><circle cx="26" cy="-34" r="1.3"/><circle cx="36" cy="-42" r="1.3"/><circle cx="44" cy="-58" r="1.3"/></g>
          ${shape('M30-26C22-24 18-18 22-14C28-14 36-18 38-24C36-27 33-27 30-26Z', '#6a4a93', 1.6)}
          <g data-p="shut">${line('M58-20C66-16 80-17 95-24', 2.6)}</g>
          <g data-p="open">${shape('M-17-3C-8-6 8-6 17-5C17 2 8 7-2 6C-9 6-15 2-17-3Z', '#23102c', 1.8)}<path d="M-9 2C-3-1 5-1 9 1C5 5-5 5-9 2Z" fill="#c55a78"/></g>
          <path d="M66-17L69-25L73-16ZM86-21L90-30L93-22Z" fill="#fff6dc" stroke="${INK}" stroke-width="1.3" stroke-linejoin="round"/>
          
          <circle cx="65" cy="-44" r="14" fill="#fffdf4" stroke="${INK}" stroke-width="3"/>
          <g data-p="pupil"><circle r="5.8" fill="#17272e"/><circle cx="-1.8" cy="-2" r="1.6" fill="#fff"/></g>
          <path d="M53-50C56-56 61-58 66-58" fill="none" stroke="#b9dbe6" stroke-width="2" stroke-linecap="round"/>
          <path data-p="lid" d="M51-44C51-53 57-58 65-58C73-58 79-53 79-44C72-49 58-49 51-44Z" fill="#6a4a93" stroke="${INK}" stroke-width="1.5" stroke-linejoin="round"/>
          <g data-p="lidFull"><path d="M51-44C51-53 57-58 65-58C73-58 79-53 79-44C79-36 73-30 65-30C57-30 51-36 51-44Z" fill="#6a4a93" stroke="${INK}" stroke-width="1.5"/>${line('M55-41C60-36 70-36 75-41', 2.2, '#2a1a40')}</g>
          ${line('M51-46L40-52', 2.6)}
          <g data-p="brow">${line('M55-60C60-63 70-63 76-59', 3, '#cbb5e6')}</g></g>
          <g data-p="bubs" fill="none" stroke="${INK}" stroke-width="1.2"><circle data-p="b1" r="3"/><circle data-p="b2" r="2"/></g>
          ${line('M24-98C8-86 1-66 1-46C1-20 22 0 54 0C86 0 107-20 107-46C107-66 100-86 84-98', 2.4)}
          ${line('M11-58C9-44 13-28 22-18', 3, '#fff', 'opacity=".7"')}${line('M95-68C98-60 99-54 99-48', 2.4, '#fff', 'opacity=".6"')}
          ${shape('M22-102C22-105 86-105 86-102C88-99 86-97 84-97C66-94 42-94 24-97C22-97 20-99 22-102Z', '#dff1f5', 1.8)}
          <g data-p="lure">
            ${line('M0 0C-6-20-4-44 8-55', 3.6)}${line('M0 0C-6-20-4-44 8-55', 1.8, '#8a68ad')}
            <g transform="translate(10 -57)"><circle data-p="halo" r="17" fill="url(#cgd-b)"/>${shape('M-5-1C-5-5-2-7 1-6C5-6 7-3 6 0C6 4 2 6-1 5C-4 5-5 2-5-1Z', '#3fe6d3', 1.5)}<circle cx="-1" cy="-2" r="1.4" fill="#fff"/></g>
          </g>
        </g>`)
      s.dot = makeDot(c, 30, `<defs><radialGradient id="cgd-d"><stop offset="0" stop-color="#14c9b6" stop-opacity=".75"/><stop offset="1" stop-color="#14c9b6" stop-opacity="0"/></radialGradient></defs>
        <circle r="8.500" fill="url(#cgd-d)"/><circle r="4.8" fill="#00a896"/><circle cx="-1.5" cy="-1.5" r="1.4" fill="#e4fffb"/>`)
    },
    frame(c) {
      const h = c.head; const s = c.state; const p = s.p
      const ax = 14; const ay = c.D.h - 9
      T(p.root, ax, ay)
      const d = ride(c, 8, true)
      const { te, gap } = after(c)
      const longNow = !c.calm && h.long && h.phase === 'word'
      const swell = longNow ? Math.sin(h.wordP * Math.PI) * 0.22 : 0
      const start = c.calm ? 0 : startled(c)
      const out = h.phase === 'after' ? clamp((te - 0.8) / 0.6) : 0
      const glow = d.o * (1 - out)
      O(s.dot, glow)
      put(c, s.dot, d.x, d.y, 0, d.k * (1 + swell + start * 0.25))
      T(p.halo, 0, 0, 0, 1 + swell * 2)
      O(p.halo, lerp(0.15, 1, glow))
      const a = aim(c, 'a', ax + 62, ay - 60, d, 4.5) + 90
      T(p.lure, 63, -60, clamp(a * 0.5, -22, 24))
      const dd = c.toDock(d)
      const look = Math.atan2(dd.y - (ay - 42), dd.x - (ax + 67))
      T(p.pupil, 65 + Math.cos(look) * 4.6, -44 + Math.sin(look) * 4.6, 0, 1 + start * 0.2 + swell * 0.1)
      O(p.lidFull, blinking(c, 2.1, 3.9) || out > 0.5 ? 1 : 0)
      O(p.lid, start > 0 ? 0 : 1)
      T(p.brow, 0, longNow ? -3 : start > 0 ? -5 : 0, longNow ? -3 : 0)
      say(c, p, 75, -19, 0.9)
      const rest = !c.calm && (h.phase === 'rest' || (h.phase === 'after' && te < 1.8))
      T(p.tail, 7, -17, rest ? Math.sin(c.t * 7) * 5 : 0)
      // Bubbles only in a silence.
      const b = rest ? (h.phase === 'rest' ? clamp(te / Math.max(gap, 0.4)) : clamp(te / 1.8)) : -1
      O(p.bubs, b >= 0 && b < 1 ? 1 - b : 0)
      if (b >= 0) { T(p.b1, 92 - b * 3, -34 - b * 26); T(p.b2, 96 + b * 2, -30 - b * 18) }
    },
  })

  // ---------------------------------------------------------------- Tina
  function bellows(W) { // The pleats are a fixed width, so a wider stage simply has more of them.
    const N = Math.max(4, Math.round(W / 15) * 2)
    const X = (i) => (i / N).toFixed(4)
    let top = 'M0-1'; let bot = ''; let folds = ''; let shade = ''
    for (let i = 1; i <= N; i += 1) {
      top += `L${X(i)} ${i % 2 ? -0.8 : -1}`
      bot = `L${X(i - 1)} ${i % 2 ? 1 : 0.8}${bot}`
      if (i < N) folds += `M${X(i)} ${i % 2 ? -0.8 : -1}L${X(i)} ${i % 2 ? 0.8 : 1}`
      if (i % 2) shade += `M${X(i)} -.8L${X(i + 1)} -1L${X(i + 1)} 1L${X(i)} .8Z`
    }
    return { outline: `${top}L1 1${bot}Z`, folds, shade }
  }
  CharLab.register({
    id: 'claude-tina-dock', name: 'Tina Concertina', author: 'Claude Opus',
    tagline: 'A squeezebox stretched out along the whole bottom of the page, who sings the words. Her dot is a note',
    notes: 'The dot is a little note she sang: it wags as each word starts and stretches on a long word, because a long word is a held note. She takes up the bottom edge like a shelf and only breathes in the pauses. Risk: a long red band is a lot of color, so her pleats stay still while she reads.',
    room: { top: 26, bottom: 96, lineHeight: 2.3 },
    setup(c) {
      const s = c.state
      s.p = rig(c, `<g data-p="root">
          <g data-p="bel"><path data-p="pO" fill="#d4472f"/><path data-p="pS" fill="#a52f1e"/><path data-p="pF" fill="none" stroke="#7c1f18" stroke-width="1.3" style="vector-effect:non-scaling-stroke"/><path data-p="pL" fill="none" stroke="${INK}" stroke-width="2.2" stroke-linejoin="round" style="vector-effect:non-scaling-stroke"/></g>
          <g data-p="rear">
            ${shape('M-7-8V-1C-7 0-6 0-5 0H5C5-3 3-5 2-8Z', '#3a2c25', 1.5)}
            ${shape('M-15-16Q-16-10-9-7H9Q16-10 15-16V-54Q16-60 9-63H-9Q-16-60-15-54Z', '#e8ae3d')}
            <path d="M15-16Q16-10 9-7H-9Q-14-9-15-13C-8-11 6-12 15-20Z" fill="#c98f28"/>
            <g fill="#fff6dc" stroke="${INK}" stroke-width="1.2"><circle cx="-5" cy="-50" r="3"/><circle cx="5" cy="-50" r="3"/><circle cx="0" cy="-41" r="3"/><circle cx="-5" cy="-32" r="3"/><circle cx="5" cy="-32" r="3"/><circle cx="0" cy="-23" r="3"/></g>
          </g>
          <g data-p="frontBoot">${shape('M-6-8V-1C-6 0-5 0-4 0H8C8-3 6-5 4-8Z', '#3a2c25', 1.5)}</g>
          <g data-p="front">
            ${shape('M-20-17Q-21-10-13-7H13Q21-10 20-17V-52Q21-60 13-63H-13Q-21-60-20-52Z', '#e8ae3d')}
            <path d="M20-17Q21-10 13-7H-13Q-18-9-20-13C-10-11 8-12 20-22Z" fill="#c98f28"/>
            <g data-p="beret">${shape('M-21-62C-25-71-6-79 9-75C20-72 20-65 17-62C8-59-11-59-21-62Z', '#2f6f8f', 1.9)}<circle cx="-3" cy="-77" r="3" fill="#fff3d8" stroke="${INK}" stroke-width="1.4"/></g>
            <g fill="#f08a6a" opacity=".85"><circle cx="-15" cy="-26" r="4"/><circle cx="13" cy="-26" r="4"/></g>
            <g transform="translate(-7.5 -38)">${shape('M-7.5 0C-7.5-5-4-8.5 0-8.5C4-8.5 7.5-5 7.5 0C7.5 5 4 8 0 8C-4 8-7.5 5-7.5 0Z', '#fffdf4', 1.7)}<g data-p="pL2"><circle r="3.9" fill="#141a1d"/><circle cx="-1.2" cy="-1.4" r="1.2" fill="#fff"/></g></g>
            <g transform="translate(8 -39)">${shape('M-7.5 0C-7.5-5-4-8.5 0-8.5C4-8.5 7.5-5 7.5 0C7.5 5 4 8 0 8C-4 8-7.5 5-7.5 0Z', '#fffdf4', 1.7)}<g data-p="pR2"><circle r="3.9" fill="#141a1d"/><circle cx="-1.2" cy="-1.4" r="1.2" fill="#fff"/></g></g>
            <g data-p="lids"><path d="M-15.5-38C-15-47-.5-47 0-38C-.5-29-15-29-15.5-38ZM.5-39C1-48 15-48 15.5-39C15-30 1-30 .5-39Z" fill="#e8ae3d"/>${line('M-13-37C-10-33-5-33-2-37M3-38C6-34 11-34 14-38', 2.2)}</g>
            ${line('M-15-49C-11-52-5-52-2-50M3-50C7-53 12-52 15-49', 2.2, '#6a4010')}
            <g data-p="shut">${line('M-7-22C-3-18 3-18 8-23', 2.3)}</g>
            <g data-p="open">${shape('M-5-3C-3-6 3-6 5-3C6 2 3 5 0 5C-3 5-6 2-5-3Z', '#5a1d12', 1.5)}<path d="M-3 3C-1 1.5 1 1.5 3 3C1 5-1 5-3 3Z" fill="#e0705f"/></g>
          </g>
          <g data-p="notes" fill="${INK}"><g data-p="n1"><ellipse cx="-2.5" rx="3.2" ry="2.3" transform="rotate(-20 -2.5 0)"/><path d="M0 0V-11L5-9" fill="none" stroke="${INK}" stroke-width="1.5"/></g>
            <g data-p="n2"><ellipse cx="-2.5" rx="2.6" ry="1.9" transform="rotate(-20 -2.5 0)"/><path d="M0 0V-9" fill="none" stroke="${INK}" stroke-width="1.4"/></g></g>
        </g>`)
      s.dot = makeDot(c, 30, `<g data-p="note"><path d="M-4.8-1V9.500C-2.500 9 .5 7.500 1.500 4.500" stroke="#b02a18" stroke-width="1.700" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
        <ellipse data-p="head" rx="5.4" ry="4" transform="rotate(-20)" fill="#d4472f"/><ellipse cx="-1.6" cy="-1.3" rx="1.5" ry=".9" transform="rotate(-20)" fill="#ffd0c4"/></g>`)
    },
    frame(c) {
      const h = c.head; const s = c.state; const p = s.p
      const W = c.D.w; const by = c.D.h - 8
      if (s.w !== W) {
        s.w = W
        const b = bellows(W - 58)
        p.pO.setAttribute('d', b.outline); p.pS.setAttribute('d', b.shade); p.pF.setAttribute('d', b.folds); p.pL.setAttribute('d', b.outline)
      }
      T(p.root, 0, by)
      const rx = 26; const fx = W - 32
      T(p.rear, rx, 0)
      const { te, gap } = after(c)
      const rest = !c.calm && h.phase === 'rest'
      const breath = rest ? Math.sin(clamp(te / Math.max(gap - 0.1, 0.3)) * Math.PI) : 0
      T(p.bel, rx, -35, 0, fx - rx, 22 * (1 + breath * 0.1))
      const d = ride(c, 6, false)
      const longNow = !c.calm && h.long && h.phase === 'word'
      const wag = c.calm || h.phase !== 'word' ? 0 : (1 - clamp(h.wordP * 6)) * 16
      const held = longNow ? 1 + clamp(h.wordP * 1.6) * 0.8 : 1
      O(s.dot, h.phase === 'after' ? 1 - clamp((te - 0.9) / 0.4) : d.o)
      put(c, s.dot, d.x, d.y, 0, d.k)
      T(s.dot._parts.note, 0, 0, wag)
      s.dot._parts.head.setAttribute('transform', `rotate(-20) scale(${held.toFixed(2)} 1)`)
      // Her face turns to follow it, by a few degrees.
      const px = c.toDock(d)
      const a = aim(c, 'a', fx, by - 38, d, 4) + 90
      const start = c.calm ? 0 : startled(c)
      p.front.setAttribute('transform', `translate(${fx.toFixed(1)} 0) rotate(${(clamp(a * 0.1, -5, 3)).toFixed(1)} 0 -8)`)
      T(p.frontBoot, fx, 0)
      const look = Math.atan2(px.y - (by - 38), px.x - fx)
      const lx = Math.cos(look) * 3; const ly = Math.sin(look) * 3.4
      T(p.pL2, lx, ly, 0, 1 + start * 0.2); T(p.pR2, lx, ly, 0, 1 + start * 0.2)
      O(p.lids, blinking(c, 2.1, 3.9) || (h.phase === 'after' && te > 1.2) ? 1 : 0)
      say(c, p, 0, -21, longNow ? 1.25 : 1.05)
      T(p.beret, 0, -start * 4, start * 6)
      // A couple of notes rise off her only when she stops to breathe.
      const q = rest ? clamp(te / Math.max(gap, 0.4)) : -1
      O(p.notes, q >= 0 ? Math.sin(q * Math.PI) : 0)
      if (q >= 0) { T(p.n1, W * 0.56 + q * 8, -60 - q * 20, q * 14); T(p.n2, W * 0.5 - q * 5, -58 - q * 12, -q * 10) }
    },
  })
})()
export default cast
