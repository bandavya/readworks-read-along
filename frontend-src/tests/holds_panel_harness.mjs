// Harness for the held-takes panel's setting and pure helpers (src/holdsApi.js, holds-admin lane). Run from prototype/app:
//   node tests/holds_panel_harness.mjs     No browser, no network.
// GUARDS: with no VITE_HOLDS_API the app has no panel (today's behavior is untouched) and nothing is ever sent; a bad value can
// never become a base; a request carries the session token only as a header and never puts a passcode in the address; an expired
// or corrupt session means signed out; a flagged word's clip is that word's OWN start and end (never the sentence's or the
// passage's) and stays inside the recording; the sentence clip runs from its first word to its last; a stated speed comes only from
// a person's own timed answers (a scripted run gives none); the outcome sentence never calls an unanswered flag approved.
// BEHAVIOR: the pad sizes, the key names, the queue order.
import { okGuard as G, okBehavior as B, finish } from './_kinds.mjs'

const H = await import('../src/holdsApi.js')
const refused = (p) => p.then(() => false, () => true)
const near = (a, b) => Math.abs(a - b) < 1e-6
G(H.holdsBase === null, "unset: holdsBase is null, so the router has no #/holds and Review shows no link")
G(await refused(H.holdsRequest('/api/holds')), 'unset: a request refuses to send anything')
G(H.normalizeHoldsApi('https://api.example.test/') === 'https://api.example.test', 'a plain https base is kept, trailing slash dropped')
G([undefined, null, '', ' ', 'not a url', 'abc.com', 'javascript:alert(1)', 'data:text/plain,hi', 'ftp://x.example'].every((v) => H.normalizeHoldsApi(v) === null), 'empty, non-URL and non-http(s) values give no base')

// a request: header only, JSON body, no passcode in the URL
let seen
const fakeFetch = async (url, init) => { seen = { url, init }; return { ok: true, status: 200, json: async () => ({ ok: true }) } }
await H.holdsRequest('/api/holds', { base: 'https://x.example', token: 'tok123', fetchFn: fakeFetch })
G(seen.url === 'https://x.example/api/holds' && seen.init.headers.Authorization === 'Bearer tok123', 'the session token travels as an Authorization header')
await H.holdsRequest('/api/holds/login', { method: 'POST', body: { passcode: 'secret-pass', name: 'Sam' }, base: 'https://x.example', fetchFn: fakeFetch })
G(!seen.url.includes('secret-pass') && seen.init.method === 'POST' && seen.init.headers['Content-Type'] === 'application/json', 'a passcode goes in the POST body, never in the address')
const failing = async () => ({ ok: false, status: 409, json: async () => ({ error: 'This take changed.', changed: true }) })
try { await H.holdsRequest('/x', { base: 'https://x.example', fetchFn: failing }); G(false, 'a refusal rejects') } catch (e) {
  G(e instanceof H.HoldsError && e.status === 409 && e.message === 'This take changed.' && e.data.changed === true, 'a server refusal reaches the screen in the server\'s own words')
}
const offline = async () => { throw new TypeError('network') }
try { await H.holdsRequest('/x', { base: 'https://x.example', fetchFn: offline }); G(false, 'offline rejects') } catch (e) {
  G(e instanceof H.HoldsError && e.status === 0 && /could not reach/i.test(e.message), 'an unreachable server gives a plain message')
}

