// Shell browser check: node tests/teacher_demo_browser.mjs <base-url> [shot-folder]
// Installed Edge via CDP. No browser package, login, server API, or AWS call.
import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { guard, finish } from './_kinds.mjs'
import { ASSIGNMENT, STUDENTS } from '../src/teacherDemo/classData.js'
import { SUPPORTS } from '../src/teacherDemo/resolve.js'
import { sessionFor } from '../src/teacherDemo/session.js'
const [base, shots] = process.argv.slice(2)
if (!base) { console.error('Usage: node tests/teacher_demo_browser.mjs <base-url> [shot-folder]'); process.exit(2) }
const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const port = 19400 + Math.floor(Math.random() * 400)
const dir = mkdtempSync(join(tmpdir(), 'teacher-demo-'))
const proc = spawn(edge, ['--headless=new', '--inprivate', '--disable-background-networking', `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, '--mute-audio', '--no-first-run', '--disable-gpu', 'about:blank'], { stdio: 'ignore' })
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
let ws, serial = 0, errors = []
const pending = new Map()
function send(method, params={}) { return new Promise((resolve,reject) => { const id=++serial; pending.set(id,{resolve,reject}); ws.send(JSON.stringify({id,method,params})) }) }
async function evaluate(expression) { const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true}); if(r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails).slice(0,500)); return r.result.value }
async function go(hash) { errors=[]; await send('Page.navigate',{url:`${base.replace(/\/$/,'')}/#/${hash}`}); await pause(1100) }
async function setHash(hash) { errors=[]; await evaluate(`window.__tdAudioCalls=[]; location.hash=${JSON.stringify('#/'+hash)}; true`); await pause(450) }
async function appears(selector, ms=4000) { for(let elapsed=0;elapsed<ms;elapsed+=100) { if(await evaluate(`!!document.querySelector(${JSON.stringify(selector)})`)) return true; await pause(100) } return false }
async function waitFor(selector, ms=4000) { if(await appears(selector,ms)) return; throw Error(`Timed out waiting for ${selector}: ${JSON.stringify(await evaluate(`({hash:location.hash,text:document.body.innerText.slice(0,500)})`))}; console errors: ${errors.join('; ')}`) }
async function click(selector) {
  await evaluate(`document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({block:'center'})`)
  await pause(100)
  const point=await evaluate(`(() => { const e=document.querySelector(${JSON.stringify(selector)}); if(!e) return null; const r=e.getBoundingClientRect(), x=(r.left+r.right)/2, y=(r.top+r.bottom)/2, hit=document.elementFromPoint(x,y); return {x,y,w:r.width,h:r.height,visible:getComputedStyle(e).visibility!=='hidden'&&getComputedStyle(e).display!=='none',hit:e===hit||e.contains(hit)} })()`)
  if(!point?.visible || !point.w || !point.h || !point.hit || point.x<0 || point.x>await evaluate('innerWidth') || point.y<0 || point.y>await evaluate('innerHeight')) throw Error(`Missing, hidden, or covered ${selector}: ${JSON.stringify(point)}`)
  await send('Input.dispatchMouseEvent',{type:'mousePressed',x:point.x,y:point.y,button:'left',clickCount:1})
  await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:point.x,y:point.y,button:'left',clickCount:1})
  await pause(450)
}
async function view() { return evaluate(`(() => ({
  title:document.querySelector('.td-head h1')?.textContent,
  text:document.querySelector('.td-page')?.innerText||'',
  scroll:document.documentElement.scrollWidth, width:innerWidth,
  targets:[...document.querySelectorAll('.td-page a,.td-page button,.td-page select')].filter(e=>e.getBoundingClientRect().width && (e.getBoundingClientRect().width<43.5||e.getBoundingClientRect().height<43.5)).map(e=>e.textContent),
  audioCalls:window.__tdAudioCalls?.length||0,
}))()`)}
async function reader() { return evaluate(`(() => { const p=document.querySelector('.td-reader,.kv'); const t=p?.querySelector('.sa-text'), back=document.querySelector('.topbar .back,.kv-demo-back'), backRect=back?.getBoundingClientRect(); return {
  hash:location.hash, text:document.body.innerText, exists:!!p, kid:p?.classList.contains('kv'),
  contrast:p?.classList.contains('td-contrast')||p?.classList.contains('td-kid-contrast'),
  spaced:p?.classList.contains('td-spaced')||p?.classList.contains('kv-spaced'),
  sans:p?.classList.contains('td-sans')||p?.classList.contains('kv-font-sans'),
  size:p?.style.getPropertyValue('--td-size')||p?.style.getPropertyValue('--size-mul'),
  player:!!document.querySelector('.player'), preview:!!document.querySelector('.pv'), side:!!document.querySelector('.side'),
  reviewLink:!!document.querySelector('.rv-vocab-link,.rv-note,.sg-note'), question:!!document.querySelector('[role=tab]')&&[...document.querySelectorAll('[role=tab]')].some(x=>/Question Set/.test(x.textContent)),
  disabled:!!document.querySelector('.inert'), banner:!!document.querySelector('.banner'), feedback:!!document.querySelector('.feedback-pill'),
  audioCalls:window.__tdAudioCalls?.length||0, currentVoice:document.querySelector('.player [role=group][aria-label=Voice] button[aria-pressed=true]')?.textContent,
  letter:t&&getComputedStyle(t).letterSpacing, font:t&&getComputedStyle(t).fontFamily,
  error:document.querySelector('.notice,.kv-msg')?.innerText||'', back:back?.innerText,
  backVisible:!!(backRect?.width && backRect?.height && getComputedStyle(back).visibility!=='hidden' && getComputedStyle(back).display!=='none'),
  backHref:back?.getAttribute('href'), brandHref:document.querySelector('.topbar .brand')?.getAttribute('href'),
}})()`)}
function check(name, pass, detail) { guard(name,()=>{ if(!pass) throw Error(typeof detail==='string' ? detail : JSON.stringify(detail)) }) }
function student(id) { return STUDENTS.find(s=>s.id===id) }
function linkValues(href) { const q=new URLSearchParams(href.split('?')[1]); return Object.fromEntries(q) }
function expectLink(id, href, resolved=sessionFor(student(id))) { const q=linkValues(href), v=resolved.values; check(`${id}: link carries resolved supports`, q.td==='1' && q.student===id && q.sa===(v.soundOn?'on':'off') && q.voice===v.voice && q.view===(v.readerMode==='kid'?'kid':'passage') && q.font===v.font && q.size===v.textSize && q.space===(v.spacing?'1':'0') && q.contrast===(v.contrast?'1':'0') && q.auto===(v.vocabAutoShow?'1':'0'), {q,v}) }
function cleanReader(m, id, width) {
  const personId = id.toLowerCase()
  check(`${id} ${width}: story has no teacher or builder panels`, m.exists && !m.preview && !m.side && !m.reviewLink && !m.question && !m.disabled && !m.banner && !m.feedback && !/What a child will get|Preview only|Nothing here is assigned|Not part of this prototype|Set by your teacher|not checked by a person|Review it|Question Set|Lexile|Assign|Print/.test(m.text), m)
  check(`${id} ${width}: visible way back to own reading`, m.backVisible && /Back to my reading/.test(m.back||'') && m.backHref===`#/class-demo?as=${personId}` && (!m.brandHref || m.brandHref===m.backHref), m)
  check(`${id} ${width}: reader never autoplays`, m.audioCalls===0, m.audioCalls)
}
try {
  let tabs
  for(let i=0;i<80;i++){ try { tabs=await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); if(tabs.some(t=>t.type==='page')) break } catch {} await pause(500) }
  if(!tabs?.some(t=>t.type==='page')) throw Error('Edge debugging port unavailable')
  ws=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl)
  await new Promise(resolve=>{ws.onopen=resolve})
  ws.onmessage=({data})=>{ const m=JSON.parse(data); if(m.id && pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result)}; if(m.method==='Runtime.exceptionThrown') errors.push(m.params.exceptionDetails?.text || 'exception'); if(m.method==='Runtime.consoleAPICalled' && m.params.type==='error') errors.push(m.params.args?.map(x=>x.value||x.description).join(' ')||'console error') }
  await send('Page.enable'); await send('Runtime.enable')
  await send('Page.addScriptToEvaluateOnNewDocument',{source:`(() => { window.__tdAudioCalls=[]; const original=HTMLMediaElement.prototype.play; HTMLMediaElement.prototype.play=function(...args){window.__tdAudioCalls.push({src:this.currentSrc||this.src});return original.apply(this,args)} })()`})
  if(shots) mkdirSync(shots,{recursive:true})
  const passage=JSON.parse(readFileSync(new URL(`../../frontend/data/${ASSIGNMENT.passageId}.json`,import.meta.url),'utf8'))
  const firstVocabMatch=passage.html.match(/data-vocab-sense-id="(\d+)"[^>]*>\s*<span[^>]*data-i="(\d+)"/)
  const firstVocabIndex=Number(firstVocabMatch?.[2])
  const firstVocabWord=passage.vocab[firstVocabMatch?.[1]]?.word
  const firstVocabTime=passage.voices.find(v=>v.id==='human')?.t?.[firstVocabIndex]?.[0]
  for(const [width,height] of [[390,844],[1366,768]]) {
    await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width===390})
    // A hash navigation preserves the module session. Each viewport is a fresh presentation.
    await go('class-demo?as=teacher')
    await send('Page.reload',{ignoreCache:true})
    await pause(900)
    await waitFor('.td-head h1')
    await click('.td-tabs button:nth-child(2)')
    check(`teacher ${width}: fresh class settings`,await evaluate(`document.querySelector('.td-toggle:nth-child(1)')?.getAttribute('aria-pressed')==='true' && document.querySelector('.td-toggle:nth-child(2)')?.getAttribute('aria-pressed')==='false'`),'viewport did not reload')
    await click('.td-tabs button:nth-child(1)')
    for(const role of ['teacher','maya','diego','jordan','priya']) {
      await go(`class-demo?as=${role}`)
      const m=await view()
      check(`${role} ${width}: screen loads`, !!m.title, m)
      check(`${role} ${width}: no console errors`, errors.length===0, errors)
      check(`${role} ${width}: no sideways scroll`, m.scroll<=m.width+1, m)
      check(`${role} ${width}: targets at least 44px`, m.targets.length===0, m.targets)
      check(`${role} ${width}: audio stays off`, m.audioCalls===0, m.audioCalls)
      check(`${role} ${width}: no broken apostrophe`, !/\w\?s\b/.test(m.text), m.text)
      check(`${role} ${width}: presenter navigation is available`, await evaluate(`!!document.querySelector('.td-roles[aria-label="Presenter: View as"] a[href="#/class-demo?as=teacher"]')`), m.text)
      if(['maya','diego','jordan'].includes(role)) {
        const resolved=sessionFor(student(role))
        check(`${role} ${width}: ordinary student assignment`, m.title==='Your reading' && (m.text.match(/Your reading/g)||[]).length===1 && !/Sample class|\bSunrise\b|\bRiver\b|\bOak\b|Reading group|Set for this story|Reader view:|Word cards while reading:/.test(m.text), m.text)
        for(const support of SUPPORTS.filter(s=>resolved.values[s.key]===false)) check(`${role} ${width}: off ${support.key} hidden`, !m.text.includes(`${support.label}:`), m.text)
        const href=await evaluate(`document.querySelector('[data-test="student-reader-link"]')?.getAttribute('href')`)
        expectLink(role,href,resolved)
      }
      if(role==='priya') {
        check(`Priya ${width}: no student names or data`, !/Maya|Diego|Jordan|Class 4B|reader progress/.test(m.text),m.text)
        await click('.td-queue a')
        await waitFor('#rv-title')
        const review=await evaluate(`({title:document.querySelector('#rv-title')?.textContent,back:document.querySelector('.rv-back')?.textContent,banner:!!document.querySelector('.banner')})`)
        check(`Priya ${width}: queue opens word help and returns`,/Check word help/.test(review.title||'')&&/Back to content work/.test(review.back||'')&&!review.banner,review)
        await click('.rv-back')
      }
      if(shots){const shot=await send('Page.captureScreenshot',{format:'png'});writeFileSync(join(shots,`${role}-${width}.png`),Buffer.from(shot.data,'base64'))}
    }
    await go('class-demo?as=teacher')
    await click('.td-roles a[href="#/class-demo?as=maya"]')
    check(`Maya ${width}: presenter can switch people`,(await view()).title==='Your reading',(await view()).text)
    await click('.td-roles a[href="#/class-demo?as=teacher"]')
    for(const [tabIndex,tabName] of [[2,'supports'],[3,'words']]) {
      await click(`.td-tabs button:nth-child(${tabIndex})`)
      const m=await view()
      check(`teacher ${tabName} ${width}: scroll and targets`,m.scroll<=m.width+1&&m.targets.length===0,m)
      if(tabName==='supports' && width===1366) {
        const visible=await evaluate(`['.td-toggle:nth-child(1)','.td-toggle:nth-child(2)','[data-test="jordan-soundOn"]'].every(s=>{const r=document.querySelector(s)?.getBoundingClientRect();return r && r.top>=0 && r.bottom<=innerHeight})`)
        check(`teacher ${width}: class controls and lock fit on screen`,visible,m.text)
      }
      if(tabName==='words') check(`teacher ${width}: pooled words include passage sentences`,/soccer field|training academy/.test(m.text),m.text)
    }
    await click('.td-tabs button:nth-child(2)')
    await click('.td-toggle:nth-child(3)')
    check(`teacher ${width}: reader view reaches the story link`, (await evaluate(`document.querySelector('[data-test="maya-preview"] a')?.getAttribute('href')`))?.startsWith('#/kid/'), 'Big page did not reach Maya')
    await click('.td-toggle:nth-child(3)')
    const previewSize=await evaluate(`document.querySelector('.td-mini-story')?.style.fontSize`)
    const previewLink=await evaluate(`document.querySelector('[data-test="maya-preview"] a')?.getAttribute('href')`)
    check(`Maya ${width}: preview is a passage`, previewLink?.startsWith('#/p/'), previewLink)
    await click('.td-toggle:nth-child(2)') // high contrast on
    const contrastPreview=await evaluate(`document.querySelector('[data-test="maya-preview"] a')?.getAttribute('href')`)
    check(`Maya ${width}: teacher contrast changes preview`,linkValues(contrastPreview).contrast==='1' && await evaluate(`document.querySelector('.td-mini-story')?.classList.contains('td-mini-contrast')`),contrastPreview)
    await setHash('class-demo?as=maya')
    check(`Maya ${width}: View-as gives heading focus`,await evaluate(`document.activeElement===document.querySelector('.td-head h1')`),'focus lost')
    const mayaLink=await evaluate(`document.querySelector('[data-test="student-reader-link"]')?.getAttribute('href')`)
    check(`Maya ${width}: teacher setting follows role switch`,mayaLink===contrastPreview,mayaLink)
    await evaluate(`(() => { const s=document.querySelector('#td-text-size'); s.value='L'; s.dispatchEvent(new Event('change',{bubbles:true})); return true })()`)
    const chosen=await evaluate(`document.querySelector('[data-test="student-reader-link"]')?.getAttribute('href')`)
    check(`Maya ${width}: student text choice changes link`,linkValues(chosen).size==='L',chosen)
    await click('[data-test="student-reader-link"]')
    await waitFor('.td-reader .sa-text')
    const m=await reader()
    cleanReader(m,'Maya',width)
    check(`Maya ${width}: real standard reader gets size, contrast and voice`,!m.kid && m.contrast && m.size==='1.2' && m.currentVoice==='Human' && m.player,m)
    const hasTabs=await evaluate(`!!document.querySelector('.td-reader .tabs [role="tab"]')`)
    check(`Maya ${width}: voiced reader has passage tabs`,hasTabs,m)
    if(hasTabs) {
      await click('.td-reader .tabs [role="tab"]:nth-child(2)')
      const vocab=await reader()
      check(`Maya ${width}: vocabulary has no review or builder notes`,!vocab.reviewLink && !/draft|not checked by a person|Review it|prototype/i.test(vocab.text),vocab.text.slice(0,900))
      await click('.td-reader .tabs [role="tab"]:nth-child(1)')
    }
    check(`Maya ${width}: word-card timing exists`,Number.isFinite(firstVocabTime) && !!firstVocabWord,{firstVocabTime,firstVocabWord})
    if(Number.isFinite(firstVocabTime)) {
      for(let i=0;i<80 && !(await evaluate(`Number(document.querySelector('.player input[type=range]')?.max)>${firstVocabTime+1}`));i++) await pause(100)
      const ready=await evaluate(`Number(document.querySelector('.player input[type=range]')?.max)>${firstVocabTime+1}`)
      check(`Maya ${width}: recording is ready for word-card check`,ready,await reader())
      if(ready) {
        // Seek while paused, then start narration. This tests the first spoken vocabulary
        // word without racing the media play event against a long seek.
        await evaluate(`(() => { const s=document.querySelector('.player input[type=range]'); s.value=${firstVocabTime+0.1}; s.dispatchEvent(new Event('input',{bubbles:true})); return true })()`)
        await pause(300)
        await click('.player .play')
        let autoCard=false
        for(let i=0;i<20 && !autoCard;i++){autoCard=await evaluate(`!!document.querySelector('.vpop:not(.hidden) .vpop-def')`);if(!autoCard)await pause(100)}
        const cardState=await evaluate(`({on:document.querySelector('.player .play')?.getAttribute('aria-label'),word:document.querySelector('.sa-w.sa-now')?.textContent,card:document.querySelector('.vpop')?.innerText,auto:new URLSearchParams(location.hash.split('?')[1]).get('auto')})`)
        check(`Maya ${width}: standard reader shows a word card while reading`,autoCard && cardState.on==='Pause' && cardState.auto==='1' && cardState.card?.toLowerCase().includes(firstVocabWord.toLowerCase()),{firstVocabTime,firstVocabWord,cardState})
      }
    }
    const savedVoice=await evaluate(`localStorage.getItem('rwp-voice')`)
    await click('.player-more')
    await click('.player [role=group][aria-label=Voice] button:first-child')
    const switched=await reader()
    check(`Maya ${width}: voice choice changes the player without saving an ordinary preference`,switched.currentVoice==='Generated' && await evaluate(`localStorage.getItem('rwp-voice')`)===savedVoice,switched)
    await click('.topbar .back')
    const returnedReady = await appears('.td-head h1')
    const returned = await view()
    const backWorked = returnedReady && returned.title==='Your reading' && await evaluate(`location.hash==='#/class-demo?as=maya' && scrollY===0`)
    check(`Maya ${width}: Back opens her own list`, backWorked, { ...returned, hash:await evaluate('location.hash'), errors })
    if (backWorked) await click('.td-roles a[href="#/class-demo?as=teacher"]')
    else await setHash('class-demo?as=teacher')
    await waitFor('.td-head h1')
    check(`Maya ${width}: text choice changes the visual preview`,(await evaluate(`document.querySelector('.td-mini-story')?.style.fontSize`))!==previewSize,'size preview unchanged')
    check(`Maya ${width}: reader voice choice reaches the teacher preview`,linkValues(await evaluate(`document.querySelector('[data-test="maya-preview"] a')?.getAttribute('href')`)).voice==='generated','voice choice lost')
    check(`teacher ${width}: supports tab and class setting survive return`,(await evaluate(`document.querySelector('#td-supports-h')?.textContent`))==='Reading supports' && (await evaluate(`document.querySelector('.td-toggle:nth-child(2)')?.getAttribute('aria-pressed')`))==='true','return state')
    await click('.td-toggle:nth-child(1)') // class read aloud off
    const jordanLock=await evaluate(`document.querySelector('[data-test="jordan-soundOn"]')?.innerText`)
    check(`Jordan ${width}: lock remains visible after class change`,/On[\s\S]*Accommodation lock[\s\S]*Locked/.test(jordanLock),jordanLock)
    await setHash('class-demo?as=diego')
    const diegoLink=await evaluate(`document.querySelector('[data-test="student-reader-link"]')?.getAttribute('href')`)
    check(`Diego ${width}: class read aloud off reaches student`,linkValues(diegoLink).sa==='off',diegoLink)
    await click('[data-test="student-reader-link"]'); await waitFor('.td-reader .sa-text')
    const d=await reader();cleanReader(d,'Diego',width)
    check(`Diego ${width}: standard reader honors silent font and spacing`,!d.player && d.sans && d.spaced && !d.kid,d)
    await click('.topbar .back')
    await setHash('class-demo?as=jordan')
    const jordanLink=await evaluate(`document.querySelector('[data-test="student-reader-link"]')?.getAttribute('href')`)
    check(`Jordan ${width}: lock reaches student after class changes`,linkValues(jordanLink).sa==='on'&&linkValues(jordanLink).contrast==='1',jordanLink)
    await click('[data-test="student-reader-link"]');await waitFor('.td-reader .sa-text')
    const j=await reader();cleanReader(j,'Jordan',width)
    check(`Jordan ${width}: real reader keeps read aloud and contrast`,j.player&&j.contrast&&!j.kid,j)
    await go(`p/${ASSIGNMENT.passageId}`)
    const ordinary=await evaluate(`({demo:!!document.querySelector('.td-reader'),back:document.querySelector('.topbar .back')?.textContent})`)
    check(`ordinary ${width}: no demo state leaks`,!ordinary.demo&&!/Class 4B/.test(ordinary.back||''),ordinary)
  }
} catch(e) { guard('browser check completes',()=>{throw e}) } finally {
  try{ws?.close()}catch{}
  if(proc.exitCode===null && proc.signalCode===null) {
    const exited=new Promise(resolve=>{ proc.once('exit',resolve); setTimeout(resolve,5000) })
    if (process.platform === 'win32' && proc.pid) {
      const killed = spawnSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' })
      if (killed.status !== 0) proc.kill()
    } else proc.kill()
    await exited
  }
  let removed=false
  for(let attempt=0;attempt<5 && !removed;attempt++) {
    try{rmSync(dir,{recursive:true,force:true,maxRetries:2,retryDelay:200});removed=true}
    catch { await pause(500*(attempt+1)) }
  }
  if(!removed) console.warn(`Could not remove Edge profile: ${dir}`)
  finish({printGuardPasses:false})
}
