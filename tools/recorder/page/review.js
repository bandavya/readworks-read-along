// The reviewer's page: listen to a sent reading, then approve it into the reader or send it back. Nothing else can put it there.
const main = document.getElementById('main')
const MUTE = new URLSearchParams(location.search).has('mute')   // tests keep every playback silent
const api = async (path, body) => {
  const res = await fetch(path, body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Something went wrong.')
  return data
}
const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('on')) e[k] = v
    else if (k === 'class') e.className = v
    else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v)
  }
  e.append(...kids.flat().filter((k) => k != null && k !== false))
  return e
}
const btn = (label, cls, onclick, attrs = {}) => el('button', { class: 'btn ' + cls, type: 'button', onclick, ...attrs }, label)
const fill = (...kids) => main.replaceChildren(...kids.flat().filter(Boolean))
const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
const bare = (t) => t.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')

async function list() {
  history.replaceState(null, '', location.search + '#')
  const rows = await api('/api/review')
  fill(el('h1', {}, rows.length ? `${rows.length} waiting to be checked` : 'Nothing is waiting to be checked'),
    el('ul', { class: 'list', id: 'waiting' }, rows.map((r) => el('li', {}, el('button', { type: 'button', onclick: () => open(r.id) },
      el('span', {}, r.title), el('small', {}, `${clock(r.seconds)} · ${r.spots ? `${r.spots} ${r.spots === 1 ? 'spot' : 'spots'} to hear` : 'no spots found'}`))))))
}

function words(S, marks) {
  const flagged = new Map()
  marks.flags.filter((f) => f.kind === 'extra').forEach((f) => flagged.set(f.i, f))
  const box = el('div', { class: 'story', id: 'story' })
  box.append(el('p', { class: 'title' }, marks.lead.map((w) => el('span', { class: 'w ' + (w.state === 'right' ? '' : w.state === 'unsaid' ? 'dim' : w.state) }, w.w)).flatMap((x) => [x, ' '])))
  let i = 0
  for (const count of S.paras) {
    const p = el('p')
    for (let k = 0; k < count; k++, i++) {
      const m = marks.words[i]
      if (flagged.has(i)) p.append(el('span', { class: 'extra' }, '+ ' + bare(flagged.get(i).heard)), ' ')
      p.append(el('span', { class: 'w ' + (m.state === 'right' ? '' : m.state) }, m.w), ' ')
    }
    box.append(p)
  }
  if (flagged.has(i)) box.lastChild.append(el('span', { class: 'extra' }, '+ ' + bare(flagged.get(i).heard)))
  return box
}