// session and remembered choice
const mem = () => { const m = {}; return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = v }, removeItem: (k) => { delete m[k] } } }
const st = mem()
const future = new Date(Date.now() + 3600e3).toISOString()
H.saveSession({ token: 't', name: 'Sam', expiresAt: future }, st)
G(H.readSession(st)?.name === 'Sam', 'a saved, unexpired session reads back')
G(H.readSession(st, Date.now() + 7200e3) === null, 'an expired session is signed out')
H.clearSession(st)
G(H.readSession(st) === null, 'clearing signs out')
st.setItem('sa-holds-session', '{not json')
G(H.readSession(st) === null, 'a corrupt session is signed out, not a crash')
G(H.readSession({ getItem() { throw new Error('blocked') } }) === null, 'storage that throws means signed out, not a crash')
G(!JSON.stringify(st).includes('passcode'), 'the session record has no passcode field')
const prefs = mem()
G(H.readPref('autoplay', true, prefs) === true, 'with nothing remembered, auto-play is on')
H.savePref('autoplay', false, prefs)
G(H.readPref('autoplay', true, prefs) === false, 'turning auto-play off is remembered')
G(H.readPref('autoplay', true, { getItem() { throw new Error('blocked') } }) === true, 'storage that throws just gives the default')

// ---------- the audio a flag plays ----------
const swap = { kind: 'swap', start: 10, end: 10.4 }
const c = H.wordClip(swap, 100)
G(near(c.from, 10 - H.WORD_PAD_BEFORE) && near(c.to, 10.4 + H.WORD_PAD_AFTER), "a word's clip is that word's own start and end plus a small pad, and nothing else")
G([[0.5, 0.9], [37.41, 37.98], [120, 120.3]].every(([s, e]) => { const w = H.wordClip({ kind: 'swap', start: s, end: e }, 300); return near(w.from, Math.max(0, s - H.WORD_PAD_BEFORE)) && near(w.to, e + H.WORD_PAD_AFTER) }),
  'that holds for any word, so the clip never follows the sentence or the passage')
G(H.wordClip({ kind: 'swap', start: 0.05, end: 0.3 }, 100).from === 0, 'a clip never starts before the recording')
G(H.wordClip({ kind: 'swap', start: 99.9, end: 100 }, 100).to <= 100, 'a clip never runs past the recording')
G(H.wordClip({ kind: 'swap', start: 5, end: 5 }, 100).to > H.wordClip({ kind: 'swap', start: 5, end: 5 }, 100).from, 'even a zero-length word gives a clip with some sound in it')
const missing = H.wordClip({ kind: 'missing', start: 20, end: 20.2 }, 100)
G(near(missing.from, 20.1 - H.MISSING_HALF_WINDOW) && near(missing.to, 20.1 + H.MISSING_HALF_WINDOW), 'a word nobody said plays the moment around where it should have been')
const extra = H.wordClip({ kind: 'extra', start: 2.0, end: 2.4 }, 100)
G(near(extra.from, 2.0 - H.WORD_PAD_BEFORE) && near(extra.to, 2.4 + H.WORD_PAD_AFTER), 'an extra spoken word plays that word')

const words = 'Dr. Mona spoke. Then she left! "Why?" asked Mr. Kim. The end'.split(' ')
G(JSON.stringify(H.sentenceBounds(words, 1)) === '[0,2]', 'an abbreviation (Dr.) does not end a sentence')
G(JSON.stringify(H.sentenceBounds(words, 4)) === '[3,5]', 'a sentence ends at ! and the next starts after it')
G(JSON.stringify(H.sentenceBounds(words, 9)) === '[7,9]', 'Mr. does not end a sentence, and a closing quote after ? still does')
G(JSON.stringify(H.sentenceBounds(words, words.length - 1)) === `[${words.length - 2},${words.length - 1}]`, 'the last sentence may have no full stop')
const long = Array.from({ length: 200 }, (_, i) => `w${i}`)
const [la, lb] = H.sentenceBounds(long, 100)
G(lb - la <= 81, 'a run with no full stop is cut, so a "sentence" is never the whole passage')
const rows = Array.from({ length: 12 }, (_, i) => [i + 1, i + 1.5, 0])
const data = { lead: ['Title', 'by', 'Me'], text: ['One', 'two.', 'Three', 'four', 'five.', 'Six'], rows: rows.slice(0, 9), duration: 50 }
const s1 = H.sentenceFor(data, { kind: 'swap', text_index: 3, word_index: 6, written: 'four' })
G(s1.words.join(' ') === 'Three four five.' && s1.mark === 1 && s1.span === 1, 'the flag sits in its own sentence, at the right word')
G(near(s1.from, rows[3 + 2][0] - 0.1) && near(s1.to, rows[3 + 4][1] + 0.25), "the sentence clip runs from its first word's start to its last word's end")
const s2 = H.sentenceFor(data, { kind: 'swap', text_index: -2, word_index: 1, written: 'by' })
G(s2.words.join(' ') === 'Title by Me' && s2.mark === 1, 'a flag in the title uses the title and byline as its sentence')
const s3 = H.sentenceFor(data, { kind: 'swap', text_index: 0, word_index: 3, written: 'One two' })
G(s3.span === 2, 'a flagged phrase covers all its written words')
const s4 = H.sentenceFor(data, { kind: 'extra', text_index: 2, word_index: 5, written: '', heard: 'um' })
G(s4.span === 0 && s4.mark === 0, 'an extra spoken word has no written span and sits before the next written word')

