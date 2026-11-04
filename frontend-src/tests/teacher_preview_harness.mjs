// Node harness for the teacher preview (no browser). Run: node tests/teacher_preview_harness.mjs  (from prototype/app)
// 1) wording check on the page source: no claim of an assignment the prototype can't back.
// 2) truthfulness invariants of buildPreview() over every real passage in public/data.
// Kinds (see tests/README.md): GUARDS = counts match the data files, a voice shown is a real voice, nothing unreviewed
// reads as approved, no claim of approval / readiness / assignment. BEHAVIOR (reported only) = today's pencil design:
// the review-state names, the default-voice rule, the settings display, the exact Spanish note, today's data coverage.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { okGuard as G, okBehavior as B, finish } from './_kinds.mjs'

// These fixtures are private media; keep the harness available when local data is linked.
const requiredLocalFiles = ['public/data/index.json', 'public/data/kid_audio.json']
if (requiredLocalFiles.some(file => !fs.existsSync(new URL('../' + file, import.meta.url)))) {
  console.log('SKIP teacher_preview_harness.mjs: private ReadWorks fixtures are absent')
  process.exit(0)
}

const here = path.dirname(fileURLToPath(import.meta.url))
const app = path.join(here, '..')

// ---- 1. wording in the source the teacher sees
const passageVue = fs.readFileSync(path.join(app, 'src/views/Passage.vue'), 'utf8')
B(!/for this assignment/i.test(passageVue), 'Passage.vue source currently avoids "for this assignment"')
B(fs.existsSync(path.join(app, 'src/components/TeacherPreview.vue')), 'there is a TeacherPreview component')
B(/TeacherPreview/.test(passageVue), 'Passage.vue shows the preview')
const previewVue = fs.readFileSync(path.join(app, 'src/components/TeacherPreview.vue'), 'utf8')
const kidVue = fs.readFileSync(path.join(app, 'src/views/KidView.vue'), 'utf8')
const readerVue = fs.readFileSync(path.join(app, 'src/components/KidReader.vue'), 'utf8')
const feedbackVue = fs.readFileSync(path.join(app, 'src/components/Feedback.vue'), 'utf8')
const teacherVue = fs.readFileSync(path.join(app, 'src/views/Teacher.vue'), 'utf8')
const startVue = fs.readFileSync(path.join(app, 'src/components/KidStart.vue'), 'utf8')
B(/:settings="effectivePreviewSettings"/.test(passageVue) && /settings: Object/.test(previewVue), 'preview currently receives effective passage settings')
B(/:href="kidLink"/.test(previewVue) && /readerLink\(/.test(previewVue), 'preview currently uses a settings-bearing kid link')
B(/setTeacherReturnLink\(document/.test(kidVue), 'kid panel currently updates the actual onward href with teacher settings')
B(/matches\?\.\(['"]input, textarea, select, \[contenteditable/.test(readerVue) && /\.fb-scrim/.test(readerVue), 'reader source currently excludes editable controls and Feedback from shortcuts')
B(/onDialogKey/.test(feedbackVue) && /opener\.value\?\.focus/.test(feedbackVue), 'Feedback source currently includes a focus-return handler')
B(/another device/i.test(teacherVue) && /localhost/i.test(teacherVue), 'teacher currently explains reachable host for another device')
B(!/kv-tap-hint/.test(startVue), 'kid start currently has no speaker hint')
const { readerLink, linkSettings, setTeacherReturnLink } = await import(pathToFileURL(path.join(app, 'src/linkSettings.js')).href)
for (const on of [true, false]) for (const voice of ['human', 'generated']) {
  const assignment = { fromTeacher: true, soundOn: on, voice, view: 'passage' }
  for (const route of ['kid', 'p']) {
    const href = readerLink(route, 'example', assignment)
    const parsed = linkSettings(href)
    G(parsed.fromTeacher && parsed.soundOn === on && parsed.voice === voice && parsed.view === (route === 'kid' ? 'kid' : 'passage'), 'onward reader links preserve sound and voice', href)
  }
  const anchor = { href: '#/p/example', setAttribute(name, value) { if (name === 'href') this.href = value } }
  const root = { querySelector() { return anchor } }
  setTeacherReturnLink(root, 'example', assignment, voice)
  const copiedLink = linkSettings(anchor.href)
  G(copiedLink.fromTeacher && copiedLink.soundOn === on && copiedLink.voice === voice && copiedLink.view === 'passage',
    'the actual kid-panel return href preserves sound and voice', anchor.href)
}

let mod
try { mod = await import(pathToFileURL(path.join(app, 'src/teacherPreview.js')).href) } catch { mod = null }
B(!!mod, 'src/teacherPreview.js exists')
if (mod) {
  const { buildPreview, reviewState } = mod
  const rd = (p) => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null)
  const dataDir = path.join(app, 'public/data')
  const kid = rd(path.join(dataDir, 'kid_audio.json'))
  const index = rd(path.join(dataDir, 'index.json'))
  G(index.length > 0, 'the passage index is not empty')
  B(index.length >= 16, 'passage selection today includes at least 16', `got ${index.length}`)

  // review states: GUARD = never read as approved; BEHAVIOR = today's state names
  G(reviewState('needs human check').kind !== 'approved', '"needs human check" never reads as approved')
  G(reviewState('not reviewed (Polly, generated 2026-10-31)').kind !== 'approved', '"not reviewed" never reads as approved')
  G(reviewState(undefined).kind !== 'approved', 'a missing review field never reads as approved')
  G(reviewState('approved by J. Smith').kind !== 'approved' && /approved by J\. Smith/.test(reviewState('approved by J. Smith').text),
    'an unrecognized review value is shown as written, not as our own claim of approval')
  B(reviewState('needs human check').kind === 'unchecked', 'review state name: "needs human check" -> unchecked')
  B(reviewState('not reviewed (Polly, generated 2026-10-31)').kind === 'unchecked', 'review state name: "not reviewed" -> unchecked')
  B(reviewState(undefined).kind === 'unknown', 'review state name: missing -> unknown')
  B(reviewState('approved by J. Smith').kind === 'other', 'review state name: unrecognized value -> other')

  const BANNED = /(ready for kids|approved|verified|assign(ed|ment)|class(room)? will|certified)/i
  let withGloss = 0, noGloss = 0
  for (const e of index) {
    const u = e.uuid
    const data = rd(path.join(dataDir, `${u}.json`))
    const gloss = rd(path.join(dataDir, 'gloss', `${u}.json`))
    const syl = rd(path.join(dataDir, 'syllables', `${u}.json`))
    const p = buildPreview({ data, gloss, syl, kid, passageId: u, saved: {} })
    const tag = u.slice(0, 8)
    G(p.voices.map((v) => v.id).join() === data.voices.map((v) => v.id).join(), 'the preview lists the passage\'s real voices', `${tag}: voices differ from data`)
    G(p.childVoice && data.voices.some((v) => v.id === p.childVoice.id), 'the child voice is one of the real voices', `${tag}: child voice not one of the real voices`)
    B(p.childVoice?.id === (data.voices.some((v) => v.id === 'human') ? 'human' : data.voices[0].id), 'default voice rule: human if it exists, else the first voice', `${tag}: default voice rule`)
    // word help counts and review come straight from the files
    if (gloss) {
      withGloss++
      G(p.help.meanings?.count === gloss.entries.length, 'meaning count matches the gloss file', `${tag}: meaning count`)
      B(['unchecked', 'unknown', 'other'].includes(p.help.meanings?.review.kind), 'meaning review state is one of unchecked / unknown / other', `${tag}: meaning review`)
      G(gloss.review !== 'needs human check' || p.help.meanings?.review.kind !== 'approved', 'unreviewed meanings never read as approved', `${tag}: unreviewed meanings read as approved`)
      B(gloss.review !== 'needs human check' || p.help.meanings?.review.kind === 'unchecked', 'unreviewed meanings read as "unchecked"', `${tag}: unreviewed meanings must read as unchecked`)
    } else { noGloss++; G(p.help.meanings === null, 'no kid meanings are invented where there is no gloss file', `${tag}: invented kid meanings`) }
    if (!syl) G(!p.help.syllables, 'no syllable guide is invented where there is no syllables file', `${tag}: invented syllables`)
    else G(p.help.syllables?.count === Object.keys(syl).length, 'syllable count matches the syllables file', `${tag}: syllable count`)
    const sylUnreviewed = Object.values(syl || {}).every((s) => s.review === 'needs human check')
    G(sylUnreviewed ? p.help.syllables?.review.kind !== 'approved' : true, 'unreviewed syllables never read as approved', `${tag}: syllable review`)
    B(sylUnreviewed ? p.help.syllables?.review.kind === 'unchecked' : true, 'unreviewed syllables read as "unchecked"', `${tag}: syllable review`)
    G(p.help.readworksWords?.count === Object.keys(data.vocab).length, 'ReadWorks vocabulary count matches the passage file', `${tag}: vocab count`)
    // Spanish
    if (data.lang === 'ES') B(p.spanish.kind === 'es-passage' && /English/.test(p.spanish.text), 'Spanish passage note says the kid view buttons are English', `${tag}: Spanish passage must say the kid view buttons are English`)
    else {
      const n = Object.values(data.vocab).filter((v) => v.spanish).length
      G(n ? p.spanish.count === n : !p.spanish.count, 'Spanish word count matches the passage file (none claimed when none exist)', `${tag}: Spanish count`)
      B(n ? true : p.spanish.kind === 'none', 'no Spanish words reads as kind "none"', `${tag}: Spanish kind`)
    }
    // no claim of approval, readiness or assignment anywhere in the generated facts
    const all = JSON.stringify([p.childVoice, p.help, p.spanish, p.settings])
    G(!BANNED.test(all), 'no claim of approval, readiness or assignment in the preview text', `${tag}: banned claim in preview text: ${all.match(BANNED)?.[0]}`)
  }
  // today's data coverage is a fact about the data, not a rule: more word help is welcome
  B(withGloss === 9 && noGloss === 7, 'word-help coverage today: 9 passages with kid meanings, 7 without', `${withGloss} with, ${noGloss} without`)

  // voice fallback + saved choice
  const two = rd(path.join(dataDir, `${index.find((e) => e.voices.length === 2).uuid}.json`))
  const one = rd(path.join(dataDir, `${index.find((e) => e.voices.length === 1 && e.voices[0] === 'generated').uuid}.json`))
  const pg = buildPreview({ data: two, gloss: null, syl: null, kid, passageId: 'x', saved: { voice: 'generated', rate: 1.25, size: 'L' } })
  G(two.voices.some((v) => v.id === pg.childVoice?.id), 'a saved voice choice still shows a real voice')
  B(pg.childVoice?.id === 'generated' && pg.childVoice?.chosen, 'saved voice is honored and flagged as chosen')
  B(pg.settings.rate === 1.25 && pg.settings.size === 'large', 'saved speed and size are shown (1.25, "large")')
  const pf = buildPreview({ data: one, gloss: null, syl: null, kid, passageId: 'x', saved: { voice: 'human' } })
  G(one.voices.some((v) => v.id === pf.childVoice?.id) && !pf.childVoice?.chosen, 'a saved voice that is not available falls back to a real voice and is not claimed as chosen')
  const pn = buildPreview({ data: { voices: [], vocab: {} }, gloss: null, syl: null, kid: null, passageId: 'x' })
  G(pn.childVoice === null, 'no voices: no voice is invented')
  B(pn.help.none === true, 'no voices and no word help is stated with help.none')
}
finish({ printGuardPasses: false })
