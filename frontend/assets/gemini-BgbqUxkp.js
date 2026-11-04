import{n as e,t}from"./index-CTxehT28.js";var n=[],r={register:e=>n.push(e),svg:e,place:t};(function(){let e=(e,t,n)=>Math.max(t,Math.min(n,e)),t=(e,t,n)=>e+(t-e)*n,n=e=>e*180/Math.PI;function i(e,t,n){return e+((t-e+540)%360-180)*n}function a(e,t,n){let r=n?{open:0,wide:0,round:0}:t.lips;if(e.mouthRest&&e.mouthOpen){let t=Math.min(1,r.open*7);e.mouthRest.style.opacity=(1-t).toFixed(3),e.mouthOpen.style.opacity=t.toFixed(3);let n=1+r.wide*.28-r.round*.28,i=Math.max(.12,(.35+r.open*.95)*(1-r.wide*.35));e.mouthOpen.style.transform=`scale(${n.toFixed(3)}, ${i.toFixed(3)})`}}function o(e,t){if(e.calm)return 0;let n=e.head;if(n.phase!==`rest`&&n.phase!==`after`&&n.phase!==`before`&&n.phase!==`page`)return 0;let r=(e.t*1.7+t)%3.2;return r<.14?Math.sin(r/.14*Math.PI):0}let s=`
    .gem-wrap { position: absolute; left: 0; top: 0; pointer-events: none; will-change: transform; }
    .gem-dot { position: absolute; left: 0; top: 0; pointer-events: none; will-change: transform, opacity; }
    .gem-beam { position: absolute; left: 0; top: 0; pointer-events: none; will-change: transform, opacity; }
    .gem-origin-center { transform-box: fill-box; transform-origin: center; }
  `;r.register({id:`gemini-barnaby-dock`,name:`Barnaby`,tagline:`A brass deep-sea diver whose forehead lamp guides each word`,author:`Gemini 4 Argon`,notes:`Barnaby sits anchored in the bottom-left corner facing the page in 3/4 profile. Only his top turret lamp swivels to track the words, shining a warm bathysphere dot under the baseline while a faint beam appears only on line sweeps.`,room:{top:20,left:0,right:0,bottom:98,lineHeight:2.15},css:s+`
      .gemini-barnaby-dock-turret { transform-origin: 48px 22px; }
      .gemini-barnaby-dock-eye { transform-origin: 54px 48px; }
      .gemini-barnaby-dock-mouth { transform-origin: 58px 61px; }
    `,setup(e){let t=e.svg(`
        <svg width="600" height="40" viewBox="0 0 600 40">
          <defs>
            <linearGradient id="gem-barn-beam" x1="0" y1="0.5" x2="1" y2="0.5">
              <stop offset="0%" stop-color="#ffe27a" stop-opacity="0.38"/>
              <stop offset="65%" stop-color="#5ce1e6" stop-opacity="0.14"/>
              <stop offset="100%" stop-color="#5ce1e6" stop-opacity="0"/>
            </linearGradient>
          </defs>
          <polygon points="0,18 600,2 600,38 0,22" fill="url(#gem-barn-beam)"/>
        </svg>
      `,{w:600,h:40,className:`gem-beam`});e.dock.append(t);let n=e.svg(`
        <svg width="36" height="22" viewBox="0 0 36 22">
          <defs>
            <radialGradient id="gem-barn-dot" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stop-color="#fff9d2" stop-opacity="0.98"/>
              <stop offset="45%" stop-color="#ffd24c" stop-opacity="0.88"/>
              <stop offset="80%" stop-color="#2ec4b6" stop-opacity="0.35"/>
              <stop offset="100%" stop-color="#2ec4b6" stop-opacity="0"/>
            </radialGradient>
          </defs>
          <ellipse cx="18" cy="11" rx="15" ry="7.5" fill="url(#gem-barn-dot)"/>
          <ellipse cx="18" cy="11" rx="6.5" ry="3.2" fill="#fffdf0" stroke="#d98a16" stroke-width="0.9" stroke-opacity="0.55"/>
          <circle class="barn-bub" cx="29" cy="7" r="2.1" fill="none" stroke="#5ce1e6" stroke-width="1.1" opacity="0.75"/>
        </svg>
      `,{w:36,h:22,className:`gem-dot`});e.layer.append(n);let r=e.svg(`
        <svg width="92" height="88" viewBox="0 0 92 88">
          <defs>
            <linearGradient id="gem-barn-copper" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stop-color="#e38c4d"/>
              <stop offset="55%" stop-color="#b85d28"/>
              <stop offset="100%" stop-color="#783512"/>
            </linearGradient>
            <linearGradient id="gem-barn-brass" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#f7d56e"/>
              <stop offset="100%" stop-color="#b8841e"/>
            </linearGradient>
            <radialGradient id="gem-barn-glass" cx="40%" cy="35%" r="65%">
              <stop offset="0%" stop-color="#2a5c6a"/>
              <stop offset="100%" stop-color="#112b33"/>
            </radialGradient>
          </defs>
          <!-- Weighted lead-and-brass shoulder corselet -->
          <path d="M12,84 C12,69 25,63 44,63 C63,63 76,69 78,84 Z" fill="url(#gem-barn-copper)" stroke="#3e1b08" stroke-width="2.2" stroke-linejoin="round"/>
          <path d="M18,78 Q45,71 72,78" fill="none" stroke="url(#gem-barn-brass)" stroke-width="4" stroke-linecap="round"/>
          <circle cx="26" cy="77" r="2.2" fill="#3e1b08"/>
          <circle cx="45" cy="75" r="2.2" fill="#3e1b08"/>
          <circle cx="64" cy="77" r="2.2" fill="#3e1b08"/>

          <!-- Main copper helmet dome (angled 3/4 toward right/text) -->
          <path d="M18,46 C18,25 31,16 47,16 C63,16 74,26 74,46 C74,58 66,67 46,67 C26,67 18,58 18,46 Z" fill="url(#gem-barn-copper)" stroke="#3e1b08" stroke-width="2.3"/>
          <!-- Side bolted viewport -->
          <ellipse cx="26" cy="46" rx="6" ry="8" fill="url(#gem-barn-brass)" stroke="#3e1b08" stroke-width="1.8"/>
          <ellipse cx="26" cy="46" rx="3.2" ry="5" fill="#1d4754"/>

          <!-- Front-right main faceplate (3/4 view facing the words) -->
          <ellipse cx="53" cy="48" rx="18.5" ry="16.5" fill="url(#gem-barn-brass)" stroke="#3e1b08" stroke-width="2.2"/>
          <ellipse cx="54" cy="48" rx="14.5" ry="13" fill="url(#gem-barn-glass)" stroke="#3e1b08" stroke-width="1.6"/>
          <!-- Rivets on bezel -->
          <circle cx="53" cy="33.5" r="1.4" fill="#3e1b08"/>
          <circle cx="53" cy="62.5" r="1.4" fill="#3e1b08"/>
          <circle cx="36.5" cy="48" r="1.4" fill="#3e1b08"/>
          <circle cx="69.5" cy="48" r="1.4" fill="#3e1b08"/>

          <!-- Cozy creature face inside helmet looking toward the text -->
          <g class="gemini-barnaby-dock-eye">
            <circle cx="49" cy="45" r="3.4" fill="#fffdf5"/>
            <circle cx="60" cy="45" r="3.1" fill="#fffdf5"/>
            <circle class="barn-pupil-l" cx="50.4" cy="44.4" r="1.8" fill="#142329"/>
            <circle class="barn-pupil-r" cx="61.3" cy="44.4" r="1.7" fill="#142329"/>
            <circle cx="49.7" cy="43.6" r="0.7" fill="#ffffff"/>
            <circle cx="60.7" cy="43.6" r="0.7" fill="#ffffff"/>
            <!-- Warm brass eyebrows -->
            <path class="barn-brows" d="M45,40 Q49,38 52,40 M57,40 Q60,38 63,40" fill="none" stroke="#f7d56e" stroke-width="1.6" stroke-linecap="round"/>
          </g>
          <!-- Rosy cheeks -->
          <ellipse cx="45" cy="51" rx="2.8" ry="1.6" fill="#ff8c69" opacity="0.55"/>
          <ellipse cx="64" cy="51" rx="2.4" ry="1.5" fill="#ff8c69" opacity="0.55"/>

          <!-- Mouth group -->
          <g transform="translate(55, 54)">
            <path class="barn-mouth-rest" d="M-3.5,0 Q0,2.5 3.5,0" fill="none" stroke="#ffd98e" stroke-width="1.9" stroke-linecap="round"/>
            <g class="barn-mouth-open" style="opacity:0">
              <ellipse cx="0" cy="1" rx="4.2" ry="3.4" fill="#e86f52" stroke="#ffd98e" stroke-width="1.3"/>
            </g>
          </g>

          <!-- Glass reflection arc -->
          <path d="M43,39 A11,10 0 0,1 56,37" fill="none" stroke="#ffffff" stroke-width="1.8" stroke-linecap="round" opacity="0.35"/>

          <!-- Swiveling Forehead Bathysphere Turret Lamp -->
          <g class="gemini-barnaby-dock-turret">
            <rect x="39" y="13" width="16" height="12" rx="4" fill="url(#gem-barn-brass)" stroke="#3e1b08" stroke-width="2"/>
            <path d="M53,11 L63,8 L63,27 L53,24 Z" fill="url(#gem-barn-copper)" stroke="#3e1b08" stroke-width="2" stroke-linejoin="round"/>
            <ellipse cx="63" cy="17.5" rx="3.2" ry="7.5" fill="#fff6b3" stroke="#3e1b08" stroke-width="1.6"/>
            <ellipse cx="63.5" cy="17.5" rx="1.8" ry="4.5" fill="#ffffff"/>
          </g>
        </svg>
      `,{w:92,h:88,className:`gem-wrap`});e.dock.append(r),e.state.els={beam:t,dot:n,body:r,turret:r.querySelector(`.gemini-barnaby-dock-turret`),eyeGroup:r.querySelector(`.gemini-barnaby-dock-eye`),brows:r.querySelector(`.barn-brows`),mouthRest:r.querySelector(`.barn-mouth-rest`),mouthOpen:r.querySelector(`.barn-mouth-open`),bub:n.querySelector(`.barn-bub`)},e.state.aimAngle=-25},frame(t){let r=t.head,s=t.state.els,c=t.D.h-90;t.place(s.body,12,c);let l=t.calm?r.word.x+r.word.w*.5:r.x,u=r.baseline+5,d=!t.calm&&r.phase===`word`&&r.long?1+Math.sin(r.wordP*Math.PI)*.25:1;t.place(s.dot,l,u,{ax:18,ay:11,sx:d,sy:1});let f=Math.sin(t.t*5)*1.8;s.bub.setAttribute(`transform`,`translate(0, ${f.toFixed(1)})`);let p=t.toDock({x:l,y:u}),m=c+22,h=p.x-60,g=p.y-m,_=Math.hypot(h,g),v=e(n(Math.atan2(g,h)),-75,25);t.state.aimAngle=t.calm?v:i(t.state.aimAngle,v,e(t.dt*14,.15,1)),s.turret.style.transform=`rotate(${t.state.aimAngle.toFixed(1)}deg)`,!t.calm&&(r.phase===`sweep`||r.phase===`page`||t.since(`tap`)<.25)?(s.beam.style.opacity=r.phase===`sweep`?String(Math.sin(r.p*Math.PI)*.85):`0.7`,t.place(s.beam,60,m,{ax:0,ay:20,rot:t.state.aimAngle,sx:_/600,sy:1})):s.beam.style.opacity=`0`,a(s,r,t.calm);let y=o(t,.4);s.eyeGroup.style.transform=`scale(1, ${(1-y*.88).toFixed(2)})`;let b=r.long&&r.phase===`word`?-2.2:t.since(`tap`)<.35?-3:0;s.brows.setAttribute(`transform`,`translate(0, ${b})`)}}),r.register({id:`gemini-pip-dock`,name:`Pip`,tagline:`A friendly stone spout gargoyle who bounces a sunbeam off a pocket mirror`,author:`Gemini 4 Argon`,notes:`Pip perches on the bottom-right corner facing left toward the passage. By tilting a small brass mirror, Pip reflects a crisp sun-patch under each word without cluttering the page with a continuous beam.`,room:{top:20,left:0,right:0,bottom:96,lineHeight:2.15},css:s+`
      .gemini-pip-dock-arm { transform-origin: 32px 54px; }
      .gemini-pip-dock-eyes { transform-origin: 44px 42px; }
      .gemini-pip-dock-ear { transform-origin: 64px 32px; }
    `,setup(e){let t=e.svg(`
        <svg width="34" height="20" viewBox="0 0 34 20">
          <defs>
            <radialGradient id="gem-pip-sun" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stop-color="#ffffff" stop-opacity="0.98"/>
              <stop offset="40%" stop-color="#ffe875" stop-opacity="0.92"/>
              <stop offset="78%" stop-color="#ffae34" stop-opacity="0.38"/>
              <stop offset="100%" stop-color="#ffae34" stop-opacity="0"/>
            </radialGradient>
          </defs>
          <ellipse cx="17" cy="10" rx="14" ry="6.5" fill="url(#gem-pip-sun)"/>
          <path class="pip-spark" d="M17,4 L18.8,8.5 L24,10 L18.8,11.5 L17,16 L15.2,11.5 L10,10 L15.2,8.5 Z" fill="#fffdf2" opacity="0.9"/>
        </svg>
      `,{w:34,h:20,className:`gem-dot`});e.layer.append(t);let n=e.svg(`
        <svg width="94" height="86" viewBox="0 0 94 86">
          <defs>
            <linearGradient id="gem-pip-stone" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stop-color="#9aa8b0"/>
              <stop offset="60%" stop-color="#6e7d87"/>
              <stop offset="100%" stop-color="#49555e"/>
            </linearGradient>
            <linearGradient id="gem-pip-mirror" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stop-color="#ffffff"/>
              <stop offset="50%" stop-color="#a8e6ff"/>
              <stop offset="100%" stop-color="#fff099"/>
            </linearGradient>
          </defs>
          <!-- Carved stone plinth ledge -->
          <path d="M20,76 L86,76 L90,85 L14,85 Z" fill="#5b6870" stroke="#2c353b" stroke-width="2" stroke-linejoin="round"/>
          <!-- Small folded stone wing on back -->
          <path d="M64,42 C79,38 86,49 81,64 C76,61 70,62 65,67 Z" fill="#596770" stroke="#2c353b" stroke-width="2" stroke-linejoin="round"/>
          <!-- Squat gargoyle body & paws gripping plinth -->
          <path d="M36,52 C34,64 38,74 52,76 C66,76 72,66 68,52 Z" fill="url(#gem-pip-stone)" stroke="#2c353b" stroke-width="2.2"/>
          <ellipse cx="42" cy="76" rx="6" ry="3.5" fill="#7c8b94" stroke="#2c353b" stroke-width="1.8"/>
          <ellipse cx="58" cy="76" rx="6" ry="3.5" fill="#7c8b94" stroke="#2c353b" stroke-width="1.8"/>

          <!-- Big expressive head facing left (3/4 view toward text) -->
          <path d="M26,38 C26,22 39,16 53,18 C67,20 71,31 69,43 C67,53 55,57 41,56 C29,55 26,47 26,38 Z" fill="url(#gem-pip-stone)" stroke="#2c353b" stroke-width="2.2"/>
          <!-- Moss tuft on head -->
          <path d="M45,17 C48,11 55,12 56,17 C59,13 64,16 61,20" fill="#6ab04c" stroke="#2c353b" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
          <!-- Floppy stone ear -->
          <path class="gemini-pip-dock-ear" d="M62,30 C72,26 79,33 74,41 C70,45 64,40 62,36 Z" fill="#7c8b94" stroke="#2c353b" stroke-width="2"/>

          <!-- Eyes looking left toward page -->
          <g class="gemini-pip-dock-eyes">
            <ellipse cx="36" cy="39" rx="4.2" ry="4.8" fill="#fef9e7" stroke="#2c353b" stroke-width="1.5"/>
            <ellipse cx="49" cy="39" rx="4.5" ry="5" fill="#fef9e7" stroke="#2c353b" stroke-width="1.5"/>
            <circle cx="34.5" cy="39" r="2.2" fill="#2c353b"/>
            <circle cx="47.2" cy="39" r="2.3" fill="#2c353b"/>
            <circle cx="35.2" cy="37.8" r="0.9" fill="#ffffff"/>
            <circle cx="48" cy="37.8" r="0.9" fill="#ffffff"/>
          </g>

          <!-- Gargoyle snout & mouth -->
          <g transform="translate(39, 49)">
            <path class="pip-mouth-rest" d="M-4,0 Q0,2.5 5,-0.5" fill="none" stroke="#2c353b" stroke-width="2" stroke-linecap="round"/>
            <path class="pip-mouth-rest" d="M-2.5,0.5 L-1,3.2 L0.8,0.8" fill="#ffffff" stroke="#2c353b" stroke-width="1"/>
            <g class="pip-mouth-open" style="opacity:0">
              <path d="M-5,-1 C-5,4 5,4 5,-1 Z" fill="#b84a39" stroke="#2c353b" stroke-width="1.5"/>
              <polygon points="-2.5,-1 -1,2 0.5,-1" fill="#ffffff"/>
            </g>
          </g>

          <!-- Pivoting Arm holding the Brass Sun-Catching Pocket Mirror -->
          <g class="gemini-pip-dock-arm">
            <path d="M35,54 L20,48" fill="none" stroke="#7c8b94" stroke-width="5.5" stroke-linecap="round"/>
            <path d="M35,54 L20,48" fill="none" stroke="#2c353b" stroke-width="2" stroke-linecap="round"/>
            <!-- Brass handle & tilted oval mirror -->
            <line x1="22" y1="52" x2="14" y2="36" stroke="#d49b27" stroke-width="3" stroke-linecap="round"/>
            <ellipse cx="13" cy="34" rx="6.5" ry="9.5" transform="rotate(-20 13 34)" fill="url(#gem-pip-mirror)" stroke="#b57c14" stroke-width="2.4"/>
            <!-- Mirror glint -->
            <path class="pip-glint" d="M13,27 L14.5,32 L19,33.5 L14.5,35 L13,40 L11.5,35 L7,33.5 L11.5,32 Z" fill="#ffffff" opacity="0.9"/>
          </g>
        </svg>
      `,{w:94,h:86,className:`gem-wrap`});e.dock.append(n),e.state.els={dot:t,body:n,arm:n.querySelector(`.gemini-pip-dock-arm`),eyes:n.querySelector(`.gemini-pip-dock-eyes`),ear:n.querySelector(`.gemini-pip-dock-ear`),glint:n.querySelector(`.pip-glint`),spark:t.querySelector(`.pip-spark`),mouthRest:n.querySelector(`.pip-mouth-rest`),mouthOpen:n.querySelector(`.pip-mouth-open`)},e.state.mirrorDeg=0},frame(r){let i=r.head,s=r.state.els,c=r.D.w-98,l=r.D.h-88;r.place(s.body,c,l);let u=r.calm?i.word.x+i.word.w*.5:i.x,d=i.baseline+4,f=r.calm?1:1+Math.sin(r.t*7)*.08;r.place(s.dot,u,d,{ax:17,ay:10,sx:f,sy:f});let p=r.toDock({x:u,y:d}),m=c+32,h=l+54,g=p.x-m,_=p.y-h,v=n(Math.atan2(_,-g)),y=e(-v*.45,-28,28);r.state.mirrorDeg=r.calm?y:t(r.state.mirrorDeg,y,e(r.dt*14,.15,1)),s.arm.style.transform=`rotate(${r.state.mirrorDeg.toFixed(1)}deg)`;let b=i.phase===`sweep`?1.35:.95;s.glint.setAttribute(`transform`,`translate(13,33.5) scale(${b}) translate(-13,-33.5)`);let x=r.since(`tap`)<.35?14:i.long&&i.phase===`word`?7:0;s.ear.style.transform=`rotate(${x}deg)`,a(s,i,r.calm);let S=o(r,1.3);s.eyes.style.transform=`scale(1, ${(1-S*.88).toFixed(2)})`}}),r.register({id:`gemini-tallow-dock`,name:`Tallow`,tagline:`A tiny street-lamp tender who points his brass igniter pole toward each word`,author:`Gemini 4 Argon`,notes:`Tallow stands at the bottom-left in a cozy wool coat and tall hat, angled toward the page. He uses no beam at all—only the tilt of his brass lamplighter pole and a warm amber gaslight dot riding under the letters.`,room:{top:20,left:0,right:0,bottom:102,lineHeight:2.15},css:s+`
      .gemini-tallow-dock-pole { transform-origin: 48px 56px; }
      .gemini-tallow-dock-eyes { transform-origin: 45px 40px; }
      .gemini-tallow-dock-scarf { transform-origin: 34px 52px; }
    `,setup(e){let t=e.svg(`
        <svg width="32" height="24" viewBox="0 0 32 24">
          <defs>
            <radialGradient id="gem-tal-glow" cx="50%" cy="55%" r="50%">
              <stop offset="0%" stop-color="#fffce6" stop-opacity="0.98"/>
              <stop offset="42%" stop-color="#ffbf3f" stop-opacity="0.9"/>
              <stop offset="80%" stop-color="#e85d04" stop-opacity="0.35"/>
              <stop offset="100%" stop-color="#e85d04" stop-opacity="0"/>
            </radialGradient>
          </defs>
          <ellipse cx="16" cy="13" rx="13" ry="7" fill="url(#gem-tal-glow)"/>
          <!-- Tiny teardrop gaslight core -->
          <path class="tal-flame" d="M16,6 C19,10 20,13.5 16,15.5 C12,13.5 13,10 16,6 Z" fill="#fffdf0" stroke="#e85d04" stroke-width="0.9"/>
        </svg>
      `,{w:32,h:24,className:`gem-dot`});e.layer.append(t);let n=e.svg(`
        <svg width="96" height="94" viewBox="0 0 96 94">
          <defs>
            <linearGradient id="gem-tal-coat" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stop-color="#2b4c65"/>
              <stop offset="100%" stop-color="#182c3c"/>
            </linearGradient>
          </defs>
          <!-- Cobblestone base -->
          <ellipse cx="40" cy="88" rx="24" ry="4" fill="#3a4750" opacity="0.35"/>
          <!-- Scarf tail that gently breathes in pauses -->
          <path class="gemini-tallow-dock-scarf" d="M34,51 C20,52 14,58 11,65 C17,67 24,63 32,57 Z" fill="#d94e34" stroke="#22181c" stroke-width="1.8" stroke-linejoin="round"/>

          <!-- Bell-shaped wool greatcoat -->
          <path d="M24,86 L29,50 L51,50 L56,86 Z" fill="url(#gem-tal-coat)" stroke="#162029" stroke-width="2.2" stroke-linejoin="round"/>
          <!-- Brass coat buttons -->
          <circle cx="45" cy="60" r="2" fill="#f4c44e" stroke="#162029" stroke-width="1"/>
          <circle cx="46" cy="70" r="2" fill="#f4c44e" stroke="#162029" stroke-width="1"/>
          <circle cx="47" cy="80" r="2" fill="#f4c44e" stroke="#162029" stroke-width="1"/>

          <!-- Warm round head in 3/4 view facing right -->
          <circle cx="42" cy="40" r="13.5" fill="#f7cfa0" stroke="#162029" stroke-width="2"/>
          <ellipse cx="48" cy="43" rx="3" ry="1.8" fill="#eb826b" opacity="0.6"/>
          <!-- Cozy wool scarf collar -->
          <path d="M27,48 Q41,55 54,48 Q55,54 41,56 Q27,54 27,48 Z" fill="#d94e34" stroke="#162029" stroke-width="1.8"/>

          <!-- Eyes looking right -->
          <g class="gemini-tallow-dock-eyes">
            <circle cx="43" cy="38.5" r="2.2" fill="#162029"/>
            <circle cx="51" cy="38.5" r="2.1" fill="#162029"/>
            <circle cx="43.7" cy="37.8" r="0.8" fill="#ffffff"/>
            <circle cx="51.7" cy="37.8" r="0.8" fill="#ffffff"/>
          </g>

          <!-- Mouth -->
          <g transform="translate(47.5, 45)">
            <path class="tal-mouth-rest" d="M-2.5,0 Q0,1.8 2.5,0" fill="none" stroke="#162029" stroke-width="1.7" stroke-linecap="round"/>
            <g class="tal-mouth-open" style="opacity:0">
              <ellipse cx="0" cy="0.6" rx="3.2" ry="2.8" fill="#9e2a2b" stroke="#162029" stroke-width="1.2"/>
            </g>
          </g>

          <!-- Tilted Stovepipe Lamplighter Hat with brass buckle -->
          <path d="M24,31 Q42,27 58,31" fill="none" stroke="#162029" stroke-width="4" stroke-linecap="round"/>
          <path d="M29,30 L27,11 C36,9 46,9 53,12 L52,30 Z" fill="#232d36" stroke="#162029" stroke-width="2" stroke-linejoin="round"/>
          <rect x="30" y="24" width="22" height="4.5" fill="#d94e34"/>
          <rect x="43" y="23.5" width="5.5" height="5.5" rx="1" fill="#f4c44e" stroke="#162029" stroke-width="1.2"/>

          <!-- Pivoting Brass Lamplighter Pole & Hands -->
          <g class="gemini-tallow-dock-pole">
            <line x1="36" y1="64" x2="80" y2="18" stroke="#d49b27" stroke-width="3.4" stroke-linecap="round"/>
            <line x1="36" y1="64" x2="80" y2="18" stroke="#ffe58f" stroke-width="1.1" stroke-linecap="round"/>
            <!-- Shepherd hook at tip with pilot star -->
            <path d="M80,18 C84,14 89,18 85,23" fill="none" stroke="#d49b27" stroke-width="2.5" stroke-linecap="round"/>
            <circle cx="84" cy="21" r="5.5" fill="#ffbf3f" opacity="0.45"/>
            <path d="M84,15 L85.5,19.5 L90,21 L85.5,22.5 L84,27 L82.5,22.5 L78,21 L82.5,19.5 Z" fill="#fffdf0"/>
            <!-- Mitten hand holding pole -->
            <circle cx="48" cy="54" r="4.2" fill="#d94e34" stroke="#162029" stroke-width="1.7"/>
          </g>
        </svg>
      `,{w:96,h:94,className:`gem-wrap`});e.dock.append(n),e.state.els={dot:t,body:n,pole:n.querySelector(`.gemini-tallow-dock-pole`),eyes:n.querySelector(`.gemini-tallow-dock-eyes`),scarf:n.querySelector(`.gemini-tallow-dock-scarf`),flame:t.querySelector(`.tal-flame`),mouthRest:n.querySelector(`.tal-mouth-rest`),mouthOpen:n.querySelector(`.tal-mouth-open`)},e.state.poleDeg=0},frame(r){let i=r.head,s=r.state.els,c=r.D.h-96;r.place(s.body,16,c);let l=r.calm?i.word.x+i.word.w*.5:i.x,u=i.baseline+5;r.place(s.dot,l,u,{ax:16,ay:13});let d=r.calm?0:e(-i.vx*.04,-18,18);s.flame.setAttribute(`transform`,`rotate(${d.toFixed(1)} 16 14)`);let f=r.toDock({x:l,y:u}),p=c+56,m=n(Math.atan2(f.y-p,f.x-64)),h=e(m- -46,-32,35);r.state.poleDeg=r.calm?h:t(r.state.poleDeg,h,e(r.dt*13,.15,1)),s.pole.style.transform=`rotate(${r.state.poleDeg.toFixed(1)}deg)`;let g=!r.calm&&(i.phase===`rest`||i.phase===`page`)?Math.sin(r.t*4)*5:0;s.scarf.style.transform=`rotate(${g.toFixed(1)}deg)`,a(s,i,r.calm);let _=o(r,2.1);s.eyes.style.transform=`scale(1, ${(1-_*.88).toFixed(2)})`}}),r.register({id:`gemini-saffron-dock`,name:`Saffron`,tagline:`A velvet Luna-moth botanist who focuses moonlight through a magnifying glass`,author:`Gemini 4 Argon`,notes:`Saffron sits calmly at the bottom-left with feathery antennae and a jeweler’s magnifying glass. She focuses a cool mint-and-gold dewdrop dot under each word, with twin refraction rays appearing briefly between lines.`,room:{top:20,left:0,right:0,bottom:98,lineHeight:2.15},css:s+`
      .gemini-saffron-dock-lens { transform-origin: 54px 50px; }
      .gemini-saffron-dock-ant { transform-origin: 42px 24px; }
      .gemini-saffron-dock-eyes { transform-origin: 48px 39px; }
    `,setup(e){let t=e.svg(`
        <svg width="600" height="30" viewBox="0 0 600 30">
          <line x1="0" y1="9" x2="600" y2="15" stroke="#a8ffdb" stroke-width="1.4" stroke-dasharray="6 5" opacity="0.55"/>
          <line x1="0" y1="21" x2="600" y2="15" stroke="#ffe680" stroke-width="1.4" stroke-dasharray="6 5" opacity="0.55"/>
        </svg>
      `,{w:600,h:30,className:`gem-beam`});e.dock.append(t);let n=e.svg(`
        <svg width="34" height="22" viewBox="0 0 34 22">
          <defs>
            <radialGradient id="gem-saf-dot" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stop-color="#ffffff" stop-opacity="0.98"/>
              <stop offset="45%" stop-color="#80ffdb" stop-opacity="0.88"/>
              <stop offset="80%" stop-color="#c7f9cc" stop-opacity="0.35"/>
              <stop offset="100%" stop-color="#c7f9cc" stop-opacity="0"/>
            </radialGradient>
          </defs>
          <ellipse cx="17" cy="11" rx="14" ry="7" fill="url(#gem-saf-dot)"/>
          <ellipse cx="17" cy="11" rx="5.5" ry="2.8" fill="#fffef2" stroke="#38b000" stroke-width="0.9" stroke-opacity="0.6"/>
        </svg>
      `,{w:34,h:22,className:`gem-dot`});e.layer.append(n);let r=e.svg(`
        <svg width="96" height="90" viewBox="0 0 96 90">
          <defs>
            <linearGradient id="gem-saf-wing" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stop-color="#b7efc5"/>
              <stop offset="70%" stop-color="#6ede8a"/>
              <stop offset="100%" stop-color="#2dc653"/>
            </linearGradient>
          </defs>
          <!-- Folded Luna-moth cape wings -->
          <path d="M22,45 C10,55 10,76 22,84 C32,82 38,72 38,56 Z" fill="url(#gem-saf-wing)" stroke="#1b4332" stroke-width="2" stroke-linejoin="round"/>
          <circle cx="24" cy="67" r="4" fill="#ffe680" stroke="#1b4332" stroke-width="1.4"/>
          <!-- Plump velvet thorax & berry-red botanist vest -->
          <ellipse cx="42" cy="66" rx="16" ry="18" fill="#52796f" stroke="#1b4332" stroke-width="2.2"/>
          <path d="M31,54 Q42,60 53,54 L55,78 Q42,83 29,78 Z" fill="#9d4edd" fill-opacity="0.28"/>
          <!-- Fluffy collar -->
          <path d="M25,46 C25,39 59,39 59,46 C59,53 25,53 25,46 Z" fill="#f8f9fa" stroke="#1b4332" stroke-width="2"/>

          <!-- Head & Feathery Antennae -->
          <g class="gemini-saffron-dock-ant">
            <path d="M36,24 C29,12 20,10 15,15" fill="none" stroke="#e09f3e" stroke-width="2.4" stroke-linecap="round"/>
            <path d="M32,19 L27,22 M27,15 L22,19 M22,13 L18,17" stroke="#e09f3e" stroke-width="1.6" stroke-linecap="round"/>
            <path d="M46,24 C51,11 60,9 66,14" fill="none" stroke="#e09f3e" stroke-width="2.4" stroke-linecap="round"/>
            <path d="M50,18 L54,22 M55,14 L59,18 M60,12 L63,17" stroke="#e09f3e" stroke-width="1.6" stroke-linecap="round"/>
          </g>
          <circle cx="43" cy="36" r="13" fill="#edf6f9" stroke="#1b4332" stroke-width="2"/>

          <!-- Large gentle nocturnal eyes facing right -->
          <g class="gemini-saffron-dock-eyes">
            <ellipse cx="42" cy="35" rx="3.6" ry="4.2" fill="#1b4332"/>
            <ellipse cx="52" cy="35" rx="3.4" ry="4" fill="#1b4332"/>
            <circle cx="43" cy="33.5" r="1.3" fill="#ffffff"/>
            <circle cx="52.8" cy="33.5" r="1.2" fill="#ffffff"/>
            <!-- Tiny wire-rim spectacles -->
            <circle cx="42" cy="35" r="5.5" fill="none" stroke="#e09f3e" stroke-width="1.4"/>
            <circle cx="52" cy="35" r="5.2" fill="none" stroke="#e09f3e" stroke-width="1.4"/>
            <line x1="47.5" y1="35" x2="46.8" y2="35" stroke="#e09f3e" stroke-width="1.4"/>
          </g>

          <!-- Mouth -->
          <g transform="translate(48, 43)">
            <path class="saf-mouth-rest" d="M-2.2,0 Q0,1.8 2.2,0" fill="none" stroke="#1b4332" stroke-width="1.7" stroke-linecap="round"/>
            <g class="saf-mouth-open" style="opacity:0">
              <ellipse cx="0" cy="0.5" rx="3" ry="2.5" fill="#e07a5f" stroke="#1b4332" stroke-width="1.2"/>
            </g>
          </g>

          <!-- Pivoting Magnifying Glass Loupe -->
          <g class="gemini-saffron-dock-lens">
            <line x1="48" y1="56" x2="68" y2="41" stroke="#b57c14" stroke-width="3.6" stroke-linecap="round"/>
            <ellipse cx="75" cy="35" rx="9" ry="12" transform="rotate(-18 75 35)" fill="#d8f3dc" fill-opacity="0.55" stroke="#e09f3e" stroke-width="3"/>
            <path d="M71,28 A6,8 0 0,1 79,31" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round"/>
            <circle cx="54" cy="52" r="4" fill="#edf6f9" stroke="#1b4332" stroke-width="1.8"/>
          </g>
        </svg>
      `,{w:96,h:90,className:`gem-wrap`});e.dock.append(r),e.state.els={beam:t,dot:n,body:r,lens:r.querySelector(`.gemini-saffron-dock-lens`),ant:r.querySelector(`.gemini-saffron-dock-ant`),eyes:r.querySelector(`.gemini-saffron-dock-eyes`),mouthRest:r.querySelector(`.saf-mouth-rest`),mouthOpen:r.querySelector(`.saf-mouth-open`)},e.state.lensDeg=0},frame(r){let i=r.head,s=r.state.els,c=r.D.h-92;r.place(s.body,14,c);let l=r.calm?i.word.x+i.word.w*.5:i.x,u=i.baseline+5,d=!r.calm&&i.long&&i.phase===`word`?1.25:1;r.place(s.dot,l,u,{ax:17,ay:11,sx:d,sy:1});let f=r.toDock({x:l,y:u}),p=c+50,m=f.x-68,h=f.y-p,g=Math.hypot(m,h),_=n(Math.atan2(h,m)),v=e(_- -34,-35,35);r.state.lensDeg=r.calm?v:t(r.state.lensDeg,v,e(r.dt*14,.15,1)),s.lens.style.transform=`rotate(${r.state.lensDeg.toFixed(1)}deg)`,!r.calm&&(i.phase===`sweep`||r.since(`tap`)<.25)?(s.beam.style.opacity=`0.75`,r.place(s.beam,86,p-12,{ax:0,ay:15,rot:_,sx:g/600,sy:1})):s.beam.style.opacity=`0`;let y=!r.calm&&(i.phase===`rest`||i.long)?Math.sin(r.t*6)*4:0;s.ant.style.transform=`rotate(${y.toFixed(1)}deg)`,a(s,i,r.calm);let b=o(r,3);s.eyes.style.transform=`scale(1, ${(1-b*.88).toFixed(2)})`}}),r.register({id:`gemini-huxley-dock`,name:`Huxley`,tagline:`A tweed-vested mole surveyor who sights every word through his brass theodolite`,author:`Gemini 4 Argon`,notes:`Huxley stands in the bottom-right corner behind a miniature brass tripod scope. The rotating brass barrel gives young readers a super-clear directional cue while placing a neat target-ring dot under the spoken word.`,room:{top:20,left:0,right:0,bottom:98,lineHeight:2.15},css:s+`
      .gemini-huxley-dock-scope { transform-origin: 28px 46px; }
      .gemini-huxley-dock-nose { transform-origin: 39px 42px; }
    `,setup(e){let t=e.svg(`
        <svg width="600" height="16" viewBox="0 0 600 16">
          <line x1="0" y1="8" x2="600" y2="8" stroke="#ff9f1c" stroke-width="1.6" stroke-dasharray="4 7" opacity="0.6"/>
        </svg>
      `,{w:600,h:16,className:`gem-beam`});e.dock.append(t);let n=e.svg(`
        <svg width="32" height="22" viewBox="0 0 32 22">
          <defs>
            <radialGradient id="gem-hux-dot" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stop-color="#fff8eb" stop-opacity="0.96"/>
              <stop offset="45%" stop-color="#ff9f1c" stop-opacity="0.88"/>
              <stop offset="82%" stop-color="#e71d36" stop-opacity="0.32"/>
              <stop offset="100%" stop-color="#e71d36" stop-opacity="0"/>
            </radialGradient>
          </defs>
          <ellipse cx="16" cy="11" rx="13" ry="6.5" fill="url(#gem-hux-dot)"/>
          <ellipse cx="16" cy="11" rx="6" ry="3" fill="none" stroke="#e71d36" stroke-width="1.2" opacity="0.65"/>
          <circle cx="16" cy="11" r="2.2" fill="#fffdf5"/>
        </svg>
      `,{w:32,h:22,className:`gem-dot`});e.layer.append(n);let r=e.svg(`
        <svg width="98" height="90" viewBox="0 0 98 90">
          <!-- Mole body in tweed waistcoat (right side, facing left) -->
          <path d="M46,84 C44,60 50,48 66,48 C82,48 88,62 86,84 Z" fill="#5e503f" stroke="#221d17" stroke-width="2.2"/>
          <!-- Tweed vest -->
          <path d="M50,56 C50,70 52,80 56,84 L78,84 C81,74 80,62 77,55 Z" fill="#b08968" stroke="#221d17" stroke-width="1.8"/>
          <line x1="60" y1="56" x2="60" y2="84" stroke="#7f5539" stroke-width="1.5"/>

          <!-- Mole head & velvety snout pointing left toward the scope -->
          <path d="M39,42 C39,28 53,24 68,26 C81,28 86,38 84,49 C82,58 68,60 54,58 C44,56 39,49 39,42 Z" fill="#5e503f" stroke="#221d17" stroke-width="2.2"/>
          <!-- Pink mole nose tip -->
          <g class="gemini-huxley-dock-nose">
            <ellipse cx="38" cy="42" rx="4.2" ry="3.2" fill="#ff8fa3" stroke="#221d17" stroke-width="1.6"/>
            <circle cx="37" cy="41" r="1" fill="#ffffff" opacity="0.7"/>
          </g>

          <!-- Half-moon brass spectacles & squinty mole eyes -->
          <path d="M46,38 Q49,35 52,38" fill="none" stroke="#221d17" stroke-width="2" stroke-linecap="round"/>
          <path d="M44,39 A4.5,4 0 0,0 53,39 Z" fill="#a8e6ff" fill-opacity="0.6" stroke="#d49b27" stroke-width="1.6"/>

          <!-- Checkered surveyor cap -->
          <path d="M46,28 C50,18 74,18 82,29 Z" fill="#d97724" stroke="#221d17" stroke-width="2"/>
          <path d="M40,28 L58,28" stroke="#221d17" stroke-width="3.2" stroke-linecap="round"/>

          <!-- Mouth -->
          <g transform="translate(50, 50)">
            <path class="hux-mouth-rest" d="M-3,0 Q0,2 3,0" fill="none" stroke="#221d17" stroke-width="1.8" stroke-linecap="round"/>
            <g class="hux-mouth-open" style="opacity:0">
              <ellipse cx="0" cy="0.6" rx="3.4" ry="2.6" fill="#a4161a" stroke="#221d17" stroke-width="1.2"/>
            </g>
          </g>

          <!-- Wooden & Brass Tripod on the left of Huxley -->
          <line x1="28" y1="50" x2="14" y2="86" stroke="#8d5b4c" stroke-width="3.2" stroke-linecap="round"/>
          <line x1="28" y1="50" x2="28" y2="86" stroke="#8d5b4c" stroke-width="3.2" stroke-linecap="round"/>
          <line x1="28" y1="50" x2="41" y2="86" stroke="#8d5b4c" stroke-width="3.2" stroke-linecap="round"/>
          <rect x="22" y="47" width="12" height="5" rx="1.5" fill="#d49b27" stroke="#221d17" stroke-width="1.6"/>

          <!-- Rotating Brass Theodolite Scope Barrel -->
          <g class="gemini-huxley-dock-scope">
            <circle cx="28" cy="44" r="5" fill="#e09f3e" stroke="#221d17" stroke-width="1.8"/>
            <path d="M38,42 L10,36 L8,43 L37,47 Z" fill="#f4c44e" stroke="#221d17" stroke-width="1.8" stroke-linejoin="round"/>
            <!-- Glowing objective lens on left end -->
            <ellipse cx="9" cy="39.5" rx="2.4" ry="4.2" fill="#ff9f1c" stroke="#221d17" stroke-width="1.4"/>
            <ellipse cx="9" cy="39.5" rx="1.2" ry="2.4" fill="#fffdf0"/>
          </g>
        </svg>
      `,{w:98,h:90,className:`gem-wrap`});e.dock.append(r),e.state.els={beam:t,dot:n,body:r,scope:r.querySelector(`.gemini-huxley-dock-scope`),nose:r.querySelector(`.gemini-huxley-dock-nose`),mouthRest:r.querySelector(`.hux-mouth-rest`),mouthOpen:r.querySelector(`.hux-mouth-open`)},e.state.scopeDeg=0},frame(r){let i=r.head,o=r.state.els,s=r.D.w-102,c=r.D.h-92;r.place(o.body,s,c);let l=r.calm?i.word.x+i.word.w*.5:i.x,u=i.baseline+5;r.place(o.dot,l,u,{ax:16,ay:11});let d=r.toDock({x:l,y:u}),f=s+28,p=c+46,m=d.x-f,h=d.y-p,g=Math.hypot(m,h),_=n(Math.atan2(h,m)),v=(_- -168+540)%360-180;v=e(v,-30,42),r.state.scopeDeg=r.calm?v:t(r.state.scopeDeg,v,e(r.dt*15,.15,1)),o.scope.style.transform=`rotate(${r.state.scopeDeg.toFixed(1)}deg)`,!r.calm&&i.phase===`sweep`?(o.beam.style.opacity=String(Math.sin(i.p*Math.PI)*.75),r.place(o.beam,f,p,{ax:0,ay:8,rot:_,sx:g/600,sy:1})):o.beam.style.opacity=`0`;let y=!r.calm&&i.phase===`rest`?Math.sin(r.t*9)*1.5:0;o.nose.style.transform=`translate(0, ${y.toFixed(1)}px)`,a(o,i,r.calm)}}),r.register({id:`gemini-maris-dock`,name:`Maris`,tagline:`A tidepool hermit crab wearing a miniature lighthouse shell`,author:`Gemini 4 Argon`,notes:`A nod to Nell’s lighthouse: Maris rests along the bottom edge wearing a red-and-white striped lighthouse shell. Her crab face speaks calmly below while the lantern turret on top swivels to shine a warm beacon dot under each word.`,room:{top:20,left:0,right:0,bottom:100,lineHeight:2.15},css:s+`
      .gemini-maris-dock-lantern { transform-origin: 48px 20px; }
      .gemini-maris-dock-eyes { transform-origin: 36px 58px; }
      .gemini-maris-dock-claw { transform-origin: 22px 72px; }
    `,setup(e){let t=e.svg(`
        <svg width="600" height="36" viewBox="0 0 600 36">
          <defs>
            <linearGradient id="gem-mar-beam" x1="0" y1="0.5" x2="1" y2="0.5">
              <stop offset="0%" stop-color="#ffea79" stop-opacity="0.4"/>
              <stop offset="70%" stop-color="#ffd166" stop-opacity="0.12"/>
              <stop offset="100%" stop-color="#ffd166" stop-opacity="0"/>
            </linearGradient>
          </defs>
          <polygon points="0,16 600,3 600,33 0,20" fill="url(#gem-mar-beam)"/>
        </svg>
      `,{w:600,h:36,className:`gem-beam`});e.dock.append(t);let n=e.svg(`
        <svg width="36" height="22" viewBox="0 0 36 22">
          <defs>
            <radialGradient id="gem-mar-dot" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stop-color="#ffffff" stop-opacity="0.98"/>
              <stop offset="42%" stop-color="#ffd166" stop-opacity="0.9"/>
              <stop offset="78%" stop-color="#06d6a0" stop-opacity="0.35"/>
              <stop offset="100%" stop-color="#06d6a0" stop-opacity="0"/>
            </radialGradient>
          </defs>
          <ellipse cx="18" cy="11" rx="15" ry="7" fill="url(#gem-mar-dot)"/>
          <circle cx="18" cy="11" r="4.2" fill="#fffdf0" stroke="#f77f00" stroke-width="1" stroke-opacity="0.6"/>
        </svg>
      `,{w:36,h:22,className:`gem-dot`});e.layer.append(n);let r=e.svg(`
        <svg width="96" height="92" viewBox="0 0 96 92">
          <!-- Sandy pebble base -->
          <ellipse cx="48" cy="85" rx="34" ry="5" fill="#e9c46a" opacity="0.35"/>

          <!-- Striped Lighthouse Spiral Shell on Crab's Back -->
          <path d="M36,56 L40,26 L56,26 L66,64 C56,70 42,68 36,56 Z" fill="#f8f9fa" stroke="#1d3557" stroke-width="2.2" stroke-linejoin="round"/>
          <!-- Red lighthouse stripes on the shell -->
          <path d="M39,35 L58,37 L60,46 L37,44 Z" fill="#e63946"/>
          <path d="M36,52 L63,54 L65,62 L37,59 Z" fill="#e63946"/>
          <path d="M36,56 L40,26 L56,26 L66,64 C56,70 42,68 36,56 Z" fill="none" stroke="#1d3557" stroke-width="2.2" stroke-linejoin="round"/>
          <!-- Lighthouse gallery rail -->
          <rect x="36" y="23" width="24" height="4" rx="1.5" fill="#1d3557"/>

          <!-- Swiveling Fresnel Lantern Turret on top of shell -->
          <g class="gemini-maris-dock-lantern">
            <rect x="40" y="11" width="16" height="12" rx="2" fill="#fff3b0" stroke="#1d3557" stroke-width="1.8"/>
            <!-- Dome roof -->
            <path d="M38,12 C40,4 56,4 58,12 Z" fill="#e63946" stroke="#1d3557" stroke-width="1.8"/>
            <circle cx="48" cy="5" r="2" fill="#ffd166" stroke="#1d3557" stroke-width="1.2"/>
            <!-- Focusing bullseye lens facing left-up -->
            <ellipse cx="41" cy="17" rx="3.2" ry="5" fill="#ffffff" stroke="#f77f00" stroke-width="1.5"/>
          </g>

          <!-- Cozy Hermit Crab Body & Walking Legs tucked underneath -->
          <path d="M24,66 C24,54 54,54 58,68 C60,78 24,80 24,66 Z" fill="#f46036" stroke="#1d3557" stroke-width="2.2"/>
          <path d="M48,76 L58,84 M54,73 L66,81 M28,76 L20,84" stroke="#d94e34" stroke-width="3.2" stroke-linecap="round"/>

          <!-- Resting front claw (gentler, tucked) -->
          <g class="gemini-maris-dock-claw">
            <path d="M26,72 C15,70 10,77 16,82 C21,85 27,80 26,75 L20,76" fill="#f46036" stroke="#1d3557" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </g>

          <!-- Eyestalks looking toward the text -->
          <g class="gemini-maris-dock-eyes">
            <line x1="31" y1="61" x2="29" y2="52" stroke="#f46036" stroke-width="3" stroke-linecap="round"/>
            <line x1="40" y1="61" x2="39" y2="52" stroke="#f46036" stroke-width="3" stroke-linecap="round"/>
            <circle cx="29" cy="50" r="4" fill="#fffdf5" stroke="#1d3557" stroke-width="1.6"/>
            <circle cx="39" cy="50" r="4" fill="#fffdf5" stroke="#1d3557" stroke-width="1.6"/>
            <circle cx="28" cy="49.5" r="2" fill="#1d3557"/>
            <circle cx="38" cy="49.5" r="2" fill="#1d3557"/>
            <circle cx="28.7" cy="48.7" r="0.8" fill="#ffffff"/>
            <circle cx="38.7" cy="48.7" r="0.8" fill="#ffffff"/>
          </g>

          <!-- Mouth -->
          <g transform="translate(34, 68)">
            <path class="mar-mouth-rest" d="M-3,0 Q0,2.2 3,0" fill="none" stroke="#1d3557" stroke-width="1.8" stroke-linecap="round"/>
            <g class="mar-mouth-open" style="opacity:0">
              <ellipse cx="0" cy="0.6" rx="3.5" ry="2.8" fill="#9e2a2b" stroke="#1d3557" stroke-width="1.2"/>
            </g>
          </g>
        </svg>
      `,{w:96,h:92,className:`gem-wrap`});e.dock.append(r),e.state.els={beam:t,dot:n,body:r,lantern:r.querySelector(`.gemini-maris-dock-lantern`),eyes:r.querySelector(`.gemini-maris-dock-eyes`),claw:r.querySelector(`.gemini-maris-dock-claw`),mouthRest:r.querySelector(`.mar-mouth-rest`),mouthOpen:r.querySelector(`.mar-mouth-open`)},e.state.lanternDeg=0},frame(r){let i=r.head,s=r.state.els,c=Math.round(r.D.w*.62),l=r.D.h-94;r.place(s.body,c,l);let u=r.calm?i.word.x+i.word.w*.5:i.x,d=i.baseline+5;r.place(s.dot,u,d,{ax:18,ay:11});let f=r.toDock({x:u,y:d}),p=c+48,m=l+17,h=f.x-p,g=f.y-m,_=Math.hypot(h,g),v=n(Math.atan2(g,h)),y=(v- -180+540)%360-180;y=e(y*.45,-28,32),r.state.lanternDeg=r.calm?y:t(r.state.lanternDeg,y,e(r.dt*14,.15,1)),s.lantern.style.transform=`rotate(${r.state.lanternDeg.toFixed(1)}deg)`,!r.calm&&(i.phase===`sweep`||i.phase===`page`)?(s.beam.style.opacity=i.phase===`page`?`0.75`:String(Math.sin(i.p*Math.PI)*.7),r.place(s.beam,p,m,{ax:0,ay:18,rot:v,sx:_/600,sy:1})):s.beam.style.opacity=`0`;let b=!r.calm&&(i.phase===`rest`||i.phase===`after`)?Math.sin(r.t*6)*5:0;s.claw.style.transform=`rotate(${b.toFixed(1)}deg)`,a(s,i,r.calm);let x=o(r,4.2);s.eyes.style.transform=`scale(1, ${(1-x*.88).toFixed(2)})`}})})();export{n as default};