// ---------- answers, outcome, speed ----------
const fl = (...a) => a.map((x) => ({ answer: x ? { answer: x } : null }))
G(JSON.stringify(H.summarize(fl('right', 'wrong', null))) === '{"total":3,"right":1,"wrong":1,"unanswered":1}', 'the answer counts add up')
G(H.outcomeText({ total: 3, right: 3, wrong: 0, unanswered: 0 }) === 'All 3 sound right.', 'all right says all right')
G(!/All .* right/.test(H.outcomeText({ total: 3, right: 2, wrong: 0, unanswered: 1 })), 'an unanswered flag is never called right')
G(!/All .* right/.test(H.outcomeText({ total: 3, right: 2, wrong: 1, unanswered: 0 })), 'a wrong flag is never called right')
G(H.outcomeText({ total: 3, right: 2, wrong: 1, unanswered: 0 }) === '2 sound right, 1 sounds wrong.', 'a mixed take says how many of each')
G(H.outcomeText({ total: 1, right: 1, wrong: 0, unanswered: 0 }) === 'All 1 sounds right.', 'one flag reads correctly')
G(H.formatDuration(200) === '3 min 20 s' && H.formatDuration(45) === '45 s' && H.formatDuration(120) === '2 min', 'durations read plainly')
G(H.speedLine({ complete: true, timed: 14, seconds: 200 }) === '14 flags in 3 min 20 s', 'a person-timed take states its speed')
G(H.speedLine({ complete: false, timed: 3, seconds: 20, scripted: 0 }) === '' && H.speedLine({ complete: false, timed: 0, scripted: 6, seconds: 0 }) === '' && H.speedLine(undefined) === '', 'no stated speed unless every answer was timed by a person: a scripted run or a partly timed take gives none')
let t = 0
const sw = H.makeStopwatch(() => t)
sw.start(); t = 4000; sw.pause(); t = 60000; sw.resume(); t = 62500
G(sw.seconds() === 6.5, 'time the page was hidden is not counted as time on screen')
B(H.WORD_PAD_BEFORE === 0.12 && H.WORD_PAD_AFTER === 0.18, 'the pads around a word are 0.12 s before and 0.18 s after')

// ---------- the queue and the keys ----------
const q = [{ id: 'a', voice: 'generated', unanswered: 0, blocked: false }, { id: 'b', voice: 'human', unanswered: 2, blocked: false },
  { id: 'c', voice: 'generated', unanswered: 3, blocked: true }, { id: 'd', voice: 'generated', unanswered: 1, blocked: false }]
