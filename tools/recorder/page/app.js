// The recorder page. No framework: one state object from the server, one draw function per screen.
const $ = (id) => document.getElementById(id)
const main = $('main')
const query = new URLSearchParams(location.search)
const TEST_FILE = query.get('test')       // a test plays this file into the real recorder, silently; never set for a person
const TEST_MUTE = query.has('mute')       // tests keep every playback silent

let S = null              // the session as the server last described it
let screen = 'pick'
let poll = null
let rec = null            // the recording in progress
let player = null         // the one audio element
let stopAt = null
let afterPlay = null      // what happens when the lead-in has played
let starting = false
let giveUpStart = false
let cutOff = false        // the microphone stopped by itself during the last recording
let saving = null         // a reading not yet safely on the computer
let heardAfter = 0        // seconds the person really played of the cleaned reading

const api = async (path, body, raw) => {
  const res = await fetch(path, raw ? { method: 'POST', body } : body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) })
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
const bare = (t) => t.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
const say = (t) => { $('live').textContent = t }
const stepsOn = (name) => {
  const order = ['read', 'check', 'finish']
  for (const li of $('steps').children) {
    const k = order.indexOf(li.dataset.s), on = order.indexOf(name)
    li.className = k === on ? 'on' : k < on ? 'done' : ''
  }
}
const dock = (...kids) => { document.querySelector('.dock')?.remove(); if (kids.length) document.body.append(el('div', { class: 'dock' }, el('div', { class: 'dock-in' }, ...kids))) }
const fill = (...kids) => main.replaceChildren(...kids.flat().filter(Boolean))
const fail = (error) => { const p = el('div', { class: 'problem', role: 'alert' }, error.message || String(error)); main.prepend(p); window.scrollTo(0, 0) }

// ------------------------------------------------------------------ audio
function audio() {
  if (!player) {
    player = new Audio()
    player.muted = TEST_MUTE
    player.preload = 'auto'
    player.ontimeupdate = tick
    player.onended = () => { stopAt = null; playBtn(); paint(null); if (afterPlay) { const go = afterPlay; afterPlay = null; go() } }
    player.onpause = playBtn
    // The audio's own time event fires about four times a second, which jumped over short words ("in", "he", "and"). While playing, look 25 times a second.
    player.onplay = () => {
      playBtn()
      clearInterval(following)
      following = setInterval(() => { if (player.paused) clearInterval(following); else tick() }, 40)
    }
  }
  return player
}
function source(url) { const a = audio(); if (a.dataset.url !== url) { a.src = url; a.dataset.url = url } return a }
let playTurn = 0          // a newer request, or a recording starting, cancels playback still waiting to begin
function silence() {
  playTurn++
  afterPlay = null
  stopAt = null
  player?.pause()
}
function playRange(url, t0, t1) {
  const a = source(url)
  const turn = ++playTurn
  const go = () => { if (turn !== playTurn) return; a.currentTime = Math.max(0, t0); stopAt = t1 ?? null; a.play().catch((e) => fail(e)) }
  if (a.readyState >= 1) go(); else a.addEventListener('loadedmetadata', go, { once: true })
}
let timeWords = null      // the [start,end] of each word for what's playing, so the words light up
let lastT = 0
let lastDraw = 0
let following = null
function tick() {
  const a = player
  if (stopAt != null && a.currentTime >= stopAt) { a.pause(); stopAt = null; if (afterPlay) { const go = afterPlay; afterPlay = null; go() } }
  if (screen === 'after' && a.dataset.url === S?.finish?.after_url && !a.paused) {
    const dt = a.currentTime - lastT
    if (dt > 0 && dt < 1) heardAfter += dt
  }
  lastT = a.currentTime
  paint(a.currentTime)
  const now = performance.now()
  if (now - lastDraw > 120) { lastDraw = now; drawHead() }
}
function paint(t) {
  document.querySelectorAll('.w.playing').forEach((w) => w.classList.remove('playing'))
  if (t == null || !timeWords) return
  let lo = 0, hi = timeWords.length - 1, at = -1
  while (lo <= hi) { const m = (lo + hi) >> 1; if (timeWords[m].start <= t) { at = m; lo = m + 1 } else hi = m - 1 }
  // Like the reader: a word stays lit until the next one starts, unless a real pause follows it.
  const next = timeWords[at + 1]
  if (at >= 0 && (t <= timeWords[at].end + 0.25 || (next && next.start - timeWords[at].end < 0.25))) document.querySelector(`.w[data-i="${timeWords[at].i}"]`)?.classList.add('playing')
}
function playBtn() { const b = $('playall'); if (b) b.textContent = player && !player.paused ? 'Pause' : (b.dataset.label || 'Play') }