async function open(id) {
  location.hash = id
  const S = await api(`/api/session/${id}`)
  const f = S.finish
  if (S.published) return approved(S)
  if (!S.submission || !f) return list()
  const marks = f.review_marks     // every spot the check raised; the reader's page leaves off those only one listen doubted
  marks.flags.sort((a, b) => Number(b.both) - Number(a.both) || a.at - b.at)
  const audio = el('audio', { controls: true, preload: 'auto', src: f.after_url, id: 'reading', style: 'width:100%' })
  audio.muted = MUTE
  let played = 0, last = 0
  audio.ontimeupdate = () => { const dt = audio.currentTime - last; if (dt > 0 && dt < 1) played += dt; last = audio.currentTime }
  const hear = (at) => { audio.currentTime = Math.max(0, at - 0.7); audio.play().catch(() => {}) }
  const problem = el('div', { class: 'problem', role: 'alert', hidden: true })
  const fail = (e) => { problem.textContent = e.message; problem.hidden = false; window.scrollTo(0, 0) }
  const reviewer = el('input', { id: 'reviewer', autocomplete: 'off' })
  const note = el('input', { id: 'note', autocomplete: 'off' })
  const listened = el('input', { id: 'listened', type: 'checkbox', style: 'width:22px;height:22px;margin-right:8px' })
  const said = new Set(marks.flags.filter((x) => x.ok).map((x) => x.key))
  fill(problem, el('h1', {}, S.title),
    el('p', { class: 'say' }, f.gate_ok && !marks.flags.length ? 'The checker found no differences from the story. It can still miss things, and it can\'t hear how this sounds.'
      : f.can_approve ? 'The checker found differences from the story. They may be its own mistakes, so hear each one.'
        : 'Too little of this matches the story, or its word timing is broken, so it can\'t go in the reader. Please send it back.'),
    audio,
    marks.flags.length ? el('div', { class: 'panel', id: 'spots' }, el('h2', { style: 'margin-top:0' }, 'Spots to hear'), marks.flags.map((x) => el('div', { class: 'row', style: 'margin-bottom:8px' },
      btn(`Hear "${(x.written || x.heard).split(' ').slice(0, 4).join(' ')}"`, '', () => hear(x.at)),
      el('span', { class: 'say', style: 'margin:0' }, (x.kind === 'swap' ? `checker heard “${bare(x.heard)}”` : x.kind === 'extra' ? 'checker heard extra words' : "checker didn't hear this") + (x.second_only ? ' · only the listen without name hints' : x.both ? '' : ' · only one of two listens') + (said.has(x.key) ? ' · the reader said it was fine' : ''))))) : null,
    S.text_issues?.length ? el('div', { class: 'panel', id: 'text-issues' }, el('h2', { style: 'margin-top:0' }, 'The reader thinks the story has a mistake'),
      S.text_issues.map((x) => el('p', {}, `“…${x.around}…”`, x.should_say ? ` They suggest: “${x.should_say}”.` : '')),
      el('p', { class: 'say' }, 'The story has not been changed. These are saved for ReadWorks in human_recordings/text_issues.jsonl. Decide whether this reading is right to use as it is.')) : null,
    f.audit?.silent_starts?.length ? el('div', { class: 'panel', id: 'odd-times' }, el('h2', { style: 'margin-top:0' }, 'Highlights to check'),
      el('p', { class: 'say' }, 'These words light up where we measured quiet, so their timing may be off.'),
      f.audit.silent_starts.slice(0, 8).map((x) => el('div', { class: 'row', style: 'margin-bottom:8px' }, btn(`Hear "${bare(x.word)}"`, '', () => hear(x.at)), el('span', { class: 'say', style: 'margin:0' }, `at ${clock(x.at)}`)))) : null,
    f.warnings.length || !f.cleaned ? el('div', { class: 'panel' }, !f.cleaned ? el('p', {}, 'Automatic cleanup refused its own result, so this is the recording as it was.') : null, f.warnings.map((w) => el('p', {}, w))) : null,
    words(S, marks),
    el('div', { class: 'panel', id: 'decide' },
      el('label', { class: 'name' }, 'Your name (saved with this decision)', reviewer),
      el('label', { class: 'name' }, 'Note (optional; the reader sees it if you send it back)', note),
      el('label', { class: 'name', style: 'display:flex;align-items:center' }, listened, 'I listened to the whole reading'),
      el('div', { class: 'row' },
        f.can_approve ? btn('Approve: add to the reader', 'go big', async () => {
          try { audio.pause(); approved(await api(`/api/session/${id}/approve`, { reviewer: reviewer.value, listened: listened.checked, note: note.value, played_seconds: played, sha: S.submission.sha })) } catch (e) { fail(e) }
        }, { id: 'approve' }) : null,
        btn('Send back to the reader', '', async () => {
          try { audio.pause(); await api(`/api/session/${id}/sendback`, { reviewer: reviewer.value, note: note.value }); await list() } catch (e) { fail(e) }
        }, { id: 'sendback' }),
        btn('Back to the list', 'link', () => { audio.pause(); list().catch(fail) }))))
  window.scrollTo(0, 0)
}

function approved(S) {
  fill(el('h1', {}, 'Added to the reader'), el('p', { class: 'say' }, `${S.title}. Approved by ${S.published.reviewer}. The earlier recording, if there was one, is kept and can be put back.`),
    el('div', { class: 'row' }, el('a', { class: 'btn go big', href: `${S.reader}#/p/${S.uid}`, target: '_blank', id: 'open' }, 'Open it in the reader'), btn('Back to the list', '', () => list())))
}

const id = location.hash.slice(1)
;(id ? open(id) : list()).catch((e) => fill(el('div', { class: 'problem' }, e.message)))
