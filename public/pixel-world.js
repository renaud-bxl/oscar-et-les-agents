/* Original smooth illustrated office. Task state controls work; scenery never changes a mission. */
import {getAmbience} from './ambience.js';
import {translate} from './i18n.js';
const W=1440,H=850,TILE=20,COLS=Math.ceil(W/TILE),ROWS=Math.ceil(H/TILE);
const P={
  ink:'#344b48',navy:'#3e5960',blue:'#8eb5c4',wall:'#e7eeea',lightwall:'#f6f9f4',
  floor:'#e9dec9',tile:'#e3d6bd',seam:'#d8cbb3',cream:'#fff6e6',white:'#ffffff',
  wood:'#c89c78',woodLight:'#e6c4a1',woodDark:'#b58a69',coral:'#dfa18c',
  mint:'#a9cbbb',green:'#7ba591',darkgreen:'#517d6b',gold:'#e6c789',
  screen:'#d8eadf',glass:'#b5d7dd',sky:'#d9ebed',leaf:'#81a98e',shadow:'#786f61'
};
const ROLES={
  recherche:{name:'Lina',label:'Recherche',names:['Lina','Camille','Nora','Iris'],shirt:'#d8a18c',hair:'#674f45',skin:'#edbc99'},
  redaction:{name:'Noé',label:'Rédaction',names:['Noé','Hugo','Inès','Lou'],shirt:'#91aebd',hair:'#5e514b',skin:'#d8a583'},
  code:{name:'Sam',label:'Développement & code',names:['Sam','Alex','Théo','Rémi'],shirt:'#d6bd87',hair:'#3f4a48',skin:'#e4b291'},
  design:{name:'Alma',label:'Design',names:['Alma','Maya','Jade','Rose'],shirt:'#9ebca9',hair:'#966b52',skin:'#f0c4a2'},
  analyse:{name:'Jules',label:'Analyse',names:['Jules','Léon','Éva','Nils'],shirt:'#b4a9c6',hair:'#665a51',skin:'#c4997d'},
  oscar:{name:'Oscar',label:'Chef d’équipe',names:['Oscar'],shirt:'#6e9780',hair:'#745c4d',skin:'#e8b993'},
  secretaire:{name:'Zoé',label:'Secrétariat',names:['Zoé'],shirt:'#bf9a9e',hair:'#745c4d',skin:'#e8b993'}
};
const ISLANDS=[
  {role:'recherche',x:170,y:350,w:220,h:90,accent:'#d5a08d'},
  {role:'redaction',x:1050,y:350,w:220,h:90,accent:'#98b3c1'},
  {role:'code',x:610,y:430,w:220,h:90,accent:'#d3b986'},
  {role:'design',x:270,y:610,w:220,h:90,accent:'#a2beac'},
  {role:'analyse',x:950,y:610,w:220,h:90,accent:'#b5a9c5'}
];
const DESKS=ISLANDS.flatMap((island,islandIndex)=>Array.from({length:4},(_,i)=>({
  id:islandIndex*4+i,role:island.role,island:islandIndex,position:i,
  x:island.x,y:island.y,
  stand:{x:island.x+(i%2===0?40:180),y:island.y+(i<2?-20:140)},
  direction:i<2?'down':'up'
})));
const DOOR={x:110,y:190},RECEPTION={x:130,y:270},REVIEW={x:730,y:330};
const OSCAR_HOME={x:720,y:237},OSCAR_WELCOME={x:250,y:275},OSCAR_GATE={x:570,y:310};
const OSCAR_VISITS={recherche:{x:430,y:370},redaction:{x:1010,y:370},code:{x:890,y:470},design:{x:530,y:640},analyse:{x:1210,y:640}};
const REVIEW_WAIT=Array.from({length:20},(_,i)=>({x:510+(i%10)*40,y:350+Math.floor(i/10)*40}));
const COFFEE=Array.from({length:20},(_,i)=>({x:190+(i%4)*20,y:650+Math.floor(i/4)*40}));
const CHAT=[{x:610,y:650},{x:850,y:650},{x:610,y:690},{x:850,y:690},{x:610,y:730},{x:850,y:730},{x:610,y:770},{x:850,y:770},{x:610,y:810},{x:650,y:810},{x:690,y:810},{x:730,y:810},{x:770,y:810},{x:810,y:810},{x:850,y:810},{x:650,y:650},{x:690,y:650},{x:730,y:650},{x:770,y:650},{x:810,y:650}];
const BUSY_TASKS=new Set(['working','revising']),EXIT_TASKS=new Set(['failed','cancelled']);
const TRAVEL_STATES=new Set(['entering','to_desk','to_oscar','to_review_queue','to_review_wait','to_coffee','to_chat','returning','leaving']);
const LAMPS=[{x:490,y:108},{x:720,y:64},{x:950,y:108},{x:550,y:520,floor:true},{x:1240,y:520,floor:true}];
const HOTSPOTS=[
  {kind:'coffee',label:'Machine à café',x:65,y:612,w:107,h:126},
  {kind:'window',label:'Fenêtre de gauche',x:180,y:60,w:220,h:134},
  {kind:'window',label:'Fenêtre de droite',x:1080,y:60,w:220,h:134},
  {kind:'clock',label:'Horloge',x:973,y:76,w:60,h:60},
  {kind:'missions',label:'Tableau des missions · ouvrir le catalogue',x:431,y:142,w:127,h:57},
  {kind:'delivery',label:'Armoire des livraisons · ouvrir les résultats',x:1260,y:636,w:126,h:80},
  {kind:'team',label:'Le collectif · rencontrer les talents',x:866,y:146,w:98,h:49},
  ...LAMPS.map((p,index)=>({kind:'lights',label:p.floor?`Lampadaire ${index-2}`:`Suspension ${index+1}`,index,x:p.x-28,y:p.y-20,w:56,h:p.floor?132:46})),
  {kind:'door',label:'Porte d’entrée',x:74,y:80,w:78,h:147},
  {kind:'plant',label:'Grand ficus',x:61,y:342,w:65,h:104},
  {kind:'plant',label:'Plante de droite',x:1310,y:345,w:70,h:108},
  {kind:'cat',label:'Moka · le chat du bureau',x:1294,y:545,w:70,h:75},
  {kind:'secretary',label:'Zoé · votre secrétaire',x:1078,y:208,w:175,h:105}
];
const OBSTACLES=[
  ...ISLANDS.map(i=>({x:i.x,y:i.y,w:i.w,h:i.h})),
  {x:610,y:220,w:220,h:70},{x:65,y:650,w:105,h:90},
  {x:670,y:690,w:120,h:85},{x:550,y:690,w:50,h:100},{x:860,y:690,w:50,h:100},{x:70,y:385,w:50,h:60},
  {x:1320,y:390,w:50,h:60},{x:1300,y:715,w:70,h:80},{x:1270,y:650,w:110,h:64}
];