// ------------------------------------------------------------------ the picture of the sound
let wave = null
function drawWave(canvas, peaks, seconds, flags) {
  wave = { canvas, peaks, seconds, flags }
  drawHead()
  canvas.onclick = (e) => { const r = canvas.getBoundingClientRect(); const a = audio(); a.currentTime = (e.clientX - r.left) / r.width * seconds; if (a.paused) a.play().catch(() => {}) }
}
function drawHead() {
  if (!wave || !wave.canvas.isConnected) return
  const { canvas, peaks, seconds, flags } = wave
  const w = canvas.clientWidth, h = canvas.clientHeight, dpr = devicePixelRatio || 1
  if (canvas.width !== w * dpr) { canvas.width = w * dpr; canvas.height = h * dpr }
  const g = canvas.getContext('2d')
  g.setTransform(dpr, 0, 0, dpr, 0, 0)
  g.clearRect(0, 0, w, h)
  const pos = player && player.dataset.url ? player.currentTime / seconds : 0
  peaks.forEach((p, i) => {
    const x = i / peaks.length * w
    g.fillStyle = i / peaks.length <= pos ? '#1f6f5c' : '#a79e8c'
    const bar = Math.max(1, p * h * 0.9)
    g.fillRect(x, (h - bar) / 2, Math.max(1, w / peaks.length - 0.5), bar)
  })
  for (const t of flags || []) { g.fillStyle = '#b3382c'; g.fillRect(t / seconds * w - 1, 0, 3, h) }
}

// ------------------------------------------------------------------ recording
async function microphone() {
  if (TEST_FILE) {
    const ctx = new AudioContext()
    const buffer = await ctx.decodeAudioData(await (await fetch('/test-audio/' + encodeURIComponent(window.__testFile || TEST_FILE))).arrayBuffer())
    const src = ctx.createBufferSource(); src.buffer = buffer
    const dest = ctx.createMediaStreamDestination()
    src.connect(dest)                     // never connected to the speakers
    src.start(ctx.currentTime + 0.4)
    src.onended = () => setTimeout(stopRecording, 400)
    return { stream: dest.stream, ctx }
  }
  // Raw sound: the browser's own loudness and noise tricks would fight the cleanup, and pump at the joins.
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 } })
  return { stream, ctx: new AudioContext() }
}
async function startRecording(onDone) {
  if (rec || starting) return false
  silence()                 // nothing from the speakers may land in a recording
  starting = true           // a second click while the microphone is starting must not begin a second recording
  giveUpStart = false
  let source
  try { source = await microphone() } catch (e) {
    starting = false
    throw new Error(e.name === 'NotAllowedError' ? 'The browser needs permission to use your microphone. Click the small icon beside the address, allow the microphone, then try again.'
      : e.name === 'NotFoundError' ? 'No microphone was found. Plug one in, then try again.' : 'The microphone could not start: ' + e.message)
  }
  const { stream, ctx } = source
  try { await ctx.resume() } finally { starting = false }
  if (giveUpStart) {        // they changed their mind while the browser was asking for the microphone
    stream.getTracks().forEach((t) => t.stop()); ctx.close().catch(() => {})
    return false
  }
  const analyser = ctx.createAnalyser(); analyser.fftSize = 2048
  ctx.createMediaStreamSource(stream).connect(analyser)
  const type = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4'].find((t) => MediaRecorder.isTypeSupported(t)) || ''
  const recorder = new MediaRecorder(stream, { mimeType: type, audioBitsPerSecond: 128000 })
  const chunks = []
  rec = { recorder, stream, ctx, analyser, started: performance.now(), buf: new Float32Array(2048), bars: [], loud: 0, quiet: 0, heard: false, nudge: '' }
  recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data) }
  recorder.onstop = () => {
    const blob = new Blob(chunks, { type: recorder.mimeType })
    stream.getTracks().forEach((t) => t.stop()); ctx.close().catch(() => {})
    const seconds = (performance.now() - rec.started) / 1000
    rec = null
    onDone(blob, seconds)
  }
  // A device unplugged mid-reading ends the track: keep what's there rather than lose it.
  stream.getAudioTracks()[0].onended = () => { if (rec?.recorder.state === 'recording') { cutOff = true; recorder.stop() } }
  recorder.start(1000)
  meterLoop()
  return true
}
function meterLoop() {
  if (!rec) return
  const { analyser, buf } = rec
  analyser.getFloatTimeDomainData(buf)
  let peak = 0, sum = 0
  for (const v of buf) { peak = Math.max(peak, Math.abs(v)); sum += v * v }
  const db = 10 * Math.log10(Math.max(sum / buf.length, 1e-10))
  const seconds = (performance.now() - rec.started) / 1000
  if (peak >= 0.98) rec.loud = performance.now()
  if (db > -42) { rec.heard = true; rec.quietStart = performance.now() }
  const sinceVoice = performance.now() - (rec.quietStart || rec.started)
  const word = performance.now() - rec.loud < 3000 ? 'That was very loud. Try moving back a little.'
    : !rec.heard && seconds > 5 ? "We can't hear you yet. Check that your microphone is on, or move closer."
    : rec.heard && sinceVoice > 8000 ? "It's gone quiet. Keep going when you're ready, or press Done."
    : rec.heard && db < -52 && seconds > 4 && rec.peakRecent < 0.03 ? 'A little closer to the microphone would help.' : ''
  rec.peakRecent = Math.max(peak, (rec.peakRecent || 0) * 0.995)
  const n = $('nudge'); if (n && n.textContent !== word) n.textContent = word
  const c = $('clock'); if (c) c.textContent = clock(seconds)
  rec.bars.push(Math.min(1, peak * 1.4))
  drawLive()
  setTimeout(meterLoop, 50)      // a timer, not a frame callback: it keeps watching while the tab is in the background
}
function drawLive() {
  const canvas = $('livewave'); if (!canvas) return
  const w = canvas.clientWidth, h = canvas.clientHeight, dpr = devicePixelRatio || 1
  if (canvas.width !== w * dpr) { canvas.width = w * dpr; canvas.height = h * dpr }
  const g = canvas.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h)
  const bars = rec.bars.slice(-Math.floor(w / 3))
  bars.forEach((b, i) => {
    g.fillStyle = b >= 0.98 ? '#b3382c' : '#1f6f5c'
    const bar = Math.max(1, b * h * 0.95)
    g.fillRect(w - (bars.length - i) * 3, (h - bar) / 2, 2, bar)
  })
}
function stopRecording() { if (rec?.recorder.state === 'recording') rec.recorder.stop() }
window.__stopRecording = stopRecording
async function send(blob) {
  saving = blob
  screen = 'work'; dock()
  fill(el('div', { class: 'work' }, el('div', { class: 'spin' }), el('p', {}, 'Saving your reading. Please keep this page open.')))
  try {
    S = await api(`/api/session/${S.id}/take?type=${encodeURIComponent(blob.type)}`, blob, true)
    saving = null
    draw()
  } catch (e) {          // the reading exists only here until it is saved: never lose it to a hiccup
    dock()
    fill(el('div', { class: 'problem', role: 'alert' }, "We couldn't save your reading yet. It's still here on this page, so please don't close it. ", e.message),
      el('div', { class: 'row' }, btn('Try saving again', 'go big', () => send(blob), { id: 'resend' }),
        el('a', { class: 'btn', href: URL.createObjectURL(blob), download: 'my-reading.' + (blob.type.includes('ogg') ? 'ogg' : blob.type.includes('mp4') ? 'm4a' : 'webm') }, 'Save a copy to this computer')))
  }
}

