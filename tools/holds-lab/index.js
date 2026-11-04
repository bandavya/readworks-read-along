// Offline policy picture. The Python simulator remains the source for machine-readable results.
const MENUS=[
  ['problem','What counts as a problem?', [['all','A · Every non-advisory difference (today)'],['meaning','B · Prioritize meaning; endings and byline bypass'],['body','C · Body only; title and byline bypass']]],
  ['certainty','How sure before flagging?', [['one','A · One recognizer (today)'],['second','B · A second listener must agree'],['homograph','C · One recognizer plus homograph watch list']]],
  ['action','What happens on a flag?', [['hold','A · Hold for a person (today)'],['publish','B · Publish with visible flags'],['fail','C · Fail the take and request a new one']]],
  ['play','What plays while held?', [['old','A · The older available take (today)'],['human','B · A human recording if available'],['none','C · Nothing for that voice']]],
  ['owner','Who resolves it?', [['editor','A · Named ReadWorks editor'],['producer','B · Audio producer'],['narrator','C · Narrator, then editor']]],
  ['stick','Does a fix stick?', [['scoped','A · This take only'],['name','B · Scoped name rule after review'],['global','C · Global pronunciation rule after testing']]]
];
const choice={problem:'all',certainty:'one',action:'hold',play:'old',owner:'editor',stick:'scoped'};
const allFlags=DATA.takes.flatMap(t=>t.flags.map(f=>({...f,take:t})));
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function holds(f,c){
  if(f.advisory)return false;
  if(c.problem==='meaning'&&['word ending','spelling of the same word','title and byline'].includes(f.category))return false;
  if(c.problem==='body'&&f.category==='title and byline')return false;
  if(c.certainty==='second')return f.second_agrees==null?null:f.second_agrees===true;
  return true;
}
function model(takes,c){return takes.map(t=>{
  const flags=t.flags.filter(f=>holds(f,c)===true);
  const unknown=t.flags.some(f=>holds(f,c)===null)||(t.unobserved_flags>0&&(c.problem!=='all'||c.certainty==='second'));
  const watch=c.certainty==='homograph'&&Object.keys(t.homograph_words||{}).length>0;
  let status=t.source.startsWith('aligned-')?'unknown':t.structural_failure?(t.route==='human'?'review':'failed'):(flags.length||watch)?'review':unknown?'unknown':(t.unobserved_flags?'review':'published');
  if(!t.structural_failure&&status==='review'&&c.action==='publish')status='published_with_flags';
  if(!t.structural_failure&&status==='review'&&c.action==='fail')status='failed';
  return {...t,status,holdFlags:flags,watch};
})}
// The offline parity check reads this without a browser.
globalThis.holdsLabModel=model;
function chosen(key){const item=MENUS.find(m=>m[0]===key);return item[2].find(o=>o[0]===choice[key])[1].split(' · ')[1]}
function node(text,kind=''){return `<span class="step ${kind}">${esc(text)}</span>`}
function row(...parts){return `<div class="flowrow">${parts.join('')}</div>`}
function flow(){
  const action=choice.action==='hold'?'Hold for a person':choice.action==='fail'?'Fail; request a new take':'Publish with visible flags';
  return row(node('Generated voice: broken timing?','question'),'<span class="edge">yes →</span>',node('Fail take','result'))+
    row(node('Human recording: pause, text or timing check fails?','question'),'<span class="edge">yes →</span>',node('Hold for a person','result'))+
    row('<span class="edge">no ↓</span>',node('Count: '+chosen('problem')),node('Check: '+chosen('certainty')))+
    row(node('Enough evidence to decide?','question'),'<span class="edge">no →</span>',node('Unknown; get evidence','result'))+
    row('<span class="edge">yes ↓</span>',node('Flag or watch word?','question'),'<span class="edge">no →</span>',node('Publish take','result'))+
    row('<span class="edge">yes →</span>',node(action,'result'))+
    row(node('If held: '+chosen('play')),node('Resolver: '+chosen('owner')),node('Fix: '+chosen('stick')));
}
function example(t){
  const f=t.holdFlags[0]||t.flags[0];
  const detail=f?`${f.written||'∅'} → ${f.heard||'∅'}`:(t.unobserved_flags?`${t.unobserved_flags} flags known only by count`:'no reported flag');
  return `<span class="badge">${esc(t.title)} · ${esc(t.route)} · ${esc(detail)}</span>`;
}
function render(){
  const rs=model(DATA.takes,choice), counts={};
  rs.forEach(r=>counts[r.status]=(counts[r.status]||0)+1);
  document.getElementById('flow').innerHTML=flow();
  document.getElementById('flowNote').textContent='Generated and human recordings have different gates. Unknown evidence stays unknown. Playback, owner, and persistence choices affect operations; their effect on errors is unmeasured.';
  document.getElementById('metrics').innerHTML=['published','review','failed','published_with_flags','unknown'].map(k=>`<div class="metric"><b>${counts[k]||0}</b>${esc(k.replaceAll('_',' '))} takes</div>`).join('');
  document.getElementById('limits').textContent=`Saved files cover ${DATA.takes.length} takes and ${allFlags.length} report items. The page models only the loaded sample. A published result here is not a release recommendation.`;
  document.getElementById('branches').innerHTML=['published','review','failed','published_with_flags','unknown'].map(k=>{
    const x=rs.filter(r=>r.status===k);
    const shown=[...x].sort((a,b)=>b.flags.length-a.flags.length).slice(0,3);
    return `<p><b>${esc(k.replaceAll('_',' '))} (${x.length}):</b> ${shown.map(example).join(' ')||'<span class="muted">No observed example</span>'}</p>`;
  }).join('');
  const risky=new Set(['real-looking substitution','small function word','dropped words','extra speech','name']);
  const excused=rs.flatMap(r=>r.flags.filter(f=>!f.advisory&&holds(f,choice)===false).map(f=>({...f,take:r})));
  const dangerous=rs.filter(r=>['published','published_with_flags'].includes(r.status)).flatMap(r=>r.flags.filter(f=>!f.advisory&&risky.has(f.category)).map(f=>({...f,take:r})));
  const unknown=rs.filter(r=>r.status==='unknown').length;
  document.getElementById('catastrophe').textContent=`Can't tell whether this choice is safe: ${excused.length} observed differences are excused by the selected rule; ${dangerous.length} observed content-changing or real-looking candidates are on modeled published takes; ${unknown} takes have unknown outcomes. ${DATA.takes.reduce((n,t)=>n+(t.unobserved_flags||0),0)} flags are known only by count, so their content cannot be classified. None of these is a confirmed voice error.`;
  document.getElementById('catExamples').innerHTML=[...new Map([...excused,...dangerous].map(f=>[f.id,f])).values()].slice(0,5).map(f=>`<span class="badge">${esc(f.take.title)}: ${esc(f.written||'∅')} → ${esc(f.heard||'∅')}</span>`).join(' ')||'<span class="muted">No observed example; this does not show safety.</span>';
  const unknownFlags=DATA.takes.reduce((n,t)=>n+(t.unobserved_flags||0),0);
  const secondUnknown=allFlags.filter(f=>f.second_agrees==null).length;
  document.getElementById('scale').textContent=`This sample has ${DATA.takes.length} takes and ${allFlags.length} listed differences. ${unknownFlags} additional differences are known only by count. ${secondUnknown} listed differences lack a second listener's answer. No library or staffing estimate is available from this sample.`;
  const selected=[
    ['What counts as a problem',`The selected rule yields ${counts.review||0} held takes in this sample.`],
    ['How sure',`${secondUnknown} listed differences have no second-listener answer.`],
    ['What happens',choice.action==='hold'?'A held take waits for a person.':'This choice changes the modeled status only.'],
    ['What plays','This sample has no playback availability data.'],
    ['Who resolves','No staffing time was measured.'],
    ['Does a fix stick','Future recurrence is unknown.']
  ];
  document.getElementById('choiceEstimates').innerHTML=selected.map(([name,detail])=>`<li><b>${esc(name)}:</b> ${esc(detail)}</li>`).join('');
}
const box=document.getElementById('choices');
box.innerHTML=MENUS.map(([key,title,options])=>`<fieldset><legend>${esc(title)}</legend>${options.map(([val,label])=>`<label><input type="radio" name="${key}" value="${val}" ${choice[key]===val?'checked':''}> ${esc(label)}</label>`).join('')}</fieldset>`).join('');
box.addEventListener('change',e=>{if(e.target.name in choice){choice[e.target.name]=e.target.value;render()}});
document.getElementById('catalog').innerHTML=allFlags.map(f=>`<tr><td>${esc(f.take.title)}<br><small>${esc(f.take.route)} · ${esc(f.take.source==='synthetic-demo'?'made-up example':f.take.source)}</small></td><td>${esc(f.category)}</td><td>${esc(f.written||'∅')} → ${esc(f.heard||'∅')}</td><td>${esc(f.context||'Context unavailable')}</td><td>${esc(f.at==null?'unknown':f.at+' s')}</td><td>${esc(f.evidence)}</td></tr>`).join('');
document.getElementById('catalogNote').textContent=`These are report items, including punctuation and long spans. ${DATA.takes.reduce((n,t)=>n+(t.unobserved_flags||0),0)} additional flags have no individual rows. Nothing here is a person label.`;
const cats=Object.fromEntries(['word ending','name','small function word','spelling of the same word','dropped words','extra speech','title and byline','numbers and dates','real-looking substitution','punctuation or alignment artifact'].map(k=>[k,0]));
allFlags.forEach(f=>cats[f.category]=(cats[f.category]||0)+1);
document.getElementById('types').textContent=Object.entries(cats).map(([k,v])=>`${k}: ${v}`).join(' · ');
const n=DATA.homograph_hits.reduce((a,h)=>a+Object.values(h.words).reduce((x,y)=>x+y,0),0);
document.getElementById('homographs').textContent=`Local scan: ${n} candidate word appearances in ${DATA.homograph_hits.length} of ${DATA.passages_scanned} sample passages. No audio judgment was made.`;
render();