G(H.nextTake(q).id === 'b', 'the next hold is one with flags to answer, not one that is only waiting for its decision')
G(H.nextTake(q, new Set(['b.human'])).id === 'd', 'a hold left for later is not offered again straight away')
G(H.nextTake([q[2]]) === null && H.nextTake([]) === null, 'a hold that cannot be released here is never offered; nothing left gives nothing')
G(H.nextTake([q[0]]).id === 'a', 'when only decisions are left, the next one is offered')
const key = (k, tag = 'BODY', extra = {}) => H.keyAction({ key: k, target: { tagName: tag }, ...extra })
G(key('y') === 'right' && key('1') === 'right' && key('n') === 'wrong' && key('2') === 'wrong', 'Y/1 and N/2 answer')
G(key('ArrowRight') === 'next' && key('ArrowLeft') === 'prev' && key('u') === 'undo' && key('s') === 'sentence' && key(' ') === 'word', 'arrows move, U undoes, S plays the sentence, Space the word')
G(key('y', 'TEXTAREA') === null && key('n', 'INPUT') === null, 'typing in a note never answers a flag')
G(key('y', 'BODY', { ctrlKey: true }) === null && key('n', 'BODY', { metaKey: true }) === null, 'a browser shortcut is never taken')
G(key(' ', 'BUTTON') === null, 'Space on a focused button presses the button, not the word')
G(H.stepIndex(0, 5, -1) === 0 && H.stepIndex(4, 5, 1) === 4 && H.stepIndex(0, 0, 1) === 0, 'the flag stepper stops at both ends')
const ps = H.paragraphsOf(['a', 'b', 'c', 'd', 'e'], [2, 3])
G(ps.length === 2 && ps[1].start === 2 && ps[1].words.join('') === 'cde', 'paragraphs keep each word at its original position')
G(H.paragraphsOf(['a', 'b'], []).length === 1 && H.paragraphsOf(['a', 'b', 'c'], [1]).flatMap((p) => p.words).length === 3, 'no word is lost when paragraph sizes are missing or short')
G(H.isScripted({ __holdsScripted: true }) === true && H.isScripted({ navigator: { webdriver: true } }) === true && H.isScripted({ navigator: { webdriver: false } }) === false, 'a script-driven page says so')

// ---------- an answer needs a fresh press ----------
{
  let t = 0
  const g = H.makeAnswerGate(() => t, 300)
  g.arrive()
  t = 100
  G(g.keyDown({ key: 'y', repeat: false }) === false, 'a key pressed within 0.3 s of a flag arriving does not answer')
  t = 400
  G(g.keyDown({ key: 'y', repeat: true }) === false, 'a held key (auto-repeat) never answers')
  G(g.keyDown({ key: 'y', repeat: false }) === true, 'a new press after that does')
  t = 500
  G(g.keyDown({ key: 'n', repeat: false }) === false && g.keyDown({ key: 'y', repeat: false }) === false, 'while an answer key is still down, no other answer is accepted (a key must be released first)')
  g.keyUp({ key: 'y' })
  G(g.keyDown({ key: 'n', repeat: false }) === true, 'after the key is released, a new press answers')
  g.keyUp({ key: 'n' })
  g.arrive()
  t = 1000
  G(g.click() === false, 'a click with no press behind it (a held Enter, a repeated click) does not answer')
  g.pressed({ repeat: false })
  G(g.click() === true && g.click() === false, 'a press gives exactly one answer; a second click needs a fresh press')
  g.pressed({ repeat: true })
  G(g.click() === false, 'a repeated key press on a focused button does not count as a fresh press')
  g.pressed({})
  t = 1100
  g.arrive()
  t = 1200
  G(g.click() === false, 'a tap within 0.3 s of a flag arriving is ignored')
  g.arrive(); g.keyUp({ key: 'y' }); g.reset()
  t = 1600
  g.pressed({}); G(g.click() === true, 'two real taps are two answers (the second one is a fresh press)')
}