// ------------------------------------------------------------------ the story text
function wordClass(m, i, span, dim) {
  const inSpan = span && i >= span.a && i < span.b
  const state = m ? (m.state === 'right' ? '' : m.ok ? 'fine' : m.state) : ''
  return ['w', state === 'unsaid' ? 'dim' : state, inSpan ? 'inspan' : '', dim && span && !inSpan ? 'dim' : ''].join(' ')
}
let breathLines = true
try { breathLines = localStorage.getItem('recorder-lines') !== 'off' } catch { /* the page works without remembering */ }
function story(args) {
  const { marks, span, onword, dim } = args
  const box = el('div', { class: 'story' + (onword ? ' marked' : ''), id: 'story' })
  box.append(el('button', { class: 'linesbtn', type: 'button', id: 'linesbtn', onclick: () => {
    breathLines = !breathLines
    try { localStorage.setItem('recorder-lines', breathLines ? 'on' : 'off') } catch { /* see above */ }
    box.replaceWith(story(args))
  } }, breathLines ? 'Show as paragraphs' : 'Show in breath lines'))
  const extras = new Map((marks?.flags || []).filter((f) => f.kind === 'extra').map((f) => [f.i, f]))
  const word = (i, text, m) => {
    const extra = extras.get(i)
    const out = []
    if (extra && onword) out.push(el('button', { class: 'extra' + (extra.ok ? ' fine' : ''), type: 'button', 'data-at': i, title: 'The checker also heard this', onclick: (e) => onword(e, i, extra) }, '+ ' + extra.heard), ' ')
    const cls = wordClass(m, i, span, dim)
    out.push(onword ? el('button', { class: cls, type: 'button', 'data-i': i, onclick: (e) => onword(e, i) }, text) : el('span', { class: cls, 'data-i': i }, text), ' ')
    return out
  }
  const lead = S.lead, top = -lead.length
  const by = lead.findIndex((w, k) => k > 0 && ['by', 'por'].includes(w.toLowerCase()))
  const line = (from, to, cls) => el('p', { class: cls }, lead.slice(from, to).map((w, k) => word(top + from + k, w, marks?.lead?.[from + k])).flat())
  box.append(line(0, by > 0 ? by : lead.length, 'title'))
  if (by > 0) box.append(line(by, lead.length, 'by'))
  let i = 0
  for (const count of S.paras) {
    const p = el('p', { class: 'para' })
    const lineAt = new Set(S.lines || [])
    let line = null
    for (let k = 0; k < count; k++, i++) {
      if (breathLines && (k === 0 || lineAt.has(i))) { line = el('span', { class: 'line' }); p.append(line) }
      ;(breathLines ? line : p).append(...word(i, S.text[i], marks?.words?.[i]))
    }
    box.append(p)
  }
  const after = extras.get(i)        // heard after the last written word
  if (after && onword) box.lastChild.append(el('button', { class: 'extra' + (after.ok ? ' fine' : ''), type: 'button', 'data-at': i, title: 'The checker also heard this', onclick: (e) => onword(e, i, after) }, '+ ' + after.heard))
  return box
}
// A place on the page, from the title line (negative) through the story.
const place = (marks, i) => (i >= 0 ? marks.words[i] : marks.lead[i + marks.lead.length])
const inOrder = (marks) => [...marks.lead.filter((w) => w.start != null), ...marks.words]
const textOf = (a, b) => [...S.lead, ...S.text].slice(a + S.lead.length, b + S.lead.length).join(' ')
// The first and last word in a span that have a time in this recording.
function spanTimes(marks, a, b) {
  const timed = []
  for (let i = a; i < b; i++) { const w = place(marks, i); if (w?.start != null) timed.push(w) }
  return timed.length ? [timed[0].start, timed[timed.length - 1].end] : [0, 0]
}

