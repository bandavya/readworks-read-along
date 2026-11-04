// The smallest buddy, for checking the plumbing. Same shape as prototype/character_lab/chars/reference.js.
export default {
  id: 'dot', name: 'Dot',
  room: { top: 32 },
  css: '.buddy-dot { position: absolute; left: 0; top: 0; width: 14px; height: 14px; border-radius: 50%; background: #e0a100; }',
  setup(ctx) {
    const el = document.createElement('div')
    el.className = 'buddy-dot'
    ctx.layer.append(el)
    ctx.state.el = el
  },
  frame(ctx) {
    const h = ctx.head
    if (ctx.calm) { ctx.place(ctx.state.el, h.word.x, h.y - 10, { ax: 0, ay: 14 }); return }
    const hop = Math.sin(Math.PI * (h.phase === 'word' ? h.wordP : 0)) * Math.min(14, h.word.w * 0.3)
    ctx.place(ctx.state.el, h.x, h.y - 4 - hop, { ax: 7, ay: 14 })
  },
}
