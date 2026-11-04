import { readFileSync, existsSync } from 'node:fs'
import { guard, finish } from './_kinds.mjs'
import { DEFAULTS, resolveSettings, visibleSupports } from '../src/teacherDemo/resolve.js'
import { ASSIGNMENT, GROUPS, STUDENTS, CLASS_WORDS } from '../src/teacherDemo/classData.js'
import { sessionFor, readerHref, liveClassSettings, setStudentChoice, studentChoices } from '../src/teacherDemo/session.js'
import { linkSettings, readerLink } from '../src/linkSettings.js'

const r = resolveSettings({ defaults: DEFAULTS, classSettings: { voice: 'generated' }, groupSettings: { voice: 'human' }, studentSettings: { voice: 'generated' }, studentChoice: { voice: 'human' }, adjustable: { voice: true } })
guard('each setting layer overrides the previous one', () => { if (r.values.voice !== 'human' || r.source.voice !== 'Student choice') throw Error(JSON.stringify(r)) })
const layers = [
  [{ voice: 'generated' }, {}, {}, 'Class'],
  [{ voice: 'generated' }, { voice: 'human' }, {}, 'Group'],
  [{ voice: 'generated' }, { voice: 'human' }, { voice: 'generated' }, 'Student'],
]
for (const [c,g,s,source] of layers) guard(`setting source ${source}`, () => { const result=resolveSettings({ defaults: DEFAULTS, classSettings:c, groupSettings:g, studentSettings:s }); if (result.source.voice !== source) throw Error(JSON.stringify(result)) })
guard('lock beats student choice and every assignment layer', () => { const result=resolveSettings({ defaults: DEFAULTS, classSettings:{ contrast:false }, groupSettings:{ contrast:false }, studentSettings:{ contrast:false }, studentChoice:{ contrast:false }, adjustable:{ contrast:true }, locks:{ contrast:true } }); if (!result.values.contrast || !result.locked.contrast || result.source.contrast !== 'Accommodation lock') throw Error(JSON.stringify(result)) })
guard('student choice requires teacher adjustability', () => { const result=resolveSettings({ defaults: DEFAULTS, classSettings:{ font:'andika' }, studentChoice:{ font:'sans' }, adjustable:{ font:false } }); if (result.values.font !== 'andika' || result.source.font !== 'Class') throw Error(JSON.stringify(result)) })
guard('off supports are hidden', () => { const result=resolveSettings({ defaults: DEFAULTS, classSettings:{ vocabAutoShow:false } }); if (visibleSupports(result).some(x => x.key === 'vocabAutoShow')) throw Error('off support visible') })
guard('class has 26 unique students and exactly 3 groups', () => { if (STUDENTS.length !== 26 || new Set(STUDENTS.map(s=>s.id)).size !== 26 || new Set(STUDENTS.map(s=>s.groupId)).size !== 3 || !STUDENTS.every(s=>GROUPS[s.groupId])) throw Error('class count or group mapping') })
guard('student records keep only coarse facts', () => { const allowed=new Set(['id','name','groupId','status','opened','audioLevel','locks','settings','choice']); for(const s of STUDENTS) { for(const k of Object.keys(s)) if(!allowed.has(k)) throw Error(`${s.id}: ${k}`); if(!['not started','stopped early','audio trouble','finished','in progress'].includes(s.status) || !Number.isInteger(s.audioLevel) || s.audioLevel < 0 || s.audioLevel > 3) throw Error(`${s.id}: progress detail`) } })
guard('Jordan has a surviving read-aloud accommodation lock', () => { const jordan=STUDENTS.find(s=>s.id==='jordan'); const result=sessionFor(jordan,{...ASSIGNMENT.classSettings,soundOn:false}); if(!result.locked.soundOn || !result.values.soundOn || result.source.soundOn !== 'Accommodation lock') throw Error('lock lost') })
guard('student reader links carry each resolved support', () => { for(const student of STUDENTS) { const v=sessionFor(student).values; const link=linkSettings(readerHref(student)); if (!link.demo || link.soundOn!==v.soundOn || link.voice!==v.voice || link.view!==(v.readerMode==='kid'?'kid':'passage') || link.font!==v.font || link.size!==v.textSize || link.spacing!==v.spacing || link.contrast!==v.contrast || link.vocabAutoShow!==v.vocabAutoShow) throw Error(student.id) } })
guard('demo route continuation keeps its support fields', () => { const a=linkSettings(readerHref(STUDENTS.find(s=>s.id==='jordan'))); const b=linkSettings(readerLink('kid',ASSIGNMENT.passageId,a,a.voice)); if(!b.demo||b.soundOn!==a.soundOn||b.contrast!==a.contrast||b.size!==a.size||b.vocabAutoShow!==a.vocabAutoShow||b.student!==a.student) throw Error('continuation lost supports') })
guard('nullish values leave inherited supports intact', () => { const r=resolveSettings({ defaults:DEFAULTS, classSettings:{textSize:'L'}, groupSettings:{textSize:null}, studentSettings:{textSize:undefined}, studentChoice:{textSize:null}, adjustable:{textSize:true}, locks:{textSize:null} }); if(r.values.textSize!=='L'||r.source.textSize!=='Class'||r.locked.textSize) throw Error(JSON.stringify(r)) })
guard('ordinary links never become demo sessions', () => { for(const hash of ['#/p/x','#/p/x?sa=on&voice=human','#/kid/x?sa=off']) if(linkSettings(hash).demo !== false) throw Error(hash) })
guard('concrete student sessions use every layer', () => {
  const byId=id=>STUDENTS.find(s=>s.id===id)
  const maya=sessionFor(byId('maya'))
  const diego=sessionFor(byId('diego'))
  const jordan=sessionFor(byId('jordan'),{...ASSIGNMENT.classSettings,soundOn:false})
  if(maya.values.voice!=='human'||maya.source.voice!=='Class'||maya.values.vocabAutoShow!==true||maya.source.vocabAutoShow!=='Group'||maya.values.spacing!==true||maya.source.spacing!=='Student'||maya.values.textSize!=='XL'||maya.source.textSize!=='Student choice') throw Error('Maya layers')
  if(diego.values.font!=='sans'||diego.source.font!=='Group'||diego.values.soundOn!==true) throw Error('Diego layers')
  if(jordan.values.soundOn!==true||!jordan.locked.soundOn||jordan.source.soundOn!=='Accommodation lock') throw Error('Jordan lock')
})
guard('student size choice changes the link only where allowed', () => { const maya=STUDENTS.find(s=>s.id==='maya'); const before=readerHref(maya); if(!setStudentChoice('maya','textSize','L')) throw Error('choice refused'); const after=readerHref(maya); if(before===after||linkSettings(after).size!=='L') throw Error('choice did not reach reader'); if(setStudentChoice('maya','spacing',false)) throw Error('unadjustable choice accepted'); delete studentChoices.maya })
guard('class read-aloud change reaches Diego but Jordan remains locked', () => { const diego=STUDENTS.find(s=>s.id==='diego'), jordan=STUDENTS.find(s=>s.id==='jordan'); const old=liveClassSettings.soundOn; liveClassSettings.soundOn=false; try { if(linkSettings(readerHref(diego)).soundOn!==false||linkSettings(readerHref(jordan)).soundOn!==true) throw Error('class or lock lost') } finally { liveClassSettings.soundOn=old } })
guard('sample status and audio levels agree', () => { for(const s of STUDENTS) if((s.status==='not started' && (s.opened||s.audioLevel!==0)) || (s.status==='finished' && s.audioLevel!==3) || (s.status==='stopped early' && s.audioLevel>=3) || (s.status==='audio trouble' && s.audioLevel>1)) throw Error(s.name) })
guard('pooled words have at least three readers', () => { if(!CLASS_WORDS.length || CLASS_WORDS.some(x=>!x.sentence?.toLowerCase().includes(x.word.toLowerCase()) || x.students<3 || x.students>STUDENTS.length || !Number.isInteger(x.students) || 'names' in x)) throw Error('invalid pooled row') })
const sourceFile = new URL(`../public/data/${ASSIGNMENT.passageId}.json`, import.meta.url)
const file = existsSync(sourceFile) ? sourceFile : new URL(`../../frontend/data/${ASSIGNMENT.passageId}.json`, import.meta.url)
if (existsSync(file)) guard('every pooled word occurs in the assigned passage', () => { const text=readFileSync(file,'utf8'); const html=JSON.parse(text).html || ''; const words=html.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').replace(/\s+([,.;!?])/g,'$1').toLowerCase(); for(const item of CLASS_WORDS) if(!new RegExp(`\\b${item.word.toLowerCase()}\\b`).test(words) || !words.includes(item.sentence.toLowerCase())) throw Error(item.word) })
else console.log('SKIP: local passage file unavailable for pooled word check')
finish()