// ------------------------------------------------------------------ screens
async function pick() {
  screen = 'pick'; S = null; stepsOn(''); dock()
  history.replaceState(null, '', location.search + '#')
  fill(el('h1', {}, 'Pick a story to read aloud'),
    el('p', { class: 'say' }, "Short ones are a good place to start. You'll read it once, see how it went, and fix anything you'd like to."))
  const rows = await api('/api/passages')
  rows.sort((a, b) => Number(a.has_person) - Number(b.has_person) || a.words - b.words)
  main.append(el('ul', { class: 'list' }, rows.map((r) => el('li', {}, el('button', { type: 'button', onclick: () => open(r.uid) },
    el('span', {}, r.title), el('small', {}, `about ${Math.max(1, Math.round(r.words / 130))} min${r.session ? ' · started' : ''}${r.has_person ? ' · already has a person reading' : ''}`))))),
    el('p', { class: 'say' }, el('a', { href: '/review' }, 'Team: readings waiting for review')))
}
async function open(uid, fresh) {
  try { S = await api('/api/session', { uid, fresh }); location.hash = S.id; draw() } catch (e) { fail(e) }
}
function schedule() {
  clearTimeout(poll)
  if (S?.job?.step) poll = setTimeout(async () => { try { S = await api(`/api/session/${S.id}`); draw() } catch (e) { fail(e) } }, 700)
}
function draw() {
  document.querySelector('.pop')?.remove()
  schedule()
  const was = screen
  drawScreen()
  if (screen !== was) window.scrollTo(0, 0)
}
function drawScreen() {
  if (S.job?.step) return drawWork()
  if (rec) return
  if (S.job?.error) return drawProblem()
  if (S.candidate != null) return drawCompare()
  if (S.span) return drawRedo()
  if (S.published) return drawDone()
  if (S.submission) return drawWaiting()
  if (S.finish) return drawAfter()
  if (S.now) return drawCheck()
  return drawReady()
}
function drawWork() {
  screen = 'work'; dock()
  fill(el('div', { class: 'work' }, el('div', { class: 'spin' }), el('p', {}, S.job.step),
    el('p', { class: 'say' }, 'This takes a moment. There is nothing you need to do.')))
  say(S.job.step)
}
function drawProblem() {
  screen = 'problem'; dock()
  fill(el('div', { class: 'problem', role: 'alert' }, S.job.error),
    el('div', { class: 'row' }, S.pending && btn('Try again', 'go', async () => { S = await api(`/api/session/${S.id}/retry`, {}); draw() }),
      btn(S.pending?.kind === 'take' ? 'Record it again' : S.span ? 'Continue' : 'Go back', S.span ? 'go' : '', async () => { S = await api(`/api/session/${S.id}/dismiss`, {}); draw() }, { id: 'continue' }),
      S.span && btn('Keep the earlier reading', '', async () => { await api(`/api/session/${S.id}/dismiss`, {}); S = await api(`/api/session/${S.id}/cancelspan`, {}); draw() }, { id: 'keepearlier' })))
}
function drawReady() {
  screen = 'ready'; stepsOn('read')
  fill(el('h1', {}, 'Read this story aloud'), el('p', { class: 'say' },
    'Find a quiet spot first; if people are talking nearby, move away. Read the title, then the story, resting for a moment at each break. If you stumble, pause, start that sentence or paragraph again, and keep going. We\'ll try to take out the first try, and you can listen afterward.'),
  S.replaces ? el('p', { class: 'say' }, 'This story already has a person reading it. If yours is approved, it will play instead, and the earlier one is kept safe.') : null,
  story({}))
  dock(el('div', { class: 'row' }, btn('Record', 'rec big', beginWhole, { id: 'record' }), el('span', { class: 'say' }, "We'll ask to use your microphone.")))
}
async function beginWhole() {
  try {
    if (!await startRecording(send)) return
    screen = 'recording'
    fill(story({}))
    dock(el('canvas', { id: 'livewave', class: 'wave' }), el('div', { class: 'nudge', id: 'nudge', role: 'status' }),
      el('div', { class: 'row' }, el('span', {}, el('span', { class: 'dot' }), 'Recording '), el('span', { class: 'clock', id: 'clock' }, '0:00'),
        btn("I'm done reading", 'go big push', stopRecording, { id: 'done' })))
    window.scrollTo(0, 0)
  } catch (e) { fail(e) }
}
function flagsAt(marks) { return marks.flags.filter((f) => !f.ok).map((f) => f.at) }
function nextFlag(marks) { return marks.flags.find((f) => !f.ok) }
function drawCheck() {
  screen = 'check'; stepsOn('check')
  const now = S.now, marks = now.marks
  timeWords = inOrder(marks)
  const left = nextFlag(marks)
  source(now.url)
  const head = left
    ? [el('h1', {}, marks.open === 1 ? 'One spot to listen to' : `${marks.open} spots to listen to`),
      el('p', { class: 'say' }, 'The checker heard something different at the marked words. It can be wrong, so have a listen. If the story itself looks wrong, tap the word and tell us.')]
    : [el('h1', {}, 'No spots found'), el('p', { class: 'say' }, 'Tap any word to hear that spot, or finish when you are happy.')]
  const notice = cutOff ? el('div', { class: 'problem', role: 'alert' }, 'Your microphone stopped while recording, so the end may be missing. Listen to the end, and read it again if you need to.') : null
  const back = S.review?.state === 'sent back' ? el('div', { class: 'problem' }, 'A team member asked you to take another look.', S.review.note ? ` They said: “${S.review.note}”` : '') : null
  const issues = S.text_issues?.length ? el('p', { class: 'say' }, `You told the team about ${S.text_issues.length === 1 ? 'a possible mistake' : S.text_issues.length + ' possible mistakes'} in the story. Thank you.`) : null
  fill(...head, notice, back, issues, cutsPanel(now),
    story({ marks, onword: wordTapped }),
    checksPanel(now.checks),
    el('div', { class: 'row' }, btn('Start the whole story over', 'link', async () => { if (confirm('Start over from the beginning? Your earlier recording stays saved on this computer.')) { S = await api(`/api/session/${S.id}/restart`, {}); location.hash = S.id; draw() } })))
  const canvas = el('canvas', { class: 'wave', id: 'wave', 'aria-label': 'Your recording. Click to jump.' })
  dock(canvas, el('div', { class: 'row' },
    btn('Play', '', () => { const a = audio(); a.paused ? a.play().catch(fail) : a.pause() }, { id: 'playall', 'data-label': 'Play my reading' }),
    el('span', { class: 'clock' }, clock(now.seconds)),
    left ? btn('Hear the next spot', 'go big push', () => hearSpot(left), { id: 'next' })
      : btn('Finish', 'go big push', finish, { id: 'finish' }),
    left && btn('Finish', '', finish, { id: 'finish' })))
  drawWave(canvas, now.peaks, now.seconds, flagsAt(marks))
  playBtn()
}
// False starts we took out. Each can be heard both ways, and put back.
function cutsPanel(now) {
  const cuts = now.note.cuts
  if (!cuts?.length) return null
  const raw = `/files/${S.id}/rev${now.note.raw}.wav`
  const label = cuts.length === 1 ? 'We took out 1 false start.' : `We took out ${cuts.length} false starts.`
  return el('details', { class: 'panel', id: 'cuts' }, el('summary', {}, label, ' Hear the changes'),
    cuts.map((c, k) => el('div', { class: 'row', style: 'margin-top:10px' },
      el('span', { style: 'flex:1 1 100%' }, `“${c.removed.split(' ').slice(0, 8).join(' ')}…”`),
      btn('Hear it edited', '', () => { timeWords = inOrder(now.marks); playRange(now.url, c.new_at - 1.5, c.new_at + 3) }, { 'data-hear': 'edited' }),
      btn('Hear the original', '', () => { timeWords = null; playRange(raw, c.cut_from - 1.5, c.cut_to + 3) }, { 'data-hear': 'original' }),
      btn('Put back', '', async () => { try { S = await api(`/api/session/${S.id}/putback`, { index: k }); draw() } catch (e) { fail(e) } }, { 'data-putback': k }))))
}
// The next spot: bring it into view, play it, and offer the choices.
function hearSpot(flag) {
  const target = flag.kind === 'extra' ? document.querySelector(`#story .extra[data-at="${flag.i}"]`) : document.querySelector(`#story .w[data-i="${flag.i}"]`)
  if (!target) return playRange(S.now.url, flag.at - 0.7, flag.at + 1.4)
  target.scrollIntoView({ block: 'center' })
  target.click()
}
function checksPanel(checks) {
  if (!checks) return null
  const need = checks.filter((c) => !c.good && c.key !== 'words')    // the marked words already say this one
  if (!need.length) return null
  return el('div', { class: 'panel', id: 'checks' }, el('h2', { style: 'margin-top:0' }, 'How it sounds'),
    el('ul', { class: 'checks' },
      need.map((c) => el('li', { class: 'need', 'data-check': c.key }, el('div', { class: 't' }, c.title), c.detail && el('p', {}, c.detail), c.action && el('p', {}, c.action),
        c.where?.length ? el('div', { class: 'row' }, c.where.slice(0, 4).map((i) => btn(`Read from "${textOf(i, i + 3)}…"`, '', () => askSpan(i, i + 1)))) : null))))
}
function wordTapped(e, i, extra) {
  document.querySelector('.pop')?.remove()
  const marks = S.now.marks, m = place(marks, i)
  const flag = extra || marks.flags.find((f) => f.kind !== 'extra' && i >= f.i && i < f.i + f.n)
  if (m?.start == null && !extra) {        // a title word nobody read: there is nothing to play
    const r0 = e.currentTarget.getBoundingClientRect()
    document.body.append(el('div', { class: 'pop', role: 'dialog', style: `left:${window.scrollX + r0.left}px;top:${window.scrollY + r0.bottom + 8}px` },
      el('p', {}, "We didn't hear this in your reading."), el('div', { class: 'row' }, btn('Read the title', 'go', () => askSpan(i, i + 1), { id: 'redohere' }))))
    return
  }
  playRange(S.now.url, (extra ? extra.at : m.start) - 0.6, (extra ? extra.at + 1 : m.end) + 0.6)
  const r = e.currentTarget.getBoundingClientRect()
  const line = flag ? (flag.kind === 'extra' ? `The checker also heard “${bare(flag.heard)}”.` : flag.kind === 'swap' ? `The checker heard “${bare(flag.heard)}”.` : "The checker didn't hear this.") : null
  const pop = el('div', { class: 'pop', role: 'dialog', 'aria-label': 'This spot', style: `left:${Math.min(window.scrollX + r.left, window.scrollX + innerWidth - 340)}px;top:${window.scrollY + r.bottom + 8}px` },
    line && el('p', {}, line),
    el('div', { class: 'row' },
      btn('Hear it again', '', () => playRange(S.now.url, (extra ? extra.at : m.start) - 0.6, (extra ? extra.at + 1 : m.end) + 0.6)),
      btn('Read this part again', 'go', () => { pop.remove(); flag ? goFix(flag) : askSpan(i, i + 1) }, { id: 'redohere' }),
      flag && btn(flag.ok ? 'Undo "It was fine"' : 'It was fine', '', async () => { pop.remove(); S = await api(`/api/session/${S.id}/fine`, { key: flag.key, ok: !flag.ok }); draw() }, { id: 'fine' })),
    btn('The story has a mistake here', 'link', () => {
      const said = el('input', { id: 'shouldsay', autocomplete: 'off', style: 'width:100%;min-height:40px;margin:6px 0;padding:4px 8px' })
      pop.replaceChildren(el('p', {}, 'What should the story say here? This goes to the team. Your reading stays as you read it.'),
        el('label', {}, 'It should say (optional)', said),
        el('div', { class: 'row' }, btn('Send to the team', 'go', async () => {
          try {
            await api(`/api/session/${S.id}/textissue`, { i, should_say: said.value })
            if (flag && !flag.ok) await api(`/api/session/${S.id}/fine`, { key: flag.key, ok: true })
            S = await api(`/api/session/${S.id}`); draw()
          } catch (err) { fail(err) }
        }, { id: 'sendissue' }), btn('Never mind', 'link', () => pop.remove())))
      said.focus()
    }, { id: 'textissue' }))
  document.body.append(pop)
  pop.querySelector('button').focus()
}
function goFix(flag) {
  const marks = S.now.marks
  const sameSentence = [flag, ...marks.flags.filter((f) => !f.ok && sentenceOf(f.i) === sentenceOf(flag.i))]
  askSpan(Math.min(...sameSentence.map((f) => f.i)), Math.max(...sameSentence.map((f) => f.i + f.n)))
}
const sentenceOf = (i) => (i < 0 ? -1 : S.starts.filter((s) => s <= i).pop())
async function askSpan(i0, i1, scope) {
  try { S = await api(`/api/session/${S.id}/span`, { i0, i1, scope }); draw() } catch (e) { fail(e) }
}
// The sentence before, then the old reading, so a reread can pick up the same tone. Up to six seconds of run-up.
function leadIn() {
  const marks = S.now.marks
  const [t0, t1] = spanTimes(marks, S.span.a, S.span.b)
  const prev = S.starts.filter((k) => k < Math.max(S.span.a, 0)).pop()
  const from = prev == null ? t0 : Math.max(place(marks, prev).start ?? t0, t0 - 6)
  return [Math.max(0, from - 0.2), t1 + 0.3]
}
function hearOld() {
  const [t0, t1] = leadIn()
  playRange(S.now.url, t0, t1)
}
async function hearThenRecord() {
  const [t0, t1] = leadIn()
  if (t1 <= 0.3) return beginRedo()       // a title never read: nothing to hear
  dock(el('div', { class: 'row' }, el('span', {}, 'Listen. Recording starts when this stops.'),
    btn('Never mind', 'link', () => { silence(); drawRedo() }, { id: 'stoplisten' }),
    btn('Skip to recording', 'link push', () => { silence(); beginRedo() }, { id: 'skip' })))
  afterPlay = beginRedo
  playRange(S.now.url, t0, t1)
}
function drawRedo() {
  screen = 'redo'; stepsOn('check'); timeWords = inOrder(S.now.marks)
  const a = S.span.a, b = S.span.b
  const wide = S.span.scope === 'paragraph'
  const forced = wide && S.span.wanted !== 'paragraph'
  fill(el('h1', {}, S.span.scope === 'title' ? 'Read the title' : wide ? 'Read this paragraph' : 'Read this sentence'),
    el('p', { class: 'say' }, forced ? 'Read the whole paragraph so we can join it smoothly. ' : '', 'Read it the way you would in the whole story, with a short pause before you start and after you finish.'),
    story({ span: S.span, dim: true }))
  const other = S.span.scope === 'title' || forced ? null
    : btn(wide ? 'Just the sentence' : 'Read the whole paragraph', '', () => askSpan(S.span.i0, S.span.i1, wide ? 'sentence' : 'paragraph'), { id: 'otherscope' })
  dock(el('div', { class: 'row' }, btn('Hear it, then record', 'rec big', hearThenRecord, { id: 'hearrecord' }), btn('Just record', '', beginRedo, { id: 'record' }), other,
    btn('Never mind', 'link push', async () => { giveUpStart = true; silence(); S = await api(`/api/session/${S.id}/cancelspan`, {}); draw() })))
  document.querySelector(`.w[data-i="${a}"]`)?.scrollIntoView({ block: 'center' })
  say(`Read this: ${textOf(a, b)}`)
}
async function beginRedo() {
  try {
    if (!await startRecording(send) || !S.span) return
    screen = 'recording'
    const firstWord = textOf(S.span.a, S.span.a + 3)
    dock(el('canvas', { id: 'livewave', class: 'wave' }), el('div', { class: 'nudge', id: 'nudge', role: 'status' }, ''),
      el('div', { class: 'row' }, el('span', {}, el('span', { class: 'dot' }), `Recording. Start at "${firstWord}…" `), el('span', { class: 'clock', id: 'clock' }, '0:00'),
        btn('Done', 'go big push', stopRecording, { id: 'done' })))
  } catch (e) { fail(e) }
}
function drawCompare() {
  screen = 'compare'; stepsOn('check')
  const cand = S.cand, span = S.span || { a: cand.note.span[0], b: cand.note.span[1] }
  const nw = cand.marks, old = S.now.marks
  const flagsIn = (m) => m.flags.filter((f) => !f.ok && f.i >= span.a && f.i < span.b)
  const stillOff = flagsIn(nw)
  const context = 2
  const hearOldPart = () => { timeWords = inOrder(old); const [t0, t1] = spanTimes(old, span.a, span.b); playRange(S.now.url, t0 - context, t1 + context) }
  const hearNewPart = () => { timeWords = inOrder(nw); const [t0, t1] = spanTimes(nw, span.a, span.b); playRange(cand.url, t0 - context, t1 + context) }
  fill(el('h1', {}, 'Which one sounds better?'),
    el('p', { class: 'say' }, stillOff.length
      ? `The checker heard something different in ${stillOff.length === 1 ? 'one spot' : stillOff.length + ' spots'} of the new reading. You can keep it anyway, or try again.`
      : 'No spots found in the new reading. Listen to both, with a little of what comes before and after.'),
    story({ marks: nw, span }))
  dock(el('div', { class: 'row' }, btn('Hear the old one', '', hearOldPart, { id: 'hearold' }), btn('Hear the new one', '', hearNewPart, { id: 'hearnew' })),
    el('div', { class: 'row' },
      btn('Keep the new one', 'go big', async () => { S = await api(`/api/session/${S.id}/keep`, { choice: 'new' }); draw() }, { id: 'keepnew' }),
      btn('Keep the old one', '', async () => { S = await api(`/api/session/${S.id}/keep`, { choice: 'old' }); draw() }, { id: 'keepold' }),
      btn('Read it again', '', beginRedo, { id: 'again' })))
  document.querySelector(`.w[data-i="${span.a}"]`)?.scrollIntoView({ block: 'center' })
}
async function finish() {
  try { S = await api(`/api/session/${S.id}/finish`, {}); draw() } catch (e) { fail(e) }
}
function drawAfter() {
  screen = 'after'; stepsOn('finish')
  const f = S.finish, marks = f.marks
  timeWords = inOrder(marks)
  let which = 'after'
  const tidy = f.tidy
  const did = [...f.stages, tidy.trimmed_start_s + tidy.trimmed_end_s > 0.2 ? 'Trimmed the quiet at the start and end' : null, tidy.shortened_pauses.length ? `Shortened ${tidy.shortened_pauses.length} long ${tidy.shortened_pauses.length === 1 ? 'pause' : 'pauses'}` : null].filter(Boolean)
  const num = (k) => f.numbers[k] || {}
  const table = el('table', { class: 'nums' }, el('tr', {}, el('th', {}, ''), el('th', {}, 'Before'), el('th', {}, 'After')),
    [['Overall loudness (LUFS)', 'lufs'], ['Highest peak (dBTP)', 'tp'], ['Spread of loud and soft (LU)', 'lra'], ['Room sound between words (dBFS)', 'floor'], ['Voice above room sound (dB)', 'snr']]
      .map(([label, k]) => el('tr', {}, el('td', {}, label), el('td', {}, String(num(k).before ?? '–')), el('td', {}, String(num(k).after ?? '–')))))
  const open = marks.flags.filter((x) => !x.ok)
  fill(
    el('h1', {}, 'Have a listen'),
    el('p', { class: 'say' }, 'Switch between your recording as it was and the cleaned-up one. They line up, so you can flip back and forth while it plays.'),
    !f.cleaned ? el('div', { class: 'problem' }, "We couldn't improve the sound safely, so we kept your recording just as it was.") : null,
    !f.can_approve ? el('div', { class: 'problem' }, "Much of this didn't match the story. Check that it's the right story and read it again, or send it and a team member will take a look.") : null,
    open.length ? el('div', { class: 'panel', id: 'decide' }, open.map((x) => el('div', { class: 'row', style: 'margin-bottom:8px' },
      btn(`Hear "${(x.written || x.heard).split(' ').slice(0, 4).join(' ')}"`, '', () => { which = 'after'; playRange(f.after_url, x.at - 0.7, x.at + 1.4) }),
      el('span', { class: 'say', style: 'margin:0' }, x.kind === 'swap' ? `sounded like “${bare(x.heard)}”` : x.kind === 'extra' ? 'heard extra words' : "wasn't heard"),
      btn('It was fine', 'fine', async () => { S = await api(`/api/session/${S.id}/fine`, { key: x.key, ok: true }); draw() }),
      btn('Read it again', '', () => { goFixFinal(x) })))) : null,
    story({ marks, onword: (e, i) => { const w = place(marks, i); if (w?.start != null) playRange(which === 'after' ? f.after_url : f.before_url, w.start - 0.3, w.end + 0.5) } }),
    el('div', { class: 'panel' }, el('h2', { style: 'margin-top:0' }, 'What we did'), el('ul', {}, did.map((t) => el('li', {}, t))),
      el('details', {}, el('summary', {}, 'The numbers'), table,
        el('p', { class: 'say' }, 'These numbers can’t hear the way a voice sounds. A team member listens before children hear this.'))))
  const beforeBtn = btn('Before', '', () => flip('before'), { id: 'ab-before', 'aria-pressed': 'false' })
  const afterBtn = btn('After', '', () => flip('after'), { id: 'ab-after', 'aria-pressed': 'true' })
  function flip(to) {
    which = to
    const a = audio(), t = a.currentTime, playing = !a.paused
    source(to === 'after' ? f.after_url : f.before_url)
    a.addEventListener('loadedmetadata', () => { a.currentTime = t; if (playing) a.play().catch(() => {}) }, { once: true })
    beforeBtn.setAttribute('aria-pressed', to === 'before'); afterBtn.setAttribute('aria-pressed', to === 'after')
  }
  source(f.after_url)
  const name = el('input', { id: 'narrator', autocomplete: 'off', placeholder: 'Leave blank to stay anonymous' })
  main.append(el('label', { class: 'name' }, 'Name to show with this reading (optional)', name))
  dock(el('div', { class: 'row' }, el('div', { class: 'ab' }, beforeBtn, afterBtn),
    btn('Play', '', () => { const a = audio(); a.paused ? a.play().catch(fail) : a.pause() }, { id: 'playall', 'data-label': 'Play' }),
    btn('Go back and change something', 'link', () => { player?.pause(); backToCheck().catch(fail) }),
    btn('Send for review', 'go big push', async () => { try { player?.pause(); S = await api(`/api/session/${S.id}/submit`, { name: name.value, heard_after_s: heardAfter }); draw() } catch (e) { fail(e) } }, { id: 'submit' })))
  playBtn()
}
async function backToCheck() { S = await api(`/api/session/${S.id}/reopen`, {}); draw() }
async function goFixFinal(flag) { S = await api(`/api/session/${S.id}/reopen`, {}); goFix(flag) }
function drawWaiting() {
  screen = 'waiting'; stepsOn('finish')
  fill(el('h1', {}, 'Thank you. Your reading is saved.'),
    el('p', { class: 'say' }, 'A team member will listen to it. Once they approve it, it goes in the reader, and each word lights up as you say it.'),
    el('div', { class: 'row' }, btn('Read another story', 'go big', () => pick().catch(fail), { id: 'another' }),
      btn('Take it back and change something', 'link', () => backToCheck().catch(fail), { id: 'takeback' })))
  dock()
}
function drawDone() {
  screen = 'done'; stepsOn('finish')
  fill(el('h1', {}, 'Your reading is in the reader'),
    el('p', { class: 'say' }, `${S.published.reviewer} listened and approved it. Each word lights up as you say it, and tapping a word plays from there.`),
    el('div', { class: 'row' }, ...(S.reader ? [el('a', { class: 'btn go big', href: `${S.reader}#/p/${S.uid}`, target: '_blank', id: 'open' }, 'Open it in the reader')] : []), btn('Read another story', '', () => pick().catch(fail))))
  dock()
}

// ------------------------------------------------------------------ start
async function start() {
  const sid = location.hash.slice(1)
  if (sid) { try { S = await api(`/api/session/${sid}`); return draw() } catch { /* an old address: start fresh */ } }
  pick().catch(fail)
}
$('home').onclick = (e) => {
  e.preventDefault()
  if (rec || saving) return say('Please finish recording first.')   // the controls for a recording in progress must stay on the screen
  giveUpStart = true
  silence()
  location.hash = ''
  pick().catch(fail)
}
window.addEventListener('beforeunload', (e) => { if (rec || saving) { e.preventDefault(); e.returnValue = '' } })
window.__state = () => ({ screen, S })
start()
