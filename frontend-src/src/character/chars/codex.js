// Copied from prototype/character_lab/chars/codex.js by character_lab/tools/to_app.py. Edit the lab file.
import { svg, place } from '../buddyDriver.js'
const cast = []
const CharLab = { register: (c) => cast.push(c), svg, place };
// Six docked reading buddies.
(function () {
  const ink = '#273044';
  const svg = (s) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 110 106" width="110" height="106" aria-hidden="true">${s}</svg>`;
  const eyes = (x, y) => `<path d="M${x-6} ${y-8}q5 -4 10 -1m7 -1q5 -4 10 -1" fill="none" stroke="${ink}" stroke-width="2.5" stroke-linecap="round"/><path d="M${x-6} ${y-3}q0 13 7 13 7 0 7 -13m9 -1q0 13 7 13 7 0 7 -13" fill="#fff9e7" stroke="${ink}" stroke-width="1.7"/><circle cx="${x+5}" cy="${y+3}" r="2.5" fill="${ink}"/><circle cx="${x+28}" cy="${y+2}" r="2.5" fill="${ink}"/>`;
  const art = {
    tilly: svg(`<path d="M17 89q-5 -18 0 -39Q19 20 45 14q28 -3 40 23l1 48q-32 15 -69 4Z" fill="#ec925d" stroke="${ink}" stroke-width="3.5"/><path d="M21 35q15 -17 34 -13M22 47q9 -7 19 -6m-19 17q8 -5 17 -5" fill="none" stroke="#ffcc8b" stroke-width="3" stroke-linecap="round"/><path d="M20 78q31 9 65 -1l1 9q-34 13 -68 3Z" fill="#c76b53"/><path d="M27 90l-7 11 22 -2 6 -9m22 -2 7 13 22 -2 -13 -16" fill="#506f9b" stroke="${ink}" stroke-width="3"/><path d="M11 72q-10 0 -9 -12l13 4M82 53q14 -6 17 2l-13 7" fill="#dc7657" stroke="${ink}" stroke-width="2.7"/><path d="M43 15q-2 -12 5 -12 7 0 5 11" fill="#ffe07d" stroke="${ink}" stroke-width="2.6"/>${eyes(49,48)}`),
    bix: svg(`<path d="M8 76q39 10 94 -3Q95 101 53 102 19 99 8 76Z" fill="#438f99" stroke="${ink}" stroke-width="3.6"/><path d="M14 80q39 13 81 -2Q71 95 34 89Z" fill="#91ccc1"/><path d="M22 91q29 12 58 -2" fill="none" stroke="#e5f2e1" stroke-width="3.5"/><path d="M22 71q-8 -29 8 -42 15 -16 37 -9 20 7 20 31l-5 27q-30 11 -60 -7Z" fill="#eac174" stroke="${ink}" stroke-width="3.5"/><path d="M27 52q4 -22 25 -23 25 0 30 22-7 20 -29 22-20 -2 -26 -21Z" fill="#ffe4a5" stroke="${ink}" stroke-width="2"/><path d="M24 32q27 -17 59 -5l4 10q-38 -6 -63 4Z" fill="#d26c65" stroke="${ink}" stroke-width="2.8"/><path d="M28 26q20 -11 42 -5" fill="none" stroke="#fff0b2" stroke-width="3"/>${eyes(42,49)}<path d="M13 69Q2 67 4 57l17 5m64 -4q10 -8 19 -3l-20 11" fill="#eac174" stroke="${ink}" stroke-width="2.5"/>`),
    bracket: svg(`<path d="M83 12H40Q18 12 18 34v42q0 19 21 19h43" fill="none" stroke="${ink}" stroke-width="15" stroke-linecap="round" stroke-linejoin="round"/><path d="M83 12H40Q18 12 18 34v42q0 19 21 19h43" fill="none" stroke="#ad86c0" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/><path d="M28 42q5 -18 24 -17 19 3 22 23l-3 32q-19 10 -40 -1Z" fill="#f7e6c4" stroke="${ink}" stroke-width="2.8"/><path d="M31 35q12 -13 30 -4l8 10q-20 -5 -39 3Z" fill="#e8bd6f" stroke="${ink}" stroke-width="2.3"/><path d="M31 75q21 8 40 1l-1 10q-19 7 -37 -2Z" fill="#83699e"/><path d="M35 94l-3 9m29 -9 6 9" stroke="${ink}" stroke-width="3.5"/>${eyes(34,50)}`),
    stair: svg(`<path d="M11 88V68h20V51h19V30h35q8 0 8 8v51Q54 98 11 88Z" fill="#a8ca94" stroke="${ink}" stroke-width="3.7" stroke-linejoin="round"/><path d="M14 68h19m0 -17h19m0 -21h31" stroke="#f0f3b8" stroke-width="5" stroke-linecap="round"/><path d="M13 77q39 7 80 -1v13q-41 10 -81 -1Z" fill="#7eaf85"/><path d="M31 68h62M51 51h42" stroke="#628f75" stroke-width="2"/><path d="M32 91l-4 12h17m25 -10 6 10h19" fill="none" stroke="${ink}" stroke-width="3.5"/><path d="M78 29V12q8 4 15 -4" fill="none" stroke="#e8786f" stroke-width="3.5"/>${eyes(54,48)}`),
    kip: svg(`<path d="M23 78Q5 55 15 30 25 5 52 9q29 4 31 29 1 17 -18 23 -19 5 -23 -14 -2 -12 12 -17 15 -4 17 7" fill="none" stroke="${ink}" stroke-width="17" stroke-linecap="round"/><path d="M23 78Q5 55 15 30 25 5 52 9q29 4 31 29 1 17 -18 23 -19 5 -23 -14 -2 -12 12 -17 15 -4 17 7" fill="none" stroke="#e6a267" stroke-width="11" stroke-linecap="round"/><path d="M24 58q14 -12 30 2l5 29q-14 13 -33 3Z" fill="#f2bf7c" stroke="${ink}" stroke-width="3"/><path d="M26 82q16 9 32 0l1 8q-15 12 -33 2Z" fill="#df9865"/><path d="M31 94l-6 9m28 -10 9 10" stroke="${ink}" stroke-width="3.5"/><path d="M17 25Q27 13 42 13" fill="none" stroke="#ffdc9a" stroke-width="3"/>${eyes(25,69)}`),
    glimmer: svg(`<path d="M31 38q-3 -16 10 -25 17 -12 34 1 12 10 7 28L70 65H43Z" fill="#ffca75" stroke="${ink}" stroke-width="3.5"/><path d="M39 38q-1 -12 8 -18 12 -7 24 2" fill="none" stroke="#fff2b6" stroke-width="5" stroke-linecap="round"/><path d="M43 64h28l-4 13H47Z" fill="#6a8d93" stroke="${ink}" stroke-width="3"/><path d="M47 77h20l5 16H42Z" fill="#9eb5a3" stroke="${ink}" stroke-width="3"/><path d="M40 92q14 5 34 0l5 9H35Z" fill="#546d81" stroke="${ink}" stroke-width="3"/><path d="M31 69q-13 3 -15 14m59 -16q15 -1 19 -14" fill="none" stroke="${ink}" stroke-width="3.3" stroke-linecap="round"/><path d="M21 83q-8 2 -11 -3m81 -25q5 4 10 1" fill="none" stroke="${ink}" stroke-width="3"/>${eyes(35,43)}`),
  };
  const specs = [
    { key:'tilly', name:'Tilly', tagline:'A thimble cobbler with a stitch of sunshine', color:'#d89539', glow:'#f9d66c', side:'left', source:[93,65], notes:'Her needle glint sends a warm stitch dot to the word. Her copper shape stays in the bottom corner.' },
    { key:'bix', name:'Bix', tagline:'A boat captain with a lantern bobber', color:'#327e88', glow:'#f0b878', side:'right', source:[94,57], notes:'The boat stays docked. A bobber lantern lights a sea-glass dot without a fishing line across the text.' },
    { key:'bracket', name:'Aunt Bracket', tagline:'A margin keeper with a little mirror', color:'#956bad', glow:'#d2b1e6', side:'left', source:[88,58], beam:true, notes:'Her mirror catches a lilac spot. A faint ray appears only while changing lines.' },
    { key:'stair', name:'Stair', tagline:'An escaped staircase opening a tiny shutter', color:'#6b986e', glow:'#d4e99f', side:'right', source:[90,58], notes:'The top step carries a shutter lamp; the green dot is its quiet footprint beneath the spoken letters.' },
    { key:'kip', name:'Kip', tagline:'A pencil shaving with a glowing wood tip', color:'#b5784d', glow:'#e8bb84', side:'left', source:[86,61], notes:'His curled silhouette stays put. Only a tiny amber tip turns toward the dot.' },
    { key:'glimmer', name:'Glimmer', tagline:'A lamp who reads by lighting one dot', color:'#b67b2d', glow:'#f6d779', side:'right', source:[90,53], notes:'The whole character is a small lamp: shade for a head, base for feet. Her light settles below each word.' },
  ];
  const lights = {
    tilly: '<path d="M5 22L22 5l3 3L8 25Z" fill="#e6a568" stroke="#273044" stroke-width="2"/><path d="M21 6l3 -3m-2 8 5 2" stroke="#ffe897" stroke-width="2" stroke-linecap="round"/>',
    bix: '<path d="M12 2h6v6M6 12q9 -7 18 0l-2 13H8Z" fill="#e98260" stroke="#273044" stroke-width="2"/><path d="M9 15h12m-9 5h6" stroke="#ffe9a2" stroke-width="2.5"/>',
    bracket: '<path d="M4 16L14 5l11 11-10 10Z" fill="#d6b4df" stroke="#273044" stroke-width="2.4"/><path d="M10 16l5 -6 5 5" fill="none" stroke="#fff6da" stroke-width="2"/>',
    stair: '<path d="M4 10h22v10H4Z" fill="#80a886" stroke="#273044" stroke-width="2.5"/><path d="M7 11l8 8 8 -8" fill="#e2efa7" stroke="#273044" stroke-width="1.5"/>',
    kip: '<path d="M4 11q10 -9 21 -4Q18 17 15 26 11 16 4 11Z" fill="#e7ad73" stroke="#273044" stroke-width="2.4"/><path d="M15 24L24 7" stroke="#fff0b5" stroke-width="2"/>',
    glimmer: '<path d="M5 17q-1 -12 10 -13 11 1 10 13l-5 6H10Z" fill="#ffd17a" stroke="#273044" stroke-width="2.4"/><path d="M10 24h10" stroke="#273044" stroke-width="2.5"/><path d="M10 10q5 -5 10 0" fill="none" stroke="#fff4b7" stroke-width="2.5"/>',
  };
  function setup(ctx, s) {
    const body = ctx.svg(art[s.key], { w:110, h:106 });
    const mouth = ctx.svg(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 16" width="20" height="16"><path data-mouth="rest" d="M3 8q7 5 14 -1" fill="none" stroke="${ink}" stroke-width="2.2" stroke-linecap="round"/><ellipse data-mouth="open" cx="10" cy="8" rx="4" ry="5" fill="${ink}" opacity="0"/><path data-mouth="wide" d="M3 6q7 8 14 0q-7 3 -14 0Z" fill="${ink}" opacity="0"/><ellipse data-mouth="round" cx="10" cy="8" rx="3" ry="4" fill="${ink}" opacity="0"/><path data-mouth="closed" d="M4 8h12" stroke="${ink}" stroke-width="2" opacity="0"/><path data-mouth="bite" d="M4 6q6 5 12 0l-2 4H6Z" fill="${ink}" opacity="0"/></svg>`, {w:20,h:16});
    const source = ctx.svg(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 30" width="30" height="30">${lights[s.key]}</svg>`, {w:30,h:30});
    const dot = document.createElement('div');
    dot.className = 'codex-dot-' + s.key;
    ctx.dock.append(body, mouth, source);
    ctx.layer.append(dot);
    let beam = null;
    if (s.beam) {
      beam = ctx.svg(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 2" width="100" height="2"><path d="M0 1H100" stroke="${s.color}" stroke-width="1"/></svg>`, {w:100,h:2});
      ctx.dock.prepend(beam);
    }
    ctx.state = {body,mouth,source,dot,beam,mouthParts:[...mouth.querySelectorAll('[data-mouth]')]};
  }
  function frame(ctx, s) {
    const h=ctx.head, st=ctx.state, right=s.side==='right', scale=.83;
    const x=right ? ctx.D.w-108 : 14, y=ctx.D.h-107;
    ctx.place(st.body,x,y,{sx:right?-scale:scale,sy:scale,ax:right?110:0,ay:0});
    const my=s.key==='kip'?81:s.key==='glimmer'?57:65;
    ctx.place(st.mouth,x+(right?49:61)*scale,y+my*scale,{ax:10,ay:8,sx:right?-1:1,sy:.6+.5*h.lips.open});
    const l=ctx.calm?{open:0,wide:0,round:0}:h.lips, on=Math.min(1,l.open*5);
    const blend={open:l.open*(1-l.round)*(1-.7*l.wide),wide:l.wide,round:l.round}, sum=blend.open+blend.wide+blend.round||1;
    for(const p of st.mouthParts){const m=p.dataset.mouth; p.style.opacity=(m==='rest'?1-on:blend[m]?on*blend[m]/sum:0).toFixed(3);}
    const target=ctx.toDock({x:h.x,y:h.baseline+5});
    const sx=x+(right?110-s.source[0]:s.source[0])*scale, sy=y+s.source[1]*scale;
    const angle=Math.atan2(target.y-sy,target.x-sx)*180/Math.PI;
    const raw=angle-(right?-175:5);
    const normalized=((raw+540)%360)-180;
    const gentle=Math.max(-20,Math.min(20,normalized));
    ctx.place(st.source,sx,sy,{ax:15,ay:15,rot:ctx.calm?0:gentle});
    const dx=ctx.calm&&h.phase==='word'?h.word.x+h.word.w/2:h.x;
    ctx.place(st.dot,dx,h.baseline+5,{ax:6,ay:6});
    st.dot.style.opacity=['before','after','page'].includes(h.phase)?'0':'1';
    if(st.beam){
      const vx=target.x-sx,vy=target.y-sy;
      ctx.place(st.beam,sx,sy,{ax:0,ay:1,rot:Math.atan2(vy,vx)*180/Math.PI,sx:Math.hypot(vx,vy)/100});
      st.beam.style.opacity=!ctx.calm&&['sweep','page'].includes(h.phase)?'.35':'0';
    }
  }
  for(const s of specs) CharLab.register({
    id:`codex-${s.key}-dock`, name:s.name, tagline:s.tagline, author:'Codex', notes:s.notes,
    room:{top:16,bottom:126,lineHeight:2.25},
    css:`.codex-dot-${s.key}{position:absolute;width:12px;height:12px;border-radius:${s.key==='bracket'?'3px':'50%'};background:radial-gradient(circle at 50% 50%,#fff9dc 0 18%,${s.color} 35%,${s.glow} 68%,transparent 73%);pointer-events:none}`,
    setup(ctx){setup(ctx,s)}, frame(ctx){frame(ctx,s)}
  });
})();
export default cast