function hash(text) {
  let n=2166136261;
  for(const c of String(text)) {n^=c.charCodeAt(0);n=Math.imul(n,16777619);}
  return n>>>0;
}
function seeded(seed) {
  let n=seed>>>0;
  return ()=>{n+=0x6D2B79F5;let t=n;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296;};
}
function roleKey(role) {
  const key=String(role||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  if(ROLES[key]) return key;
  if(/recherch|research/.test(key)) return 'recherche';
  if(/redac|writ/.test(key)) return 'redaction';
  if(/develop|code/.test(key)) return 'code';
  if(/design/.test(key)) return 'design';
  if(/analy/.test(key)) return 'analyse';
  return 'recherche';
}
function taskAttempt(task) {return Math.max(1,Number(task?.attempt)||1);}
function cell(point) {return {x:Math.floor(point.x/TILE),y:Math.floor(point.y/TILE)};}
function center(x,y) {return {x:x*TILE+8,y:y*TILE+8};}
function distance(a,b) {return Math.hypot(a.x-b.x,a.y-b.y);}
function clipped(text,max=27) {const str=String(text||'').replace(/\s+/g,' ').trim();return str.length>max?str.slice(0,max-1)+'…':str;}
const AMBIENCE_MODES=['auto','day','sunset','night'],AMBIENCE_KEY='oscar-ambience-v1';
function readAmbiencePreference() {
  try {
    const value=JSON.parse(window.localStorage.getItem(AMBIENCE_KEY)||'null');
    if(!value||typeof value!=='object')return null;
    return {mode:AMBIENCE_MODES.includes(value.mode)?value.mode:'auto',
      lightsMode:value.lightsMode==='manual'?'manual':'auto',
      lights:Array.isArray(value.lights)&&[3,LAMPS.length].includes(value.lights.length)&&value.lights.every(v=>typeof v==='boolean')?LAMPS.map((_,i)=>value.lights[i]??false):null};
  } catch {return null;}
}
function blend(a,b,amount) {
  const t=Math.max(0,Math.min(1,amount)),rgb=[1,3,5].map(i=>Math.round(parseInt(a.slice(i,i+2),16)*(1-t)+parseInt(b.slice(i,i+2),16)*t));
  return `rgb(${rgb.join(',')})`;
}

export class PixelWorld {
  constructor(canvas,{onSelect=()=>{},onStatus=()=>{},onEvent=()=>{},onInteract=()=>{},onAmbience=()=>{}}={}) {
    if(!canvas?.getContext) throw new Error('Un canvas est nécessaire pour ouvrir l’atelier.');
    this.canvas=canvas;this.ctx=canvas.getContext('2d');
    if(!this.ctx) throw new Error('Le dessin de l’atelier est indisponible dans ce navigateur.');
    this.pixelRatio=Math.min(2,Math.max(1,window.devicePixelRatio||1));
    canvas.width=Math.round(W*this.pixelRatio);canvas.height=Math.round(H*this.pixelRatio);
    this.viewport={width:W,height:H,scale:1,offsetX:0,offsetY:0,dpr:this.pixelRatio};
    this.ctx.imageSmoothingEnabled=true;
    this.onSelect=onSelect;this.onStatus=onStatus;this.onEvent=onEvent;this.onInteract=onInteract;this.onAmbience=onAmbience;
    this.mission=null;this.missionId=null;this.agents=new Map();
    this.frame=0;this.time=0;this.oscarState='idle';this._oscarBubble='Explique-moi ce que tu veux faire';this._oscarBubbleUntil=4;
    this.oscar={...OSCAR_WELCOME,id:'oscar',key:'oscar',role:'oscar',name:'Oscar',direction:'down',path:[],place:'welcome',destination:'welcome',nextVisitAt:18,visitUntil:0,visits:0};
    this._reviewOwner=null;this._raf=null;this._lastTick=null;this._lastPaint=0;
    this._manualPaused=false;this._destroyed=false;this._doorOpen=0;this._statusMemo='';this._lastCompleted=null;
    this.props={windowMode:'day',lights:LAMPS.map(()=>true),coffeeUntil:0,clockUntil:0,doorUntil:0,catUntil:0,catStart:0};
    const preference=readAmbiencePreference();
    this._ambienceMode=preference?.mode||'auto';this._lightsAuto=preference?.lightsMode!=='manual'||!preference?.lights;
    this._manualLights=preference?.lights||LAMPS.map(()=>true);this.ambience=null;this._ambienceSignature='';
    this._refreshAmbience(true);
    this._propBubble=null;this._hoveredProp=null;this._reactions=new Map();this._clickCounts=new Map();this._selectionTimer=null;
    this._lastInteraction=null;this._lastClickedBubble=null;this._visibleBubbles=[];
    this._media=window.matchMedia?.('(prefers-reduced-motion: reduce)');
    this.reducedMotion=!!this._media?.matches;
    this._onMotion=()=>{this.reducedMotion=!!this._media?.matches;this._lastTick=null;this._draw();};
    this._onVisibility=()=>{this._lastTick=null;if(!document.hidden){this._refreshAmbience(true);this._draw();}this._schedule();};
    this._onClick=e=>this._select(e);
    this._onKey=e=>{if(e.key==='Enter'||e.key===' ') {e.preventDefault();this._selectActor({role:'oscar',id:null});}};
    this._onPointer=e=>this._pointer(e);
    this._initialTitle=canvas.title||'';
    this._onLeave=()=>{this.canvas.style.cursor='';this.canvas.title=this._initialTitle;this._hoveredProp=null;this._draw();};
    this._onResize=()=>this._resizeViewport();
    this._onLanguage=()=>{this._background=this._makeBackground();this._draw();};
    document.addEventListener('oscar:language',this._onLanguage);
    document.addEventListener('visibilitychange',this._onVisibility);
    this._media?.addEventListener?.('change',this._onMotion);
    canvas.addEventListener('click',this._onClick);
    canvas.addEventListener('keydown',this._onKey);
    canvas.addEventListener('pointermove',this._onPointer);
    canvas.addEventListener('pointerleave',this._onLeave);
    this._background=this._makeBackground();
    this._tick=this._tick.bind(this);this._resizeViewport();
    this._resizeObserver=typeof ResizeObserver==='function'?new ResizeObserver(this._onResize):null;
    this._resizeObserver?.observe(canvas);window.addEventListener?.('resize',this._onResize);
    this._draw();this._schedule();
    this._ambienceTimer=setInterval(()=>{if(!this._destroyed){this._refreshAmbience();if(!document.hidden)this._draw();}},30000);
    this._ambienceTimer?.unref?.();
  }

  _persistAmbiencePreference() {
    try {window.localStorage.setItem(AMBIENCE_KEY,JSON.stringify({mode:this._ambienceMode,lightsMode:this._lightsAuto?'auto':'manual',lights:[...this.props.lights]}));} catch { /* Private browsing and blocked storage retain the session choice. */ }
  }
  _refreshAmbience(force=false,date=new Date()) {
    const actual=getAmbience(date),sceneDate=new Date(date.getTime());
    if(this._ambienceMode!=='auto')sceneDate.setHours({day:13,sunset:19,night:23}[this._ambienceMode],0,0,0);
    const scene=this._ambienceMode==='auto'?actual:getAmbience(sceneDate);
    this.ambience={...scene,mode:this._ambienceMode,hour:actual.hour,sceneHour:scene.hour,lightsMode:this._lightsAuto?'auto':'manual'};
    this.props.windowMode=scene.phase;
    this.props.lights=this._lightsAuto?LAMPS.map(()=>scene.lampsOn):[...this._manualLights];
    const signature=JSON.stringify([this._ambienceMode,scene.phase,Math.round(actual.hour*120),Math.round(scene.daylight*1000),this._lightsAuto,...this.props.lights]);
    if(force||signature!==this._ambienceSignature){this._ambienceSignature=signature;this.onAmbience(this._ambienceSnapshot());}
  }
  _ambienceSnapshot() {return {...this.ambience,sun:{...this.ambience.sun},moon:{...this.ambience.moon},lights:[...this.props.lights]};}
  setAmbienceMode(mode) {
    if(this._destroyed)return null;
    if(!AMBIENCE_MODES.includes(mode))throw new RangeError('Choisissez auto, day, sunset ou night.');
    this._ambienceMode=mode;this._refreshAmbience(true);this._persistAmbiencePreference();this._draw();
    return this._ambienceSnapshot();
  }
  setSpeaking(role){this.speakingRole=role||null;this._draw();}
  setSecretaryActivity(busy){this.secretaryBusy=!!busy;this._draw();}

  update(mission) {
    if(this._destroyed) return;
    const nextId=mission?.id??null;
    if(nextId!==this.missionId) {
      for(const a of this.agents.values()) a.retiring=true;
      this._reviewOwner=null;this.missionId=nextId;
      this._oscarBubble=mission?'Allez, je prépare le recrutement !':'Explique-moi ce que tu veux faire';
      this._oscarBubbleUntil=this.time+3.5;
      this._lastCompleted=null;
    }
    this.mission=mission||null;
    if(mission) {
      const tasks=Array.isArray(mission.tasks)?mission.tasks:[];
      const keys=new Set(),roleCounts=new Map();
      tasks.forEach((task,index)=>{
        if(!task?.id) return;
        const key=`${nextId}:${task.id}`;keys.add(key);
        const role=roleKey(task.role),roleIndex=roleCounts.get(role)||0;roleCounts.set(role,roleIndex+1);
        const suppliedName=typeof task.agentName==='string'?task.agentName.trim().slice(0,40):'';
        const name=suppliedName||ROLES[role].names[roleIndex%ROLES[role].names.length];
        let a=this.agents.get(key);
        if(!a) {
          if(mission.status==='cancelled'||task.status==='cancelled') return;
          const random=seeded(hash(key));
          a={key,id:task.id,missionId:nextId,role,name,roleIndex,task,index,slot:-1,
            x:DOOR.x,y:DOOR.y,direction:'down',walkFrame:0,state:'waiting_entry',visible:false,
            target:null,path:[],afterTravel:null,deadline:0,hireAt:this.time+index*.35,
            workSince:0,handoffAttempt:0,handoffAttempts:new Set(),paper:false,mug:false,
            retiring:false,random,bubble:'',bubbleUntil:0,visited:[],speed:165+random()*25,
            nextIdleAt:0,reviewRequestedAt:0,lastAttempt:taskAttempt(task)};
          this.agents.set(key,a);
        } else {
          const wasRetiring=a.retiring||a.state==='leaving';
          a.task=task;a.index=index;a.name=name;a.roleIndex=roleIndex;
          if(wasRetiring&&!EXIT_TASKS.has(task.status)&&!['failed','cancelled'].includes(mission.status)) this._reactivate(a);
        }
      });
      for(const a of this.agents.values()) if(a.missionId===nextId&&!keys.has(a.key)) a.retiring=true;
      if(mission.status==='completed'&&this._lastCompleted!==mission.id) {
        this._lastCompleted=mission.id;this._oscarBubble='Du beau travail !';this._oscarBubbleUntil=this.time+4;
      }
    }
    this._updateOscar();
    this._sayStatus(mission?.phase||(mission?'Oscar réunit les talents utiles à votre mission.':'L’atelier attend votre première idée.'));
    this._draw();this._schedule();
  }

  setPaused(paused) {
    this._manualPaused=!!paused;this._lastTick=null;
    if(paused&&this._raf!==null) {cancelAnimationFrame(this._raf);this._raf=null;}
    this._draw();this._schedule();
  }

  /** These interactions are scenery only: no task or backend state is changed. */
  interact(kind,index=null) {
    if(this._destroyed) return null;
    let text='',bubble='',x=720,y=365;
    if(kind==='coffee') {
      this.props.coffeeUntil=this.time+4.2;x=142;y=580;bubble='Un petit café, une grande idée.';
      text='Psshh ! Le café est prêt. La seule réunion que tout le monde accepte.';
      const idle=[...this.agents.values()].filter(a=>a.visible&&!a.retiring&&a.task.status==='approved'&&['resting','coffee','chat'].includes(a.state));
      for(const a of idle.slice(0,2)) this._bubble(a,a.state==='coffee'?'Mon abonnement préféré.':'Il en reste pour moi ?',3);
      if(!idle.length&&this.oscarState==='idle') {this._oscarBubble='Je supervise la mousse.';this._oscarBubbleUntil=this.time+3;}
    } else if(kind==='window') {
      const mode=AMBIENCE_MODES[(AMBIENCE_MODES.indexOf(this._ambienceMode)+1)%AMBIENCE_MODES.length];this.setAmbienceMode(mode);
      x=1190;y=206;
      const lines={
        auto:['La lumière suit votre horloge.','Ambiance automatique : le décor suit l’heure locale, avec un rythme de lumière progressif entre 6 h et 20 h.'],
        day:['Grand jour, grandes idées.','Ambiance de jour choisie manuellement. Les idées ont leur vitamine D.'],
        sunset:['Le soleil rend son rapport.','Coucher de soleil choisi manuellement : même le soleil vient de rendre son rapport.'],
        night:['Le bureau passe en soirée.','Ambiance de nuit choisie manuellement. Les lampes gardent les idées au chaud.']
      };
      [bubble,text]=lines[mode];
    } else if(kind==='auto') {
      this._lightsAuto=true;this.setAmbienceMode('auto');x=720;y=120;
      bubble='Fenêtres et lampes à l’heure locale.';
      text='Les fenêtres et les lampes suivent à nouveau l’heure locale. La transition du décor est indicative et ne dépend ni de votre position ni de la météo.';
    } else if(kind==='clock') {
      this.props.clockUntil=this.time+2.2;x=1000;y=148;
      const hour=new Date().toLocaleTimeString('fr-BE',{hour:'2-digit',minute:'2-digit'});
      bubble=`${hour} · La deadline fait coucou.`;
      text=`Il est ${hour}. L’horloge court deux secondes pour impressionner la deadline. La deadline reste imperturbable.`;
    } else if(kind==='lights') {
      const lampIndex=Number.isInteger(index)&&index>=0&&index<LAMPS.length?index:null;
      if(lampIndex!==null) this.props.lights[lampIndex]=!this.props.lights[lampIndex];
      else {const on=!this.props.lights.every(Boolean);this.props.lights=this.props.lights.map(()=>on);}
      const count=this.props.lights.filter(Boolean).length;
      this._lightsAuto=false;this._manualLights=[...this.props.lights];this._refreshAmbience(true);this._persistAmbiencePreference();
      x=lampIndex!==null?LAMPS[lampIndex].x:720;y=lampIndex!==null&&LAMPS[lampIndex].floor?LAMPS[lampIndex].y-35:165;
      bubble=count===0?'Mode idées lumineuses.':`${count}/${LAMPS.length} lampes. Ambiance validée.`;
      text=count===0?'Toutes les lampes sont éteintes. Oscar compte sur les idées lumineuses.':`${count} lampe${count>1?'s':''} allumée${count>1?'s':''}. L’ambiance vient de passer la validation d’Oscar.`;
    } else if(kind==='door') {
      this.props.doorUntil=this.time+2.8;x=144;y=238;bubble='Toc toc. Juste le courant d’air.';
      text='Toc toc ! Seulement le courant d’air. Les spécialistes arrivent quand le plan a besoin d’eux.';
    } else if(kind==='plant') {
      x=this._hoveredProp?.x?this._hoveredProp.x+32:93;y=320;bubble='Je fais pousser les idées.';
      text='La plante demande un peu d’eau et zéro réunion. Elle fait déjà pousser les idées.';
    } else if(kind==='cat') {
      this.props.catStart=this.time;this.props.catUntil=this.time+4.5;x=1324;y=500;bubble='Miaou ! Contrôle du rebond terminé.';
      text='Moka teste la gravité, puis reprend son poste de responsable qualité des siestes.';
    } else if(kind==='secretary') {
      x=1160;y=190;bubble='On fait le point sur votre journée ?';
      text='Zoé prépare vos e-mails, votre agenda et vos priorités avec les services que vous avez connectés.';
    } else if(kind==='missions') {
      x=494;y=103;bubble='Une nouvelle idée à construire ?';
      text='Le tableau des missions : choisissez une idée dans le catalogue ou confiez votre propre projet à Oscar.';
    } else if(kind==='delivery') {
      x=1308;y=588;bubble='Les bonnes idées se retrouvent ici.';
      text=this.mission?.files?.length?'L’armoire des livraisons est ouverte : retrouvez les résultats et les fichiers de cette mission.':'L’armoire des livraisons est ouverte. Les résultats et fichiers de la mission y seront conservés.';
    } else if(kind==='team') {
      x=914;y=103;bubble='Cinq métiers, plein de personnalités.';
      text='Rencontrez les talents : chaque spécialiste a son métier, sa personnalité et les tâches confiées par Oscar.';
    } else return null;
    this._propBubble={text:bubble,x,y,until:this.time+3.6};
    this._lastInteraction={kind,text,at:this.time};
    this._sayStatus(text);this.onInteract(kind,text);this.onEvent('interact',{kind,missionId:this.missionId});
    this._draw();return {kind,text};
  }

  snapshot() {
    return {
      missionId:this.missionId,bounds:{width:W,height:H},viewport:{...this.viewport},ambience:this._ambienceSnapshot(),frame:this.frame,time:Math.round(this.time*100)/100,
      paused:this._manualPaused||document.hidden,reducedMotion:this.reducedMotion,oscarState:this.oscarState,oscar:{x:this.oscar.x,y:this.oscar.y,place:this.oscar.place,destination:this.oscar.destination,moving:!!this.oscar.path.length,visits:this.oscar.visits},
      doorOpen:this._doorOpen,reviewOwner:this._reviewOwner,secretary:{name:'Zoé',busy:!!this.secretaryBusy},
      bubbles:this._visibleBubbles.map(b=>({...b})),
      props:{windowMode:this.props.windowMode,lights:[...this.props.lights],coffeeSteam:this.time<this.props.coffeeUntil,
        clockGag:this.time<this.props.clockUntil,clockTime:new Date().toLocaleTimeString('fr-BE',{hour:'2-digit',minute:'2-digit'}),
        hotspots:HOTSPOTS.map(p=>({...p})),lastInteraction:this._lastInteraction?{...this._lastInteraction}:null},
      agents:[...this.agents.values()].map(a=>({
        id:a.id,missionId:a.missionId,role:a.role,name:a.name||ROLES[a.role].name,state:a.state,
        x:Math.round(a.x*10)/10,y:Math.round(a.y*10)/10,
        target:a.target?{...a.target}:null,desk:a.slot,visible:a.visible,
        taskStatus:a.task.status,attempt:taskAttempt(a.task),handoffAttempt:a.handoffAttempt,
        retiring:!!a.retiring,reactivations:a.reactivations||0,
        paper:a.paper,mug:a.mug,direction:a.direction,visited:[...a.visited],
        reaction:this._reactions.get(a.key)?.until>this.time?this._reactions.get(a.key).kind:null,
        pathLength:a.path.length,bubble:this.time<a.bubbleUntil?a.bubble:null
      }))
    };
  }

  destroy() {
    if(this._destroyed) return;
    this._destroyed=true;
    if(this._raf!==null) cancelAnimationFrame(this._raf);
    if(this._selectionTimer!==null) clearTimeout(this._selectionTimer);
    clearInterval(this._ambienceTimer);
    this._raf=null;
    document.removeEventListener('visibilitychange',this._onVisibility);
    document.removeEventListener('oscar:language',this._onLanguage);
    this._media?.removeEventListener?.('change',this._onMotion);
    this._resizeObserver?.disconnect();window.removeEventListener?.('resize',this._onResize);
    this.canvas.removeEventListener('click',this._onClick);
    this.canvas.removeEventListener('keydown',this._onKey);
    this.canvas.removeEventListener('pointermove',this._onPointer);
    this.canvas.removeEventListener('pointerleave',this._onLeave);
    this.canvas.style.cursor='';
    this.canvas.title=this._initialTitle;
    this.agents.clear();
    this._reactions.clear();
  }

  _schedule() {
    if(this._destroyed||this._manualPaused||document.hidden) {
      if(this._raf!==null) cancelAnimationFrame(this._raf);
      this._raf=null;return;
    }
    if(this._raf===null) this._raf=requestAnimationFrame(this._tick);
  }

  _tick(stamp) {
    this._raf=null;
    if(this._destroyed||this._manualPaused||document.hidden) return;
    if(this._lastTick===null) this._lastTick=stamp;
    const interval=this.reducedMotion?125:1000/24;
    if(stamp-this._lastPaint>=interval) {
      const dt=Math.min((stamp-this._lastTick)/1000,.15);
      this._lastTick=stamp;this._lastPaint=stamp;this.time+=dt;
      for(const a of this.agents.values()) this._stepAgent(a,dt);
      this._updateOscar(dt);
      const nearDoor=this.time<this.props.doorUntil||[...this.agents.values()].some(a=>a.visible&&a.x<160&&a.y<252);
      this._doorOpen=Math.max(0,Math.min(1,this._doorOpen+(nearDoor?1:-1)*dt*4));
      this._draw();
    }
    this._schedule();
  }

  _visit(a,state) {
    a.state=state;
    if(a.visited.at(-1)!==state) a.visited.push(state);
    if(a.visited.length>40) a.visited.shift();
  }
  _bubble(a,text,seconds=2.4) {a.bubble=clipped(text);a.bubbleUntil=this.time+seconds;}
  _sayStatus(text) {if(text!==this._statusMemo) {this._statusMemo=text;this.onStatus(text);}}
  _event(kind,a) {this.onEvent(kind,{id:a?.id,role:a?.role,missionId:this.missionId});}
  _claimDesk(a) {
    const occupied=new Set([...this.agents.values()].filter(x=>x!==a&&x.visible&&x.slot>=0).map(x=>x.slot));
    const free=DESKS.find(d=>d.role===a.role&&!occupied.has(d.id));
    if(!free) return false;
    a.slot=free.id;return true;
  }
  _travel(a,state,target,after) {
    this._visit(a,state);a.target={...target};a.path=this._path(a,target);a.afterTravel=after;
    if(!a.path.length&&distance(a,target)<2) this._arrived(a);
  }
  _releaseReview(a) {if(this._reviewOwner===a.key) this._reviewOwner=null;}
  _reactivate(a) {
    a.retiring=false;a.reactivations=(a.reactivations||0)+1;
    this._releaseReview(a);a.path=[];a.target=null;a.afterTravel=null;a.paper=false;a.mug=false;
    if(!a.visible||a.slot<0) {
      a.visible=false;a.slot=-1;a.x=DOOR.x;a.y=DOOR.y;
      a.hireAt=this.time;this._visit(a,'waiting_entry');return;
    }
    const attempt=taskAttempt(a.task),wasHandedOff=a.handoffAttempts.has(attempt);
    if(a.task.status==='approved'&&wasHandedOff) {
      this._startCoffee(a);
    } else if(a.task.status==='reviewing'&&wasHandedOff) {
      this._travel(a,'to_review_wait',REVIEW_WAIT[a.slot%REVIEW_WAIT.length],'waiting_review');
    } else if(a.task.status==='reviewing') {
      this._startReview(a);
    } else {
      // Includes approved results whose handoff was interrupted before it happened.
      // The normal desk lifecycle will deliver those exactly once for this attempt.
      this._bubble(a,a.task.status==='approved'?'Je termine la remise à Oscar.':'Je retrouve mon bureau.');
      this._travel(a,'returning',DESKS[a.slot].stand,'working');
    }
  }
  _returnToDesk(a) {
    this._releaseReview(a);a.paper=false;a.mug=false;
    this._bubble(a,a.task.status==='needs_review'?'Je reprends ce point.':'On améliore ça !');
    this._travel(a,'returning',DESKS[a.slot].stand,'working');
  }
  _startReview(a) {
    a.paper=true;a.mug=false;a.reviewRequestedAt=this.time;
    if(!this._reviewOwner||this._reviewOwner===a.key) {
      this._reviewOwner=a.key;
      this._bubble(a,'Mon résultat pour Oscar.');
      this._travel(a,'to_oscar',REVIEW,'handoff');
    } else this._travel(a,'to_review_queue',REVIEW_WAIT[a.slot%REVIEW_WAIT.length],'review_queue');
  }
  _startCoffee(a) {
    if(a.task.status!=='approved') return;
    this._releaseReview(a);a.paper=false;a.mug=false;
    this._bubble(a,'Validé ! Pause café.');
    this._event('approved',a);
    this._travel(a,'to_coffee',COFFEE[a.slot%COFFEE.length],'coffee');
  }
  _startSocial(a) {
    const others=[...this.agents.values()].filter(b=>b!==a&&b.visible&&!b.retiring&&b.task.status==='approved'&&['coffee','to_chat','chat','resting','returning'].includes(b.state));
    if(others.length) {
      this._travel(a,'to_chat',CHAT[a.slot%CHAT.length],'chat');
    } else this._travel(a,'returning',DESKS[a.slot].stand,'resting');
  }
  _arrived(a) {
    a.path=[];a.target=null;const state=a.afterTravel;a.afterTravel=null;
    this._visit(a,state||'resting');
    if(state==='briefing') {
      a.direction='right';a.deadline=this.time+.8;
      this._bubble(a,`Salut, moi c’est ${(a.name||ROLES[a.role].name)} !`,2);
      this._oscarBubble=`Bienvenue ${(a.name||ROLES[a.role].name)} !`;this._oscarBubbleUntil=this.time+1.6;
      this._event('hire',a);
    } else if(state==='working') {
      a.direction=DESKS[a.slot]?.direction||'up';a.workSince=this.time;a.paper=false;a.mug=false;
      if(a.task.status==='queued') this._visit(a,'waiting_task');
      else this._bubble(a,a.task.status==='revising'?'Je corrige le détail.':'À moi de jouer !',2);
    } else if(state==='handoff') {
      a.direction='up';a.deadline=this.time+1.35;
      a.handoffAttempt=taskAttempt(a.task);a.handoffAttempts.add(a.handoffAttempt);
      this._bubble(a,a.task.status==='failed'?'Un problème à te signaler.':'À toi de vérifier !',1.6);
      this._oscarBubble='Voyons ça…';this._oscarBubbleUntil=this.time+2;
      this._sayStatus(a.task.status==='failed'?`${(a.name||ROLES[a.role].name)} signale le problème à Oscar. Les fichiers déjà produits sont conservés.`:`${(a.name||ROLES[a.role].name)} remet son résultat à Oscar pour validation.`);
      this._event('handoff',a);
    } else if(state==='review_queue') {a.direction=a.x<REVIEW.x?'right':'left';this._bubble(a,'Mon dossier est prêt.');}
    else if(state==='waiting_review') {a.direction='up';a.paper=false;this._bubble(a,'J’attends le retour.');}
    else if(state==='coffee') {a.direction='left';a.mug=true;a.deadline=this.time+2.5+a.random()*2;this._bubble(a,'Un café bien mérité !');this._event('coffee',a);}
    else if(state==='chat') {
      a.direction=a.x<730?'right':'left';a.mug=a.random()>.45;a.deadline=this.time+3+a.random()*3;
      const other=[...this.agents.values()].find(b=>b!==a&&b.state==='chat'&&b.task.status==='approved');
      this._bubble(a,other?['Joli travail !','Et ta prochaine idée ?','Bien joué, l’équipe !'][Math.floor(a.random()*3)]:'On se retrouve ici ?',3.6);
      if(other) this._bubble(other,['Merci !','On forme une belle équipe.','Je suis partant !'][Math.floor(a.random()*3)],3.2);
      this._event('chat',a);
    } else if(state==='resting') {a.direction='down';a.mug=false;a.nextIdleAt=this.time+6+a.random()*14;}
    else if(state==='gone') {a.visible=false;this._releaseReview(a);this.agents.delete(a.key);this._event('exit',a);}
  }

  _stepAgent(a,dt) {
    const activeMission=a.missionId===this.missionId;
    const pendingHandoff=['approved','reviewing','needs_review','failed'].includes(a.task.status)&&!a.handoffAttempts.has(taskAttempt(a.task));
    const cancelled=a.task.status==='cancelled'||activeMission&&this.mission?.status==='cancelled';
    const exit=cancelled||(!pendingHandoff&&a.state!=='handoff'&&(a.retiring||a.task.status==='failed'||activeMission&&this.mission?.status==='failed'));
    if(exit&&a.state!=='leaving') {
      this._releaseReview(a);
      if(!a.visible) {this.agents.delete(a.key);return;}
      a.paper=false;a.mug=false;this._bubble(a,'À bientôt, l’atelier.');
      this._travel(a,'leaving',DOOR,'gone');
    }
    if(a.state==='waiting_entry') {
      if(this.time<a.hireAt||!this._claimDesk(a)) return;
      a.visible=true;this._travel(a,'entering',RECEPTION,'briefing');
    }
    if(!a.visible) return;
    const attempt=taskAttempt(a.task);
    const needsWork=BUSY_TASKS.has(a.task.status)||a.task.status==='needs_review';
    const awayFromWork=['to_oscar','to_review_queue','review_queue','handoff','to_review_wait','waiting_review','to_coffee','coffee','to_chat','chat','resting'].includes(a.state);
    if(needsWork&&awayFromWork&&(attempt>a.handoffAttempt||a.task.status==='needs_review'||a.task.status==='revising')) this._returnToDesk(a);
    a.lastAttempt=attempt;
    if(TRAVEL_STATES.has(a.state)) {
      let remaining=a.speed*dt;
      while(a.path.length&&remaining>0) {
        const p=a.path[0],dx=p.x-a.x,dy=p.y-a.y,d=Math.hypot(dx,dy);
        if(d>.01) a.direction=Math.abs(dx)>Math.abs(dy)?dx>0?'right':'left':dy>0?'down':'up';
        if(d<=remaining) {a.x=p.x;a.y=p.y;a.path.shift();remaining-=d;}
        else {a.x+=dx/d*remaining;a.y+=dy/d*remaining;remaining=0;}
      }
      a.walkFrame=this.reducedMotion?0:Math.floor(this.time*7)%2;
      if(!a.path.length) this._arrived(a);
      return;
    }
    if(a.state==='briefing'&&this.time>=a.deadline) {this._travel(a,'to_desk',DESKS[a.slot].stand,'working');return;}
    if(a.state==='waiting_task') {
      if(a.task.status!=='queued') {this._visit(a,'working');a.workSince=this.time;this._bubble(a,'C’est parti !');}
      return;
    }
    if(a.state==='working') {
      if(a.task.status==='queued') {this._visit(a,'waiting_task');return;}
      if(['reviewing','approved','failed'].includes(a.task.status)&&this.time-a.workSince>.65) {
        if(!a.handoffAttempts.has(attempt)) this._startReview(a);
        else if(a.task.status==='approved') this._startCoffee(a);
        else this._travel(a,'to_review_wait',REVIEW_WAIT[a.slot%REVIEW_WAIT.length],'waiting_review');
      } else if(a.task.activity&&this.time>a.bubbleUntil+5&&a.random()<.015) this._bubble(a,clipped(a.task.activity));
      return;
    }
    if(a.state==='review_queue') {
      if(!this._reviewOwner) {this._reviewOwner=a.key;this._travel(a,'to_oscar',REVIEW,'handoff');}
      return;
    }
    if(a.state==='handoff'&&this.oscar.place!=='desk'){a.deadline=Math.max(a.deadline,this.time+.7);return;}
    if(a.state==='handoff'&&this.time>=a.deadline) {
      this._releaseReview(a);a.paper=false;
      if(a.task.status==='failed'){a.paper=false;this._bubble(a,'Oscar a le point à vérifier.');this._travel(a,'leaving',DOOR,'gone');}
      else if(a.task.status==='approved') this._startCoffee(a);
      else if(needsWork) this._returnToDesk(a);
      else this._travel(a,'to_review_wait',REVIEW_WAIT[a.slot%REVIEW_WAIT.length],'waiting_review');
      return;
    }
    if(a.state==='waiting_review') {
      if(a.task.status==='approved') this._startCoffee(a);
      else if(needsWork) this._returnToDesk(a);
      else if(attempt>a.handoffAttempt) this._startReview(a);
      return;
    }
    if(a.state==='coffee'&&this.time>=a.deadline) {a.mug=false;this._startSocial(a);return;}
    if(a.state==='chat'&&this.time>=a.deadline) {a.mug=false;this._travel(a,'returning',DESKS[a.slot].stand,'resting');return;}
    if(a.state==='resting'&&a.task.status==='approved'&&this.time>=a.nextIdleAt) {
      if(a.random()<.55) this._startCoffee(a);else this._startSocial(a);
    }
  }

  _walkable(x,y) {
    if(x>=4&&x<=6&&y>=7&&y<=11) return true;
    if(x<3||x>=COLS-3||y<11||y>40) return false;
    const p=center(x,y);
    return !OBSTACLES.some(b=>p.x>=b.x&&p.x<b.x+b.w&&p.y>=b.y&&p.y<b.y+b.h);
  }
  _nearest(point) {
    const start=cell(point);
    if(this._walkable(start.x,start.y)) return start;
    for(let r=1;r<12;r++) for(let y=start.y-r;y<=start.y+r;y++) for(let x=start.x-r;x<=start.x+r;x++) if(this._walkable(x,y)) return {x,y};
    return {x:5,y:11};
  }
  _path(from,to) {
    const start=this._nearest(from),end=this._nearest(to),key=(x,y)=>y*COLS+x;
    const queue=[start],previous=new Map([[key(start.x,start.y),null]]);
    let found=false;
    for(let n=0;n<queue.length;n++) {
      const p=queue[n];
      if(p.x===end.x&&p.y===end.y) {found=true;break;}
      for(const [dx,dy] of [[0,1],[1,0],[-1,0],[0,-1]]) {
        const x=p.x+dx,y=p.y+dy,k=key(x,y);
        if(this._walkable(x,y)&&!previous.has(k)) {previous.set(k,p);queue.push({x,y});}
      }
    }
    if(!found) return [];
    const points=[];let p=end;
    while(p) {points.push(center(p.x,p.y));p=previous.get(key(p.x,p.y));}
    points.reverse();
    if(points.length&&distance(from,points[0])<1) points.shift();
    return points;
  }
  _oscarRoute(place,point) {
    const a=this.oscar;
    if(a.destination===place&&(a.path.length||a.place===place))return;
    const route=[];
    if(a.y<310&&a.x>560){if(a.y>240)route.push({x:570,y:310});else route.push({x:570,y:205},{...OSCAR_GATE});}
    const from=route.at(-1)||a;
    if(place==='desk'){
      if(a.y<245&&a.x>570)route.length=0;
      else route.push(...this._path(from,OSCAR_GATE),{x:570,y:205},{x:720,y:205});
      route.push({...OSCAR_HOME});
    }else route.push(...this._path(from,point),{...point});
    a.path=route;a.destination=place;a.place='walking';
    if(this.reducedMotion){Object.assign(a,point);a.path=[];this._oscarArrived();}
  }
  _oscarArrived(){
    const a=this.oscar;a.place=a.destination;a.direction='down';
    if(a.place==='desk'){
      a.nextVisitAt=this.time+15;
      if(this.mission&&this._oscarAnnouncedMission!==this.mission.id){this._oscarAnnouncedMission=this.mission.id;this._oscarBubble='J’engage les bons talents !';this._oscarBubbleUntil=this.time+5;this.onEvent('oscar_arrived',{missionId:this.mission.id,place:'desk'});}
    }else if(a.place==='visit'){a.visitUntil=this.time+3.5;a.visits++;this._oscarBubble=['Tout roule ici ?','On avance ensemble.','Je fais le tour des idées.'][a.visits%3];this._oscarBubbleUntil=this.time+3.5;}
    else if(a.place==='welcome'){this._oscarBubble='Explique-moi ce que tu veux faire';this._oscarBubbleUntil=this.time+5;}
  }
  _updateOscar(dt=0) {
    const live=[...this.agents.values()].filter(a=>a.visible&&!a.retiring);
    if(live.some(a=>a.state==='handoff')||this.mission?.tasks?.some(t=>t.status==='reviewing')) this.oscarState='reviewing';
    else if(this.mission?.status==='planning') this.oscarState='planning';
    else if(this.mission?.status==='completed'&&this.time<this._oscarBubbleUntil) this.oscarState='celebrating';
    else if(['running','reviewing'].includes(this.mission?.status)) this.oscarState='coordinating';
    else this.oscarState='idle';
    const a=this.oscar,review=!!this._reviewOwner||live.some(x=>x.state==='handoff')||this.mission?.tasks?.some(t=>t.status==='reviewing');
    const busy=['planning','running','reviewing'].includes(this.mission?.status)||review;
    if(review)this._oscarRoute('desk',OSCAR_HOME);
    else if(!this.mission)this._oscarRoute('welcome',OSCAR_WELCOME);
    else if(['planning','reviewing'].includes(this.mission.status))this._oscarRoute('desk',OSCAR_HOME);
    else if(busy&&a.place==='desk'&&this.time>=a.nextVisitAt){const workers=live.filter(x=>x.task.status==='working'),role=workers[a.visits%Math.max(1,workers.length)]?.role||'code';this._oscarRoute('visit',OSCAR_VISITS[role]);}
    else if(a.place==='visit'&&this.time>=a.visitUntil)this._oscarRoute('desk',OSCAR_HOME);
    else if(busy&&a.place==='welcome')this._oscarRoute('desk',OSCAR_HOME);
    else if(!busy&&!a.path.length&&a.place==='desk'&&this.time>=a.nextVisitAt)this._oscarRoute('welcome',OSCAR_WELCOME);
    if(dt&&a.path.length){let budget=160*dt;while(a.path.length&&budget>0){const p=a.path[0],dx=p.x-a.x,dy=p.y-a.y,d=Math.hypot(dx,dy);if(d>.01)a.direction=Math.abs(dx)>Math.abs(dy)?dx>0?'right':'left':dy>0?'down':'up';if(d<=budget){a.x=p.x;a.y=p.y;a.path.shift();budget-=d;}else{a.x+=dx/d*budget;a.y+=dy/d*budget;budget=0;}}if(!a.path.length)this._oscarArrived();}
  }

  _coordinates(event) {
    const r=this.canvas.getBoundingClientRect();
    const v=this.viewport,x=(event.clientX-r.left)*v.width/Math.max(1,r.width),y=(event.clientY-r.top)*v.height/Math.max(1,r.height);
    return {x:(x-v.offsetX)/v.scale,y:(y-v.offsetY)/v.scale};
  }
  _resizeViewport() {
    if(this._destroyed)return;
    const r=this.canvas.getBoundingClientRect();
    const width=Math.max(1,r.width||this.canvas.clientWidth||window.innerWidth||W),height=Math.max(1,r.height||this.canvas.clientHeight||window.innerHeight||H);
    const dpr=Math.max(1,Math.min(2,Number(window.devicePixelRatio)||1)),scale=Math.min(width/W,height/H);
    this.viewport={width,height,scale,offsetX:(width-W*scale)/2,offsetY:(height-H*scale)/2,dpr};
    const rasterWidth=Math.max(1,Math.round(width*dpr)),rasterHeight=Math.max(1,Math.round(height*dpr));
    if(this.canvas.width!==rasterWidth||this.canvas.height!==rasterHeight){this.canvas.width=rasterWidth;this.canvas.height=rasterHeight;}
    if(this.pixelRatio!==dpr){this.pixelRatio=dpr;this._background=this._makeBackground();}
    this.ctx.imageSmoothingEnabled=true;if(this._background)this._draw();
  }
  _hit(p) {
    const agents=[...this.agents.values()].filter(a=>a.visible).sort((a,b)=>b.y-a.y);
    for(const a of agents) if(Math.abs(p.x-a.x)<27&&p.y>a.y-82&&p.y<a.y+32) return a;
    if(Math.abs(p.x-1160)<30&&p.y>=174&&p.y<=267||p.x>=1078&&p.x<=1253&&p.y>=255&&p.y<=313)return {role:'secretaire',name:'Zoé',id:null,type:'secretary'};
    if(Math.abs(p.x-this.oscar.x)<34&&p.y>this.oscar.y-90&&p.y<this.oscar.y+25)return {role:'oscar',id:null};
    if(p.x>610&&p.x<830&&p.y>218&&p.y<290)return {role:'oscar',id:null,type:'desk'};
    for(const island of ISLANDS)if(p.x>=island.x-12&&p.x<=island.x+island.w+12&&p.y>=island.y-78&&p.y<=island.y+island.h+65)return {role:island.role,id:null,type:'desk'};
    return null;
  }
  _hitProp(p) {return HOTSPOTS.find(h=>p.x>=h.x&&p.x<h.x+h.w&&p.y>=h.y&&p.y<h.y+h.h)||null;}
  _selectActor(a) {
    if(a.type==='secretary'){this.interact('secretary');return;}
    if(a.type==='desk'){this.onSelect(a.role,null);return;}
    const info={...ROLES[a.role],name:a.name||ROLES[a.role].name},key=a.key||'oscar';
    const n=this._clickCounts.get(key)||0;this._clickCounts.set(key,n+1);
    let text;
    if(a.role==='oscar') text=this.oscarState==='reviewing'?'Je lis. La tasse attend.':this.oscarState==='planning'?'Une idée, puis un plan.':this.oscarState==='coordinating'?'Je coordonne. Le café inclus.':['Chef d’équipe. Et de cafetière.','Mon superpouvoir ? Déléguer.','Les bonnes idées ont une place.'][n%3];
    else if(a.state==='leaving') text='Je rends les clés et la tasse.';
    else if(a.task?.status==='queued') text='Prêt ! J’attends le brief.';
    else if(a.task?.status==='reviewing') text='Oscar lit. Je retiens ma tasse.';
    else if(['revising','needs_review'].includes(a.task?.status)) text='Je corrige. Le café attendra.';
    else if(a.task?.status==='approved') text=['Validé ! Mon café aussi.','Mission validée. Sourire aussi.','Le vrai livrable ? L’équipe.'][n%3];
    else text={recherche:'Je cherche, pas la cafetière.',redaction:'Les mots sont bien alignés.',code:'Ça compile dans ma tête.',design:'Un dernier détail, promis.',analyse:'J’ai même compté les sourires.'}[a.role]||'Toujours sur la mission !';
    const reaction={kind:['wave','jump','wink'][n%3],start:this.time,until:this.time+1.5};
    this._reactions.set(key,reaction);
    this._lastClickedBubble={key,until:this.time+3.5};
    if(a.role==='oscar') {this._oscarBubble=text;this._oscarBubbleUntil=this.time+3.5;}
    else this._bubble(a,text,3.5);
    this._sayStatus(`${info.name} : ${text}`);this.onInteract('character',`${info.name} : ${text}`);
    this._draw();
    // A short greeting gets a few frames before the host opens the real task sheet.
    if(this._selectionTimer!==null) clearTimeout(this._selectionTimer);
    this._selectionTimer=setTimeout(()=>{
      this._selectionTimer=null;
      if(!this._destroyed&&(a.role==='oscar'||this.agents.has(key))) this.onSelect(a.role,a.id);
    },this.reducedMotion?80:180);
  }
  _select(event) {
    const p=this._coordinates(event),a=this._hit(p);
    if(a) {this._selectActor(a);return;}
    const prop=this._hitProp(p);
    if(prop) {this._hoveredProp=prop;this.interact(prop.kind,prop.index??null);}
  }
  _pointer(event) {
    const p=this._coordinates(event),actor=this._hit(p),prop=actor?null:this._hitProp(p);
    this.canvas.style.cursor=actor||prop?'pointer':'';
    this.canvas.title=actor?`${actor.name||ROLES[actor.role].name} · voir sa personnalité et sa mission`:prop?.label||this._initialTitle;
    if(prop!==this._hoveredProp) {this._hoveredProp=prop;if(this._manualPaused) this._draw();}
  }

  _round(c,x,y,w,h,r,fill,stroke=null) {
    c.beginPath();c.roundRect(x,y,w,h,r);
    if(fill){c.fillStyle=fill;c.fill();}
    if(stroke){c.strokeStyle=stroke;c.lineWidth=1;c.stroke();}
  }
  _ellipse(c,x,y,rx,ry,fill) {c.beginPath();c.ellipse(x,y,rx,ry,0,0,Math.PI*2);c.fillStyle=fill;c.fill();}
  _line(c,x1,y1,x2,y2,color,width=1) {c.beginPath();c.moveTo(x1,y1);c.lineTo(x2,y2);c.strokeStyle=color;c.lineWidth=width;c.lineCap='round';c.stroke();}
  _shadow(c,draw,blur=18,offset=9) {c.save();c.shadowColor='#5664541c';c.shadowBlur=blur;c.shadowOffsetY=offset;draw();c.restore();}
  _text(c,text,x,y,color=P.ink,size=14,align='left',weight=500) {
    c.font=`${weight} ${size}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
    c.textBaseline='alphabetic';c.textAlign=align;c.fillStyle=color;c.fillText(translate(String(text)),x,y);
  }
  _drawViewportBackdrop(c) {
    const {width,height,scale,offsetX,offsetY}=this.viewport,floorY=offsetY+209*scale;
    const wall=c.createLinearGradient(0,offsetY+24*scale,0,offsetY+224*scale);wall.addColorStop(0,'#f7faf6');wall.addColorStop(1,'#e1ebe4');
    c.fillStyle=wall;c.fillRect(0,0,width,height);
    const floor=c.createLinearGradient(0,offsetY+214*scale,0,offsetY+822*scale);floor.addColorStop(0,'#eee5d4');floor.addColorStop(1,'#e2d2b6');
    c.fillStyle=floor;c.fillRect(0,floorY,width,height-floorY);
    this._line(c,0,offsetY+212*scale,width,offsetY+212*scale,'#b9c7b980',6*scale);
    this._line(c,0,offsetY+218*scale,width,offsetY+218*scale,'#fdfbf4',4*scale);
    const maxRow=Math.ceil(((height-offsetY)/scale-224)/38),firstCol=Math.floor((-offsetX/scale-42)/220)-1,lastCol=Math.ceil(((width-offsetX)/scale-42)/220)+1;
    for(let row=0;row<=maxRow;row++) {
      const y=offsetY+(224+row*38)*scale;this._line(c,0,y,width,y,'#cbbb9d38',Math.max(.4,scale));
      for(let j=firstCol;j<=lastCol;j++){const x=offsetX+(42+j*220+(row%2)*110)*scale;this._line(c,x,y,x,y+38*scale,'#cbbb9d2c',Math.max(.4,scale));}
    }
    const alpha=this._ambientShade();
    c.save();c.globalCompositeOperation='multiply';
    if(alpha){c.fillStyle=`rgba(28,28,35,${alpha})`;c.fillRect(0,offsetY+210*scale,width,height-offsetY-210*scale);}
    const wallShade=(1-this.ambience.daylight)*.15;if(wallShade){c.fillStyle=`rgba(45,65,101,${wallShade})`;c.fillRect(0,0,width,offsetY+210*scale);}
    c.restore();
  }
  _makeBackground() {
    const canvas=document.createElement('canvas');canvas.width=Math.round(W*this.pixelRatio);canvas.height=Math.round(H*this.pixelRatio);
    const c=canvas.getContext('2d');c.scale(this.pixelRatio,this.pixelRatio);c.imageSmoothingEnabled=true;
    const wall=c.createLinearGradient(0,24,0,224);wall.addColorStop(0,'#f7faf6');wall.addColorStop(1,'#e1ebe4');
    c.fillStyle=wall;c.fillRect(0,0,W,H);
    const floor=c.createLinearGradient(0,214,0,822);floor.addColorStop(0,'#eee5d4');floor.addColorStop(1,'#e2d2b6');
    c.fillStyle=floor;c.fillRect(0,209,W,H-209);
    this._line(c,0,212,W,212,'#b9c7b980',6);this._line(c,0,218,W,218,'#fdfbf4',4);
    c.save();c.beginPath();c.rect(0,218,W,H-218);c.clip();
    for(let row=0;row<18;row++) {
      const y=224+row*38;this._line(c,0,y,W,y,'#cbbb9d38');
      for(let j=0;j<7;j++){const x=42+j*220+(row%2)*110;this._line(c,x,y,x,y+38,'#cbbb9d2c');}
    }
    for(let i=0;i<32;i++){const x=90+(i*137)%1250,y=250+(i*71)%520;this._line(c,x,y,x+22+(i%4)*5,y+1,'#f5ecdc50',2);}
    c.restore();
    // Cache furnishings separately: nighttime belongs to the room and windows,
    // while desk colors, signs and characters remain crisp under their lamps.
    c.clearRect(0,0,W,H);
    // A real entrance, a quiet cabinet, and a place for Oscar's plans.
    this._shadow(c,()=>this._round(c,73,78,81,149,12,'#b09b80'),14,5);
    this._round(c,80,85,67,136,7,'#4b6866');this._round(c,86,91,55,122,5,'#678d86');
    this._round(c,95,102,37,56,5,'#a9cbc4');this._ellipse(c,133,171,3,3,P.gold);
    this._round(c,63,227,102,27,12,'#d9b4a2');this._text(c,'BIENVENUE',114,245,'#fffaf1',10,'center',650);
    this._round(c,431,142,127,57,9,'#cfb593');this._round(c,437,148,115,45,6,'#ecd7b6');
    [[449,156,-.08,'#fffaf0'],[484,161,.1,'#d6e5d4'],[517,153,-.04,'#f0c6b2']].forEach(([x,y,a,color])=>{c.save();c.translate(x,y);c.rotate(a);this._round(c,0,0,24,28,3,color);this._ellipse(c,12,3,2,2,'#aa8c72');this._line(c,5,12,18,12,'#8da28d',1.5);this._line(c,5,17,15,17,'#8da28d',1.5);c.restore();});
    this._round(c,866,146,98,49,8,'#fafaf0');this._text(c,'LE COLLECTIF',915,160,'#91a58c',10,'center',650);
    for(let i=0;i<5;i++)this._ellipse(c,887+i*14,174,4,4,[P.coral,P.blue,P.gold,P.mint,'#b4a9c6'][i]);
    this._text(c,'Talents & métiers',915,188,'#a6ad9b',8,'center');
    this._text(c,'Oscar et les Agents',720,43,'#6e897a',16,'center',550);
    this._plant(c,94,421,1.05);this._plant(c,1347,424,1.16);this._plant(c,1335,761,1.2);
    this._coffeeCorner(c);this._lounge(c);this._deliveryCabinet(c);
    for(const island of ISLANDS) this._island(c,island);
    this._oscarDesk(c,false);
    // Books, an original porcelain companion, and the studio's small everyday objects.
    this._shadow(c,()=>this._round(c,1280,611,80,11,5,'#c5a282'),9,5);
    for(let i=0;i<4;i++)this._round(c,1289+i*8,590-i%2*7,6,21+i%2*7,2,[P.coral,P.mint,P.gold,P.blue][i]);
    return canvas;
  }
  _island(c,island) {
    const {x,y,w,h,accent,role}=island;
    this._round(c,x-36,y-58,w+72,h+126,44,`${accent}17`);
    this._text(c,ROLES[role].label.toUpperCase(),x+w/2,y-63,'#81917f',12,'center',650);
    for(const seat of DESKS.filter(d=>d.role===role)) this._chair(c,seat.stand.x,seat.stand.y,accent,seat.position<2);
    this._shadow(c,()=>this._round(c,x+2,y+13,w-4,h-8,22,'#a48d7160'),22,13);
    this._round(c,x,y+7,w,h-7,21,'#bc9a78');
    const top=c.createLinearGradient(x,y,x,y+h);top.addColorStop(0,'#f8e6cf');top.addColorStop(1,'#eacdae');
    this._round(c,x,y,w,h-12,20,top,'#d6b794');
    this._line(c,x+20,y+10,x+w-20,y+10,'#ffffff60',2);
    for(const seat of DESKS.filter(d=>d.role===role)) this._screen(c,seat,false);
    this._round(c,x+w/2-42,y+32,84,23,11,'#fff7e8d9');
    this._text(c,ROLES[role].label,x+w/2,y+48,'#8e957e',10,'center',600);
    this._ellipse(c,x+w/2+17,y+64,8,3,'#b4937260');this._round(c,x+w/2+10,y+55,13,10,3,accent);this._ellipse(c,x+w/2+16,y+55,6,2,'#f8eddd');
    this._round(c,x+w/2-30,y+60,19,10,2,'#fff9ec');this._line(c,x+w/2-26,y+63,x+w/2-15,y+63,'#a7b49e');
  }
  _chair(c,x,y,color,upper=false) {
    this._ellipse(c,x,y+3,23,9,'#66785e13');
    this._round(c,x-18,y-30,36,31,13,'#879984');
    this._round(c,x-16,y-30,32,23,11,color);
    this._round(c,x-16,y-9,32,12,7,'#d5ddc7');
    this._line(c,x-11,y+1,x-14,y+9,'#8c9b88',3);this._line(c,x+11,y+1,x+14,y+9,'#8c9b88',3);
    if(upper)this._line(c,x-11,y-26,x+11,y-26,'#ffffff40',2);
  }
  _screen(c,seat,working) {
    const island=ISLANDS[seat.island],x=seat.stand.x,y=island.y+(seat.position<2?7:46);
    this._ellipse(c,x,y+30,20,4,'#a58c7020');
    this._round(c,x-3,y+19,6,12,2,'#829895');this._round(c,x-12,y+28,24,3,1.5,'#8ba09a');
    this._round(c,x-22,y-3,44,27,5,'#657b7a');
    const g=c.createLinearGradient(x,y,x+20,y+24);g.addColorStop(0,working?'#d0e5d7':'#e3e9df');g.addColorStop(1,working?'#b7d5cc':'#cad8d3');
    this._round(c,x-19,y,38,20,3,g);
    if(working) {
      const t=this.reducedMotion?0:Math.floor(this.time*4+seat.id)%4;
      this._round(c,x-14,y+4,14+t*2,2,1,'#8faea0');this._round(c,x-14,y+9,24-t,2,1,'#a2beb2');this._round(c,x-14,y+14,11+t,2,1,'#a2beb2');
      if(!this.reducedMotion&&Math.floor(this.time*3+seat.id)%2===0)this._round(c,x+8+t,y+14,2,3,1,'#6d9e8d');
    } else {this._ellipse(c,x,y+10,4,4,'#ffffff80');}
  }
  _oscarDesk(c,frontOnly=false) {
    if(!frontOnly) {
      this._round(c,596,188,248,129,30,'#abc3ab18');this._chair(c,720,238,'#729e86',true);
      this._shadow(c,()=>this._round(c,610,232,220,62,19,'#b89c7d'),20,10);
      const top=c.createLinearGradient(610,220,830,280);top.addColorStop(0,'#f6dfc4');top.addColorStop(1,'#e8c6a2');
      this._round(c,610,220,220,63,19,top,'#cdb18d');
    } else {
      this._round(c,612,248,216,37,[0,0,17,17],'#e7c9a7');
      this._line(c,629,253,810,253,'#f5dfc4',2);
      this._round(c,654,218,66,40,7,'#5f7b71');this._round(c,659,222,56,29,4,'#d5e7d6');
      this._round(c,675,259,30,4,2,'#a5b299');
      this._round(c,741,230,39,24,3,'#fffaf0');this._line(c,747,236,772,236,'#b4bfa8',2);this._line(c,747,242,765,242,'#b4bfa8',2);
      this._round(c,792,231,17,18,6,'#84a992');this._ellipse(c,800,232,7,3,'#f6ead5');
      this._round(c,702,272,45,17,6,'#fff6e8');this._text(c,'Oscar',725,284,'#82917d',10,'center',650);
    }
  }
  _coffeeCorner(c) {
    this._round(c,57,618,123,142,24,'#d4b7a01c');
    this._shadow(c,()=>this._round(c,66,665,103,73,13,'#b48f72'),17,9);
    this._round(c,66,648,103,21,10,'#f1e6d2');
    this._round(c,75,676,37,48,5,'#c9a381');this._round(c,120,676,39,48,5,'#c9a381');
    this._line(c,108,691,108,707,'#997a61',2);this._line(c,124,691,124,707,'#997a61',2);
    this._shadow(c,()=>this._round(c,80,608,58,44,10,'#f5eee0'),10,3);
    this._round(c,84,613,50,10,4,'#829992');this._round(c,89,628,40,21,4,'#607c72');
    this._round(c,104,625,7,10,2,'#d9dfcc');this._round(c,100,639,16,11,4,'#faf5e8');
    this._ellipse(c,108,640,7,2,'#8c7059');this._ellipse(c,128,618,2,2,P.mint);
    this._round(c,145,635,11,15,4,P.coral);this._ellipse(c,150,636,5,2,'#fff3dc');
    this._text(c,'Le petit café',118,594,'#9c9c84',12,'center',550);
    this._round(c,95,745,46,9,4,'#90765d');
  }
  _deliveryCabinet(c) {
    this._shadow(c,()=>this._round(c,1270,656,110,58,11,'#b99e7f'),13,6);
    this._round(c,1267,647,116,14,6,'#e3cdb1');
    this._round(c,1278,665,43,37,4,'#d3b797');this._round(c,1328,665,43,37,4,'#d3b797');
    this._line(c,1317,677,1317,689,'#9e876d',2);this._line(c,1332,677,1332,689,'#9e876d',2);
    for(let i=0;i<3;i++){this._round(c,1282+i*22,628-i%2*4,20,18,4,[P.mint,'#e8d5b2',P.coral][i]);this._round(c,1285+i*22,624-i%2*4,9,5,2,[P.mint,'#e8d5b2',P.coral][i]);}
    this._text(c,'Livraisons',1325,736,'#8b9a85',11,'center');
  }
  _lounge(c) {
    this._round(c,525,650,395,163,66,'#a8beb71c');
    for(const x of [552,864]) {
      this._ellipse(c,x+20,794,35,9,'#6f846522');
      this._round(c,x,682,44,109,20,'#a2b5a1');this._round(c,x+6,689,32,95,15,'#c3d1ba');
      this._line(c,x+9,734,x+35,734,'#a7b99e',2);this._line(c,x+8,779,x+36,779,'#94a68e',2);
      this._round(c,x+8,698,27,24,8,'#eee2c6');
    }
    this._shadow(c,()=>this._ellipse(c,730,744,67,36,'#b0967860'),20,12);
    this._ellipse(c,730,733,64,35,'#b99876');this._ellipse(c,730,725,64,35,'#efdbbf');
    this._round(c,701,707,30,22,4,'#fff9ee');this._line(c,708,713,725,713,'#a6b99e',2);this._line(c,708,719,722,719,'#bdcbb6',2);
    this._ellipse(c,749,734,13,5,'#b19c7c25');this._round(c,740,715,17,18,6,'#c99178');this._ellipse(c,748,716,8,3,'#f8ead8');
    this._text(c,'Lounge · les idées continuent',730,835,'#8b9a85',12,'center');
  }
  _plant(c,x,y,scale=1) {
    c.save();c.translate(x,y);c.scale(scale,scale);
    this._ellipse(c,0,16,26,8,'#6d83601b');
    c.beginPath();c.moveTo(-18,-11);c.lineTo(18,-11);c.quadraticCurveTo(17,18,10,21);c.lineTo(-10,21);c.quadraticCurveTo(-17,18,-18,-11);c.fillStyle='#cfac91';c.fill();
    this._ellipse(c,0,-10,18,6,'#a7876d');this._ellipse(c,0,-12,16,4,'#7f886c');
    this._line(c,0,-12,-2,-75,'#719273',3);this._line(c,-1,-28,-22,-53,'#719273',2);this._line(c,-1,-44,21,-66,'#719273',2);
    for(const [lx,ly,rx,ry,angle,col] of [[-17,-55,15,7,-.4,'#82a58b'],[15,-67,16,8,.4,'#94b49a'],[-8,-75,13,7,-.65,'#769d82'],[15,-40,16,8,-.3,'#8fb196'],[-18,-32,14,7,.2,'#9aba9e']]) {
      c.save();c.translate(lx,ly);c.rotate(angle);this._ellipse(c,0,0,rx,ry,col);this._line(c,-rx+4,0,rx-4,0,'#ffffff24');c.restore();
    }
    c.restore();
  }
  _drawWindows(c) {
    const scene=this.ambience,daylight=scene.daylight;
    for(const [i,x] of [180,1080].entries()) {
      this._shadow(c,()=>this._round(c,x-6,59,232,134,16,'#d0d8ca'),13,5);
      this._round(c,x,62,220,123,11,'#fefdf7');
      c.save();c.beginPath();c.roundRect(x+8,70,204,106,7);c.clip();
      const skyTop=blend('#35516b','#d8edef',daylight),skyBottom=blend('#8296a3','#f4f5df',daylight);
      const sky=c.createLinearGradient(0,70,0,176);sky.addColorStop(0,skyTop);sky.addColorStop(1,skyBottom);
      c.fillStyle=sky;c.fillRect(x+8,70,204,106);
      if(scene.warmth>0){c.save();c.globalAlpha=scene.warmth*.52;const warmth=c.createLinearGradient(0,70,0,176);warmth.addColorStop(0,'#e4aba8');warmth.addColorStop(1,'#f4d7ad');c.fillStyle=warmth;c.fillRect(x+8,70,204,106);c.restore();}
      if(scene.stars>.03) {
        for(let n=0;n<14;n++) {
          const sx=x+17+(n*27)%186,sy=79+(n*13)%58,twinkle=this.reducedMotion ? .8 :.72+Math.sin(this.time*.8+n*2.7)*.28;
          c.save();c.globalAlpha=scene.stars*twinkle;this._ellipse(c,sx,sy,n%4===0?1.7:1.2,1.2,'#fff4db');c.restore();
        }
      }
      if(scene.moon.visible){c.save();c.globalAlpha=scene.moon.opacity;const mx=x+8+scene.moon.x*204,my=70+scene.moon.y*106;const halo=c.createRadialGradient(mx,my,7,mx,my,25);halo.addColorStop(0,'#fff2cc25');halo.addColorStop(1,'#fff2cc00');this._ellipse(c,mx,my,25,25,halo);this._ellipse(c,mx,my,12,12,'#f8ecd2');this._ellipse(c,mx-5,my-4,11,11,skyTop);c.restore();}
      if(scene.sun.visible){c.save();c.globalAlpha=scene.sun.opacity;const sx=x+8+scene.sun.x*204,sy=70+scene.sun.y*106;const halo=c.createRadialGradient(sx,sy,4,sx,sy,31);halo.addColorStop(0,'#f5dda742');halo.addColorStop(1,'#f5dda700');this._ellipse(c,sx,sy,31,31,halo);this._ellipse(c,sx,sy,15+scene.warmth*3,15+scene.warmth*3,'#edd39b');c.restore();}
      const shift=this.reducedMotion?0:Math.sin(this.time*.025+i)*14;
      c.save();c.globalAlpha=.18+daylight*.55;
      for(const [cx,cy,size] of [[x+44+shift,98,1],[x+106-shift,118,.8]]){this._ellipse(c,cx,cy,22*size,7*size,'#fff8e9');this._ellipse(c,cx-7*size,cy-5*size,11*size,7*size,'#fff8e9');}
      c.restore();
      c.beginPath();c.moveTo(x,174);c.bezierCurveTo(x+40,119,x+75,175,x+118,144);c.bezierCurveTo(x+160,116,x+185,163,x+230,137);c.lineTo(x+230,185);c.lineTo(x,185);c.fillStyle=blend('#607b7d','#adc8ad',daylight);c.fill();
      c.beginPath();c.moveTo(x,181);c.bezierCurveTo(x+70,143,x+137,174,x+220,153);c.lineTo(x+220,190);c.lineTo(x,190);c.fillStyle=blend('#466c70','#94b69a',daylight);c.fill();
      c.restore();
      this._round(c,x+104,67,7,111,2,'#fdfcf5');this._round(c,x+5,121,211,6,2,'#fdfcf5');this._round(c,x-9,182,238,12,5,'#ebe6d6');
      if(scene.sun.visible&&daylight>.08){c.save();c.globalAlpha=.025+daylight*.055;const lean=(.5-scene.sun.progress)*170,g=c.createLinearGradient(x,212,x+lean,380);g.addColorStop(0,'#f2d49c');g.addColorStop(1,'#f2d49c00');c.fillStyle=g;c.beginPath();c.moveTo(x+10,218);c.lineTo(x+210,218);c.lineTo(x+210+lean,380);c.lineTo(x+10+lean,380);c.fill();c.restore();}
    }
  }
  _drawSunShadows(c) {
    const {sun,daylight}=this.ambience;if(!sun.visible||daylight<.08)return;
    const lean=(.5-sun.progress)*92,stretch=(1-sun.altitude)*24;
    c.save();c.globalAlpha=daylight*.11;
    for(const island of ISLANDS)this._ellipse(c,island.x+island.w/2+lean,island.y+island.h+18+stretch,island.w*.55,14+stretch,'#697c65');
    this._ellipse(c,720+lean,306+stretch,121,16+stretch,'#697c65');c.restore();
  }
  _drawClock(c) {
    const x=1003,y=106;this._shadow(c,()=>this._ellipse(c,x,y,29,29,'#d5c3a5'),8,4);this._ellipse(c,x,y,26,26,'#fdf9ef');
    for(let i=0;i<12;i++){const a=i*Math.PI/6;this._line(c,x+Math.sin(a)*21,y-Math.cos(a)*21,x+Math.sin(a)*(i%3===0?17:19),y-Math.cos(a)*(i%3===0?17:19),'#a2ae98',i%3===0?2:1);}
    const date=new Date(),gag=this.time<this.props.clockUntil&&!this.reducedMotion;
    const minute=date.getMinutes()+date.getSeconds()/60,hour=date.getHours()%12+minute/60;
    const ma=gag?this.time*14:minute*Math.PI/30,ha=gag?this.time*5:hour*Math.PI/6;
    this._line(c,x,y,x+Math.sin(ma)*17,y-Math.cos(ma)*17,'#6a8373',2);this._line(c,x,y,x+Math.sin(ha)*12,y-Math.cos(ha)*12,'#6a8373',3);
    if(!this.reducedMotion&&!gag){const a=date.getSeconds()*Math.PI/30;this._line(c,x,y,x+Math.sin(a)*18,y-Math.cos(a)*18,'#cf9f86',1);}
    this._ellipse(c,x,y,3,3,'#cc9f83');
    if(gag){this._line(c,x-34,y-13,x-38,y-17,'#dab797',2);this._line(c,x+33,y+7,x+38,y+9,'#dab797',2);}
  }
  _drawLamps(c) {
    for(const [i,lamp] of LAMPS.entries()) {
      if(lamp.floor){
        this._ellipse(c,lamp.x,lamp.y+113,24,5,'#62735a1a');
        this._round(c,lamp.x-18,lamp.y+102,36,7,4,'#6e7c72');
        this._line(c,lamp.x,lamp.y+104,lamp.x,lamp.y+3,'#8b9b8d',4);
        this._line(c,lamp.x+2,lamp.y+100,lamp.x+2,lamp.y+8,'#c7d1bf',1.5);
        this._ellipse(c,lamp.x,lamp.y+2,22,7,'#c6baa0');
        this._ellipse(c,lamp.x,lamp.y-1,21,5,this.props.lights[i]?'#fff3ce':'#a4b2a5');
        this._round(c,lamp.x-3,lamp.y+55,6,9,2,this.props.lights[i]?'#e5c482':'#64776c');
        continue;
      }
      this._line(c,lamp.x,29,lamp.x,lamp.y-13,'#adbaac',2);
      this._shadow(c,()=>{c.beginPath();c.moveTo(lamp.x-8,lamp.y-17);c.bezierCurveTo(lamp.x-20,lamp.y-15,lamp.x-25,lamp.y-1,lamp.x-25,lamp.y+5);c.quadraticCurveTo(lamp.x,lamp.y+19,lamp.x+25,lamp.y+5);c.bezierCurveTo(lamp.x+25,lamp.y-1,lamp.x+20,lamp.y-15,lamp.x+8,lamp.y-17);c.closePath();c.fillStyle=i===1?'#a9bdac':'#dac5a5';c.fill();},9,3);
      this._ellipse(c,lamp.x,lamp.y+5,23,7,this.props.lights[i]?'#fff1c9':'#b6b7a5');
      if(this.props.lights[i]) {this._ellipse(c,lamp.x,lamp.y+5,9,4,'#fff9e6');const g=c.createRadialGradient(lamp.x,lamp.y+13,2,lamp.x,lamp.y+20,50);g.addColorStop(0,'#fff2c420');g.addColorStop(1,'#fff2c400');this._ellipse(c,lamp.x,lamp.y+20,50,37,g);}
    }
  }
  _ambientShade() {return Math.max(0,(1-this.ambience.daylight)*(.34-this.props.lights.filter(Boolean).length*.012));}
  _drawAtmosphere(c) {
    const alpha=this._ambientShade(),nightness=1-this.ambience.daylight;
    // Small pools of warm light never overlap the whole office.
    for(const [i,lamp] of LAMPS.entries()) if(this.props.lights[i]) {
      const strength=this._lightsAuto ? .2+nightness*.8 : 1;
      c.save();c.globalAlpha=strength;
      const y=lamp.floor?lamp.y-48:lamp.y+75,r=lamp.floor?125:155;
      const glow=c.createRadialGradient(lamp.x,y,6,lamp.x,y,r);glow.addColorStop(0,'#fff0c31c');glow.addColorStop(.45,'#ffe6ac10');glow.addColorStop(1,'#fff0c300');this._ellipse(c,lamp.x,y,r,r*.9,glow);
      c.restore();
    }
  }
  _drawCoffeeSteam(c) {
    const active=this.time<this.props.coffeeUntil;
    if(!active&&(this.reducedMotion||Math.floor(this.time)%7>2))return;
    for(let i=0;i<(active?4:2);i++) {
      const t=this.reducedMotion ? .5 :(this.time*.7+i*.27)%1,x=94+i*9,y=602-t*28;
      c.save();c.globalAlpha=(1-t)*(active ? .6 : .35);c.beginPath();c.moveTo(x,y+12);c.bezierCurveTo(x-7,y+5,x+8,y+2,x+1,y-8);c.strokeStyle='#fffdf6';c.lineWidth=3;c.lineCap='round';c.stroke();c.restore();
    }
    if(active){this._line(c,107,631,107,641,'#ad8563',2);this._text(c,'pshhh…',149,616,'#afad94',11,'left');}
  }
  _drawSecretary(c) {
    const x=1160,y=258;
    this._ellipse(c,x,y+43,81,12,'#66785e14');
    this._round(c,x-68,y-12,136,62,18,'#d9b795');
    this._sprite(c,{x,y,id:'zoe',key:'zoe',role:'secretaire',roleIndex:1,direction:'down',state:this.secretaryBusy?'working':'idle'});
    this._round(c,x-83,y+1,166,42,14,'#dfbf9e');
    this._round(c,x-79,y+2,158,8,5,'#efd9bc');
    this._round(c,x-30,y-17,51,27,5,'#809b8a');this._round(c,x-26,y-13,43,19,3,this.secretaryBusy?'#def1df':'#e4eee3');
    this._line(c,x-5,y+10,x-5,y+14,'#93a88f',3);
    this._round(c,x+37,y+9,24,16,3,'#faf5e7');this._line(c,x+39,y+10,x+49,y+18,'#c2b59b',1);this._line(c,x+59,y+10,x+49,y+18,'#c2b59b',1);
    this._round(c,x-33,y+26,72,18,8,'#fff9ed');this._text(c,'Zoé · Secrétariat',x+3,y+38,'#83626a',8.5,'center',650);
  }
  _companion(c,reacting) {
    const elapsed=this.time-(this.props.catStart||0),hop=reacting&&!this.reducedMotion?Math.abs(Math.sin(elapsed*Math.PI*1.25))*38*Math.max(0,1-elapsed/5):0;
    const x=1324+(reacting&&!this.reducedMotion?Math.sin(elapsed*4)*7:0),y=608-hop;
    this._ellipse(c,1324,611,Math.max(9,18-hop*.15),4,'#6a765e25');this._ellipse(c,x,y-9,13,17,'#ede5d2');
    this._ellipse(c,x-2,y-25,13,11,'#f5edda');
    c.beginPath();c.moveTo(x-13,y-29);c.quadraticCurveTo(x-18,y-48,x-4,y-35);c.moveTo(x+5,y-34);c.quadraticCurveTo(x+18,y-47,x+10,y-26);c.fillStyle='#f5edda';c.fill();
    const blink=!this.reducedMotion&&Math.floor(this.time*5)%23===0;
    if(blink){this._line(c,x-8,y-25,x-4,y-26,'#8e9c85',1.5);this._line(c,x+2,y-26,x+6,y-25,'#8e9c85',1.5);}else{this._ellipse(c,x-6,y-26,1.5,2,'#7c8c77');this._ellipse(c,x+4,y-26,1.5,2,'#7c8c77');}
    this._ellipse(c,x-1,y-21,2,1.5,'#d5aa95');
    const swish=this.reducedMotion?0:Math.sin(this.time*(reacting?7:1.8))*(reacting?10:3);
    c.beginPath();c.moveTo(x+8,y);c.bezierCurveTo(x+30,y+4,x+35+swish,y-16,x+24+swish,y-17);c.strokeStyle='#e7decb';c.lineWidth=7;c.lineCap='round';c.stroke();
    this._ellipse(c,x-8,y+3,5,3,'#f5edda');this._ellipse(c,x+4,y+3,5,3,'#f5edda');
    if(reacting&&!this.reducedMotion)this._heart(c,x+27,y-43+Math.sin(this.time*2)*3,P.coral);
  }
  _sprite(c,actor,oscar=false) {
    const info=ROLES[actor.role]||ROLES.recherche,reaction=this._reactions.get(actor.key||'oscar'),reacting=!!reaction&&reaction.until>this.time;
    const moving=TRAVEL_STATES.has(actor.state),working=['working','planning','coordinating','reviewing'].includes(actor.state);
    const variant=actor.roleIndex||0,walk=moving&&!this.reducedMotion?Math.sin(this.time*9+variant):0;
    const jump=reacting&&reaction.kind==='jump'&&!this.reducedMotion?Math.max(0,Math.sin((this.time-reaction.start)*Math.PI*3))*8:0;
    const phase=(hash(actor.id||'oscar')%100)/13;
    const bob=!this.reducedMotion?(moving?Math.abs(walk)*2:working?Math.sin(this.time*4.2+phase)*1.35:Math.sin(this.time*1.8+variant)*.8):0;
    const glance=working&&!this.reducedMotion&&Math.floor(this.time+phase)%19<2;
    const x=actor.x+(working&&!this.reducedMotion?Math.sin(this.time*2.1+phase)*.7:0),y=actor.y-jump-bob,up=actor.direction==='up'&&!reacting&&!glance,side=['left','right'].includes(actor.direction)&&!reacting,left=actor.direction==='left';
    const skin=['#edbd9a','#d8a07c','#efc7a7','#bc8c6b'][oscar?0:variant%4],hair=['#634f43','#9c7257','#3c4845','#7f6254'][oscar?0:variant%4];
    this._ellipse(c,x,actor.y+1,20,6.5,'#62735a1e');
    c.save();c.translate(x,y);c.scale(1.1,1.1);
    for(const sideSign of [-1,1]) {
      const step=sideSign*walk*4;
      this._line(c,sideSign*6,-17,sideSign*7,-5+step,'#61716a',6);
      this._round(c,sideSign*7-4,-5+step,10,5,2.5,'#4a5b53');
    }
    const body=c.createLinearGradient(-13,-40,13,-15);body.addColorStop(0,info.shirt);body.addColorStop(1,oscar?'#638d77':info.shirt);
    this._round(c,-14,-40,28,26,[11,11,8,8],body);
    this._line(c,-14,-31,-18,-18+walk*3,skin,6);this._line(c,14,-31,18,-18-walk*3,skin,6);
    if(working&&!moving){
      const keyY=actor.direction==='down'&&!oscar?8:-20,t=this.reducedMotion?0:Math.sin(this.time*(10+variant)+phase)*3;
      this._round(c,-22,keyY-2,44,13,4,'#e7ead9','#acbba1');
      for(let row=0;row<2;row++)for(let col=0;col<7;col++)this._round(c,-17+col*5,keyY+1+row*4,3,2,1,(col+row+Math.floor(this.time*7+phase))%7===0?'#92b29b':'#c2cdb8');
      this._line(c,-13,-31,-10,keyY+t/2,skin,5);this._line(c,13,-31,10,keyY-t/2,skin,5);
      this._ellipse(c,-10,keyY+t/2,4.3,3.1,skin);this._ellipse(c,10,keyY-t/2,4.3,3.1,skin);
    }
    if(variant%4===1&&!oscar){this._ellipse(c,0,-56,16,16,hair);this._ellipse(c,-11,-67,7,7,hair);}
    this._round(c,-4,-45,8,10,3,skin);
    this._ellipse(c,0,-53,14,16,skin);
    if(up){this._ellipse(c,0,-56,14,14,hair);this._ellipse(c,0,-47,12,7,hair);}
    else {
      c.beginPath();c.moveTo(-14,-53);c.bezierCurveTo(-19,-75,10,-77,14,-61);c.bezierCurveTo(13,-60,5,-65,0,-63);c.bezierCurveTo(-7,-60,-9,-63,-12,-53);c.fillStyle=hair;c.fill();
      const dx=side?(left?-3:3):glance?Math.sin(this.time*1.8+phase)*2:0,blink=reacting&&reaction.kind==='wink'||!this.reducedMotion&&Math.floor(this.time*23+hash(actor.id||'oscar')%83)%119<4;
      for(const sx of [-5,5]) {
        if(blink&&(sx===5||!reacting))this._line(c,sx+dx-2,-52,sx+dx+2,-52,'#3b5142',1.7);
        else {this._ellipse(c,sx+dx,-52,2.1,2.7,'#314d3d');this._ellipse(c,sx+dx-.4,-52.8,.65,.8,'#fffaf0');}
      }
      this._ellipse(c,-9+dx,-47,3,1.6,'#d9957e50');this._ellipse(c,9+dx,-47,3,1.6,'#d9957e50');
      if(this.speakingRole===actor.role&&!this.reducedMotion){this._ellipse(c,dx,-42,3.4,1.8+Math.abs(Math.sin(this.time*13))*2,'#98634f');}
      else{c.beginPath();c.moveTo(-3+dx,-43);c.quadraticCurveTo(dx,working?-41.5:-39.7,4+dx,-43);c.strokeStyle='#98634f';c.lineWidth=1.5;c.lineCap='round';c.stroke();}
      if((variant%4===0||actor.role==='secretaire')&&!oscar){for(const sx of [-6,6]){c.beginPath();c.ellipse(sx+dx,-52,5,4,0,0,Math.PI*2);c.strokeStyle='#60776a';c.lineWidth=1.65;c.stroke();}this._line(c,-1+dx,-52,1+dx,-52,'#60776a',1.5);}
      if(variant%4===2&&!oscar){c.beginPath();c.moveTo(-11,-44);c.quadraticCurveTo(0,-31,11,-44);c.quadraticCurveTo(0,-38,-11,-44);c.fillStyle=`${hair}85`;c.fill();}
    }
    if(actor.role==='code'&&variant%2===1){this._round(c,-15,-71,30,9,[7,7,2,2],'#829b94');this._round(c,-17,-64,34,3,1.5,'#6e8880');}
    if(actor.role==='design'&&variant%2===1){this._round(c,7,-66,7,3,1.5,'#d5a28f');this._ellipse(c,11,-64,2,2,'#f2ddba');}
    if(oscar){this._round(c,-10,-39,20,9,3,'#c8d9be');this._line(c,-6,-34,5,-28,'#f8ead3',2);this._round(c,-3,-31,6,8,2,'#d6c29b');}
    if(actor.paper){c.save();c.translate(left?-24:20,-26);c.rotate(left?-.15:.12);this._shadow(c,()=>this._round(c,-7,-12,16,24,3,'#fff8ea'),3,1);this._line(c,-3,-6,5,-6,'#a2b7a0',1.4);this._line(c,-3,-1,4,-1,'#bbc9b0',1.4);c.restore();}
    if(actor.mug){const mx=left?-23:21;this._round(c,mx-6,-26,12,14,5,oscar?'#d5b187':info.shirt);this._ellipse(c,mx,-26,5,2,'#f5e8d3');c.beginPath();c.arc(mx+6,-20,4,-Math.PI/2,Math.PI/2);c.strokeStyle=info.shirt;c.lineWidth=3;c.stroke();}
    if(reacting&&reaction.kind==='wave'){const wave=this.reducedMotion?0:Math.sin((this.time-reaction.start)*13)*2;this._line(c,12,-31,23,-45,info.shirt,6);this._line(c,23,-45,22+wave,-55,skin,5);this._ellipse(c,22+wave,-57,3.5,4,skin);}
    if(actor.state==='chat'&&!this.reducedMotion&&Math.floor(this.time*2+variant)%8===0)this._heart(c,27,-68,P.coral);
    if(actor.state==='coffee'&&!this.reducedMotion){c.beginPath();c.moveTo(22,-31);c.bezierCurveTo(15,-37,28,-39,22,-44);c.strokeStyle='#fff9ea90';c.lineWidth=1.7;c.stroke();}
    c.restore();
    if(!oscar) {
      const name=clipped(actor.name||info.name,15);c.font='550 13px -apple-system, sans-serif';const width=c.measureText(name).width+18;
      this._round(c,x-width/2,actor.y+9,width,22,11,'#fffaf0eb');this._text(c,name,x,actor.y+24,'#5d745f',13,'center',550);
    }
  }
  _heart(c,x,y,color) {
    c.save();c.translate(x,y);c.beginPath();c.moveTo(0,3);c.bezierCurveTo(-12,-6,-8,-14,0,-8);c.bezierCurveTo(8,-14,12,-6,0,3);c.fillStyle=color;c.fill();c.restore();
  }
  _bubbleDraw(c,text,x,y,accent=P.green,layout=null) {
    if(!text)return;const str=clipped(translate(text),39);c.font='500 13px -apple-system, BlinkMacSystemFont, sans-serif';
    const width=layout?.w??Math.min(300,c.measureText(str).width+26),bx=layout?.x??Math.max(48,Math.min(W-width-48,x-width/2)),by=layout?.y??Math.max(45,y);
    this._shadow(c,()=>this._round(c,bx,by,width,34,13,'#fffdf5'),10,4);
    const pin=Math.max(bx+13,Math.min(bx+width-13,x));
    c.beginPath();c.moveTo(pin-5,by+32);c.quadraticCurveTo(pin,by+45,pin+7,by+32);c.fillStyle='#fffdf5';c.fill();
    this._ellipse(c,bx+10,by+17,2.5,2.5,accent);this._text(c,str,bx+20,by+22,'#627563',13);
  }
  _drawBubbles(c,live) {
    const clicked=this._lastClickedBubble?.until>this.time?this._lastClickedBubble.key:null;
    const focused=live.find(a=>a.key===clicked)||this.oscar;
    const candidates=[];
    for(const a of live) if(this.time<a.bubbleUntil) candidates.push({
      id:a.key,kind:clicked===a.key?'reaction':'ambient',priority:clicked===a.key?0:2,
      text:a.bubble,x:a.x,y:a.y-126,accent:ROLES[a.role].shirt,
      distance:distance(a,focused)
    });
    if(this.time<this._oscarBubbleUntil||!this.mission)candidates.push({id:'oscar',kind:clicked==='oscar'?'reaction':'oscar',priority:clicked==='oscar'?0:1,text:!this.mission&&this.time>=this._oscarBubbleUntil?'Explique-moi ce que tu veux faire':this._oscarBubble,x:this.oscar.x,y:this.oscar.y-126,accent:P.green,distance:0});
    if(this._propBubble&&this.time<this._propBubble.until)candidates.push({id:'prop',kind:'prop',priority:.5,text:this._propBubble.text,x:this._propBubble.x,y:this._propBubble.y,accent:P.coral,distance:0});
    candidates.sort((a,b)=>a.priority-b.priority||a.distance-b.distance);
    // Speech should never hide a face, a name, another speech bubble, or the studio title.
    const bodies=[{x:this.oscar.x-34,y:this.oscar.y-90,w:69,h:122},...live.map(a=>({x:a.x-28,y:a.y-85,w:56,h:118})),{x:600,y:24,w:240,h:28}];
    const placed=[];
    const overlaps=(a,b,pad=7)=>a.x<b.x+b.w+pad&&a.x+a.w+pad>b.x&&a.y<b.y+b.h+pad&&a.y+a.h+pad>b.y;
    c.font='500 13px -apple-system, BlinkMacSystemFont, sans-serif';
    for(const candidate of candidates) {
      if(placed.length>=3)break;
      const width=Math.min(300,c.measureText(clipped(translate(candidate.text),39)).width+26);
      let box=null;
      const positions=[];
      for(const dy of [0,-45,-90,-140])for(const dx of [0,-width*.6,width*.6])positions.push({x:Math.max(48,Math.min(W-width-48,candidate.x-width/2+dx)),y:Math.max(56,candidate.y+dy),w:width,h:45});
      // Keep ordinary speech near its owner; only the clicked person gets a fallback.
      if(candidate.priority===0)for(const y of [58,107,156])for(const x of [candidate.x,205,1230])positions.push({x:Math.max(48,Math.min(W-width-48,x-width/2)),y,w:width,h:45});
      for(const pos of positions) {
        if(pos.y+pos.h>H-35||bodies.some(body=>overlaps(pos,body,3))||placed.some(other=>overlaps(pos,other)))continue;
        box=pos;break;
      }
      if(!box)continue;
      this._bubbleDraw(c,candidate.text,candidate.x,box.y,candidate.accent,box);
      placed.push({...box,id:candidate.id,kind:candidate.kind});
    }
    this._visibleBubbles=placed.map(({id,kind,x,y,w,h})=>({id,kind,x,y,w,h}));
  }
  _drawPropFeedback(c) {
    this._companion(c,this.time<this.props.catUntil);
    if(this._lastInteraction?.kind==='plant'&&this.time-this._lastInteraction.at<2.8)this._heart(c,this._propBubble?.x||94,344,P.coral);
    if(this._hoveredProp){const p=this._hoveredProp;this._round(c,p.x-4,p.y-4,p.w+8,p.h+8,12,null,'#a5ba8a75');}
  }
  _draw() {
    if(this._destroyed)return;
    const c=this.ctx,v=this.viewport;c.setTransform(1,0,0,1,0,0);c.clearRect(0,0,this.canvas.width,this.canvas.height);
    c.setTransform(v.dpr,0,0,v.dpr,0,0);c.imageSmoothingEnabled=true;this._drawViewportBackdrop(c);
    c.translate(v.offsetX,v.offsetY);c.scale(v.scale,v.scale);
    this._drawWindows(c);this._drawSunShadows(c);this._drawAtmosphere(c);c.drawImage(this._background,0,0,W,H);
    const open=this._doorOpen;
    if(open>.01){this._round(c,80,85,67,136,7,'#5d746c');this._round(c,83,88,Math.max(6,61*(1-open)),128,5,'#91afa0');}
    this._drawClock(c);this._drawCoffeeSteam(c);this._drawSecretary(c);
    const live=[...this.agents.values()].filter(a=>a.visible);
    for(const a of live)if(a.slot>=0)this._screen(c,DESKS[a.slot],a.state==='working');
    const oscar={...this.oscar,state:this.oscar.path.length?'entering':this.oscarState,paper:this.oscarState==='reviewing',mug:this.oscarState==='idle'&&Math.floor(this.time/13)%3===1,roleIndex:0};
    if(this.oscar.y<290)this._sprite(c,oscar,true);this._oscarDesk(c,true);
    const ordered=[...live,...(this.oscar.y>=290?[oscar]:[])].sort((a,b)=>a.y-b.y||a.x-b.x);for(const a of ordered)this._sprite(c,a,a.role==='oscar');
    for(const a of live) {
      if(a.state==='working'&&!this.reducedMotion&&Math.floor(this.time*2+a.slot)%5===0){this._ellipse(c,a.x+26,a.y-57,2,2,P.gold);this._ellipse(c,a.x+31,a.y-63,1.5,1.5,P.gold);}
      if(a.task.status==='approved'&&['resting','coffee','chat'].includes(a.state)){this._ellipse(c,a.x+20,a.y-39,5,5,'#e3edd8');this._line(c,a.x+18,a.y-39,a.x+20,a.y-37,'#81a477',1.5);this._line(c,a.x+20,a.y-37,a.x+23,a.y-42,'#81a477',1.5);}
    }
    this._drawLamps(c);this._drawPropFeedback(c);
    this._drawBubbles(c,live);
    const count=live.filter(a=>!a.retiring&&a.missionId===this.missionId).length;
    this._round(c,865,214,177,27,13,'#fffaf0e8');this._ellipse(c,879,228,3,3,this.mission?.provider==='demo'?'#c9a878':'#93b291');
    this._text(c,this.mission?.provider==='demo'?`Démonstration · ${count} talents`:`${count} talent${count>1?'s':''} · 20 places`,891,232,'#667a62',11);
    if(this._manualPaused){this._shadow(c,()=>this._round(c,575,367,290,63,20,'#fffdf4f5'),18,6);this._round(c,600,387,5,22,2,P.green);this._round(c,610,387,5,22,2,P.green);this._text(c,'Le bureau prend une pause',630,404,P.green,15);}
    this.frame++;
  }
}