// ---------- answers carry the take they were made on; a refusal drops the rest ----------
{
  const sent = []
  const told = { changed: null, failed: [] }
  const refuseFirst = async (job) => {
    sent.push(job.body.fingerprint)
    if (sent.length === 1) { const e = new H.HoldsError(409, 'changed', { changed: true }); throw e }
  }
  const q = H.makeAnswerQueue(refuseFirst, { changed: async (n) => { told.changed = n }, failed: async (job) => { told.failed.push(job.body.flag) } })
  q.add({ body: { fingerprint: 'OLD', flag: 'a' } })
  q.add({ body: { fingerprint: 'OLD', flag: 'b' } })
  q.add({ body: { fingerprint: 'OLD', flag: 'c' } })
  await q.idle()
  G(sent.length === 1, 'after a refusal the answers still waiting are dropped, never sent against the changed take')
  G(told.changed === 3, 'the person is told how many answers were not saved (the refused one and the two dropped)')
  q.add({ body: { fingerprint: 'NEW', flag: 'd' } })
  await q.idle()
  G(sent.length === 2 && sent[1] === 'NEW', 'an answer made after the reload goes with the new fingerprint')
  G(H.changedMessage(3) === 'This take changed. Your last 3 answers weren\u2019t saved.' && H.changedMessage(1) === 'This take changed. Your last answer wasn\u2019t saved.', 'the message says it plainly')
  const sent2 = []
  const q2 = H.makeAnswerQueue(async (job) => { sent2.push(job.body.flag); if (job.body.flag === 'x') throw new H.HoldsError(0, 'offline', {}) }, { changed: async () => {}, failed: async (job) => { told.failed.push(job.body.flag) } })
  q2.add({ body: { flag: 'x' } }); q2.add({ body: { flag: 'y' } })
  await q2.idle()
  G(sent2.join() === 'x,y' && told.failed.join() === 'x', 'a failure that is not a changed take only fails that answer; the next one is still sent')
  let fp = 'A'
  const sent3 = []
  const q3 = H.makeAnswerQueue(async (job) => { sent3.push(job.body.fingerprint) }, { changed: async () => {}, failed: async () => {} })
  q3.add({ body: { fingerprint: fp } }); fp = 'B'; q3.add({ body: { fingerprint: fp } })
  await q3.idle()
  G(sent3.join() === 'A,B', 'each answer is sent with the fingerprint it was made with, not whatever the screen holds when it is sent')
}

// ---------- a clip waiting for the recording is cancelled when anything else starts or stops ----------
{
  const mkAudio = () => {
    const listeners = {}
    return {
      readyState: 0, src: '', paused: true, currentTime: 0, playbackRate: 1, started: [],
      addEventListener(type, fn, opts) { (listeners[type] ||= []).push({ fn, once: !!(opts && opts.once) }) },
      removeEventListener(type, fn) { listeners[type] = (listeners[type] || []).filter((l) => l.fn !== fn) },
      fire(type) { for (const l of [...(listeners[type] || [])]) { if (l.once) this.removeEventListener(type, l.fn); l.fn() } },
      load() {}, pause() { this.paused = true },
      play() { this.paused = false; this.started.push({ src: this.src, from: this.currentTime }); return Promise.resolve() },
    }
  }
  const noTimer = { every: () => 1, clear: () => {} }
  let a = mkAudio()
  let p = H.makeClipPlayer(a, noTimer)
  p.play('rec.mp3', 5, 6, 'word')
  p.play('rec.mp3', 20, 21, 'word')
  a.readyState = 1; a.fire('loadedmetadata')
  G(a.started.length === 1 && a.started[0].from === 20, 'when the recording loads, only the latest clip starts, not the one that was replaced')
  a = mkAudio(); p = H.makeClipPlayer(a, noTimer)
  p.play('rec.mp3', 5, 6, 'word')
  p.stop()
  a.readyState = 1; a.fire('loadedmetadata')
  G(a.started.length === 0, 'a clip still loading never starts after the player was stopped (moving on to the next flag stops it)')
  a = mkAudio(); a.readyState = 1; p = H.makeClipPlayer(a, noTimer)
  p.play('rec.mp3', 5, 6, 'word')
  G(a.started.length === 1 && a.started[0].from === 5, 'with the recording already loaded a clip starts at once, at its own start')
}

B(H.shortState('live_unanswered') === 'Live now' && H.shortState('held') === 'Held', 'the list names states in one or two words')
finish()
