/* Original miniature pixel atelier. Animations follow task state; they never alter a mission. */
const W = 576, H = 352, TILE = 16, COLS = W / TILE, ROWS = H / TILE;
const P = {
  ink:'#202c45', navy:'#293b58', blue:'#53758d', wall:'#658c9b', lightwall:'#91afb3',
  floor:'#d8c595', tile:'#d0ba88', seam:'#baa47a', cream:'#fff0c5', white:'#fff8df',
  wood:'#b87d57', woodLight:'#dbac71', woodDark:'#805e48', coral:'#df8277',
  mint:'#99c9ae', green:'#5e9b88', darkgreen:'#42796e', gold:'#edc879',
  screen:'#a4d5bd', glass:'#8cbcc9', sky:'#b9dfd5', leaf:'#699c85', shadow:'#796d5c'
};
const ROLES = {
  recherche:{name:'Lina',label:'Recherche',shirt:P.coral,hair:'#754d45',skin:'#f1bd90'},
  redaction:{name:'Noé',label:'Rédaction',shirt:P.blue,hair:'#594c4c',skin:'#d6a077'},
  code:{name:'Sam',label:'Développement',shirt:P.gold,hair:P.ink,skin:'#e6b08b'},
  design:{name:'Alma',label:'Design',shirt:P.mint,hair:'#9d6651',skin:'#f1c19b'},
  analyse:{name:'Jules',label:'Analyse',shirt:'#b4a8cf',hair:'#68594c',skin:'#be8e70'},
  oscar:{name:'Oscar',label:'Chef d’équipe',shirt:P.green,hair:'#73594b',skin:'#efbd91'}
};
const DESKS = Array.from({length:8},(_,i)=>({
  id:i, x:i < 4 ? 112 : 408, y:104 + (i % 4)*48,
  stand:{x:i < 4 ? 136 : 440,y:136 + (i % 4)*48}
}));
const DOOR = {x:56,y:56};
const RECEPTION = {x:88,y:88};
const REVIEW = {x:296,y:104};
const REVIEW_WAIT = [{x:248,y:136},{x:328,y:136},{x:232,y:152},{x:344,y:152},{x:264,y:168},{x:312,y:168},{x:216,y:184},{x:360,y:184}];
const COFFEE = [{x:88,y:312},{x:104,y:312},{x:88,y:328},{x:104,y:328}];
const CHAT = [{x:216,y:312},{x:232,y:328},{x:312,y:328},{x:328,y:312},{x:232,y:296},{x:312,y:296},{x:264,y:280},{x:296,y:280}];
const BUSY_TASKS = new Set(['working','revising']);
const EXIT_TASKS = new Set(['failed','cancelled']);
const TRAVEL_STATES = new Set(['entering','to_desk','to_oscar','to_review_queue','to_review_wait','to_coffee','to_chat','returning','leaving']);
const LAMPS = [{x:174,y:38},{x:294,y:35},{x:438,y:38}];
const HOTSPOTS = [
  {kind:'coffee',label:'Machine à café',x:30,y:259,w:50,h:50},
  {kind:'window',label:'Fenêtre de gauche',x:94,y:29,w:68,h:34},
  {kind:'window',label:'Fenêtre de droite',x:462,y:29,w:68,h:34},
  {kind:'clock',label:'Horloge',x:329,y:28,w:25,h:28},
  ...LAMPS.map((p,index)=>({kind:'lights',label:`Lampe ${index+1}`,index,x:p.x-12,y:p.y-11,w:24,h:22})),
  {kind:'door',label:'Porte d’entrée',x:36,y:30,w:40,h:40},
  {kind:'plant',label:'Plante de gauche',x:21,y:124,w:25,h:40},
  {kind:'plant',label:'Plante de droite',x:527,y:124,w:25,h:40},
  {kind:'cat',label:'Petit chat sur l’étagère',x:518,y:198,w:20,h:18}
];
const OBSTACLES = [
  ...DESKS.map(d=>({x:d.x,y:d.y,w:56,h:24})),
  {x:256,y:64,w:72,h:32},
  {x:32,y:280,w:48,h:32},
  {x:248,y:296,w:48,h:24},
  {x:24,y:136,w:24,h:24},
  {x:528,y:136,w:24,h:24},
  {x:520,y:296,w:24,h:32}
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

export class PixelWorld {
  constructor(canvas,{onSelect=()=>{},onStatus=()=>{},onEvent=()=>{},onInteract=()=>{}}={}) {
    if(!canvas?.getContext) throw new Error('Un canvas est nécessaire pour ouvrir l’atelier.');
    this.canvas=canvas;this.ctx=canvas.getContext('2d');
    if(!this.ctx) throw new Error('Le dessin de l’atelier est indisponible dans ce navigateur.');
    canvas.width=W;canvas.height=H;
    this.ctx.imageSmoothingEnabled=false;
    this.onSelect=onSelect;this.onStatus=onStatus;this.onEvent=onEvent;this.onInteract=onInteract;
    this.mission=null;this.missionId=null;this.agents=new Map();
    this.frame=0;this.time=0;this.oscarState='idle';this._oscarBubble='Une idée ?';this._oscarBubbleUntil=4;
    this._reviewOwner=null;this._raf=null;this._lastTick=null;this._lastPaint=0;
    this._manualPaused=false;this._destroyed=false;this._doorOpen=0;this._statusMemo='';this._lastCompleted=null;
    this.props={windowMode:'day',lights:[true,true,true],coffeeUntil:0,clockUntil:0,doorUntil:0,catUntil:0};
    this._propBubble=null;this._hoveredProp=null;this._reactions=new Map();this._clickCounts=new Map();this._selectionTimer=null;
    this._lastInteraction=null;
    this._media=window.matchMedia?.('(prefers-reduced-motion: reduce)');
    this.reducedMotion=!!this._media?.matches;
    this._onMotion=()=>{this.reducedMotion=!!this._media?.matches;this._lastTick=null;this._draw();};
    this._onVisibility=()=>{this._lastTick=null;this._schedule();};
    this._onClick=e=>this._select(e);
    this._onKey=e=>{if(e.key==='Enter'||e.key===' ') {e.preventDefault();this._selectActor({role:'oscar',id:null});}};
    this._onPointer=e=>this._pointer(e);
    this._onLeave=()=>{this.canvas.style.cursor='';this._hoveredProp=null;this._draw();};
    document.addEventListener('visibilitychange',this._onVisibility);
    this._media?.addEventListener?.('change',this._onMotion);
    canvas.addEventListener('click',this._onClick);
    canvas.addEventListener('keydown',this._onKey);
    canvas.addEventListener('pointermove',this._onPointer);
    canvas.addEventListener('pointerleave',this._onLeave);
    this._background=this._makeBackground();
    this._tick=this._tick.bind(this);this._draw();this._schedule();
  }

  update(mission) {
    if(this._destroyed) return;
    const nextId=mission?.id??null;
    if(nextId!==this.missionId) {
      for(const a of this.agents.values()) a.retiring=true;
      this._reviewOwner=null;this.missionId=nextId;
      this._oscarBubble=mission?'Bienvenue, l’équipe !':'L’atelier est ouvert.';
      this._oscarBubbleUntil=this.time+3.5;
      this._lastCompleted=null;
    }
    this.mission=mission||null;
    if(mission) {
      const tasks=Array.isArray(mission.tasks)?mission.tasks:[];
      const keys=new Set();
      tasks.forEach((task,index)=>{
        if(!task?.id) return;
        const key=`${nextId}:${task.id}`;keys.add(key);
        let a=this.agents.get(key);
        if(!a) {
          if(['failed','cancelled'].includes(mission.status)||EXIT_TASKS.has(task.status)) return;
          const random=seeded(hash(key));
          a={key,id:task.id,missionId:nextId,role:roleKey(task.role),task,index,slot:-1,
            x:DOOR.x,y:DOOR.y,direction:'down',walkFrame:0,state:'waiting_entry',visible:false,
            target:null,path:[],afterTravel:null,deadline:0,hireAt:this.time+index*.7,
            workSince:0,handoffAttempt:0,handoffAttempts:new Set(),paper:false,mug:false,
            retiring:false,random,bubble:'',bubbleUntil:0,visited:[],speed:43+random()*10,
            nextIdleAt:0,reviewRequestedAt:0,lastAttempt:taskAttempt(task)};
          this.agents.set(key,a);
        } else {
          const wasRetiring=a.retiring||a.state==='leaving';
          a.task=task;a.index=index;
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
    let text='',bubble='',x=292,y=180;
    if(kind==='coffee') {
      this.props.coffeeUntil=this.time+4.2;x=69;y=236;bubble='PSSHH ! +1 idée, 0 café réel.';
      text='Psshh ! Un café pixelisé. Zéro caféine, mais une excellente ambiance.';
      const idle=[...this.agents.values()].filter(a=>a.visible&&!a.retiring&&a.task.status==='approved'&&['resting','coffee','chat'].includes(a.state));
      for(const a of idle.slice(0,2)) this._bubble(a,a.state==='coffee'?'Mon abonnement préféré.':'Il en reste pour moi ?',3);
      if(!idle.length&&this.oscarState==='idle') {this._oscarBubble='Je supervise la mousse.';this._oscarBubbleUntil=this.time+3;}
    } else if(kind==='window') {
      const modes=['day','sunset','night'];this.props.windowMode=modes[(modes.indexOf(this.props.windowMode)+1)%modes.length];
      x=493;y=74;
      const lines={
        day:['Grand jour, grandes idées.','Les fenêtres passent au grand jour. Les idées ont leur vitamine D.'],
        sunset:['Le soleil rend son rapport.','Coucher de soleil : même le soleil vient de rendre son rapport.'],
        night:['Les pixels font leur nuit.','La nuit tombe sur le bureau. Les lampes gardent les idées au chaud.']
      };
      [bubble,text]=lines[this.props.windowMode];
    } else if(kind==='clock') {
      this.props.clockUntil=this.time+2.2;x=342;y=69;
      const hour=new Date().toLocaleTimeString('fr-BE',{hour:'2-digit',minute:'2-digit'});
      bubble=`${hour} · La deadline fait coucou.`;
      text=`Il est ${hour}. L’horloge court deux secondes pour impressionner la deadline. La deadline reste imperturbable.`;
    } else if(kind==='lights') {
      const lampIndex=Number.isInteger(index)&&index>=0&&index<LAMPS.length?index:null;
      if(lampIndex!==null) this.props.lights[lampIndex]=!this.props.lights[lampIndex];
      else {const on=!this.props.lights.every(Boolean);this.props.lights=this.props.lights.map(()=>on);}
      const count=this.props.lights.filter(Boolean).length;
      x=lampIndex!==null?LAMPS[lampIndex].x:294;y=88;
      bubble=count===0?'Mode idées lumineuses.':`${count}/3 lampes. Ambiance validée.`;
      text=count===0?'Toutes les lampes sont éteintes. Oscar compte sur les idées lumineuses.':`${count} lampe${count>1?'s':''} allumée${count>1?'s':''}. L’ambiance vient de passer la validation d’Oscar.`;
    } else if(kind==='door') {
      this.props.doorUntil=this.time+2.8;x=77;y=91;bubble='Toc toc. Juste le courant d’air.';
      text='Toc toc ! Seulement le courant d’air. Les spécialistes arrivent quand le plan a besoin d’eux.';
    } else if(kind==='plant') {
      x=this._hoveredProp?.x?this._hoveredProp.x+12:35;y=104;bubble='Je fais pousser les idées.';
      text='La plante demande un peu d’eau et zéro réunion. Elle fait déjà pousser les idées.';
    } else if(kind==='cat') {
      this.props.catUntil=this.time+2.7;x=526;y=171;bubble='Miaou. J’approuve cette sieste.';
      text='Miaou ! Le petit chat de l’étagère est responsable qualité des siestes. Son rapport : ronron.';
    } else return null;
    this._propBubble={text:bubble,x,y,until:this.time+3.6};
    this._lastInteraction={kind,text,at:this.time};
    this._sayStatus(text);this.onInteract(kind,text);this.onEvent('interact',{kind,missionId:this.missionId});
    this._draw();return {kind,text};
  }

  snapshot() {
    return {
      missionId:this.missionId,frame:this.frame,time:Math.round(this.time*100)/100,
      paused:this._manualPaused||document.hidden,reducedMotion:this.reducedMotion,oscarState:this.oscarState,
      doorOpen:this._doorOpen,reviewOwner:this._reviewOwner,
      props:{windowMode:this.props.windowMode,lights:[...this.props.lights],coffeeSteam:this.time<this.props.coffeeUntil,
        clockGag:this.time<this.props.clockUntil,clockTime:new Date().toLocaleTimeString('fr-BE',{hour:'2-digit',minute:'2-digit'}),
        hotspots:HOTSPOTS.map(p=>({...p})),lastInteraction:this._lastInteraction?{...this._lastInteraction}:null},
      agents:[...this.agents.values()].map(a=>({
        id:a.id,missionId:a.missionId,role:a.role,name:ROLES[a.role].name,state:a.state,
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
    this._raf=null;
    document.removeEventListener('visibilitychange',this._onVisibility);
    this._media?.removeEventListener?.('change',this._onMotion);
    this.canvas.removeEventListener('click',this._onClick);
    this.canvas.removeEventListener('keydown',this._onKey);
    this.canvas.removeEventListener('pointermove',this._onPointer);
    this.canvas.removeEventListener('pointerleave',this._onLeave);
    this.canvas.style.cursor='';
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
      this._updateOscar();
      const nearDoor=this.time<this.props.doorUntil||[...this.agents.values()].some(a=>a.visible&&a.x<88&&a.y<91);
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
    const free=DESKS.find(d=>!occupied.has(d.id));
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
      this._bubble(a,`Salut, moi c’est ${ROLES[a.role].name} !`,2);
      this._oscarBubble=`Bienvenue ${ROLES[a.role].name} !`;this._oscarBubbleUntil=this.time+1.6;
      this._event('hire',a);
    } else if(state==='working') {
      a.direction='up';a.workSince=this.time;a.paper=false;a.mug=false;
      if(a.task.status==='queued') this._visit(a,'waiting_task');
      else this._bubble(a,a.task.status==='revising'?'Je corrige le détail.':'À moi de jouer !',2);
    } else if(state==='handoff') {
      a.direction='up';a.deadline=this.time+1.35;
      a.handoffAttempt=taskAttempt(a.task);a.handoffAttempts.add(a.handoffAttempt);
      this._bubble(a,'À toi de vérifier !',1.6);
      this._oscarBubble='Voyons ça…';this._oscarBubbleUntil=this.time+2;
      this._sayStatus(`${ROLES[a.role].name} remet son résultat à Oscar pour validation.`);
      this._event('handoff',a);
    } else if(state==='review_queue') {a.direction=a.x<REVIEW.x?'right':'left';this._bubble(a,'Mon dossier est prêt.');}
    else if(state==='waiting_review') {a.direction='up';a.paper=false;this._bubble(a,'J’attends le retour.');}
    else if(state==='coffee') {a.direction='left';a.mug=true;a.deadline=this.time+2.5+a.random()*2;this._bubble(a,'Un café bien mérité !');this._event('coffee',a);}
    else if(state==='chat') {
      a.direction=a.x<272?'right':'left';a.mug=a.random()>.45;a.deadline=this.time+3+a.random()*3;
      const other=[...this.agents.values()].find(b=>b!==a&&b.state==='chat'&&b.task.status==='approved');
      this._bubble(a,other?['Joli travail !','Et ta prochaine idée ?','Bien joué, l’équipe !'][Math.floor(a.random()*3)]:'On se retrouve ici ?',3.6);
      if(other) this._bubble(other,['Merci !','On forme une belle équipe.','Je suis partant !'][Math.floor(a.random()*3)],3.2);
      this._event('chat',a);
    } else if(state==='resting') {a.direction='down';a.mug=false;a.nextIdleAt=this.time+6+a.random()*14;}
    else if(state==='gone') {a.visible=false;this._releaseReview(a);this.agents.delete(a.key);this._event('exit',a);}
  }

  _stepAgent(a,dt) {
    const activeMission=a.missionId===this.missionId;
    const exit=a.retiring||EXIT_TASKS.has(a.task.status)||(activeMission&&['failed','cancelled'].includes(this.mission?.status));
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
      if(['reviewing','approved'].includes(a.task.status)&&this.time-a.workSince>.65) {
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
    if(a.state==='handoff'&&this.time>=a.deadline) {
      this._releaseReview(a);a.paper=false;
      if(a.task.status==='approved') this._startCoffee(a);
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
    if(x===3&&y>=2&&y<=4) return true;
    if(x<1||x>=COLS-1||y<4||y>=ROWS-1) return false;
    const p=center(x,y);
    return !OBSTACLES.some(b=>p.x>=b.x&&p.x<b.x+b.w&&p.y>=b.y&&p.y<b.y+b.h);
  }
  _nearest(point) {
    const start=cell(point);
    if(this._walkable(start.x,start.y)) return start;
    for(let r=1;r<12;r++) for(let y=start.y-r;y<=start.y+r;y++) for(let x=start.x-r;x<=start.x+r;x++) if(this._walkable(x,y)) return {x,y};
    return {x:3,y:4};
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
  _updateOscar() {
    const live=[...this.agents.values()].filter(a=>a.visible&&!a.retiring);
    if(live.some(a=>a.state==='handoff')||this.mission?.tasks?.some(t=>t.status==='reviewing')) this.oscarState='reviewing';
    else if(this.mission?.status==='planning') this.oscarState='planning';
    else if(this.mission?.status==='completed'&&this.time<this._oscarBubbleUntil) this.oscarState='celebrating';
    else if(['running','reviewing'].includes(this.mission?.status)) this.oscarState='coordinating';
    else this.oscarState='idle';
  }

  _coordinates(event) {
    const r=this.canvas.getBoundingClientRect();
    return {x:(event.clientX-r.left)*W/r.width,y:(event.clientY-r.top)*H/r.height};
  }
  _hit(p) {
    const agents=[...this.agents.values()].filter(a=>a.visible).sort((a,b)=>b.y-a.y);
    for(const a of agents) if(Math.abs(p.x-a.x)<12&&p.y>a.y-25&&p.y<a.y+7) return a;
    if(p.x>268&&p.x<318&&p.y>44&&p.y<98) return {role:'oscar',id:null};
    return null;
  }
  _hitProp(p) {return HOTSPOTS.find(h=>p.x>=h.x&&p.x<h.x+h.w&&p.y>=h.y&&p.y<h.y+h.h)||null;}
  _selectActor(a) {
    const info=ROLES[a.role],key=a.key||'oscar';
    const n=this._clickCounts.get(key)||0;this._clickCounts.set(key,n+1);
    let text;
    if(a.role==='oscar') text=this.oscarState==='reviewing'?'Je lis. La tasse attend.':this.oscarState==='planning'?'Une idée, puis un plan.':this.oscarState==='coordinating'?'Je coordonne, même les pixels.':['Chef d’équipe. Et de cafetière.','Mon superpouvoir ? Déléguer.','Les bonnes idées ont une place.'][n%3];
    else if(a.state==='leaving') text='Je rends les clés et la tasse.';
    else if(a.task?.status==='queued') text='Prêt ! J’attends le brief.';
    else if(a.task?.status==='reviewing') text='Oscar lit. Je retiens ma tasse.';
    else if(['revising','needs_review'].includes(a.task?.status)) text='Je corrige. Le café attendra.';
    else if(a.task?.status==='approved') text=['Validé ! Mon café aussi.','Mission validée. Sourire aussi.','Le vrai livrable ? L’équipe.'][n%3];
    else text={recherche:'Je cherche, pas la cafetière.',redaction:'Les mots sont bien alignés.',code:'Ça compile dans ma tête.',design:'Encore un pixel et j’y suis.',analyse:'J’ai compté tous les pixels.'}[a.role]||'Toujours sur la mission !';
    const reaction={kind:['wave','jump','wink'][n%3],start:this.time,until:this.time+1.5};
    this._reactions.set(key,reaction);
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
    if(prop!==this._hoveredProp) {this._hoveredProp=prop;if(this._manualPaused) this._draw();}
  }

  _makeBackground() {
    const canvas=document.createElement('canvas');canvas.width=W;canvas.height=H;
    const c=canvas.getContext('2d');c.imageSmoothingEnabled=false;
    const rect=(x,y,w,h,color)=>{c.fillStyle=color;c.fillRect(x,y,w,h);};
    rect(0,0,W,H,P.ink);rect(8,20,560,324,P.navy);rect(16,24,544,312,P.floor);
    for(let row=4;row<21;row++) for(let col=1;col<35;col++) {
      const x=col*16,y=row*16;rect(x,y,16,16,(row+col)%2?P.floor:P.tile);
      rect(x,y+15,16,1,P.seam);rect(x+15,y,1,16,P.seam);
      if((row*13+col*7)%19===0) rect(x+4,y+5,2,1,'#e5d4a9');
    }
    rect(16,24,544,40,P.wall);rect(16,24,544,4,P.lightwall);rect(16,61,544,4,P.navy);
    rect(16,65,544,3,P.woodDark);rect(8,24,8,320,P.navy);rect(560,24,8,320,P.navy);
    rect(16,336,544,4,P.woodDark);rect(16,340,544,4,P.ink);
    // Entry, deliberately legible as an actual doorway.
    rect(36,29,40,39,P.ink);rect(40,33,32,35,P.woodDark);rect(44,37,24,31,P.navy);
    rect(36,66,40,4,P.woodLight);rect(40,72,32,13,P.coral);rect(44,76,24,1,P.gold);rect(44,80,24,1,P.gold);
    this._text(c,'ENTRÉE',39,27,P.cream,6);
    // Windows and pinboards.
    for(const x of [96,464]) {
      rect(x,31,64,28,P.ink);rect(x+3,34,58,22,P.woodLight);rect(x+5,36,54,18,P.sky);
      rect(x+7,47,50,7,P.mint);rect(x+28,34,4,22,P.cream);rect(x+3,43,58,3,P.cream);
      rect(x-2,58,68,4,P.woodLight);rect(x+43,38,5,5,P.gold);
    }
    rect(186,31,43,27,P.woodDark);rect(189,34,37,21,P.woodLight);
    [[193,37,P.cream],[206,40,P.coral],[216,36,P.mint]].forEach(([x,y,color])=>{rect(x,y,7,10,color);rect(x+3,y,1,2,P.ink);});
    rect(354,30,59,28,P.ink);rect(357,33,53,22,P.darkgreen);
    this._text(c,'OSCAR',364,43,P.cream,7);this._text(c,'& L’ÉQUIPE',360,51,P.mint,6);
    this._plant(c,34,153);this._plant(c,540,153);this._plant(c,532,318);
    // A warm rug gives the social space its own corner.
    rect(192,288,160,43,P.blue);rect(196,292,152,35,P.lightwall);
    rect(200,296,144,27,P.blue);rect(202,298,140,23,'#7596a0');
    rect(28,312,84,20,P.coral);rect(32,315,76,2,P.gold);rect(32,327,76,2,P.gold);
    this._coffeeCorner(c);
    // Coffee table, stools, and a tiny stack of shared ideas.
    rect(246,296,52,24,P.ink);rect(248,296,48,20,P.woodDark);rect(248,296,48,16,P.woodLight);
    rect(253,299,12,10,P.cream);rect(256,302,7,1,P.blue);rect(256,305,6,1,P.blue);
    rect(281,300,7,7,P.green);rect(283,298,3,2,P.mint);
    for(const [x,y] of [[225,304],[312,304],[256,328],[288,328]]) {rect(x-6,y-5,12,7,P.ink);rect(x-5,y-5,10,5,P.coral);rect(x-4,y+2,2,3,P.woodDark);rect(x+3,y+2,2,3,P.woodDark);}
    this._text(c,'PAUSE & IDÉES',237,340,P.navy,6);
    this._text(c,'CAFÉ',37,278,P.navy,6);
    // A record shelf and little mascot cat sculpture; no extra agent is invented.
    rect(486,216,56,8,P.ink);rect(488,216,52,5,P.woodLight);
    rect(491,204,5,12,P.coral);rect(498,201,5,15,P.gold);rect(505,206,5,10,P.mint);
    rect(523,205,10,9,P.navy);rect(523,202,3,4,P.navy);rect(530,202,3,4,P.navy);
    rect(525,207,1,1,P.gold);rect(530,207,1,1,P.gold);
    for(const desk of DESKS) this._desk(c,desk,false);
    this._desk(c,{x:256,y:68,id:-1},true);
    return canvas;
  }

  _desk(c,d,oscar=false) {
    const x=d.x,y=d.y,w=oscar?72:56;
    const r=(a,b,ww,hh,color)=>{c.fillStyle=color;c.fillRect(a,b,ww,hh);};
    r(x+3,y+18,w-1,7,'#887858');r(x,y,w,23,P.ink);r(x+2,y,w-4,17,P.woodLight);r(x+2,y+17,w-4,4,P.woodDark);
    r(x+4,y+22,4,5,P.woodDark);r(x+w-8,y+22,4,5,P.woodDark);
    r(x+17,y-9,24,16,P.ink);r(x+19,y-7,20,11,oscar?P.mint:P.blue);r(x+26,y+7,6,3,P.navy);
    r(x+19,y+12,19,4,P.cream);r(x+21,y+13,2,1,P.blue);r(x+25,y+13,2,1,P.blue);r(x+29,y+13,2,1,P.blue);
    r(x+5,y+5,8,7,P.cream);r(x+6,y+7,5,1,P.coral);r(x+w-11,y+7,5,6,P.coral);r(x+w-6,y+8,2,3,P.cream);
    if(oscar) {r(x+w-21,y-2,14,8,P.cream);this._text(c,'O',x+w-17,y+4,P.navy,6);}
    else this._text(c,String(d.id+1).padStart(2,'0'),x+w-14,y+19,P.cream,5);
  }

  _coffeeCorner(c) {
    const r=(x,y,w,h,color)=>{c.fillStyle=color;c.fillRect(x,y,w,h);};
    r(30,282,52,28,P.ink);r(32,284,48,22,P.woodDark);r(32,284,48,5,P.woodLight);
    r(34,266,26,19,P.ink);r(36,268,22,15,P.blue);r(38,269,18,4,P.cream);
    r(40,275,14,9,P.navy);r(44,276,6,2,P.gold);r(44,280,5,5,P.cream);r(49,281,2,2,P.cream);
    r(64,278,5,7,P.cream);r(70,278,5,7,P.coral);r(66,275,7,2,P.woodLight);
    r(36,292,16,10,P.woodLight);r(58,292,16,10,P.woodLight);r(49,296,1,2,P.navy);r(60,296,1,2,P.navy);
  }

  _plant(c,x,y) {
    const r=(a,b,w,h,color)=>{c.fillStyle=color;c.fillRect(a,b,w,h);};
    r(x-8,y-3,17,6,P.ink);r(x-6,y+3,13,7,P.woodDark);r(x-5,y+3,11,4,P.coral);
    r(x-1,y-22,3,20,P.darkgreen);r(x-10,y-16,10,5,P.green);r(x-7,y-12,7,5,P.leaf);r(x+1,y-21,9,6,P.green);r(x+3,y-24,6,5,P.mint);r(x-7,y-27,6,8,P.leaf);
  }

  _drawWindows(c) {
    const r=(x,y,w,h,color)=>{c.fillStyle=color;c.fillRect(x,y,w,h);};
    const mode=this.props.windowMode;
    for(const [i,x] of [96,464].entries()) {
      r(x,31,64,28,P.ink);r(x+3,34,58,22,P.woodLight);
      r(x+5,36,54,18,mode==='night'?P.navy:mode==='sunset'?'#da9294':P.sky);
      if(mode==='night') {
        r(x+7,48,50,6,'#405978');
        for(let n=0;n<6;n++) {const bx=x+8+n*8;r(bx,47-(n%3)*2,5,7+(n%3)*2,P.ink);if(n%2)r(bx+1,49,1,2,P.gold);}
        r(x+41,37,7,7,P.cream);r(x+39,36,6,6,P.navy);
        for(const [sx,sy] of [[12,40],[25,38],[34,43],[52,41]]) {
          const blink=!this.reducedMotion&&Math.floor(this.time+i+sx)%5===0;
          r(x+sx,sy,blink?2:1,1,P.cream);
        }
      } else {
        r(x+7,48,50,6,mode==='sunset'?'#8e8b9b':P.green);
        r(x+14,46,13,3,mode==='sunset'?'#a69d9c':P.mint);
        r(x+(mode==='sunset'?19:43),mode==='sunset'?44:38,mode==='sunset'?9:5,mode==='sunset'?7:5,P.gold);
        const shift=this.reducedMotion?0:Math.floor(this.time*1.2+i*13)%20;
        r(x+8+shift,39,12,3,mode==='sunset'?'#f0c1a4':P.white);r(x+11+shift,37,6,2,mode==='sunset'?'#f0c1a4':P.white);
        if(mode==='day') {const bx=x+8+(this.reducedMotion?9:Math.floor(this.time*3+i*19)%44);r(bx,44,2,1,P.blue);r(bx+3,44,2,1,P.blue);r(bx+2,45,1,1,P.blue);}
      }
      r(x+28,34,4,22,P.cream);r(x+3,43,58,3,P.cream);r(x-2,58,68,4,P.woodLight);
      if(mode==='sunset') {r(x+8,68,54,4,'#f1c07d55');r(x+12,72,58,4,'#f1c07d33');r(x+17,76,62,4,'#f1c07d22');}
    }
  }

  _pixelLine(c,x0,y0,x1,y1,color,width=1) {
    x0=Math.round(x0);y0=Math.round(y0);x1=Math.round(x1);y1=Math.round(y1);
    const dx=Math.abs(x1-x0),sx=x0<x1?1:-1,dy=-Math.abs(y1-y0),sy=y0<y1?1:-1;
    let error=dx+dy;c.fillStyle=color;
    for(let safety=0;safety<100;safety++) {
      c.fillRect(x0,y0,width,width);
      if(x0===x1&&y0===y1) break;
      const e=2*error;if(e>=dy) {error+=dy;x0+=sx;}if(e<=dx) {error+=dx;y0+=sy;}
    }
  }

  _drawClock(c) {
    const x=342,y=42,r=(a,b,w,h,color)=>{c.fillStyle=color;c.fillRect(a,b,w,h);};
    r(x-8,y-12,16,24,P.ink);r(x-12,y-8,24,16,P.ink);r(x-10,y-10,20,20,P.gold);
    r(x-8,y-9,16,18,P.cream);r(x-9,y-7,18,14,P.cream);
    r(x,y-8,1,2,P.navy);r(x+7,y,2,1,P.navy);r(x,y+7,1,2,P.navy);r(x-8,y,2,1,P.navy);
    const date=new Date(),gag=this.time<this.props.clockUntil&&!this.reducedMotion;
    const minute=date.getMinutes()+date.getSeconds()/60;
    const hour=(date.getHours()%12)+minute/60;
    const ma=gag?this.time*21:minute*Math.PI/30,ha=gag?this.time*7:hour*Math.PI/6;
    this._pixelLine(c,x,y,x+Math.sin(ma)*7,y-Math.cos(ma)*7,P.navy);
    this._pixelLine(c,x,y,x+Math.sin(ha)*4,y-Math.cos(ha)*4,P.navy,2);
    if(!this.reducedMotion&&!gag) {const angle=date.getSeconds()*Math.PI/30;this._pixelLine(c,x,y,x+Math.sin(angle)*7,y-Math.cos(angle)*7,P.coral);}
    r(x,y,2,2,P.coral);
    if(gag) {r(x-15,y-9,2,3,P.coral);r(x+14,y+4,2,3,P.gold);}
  }

  _drawLamps(c) {
    for(const [i,lamp] of LAMPS.entries()) {
      const on=this.props.lights[i],r=(x,y,w,h,color)=>{c.fillStyle=color;c.fillRect(x,y,w,h);};
      r(lamp.x-1,25,2,Math.max(1,lamp.y-29),P.ink);
      r(lamp.x-5,lamp.y-8,10,3,P.ink);r(lamp.x-8,lamp.y-5,16,4,P.navy);r(lamp.x-11,lamp.y-1,22,5,P.ink);
      r(lamp.x-9,lamp.y-1,18,3,on?P.gold:P.blue);r(lamp.x-4,lamp.y+4,8,2,on?P.cream:P.navy);
      if(on) {r(lamp.x-6,lamp.y+7,12,1,'#fff0c55a');r(lamp.x-9,lamp.y+9,18,1,'#fff0c530');}
    }
  }

  _drawAtmosphere(c) {
    const count=this.props.lights.filter(Boolean).length;
    const shade=this.props.windowMode==='night'?[.48,.38,.3,.23][count]:this.props.windowMode==='sunset'?[.25,.2,.15,.1][count]:[.16,.11,.065,0][count];
    if(shade) {c.fillStyle=`rgba(25,42,70,${shade})`;c.fillRect(16,64,544,272);}
    for(const [i,lamp] of LAMPS.entries()) if(this.props.lights[i]) {
      for(let y=64;y<320;y+=16) {
        const width=40+Math.floor((y-64)/32)*16;
        c.fillStyle=this.props.windowMode==='night'?'#ffe5a515':'#ffe5a509';
        c.fillRect(Math.round(lamp.x-width/2),y,width,16);
      }
    }
  }

  _drawCoffeeSteam(c) {
    const active=this.time<this.props.coffeeUntil;
    if(!active&&(this.reducedMotion||Math.floor(this.time*2)%5>=2)) return;
    const rise=this.reducedMotion?2:Math.floor(this.time*(active?8:3))%8;
    c.fillStyle=P.cream;
    for(let i=0;i<(active?4:2);i++) {
      const x=39+i*6+(this.reducedMotion?0:(Math.floor(this.time*4+i)%2));
      c.fillRect(x,263-rise-i%2*3,2,3);c.fillRect(x+2,259-rise-i%3*2,1,2);
    }
    if(active) {
      c.fillStyle=P.gold;c.fillRect(46,278,2,5);c.fillStyle=P.cream;c.fillRect(43,284,8,1);
      this._text(c,'PSSHH!',63,262,P.cream,6);
      if(!this.reducedMotion) {c.fillStyle=P.gold;c.fillRect(29,272-Math.floor(this.time*5)%3,2,2);c.fillRect(78,274-Math.floor(this.time*7)%4,1,2);}
    }
  }

  _drawPropFeedback(c) {
    if(this.time<this.props.catUntil) {
      c.fillStyle=P.navy;c.fillRect(524,206,9,3);
      c.fillStyle=P.gold;c.fillRect(525,207,2,1);c.fillRect(530,207,2,1);
      if(!this.reducedMotion) this._heart(c,539,195-Math.floor(this.time*2)%3,P.coral);
    }
    if(this._lastInteraction?.kind==='plant'&&this.time-this._lastInteraction.at<2.8) this._heart(c,this._propBubble?.x||35,119,P.mint);
    const p=this._hoveredProp;
    if(p) {
      c.fillStyle=P.gold;c.fillRect(p.x-2,p.y-2,p.w+4,1);c.fillRect(p.x-2,p.y+p.h+1,p.w+4,1);
      c.fillRect(p.x-2,p.y-2,1,p.h+4);c.fillRect(p.x+p.w+1,p.y-2,1,p.h+4);
    }
  }

  _text(c,text,x,y,color=P.ink,size=7,align='left') {
    c.font=`${size}px monospace`;c.textBaseline='alphabetic';c.textAlign=align;c.fillStyle=color;c.fillText(String(text),Math.round(x),Math.round(y));
  }

  _sprite(c,actor,oscar=false) {
    const reaction=this._reactions.get(actor.key||'oscar');
    const reacting=!!reaction&&reaction.until>this.time;
    const jump=reacting&&reaction.kind==='jump'&&!this.reducedMotion?Math.round(Math.max(0,Math.sin((this.time-reaction.start)*Math.PI*3))*5):0;
    const info=ROLES[actor.role]||ROLES.recherche,x=Math.round(actor.x),baseY=Math.round(actor.y),y=baseY-jump;
    const moving=TRAVEL_STATES.has(actor.state),working=['working','planning','coordinating','reviewing'].includes(actor.state);
    const walk=moving&&!this.reducedMotion?actor.walkFrame:0;
    const bob=working&&!this.reducedMotion&&Math.floor(this.time*3+hash(actor.id||'oscar')%3)%2?1:0;
    const up=actor.direction==='up'&&!reacting,side=['left','right'].includes(actor.direction)&&!reacting,left=actor.direction==='left';
    const r=(xx,yy,w,h,col)=>{c.fillStyle=col;c.fillRect(x+xx,y+yy-bob,w,h);};
    c.fillStyle='#756b6450';c.fillRect(x-7,baseY-1,14,3);c.fillRect(x-5,baseY+2,10,1);
    r(-5,-7,4,7+walk,P.ink);r(2,-7,4,8-walk,P.ink);
    r(-6,-15,13,10,P.ink);r(-5,-14,11,8,info.shirt);
    const armOffset=walk?1:0;
    r(-8,-13+armOffset,3,7,info.skin);r(7,-13-armOffset,3,7,info.skin);
    if(working&&!moving) {const hand=!this.reducedMotion?Math.floor(this.time*6)%2:0;r(-7,-8-hand,3,3,info.skin);r(7,-8+hand,3,3,info.skin);}
    r(-6,-25,13,12,P.ink);r(-5,-24,11,11,info.skin);
    r(-5,-25,11,4,info.hair);r(-6,-23,3,5,info.hair);r(5,-23,2,5,info.hair);
    if(['recherche','design'].includes(actor.role)) {r(-7,-22,3,10,info.hair);r(6,-22,3,10,info.hair);}
    if(up) {r(-5,-22,11,6,info.hair);r(-4,-17,9,2,info.hair);}
    else {
      const blink=reacting&&reaction.kind==='wink'||!this.reducedMotion&&Math.floor(this.time*24+(hash(actor.id||'oscar')%91))%113<3;
      if(side) {r(left?-5:4,-19,2,blink?1:2,P.ink);r(left?-7:6,-17,2,2,info.skin);}
      else {r(-3,-19,2,blink?1:2,P.ink);r(3,-19,2,blink?1:2,P.ink);r(0,-15,2,1,'#b77c64');}
    }
    if(actor.role==='analyse'&&!up) {r(-5,-20,5,4,P.navy);r(2,-20,5,4,P.navy);r(0,-19,2,1,P.navy);r(-4,-19,3,2,P.glass);r(3,-19,3,2,P.glass);}
    if(actor.role==='code') {r(-7,-24,15,3,P.blue);r(-5,-27,10,4,P.blue);}
    if(oscar) {r(-1,-13,3,6,P.gold);r(-1,-8,3,2,P.cream);}
    if(actor.paper) {
      const px=left?-13:9;r(px,-14,8,11,P.ink);r(px+1,-13,6,9,P.cream);r(px+2,-11,4,1,P.blue);r(px+2,-8,4,1,P.blue);
    }
    if(actor.mug) {const px=left?-12:9;r(px,-12,6,7,P.ink);r(px+1,-11,4,5,P.cream);r(px+6,-10,2,3,P.cream);}
    if(reacting&&reaction.kind==='wave') {
      const wave=this.reducedMotion?0:Math.floor((this.time-reaction.start)*9)%2;
      r(8,-16,3,7,info.shirt);r(9+wave,-21-wave,3,6,info.skin);r(9+wave,-24-wave,4,3,info.skin);
      if(!this.reducedMotion) {r(15,-24-wave,1,3,P.gold);r(17,-20+wave,2,1,P.gold);}
    }
    if(actor.state==='coffee'&&!this.reducedMotion) {const s=Math.floor(this.time*3)%3;r(-15,-17-s*2,1,2,P.cream);r(-12,-19-s*2,1,2,P.cream);}
    if(actor.state==='chat'&&!this.reducedMotion&&Math.floor(this.time*2)%6===0) this._heart(c,x+12,y-28,P.coral);
  }

  _heart(c,x,y,color) {
    c.fillStyle=color;c.fillRect(x,y,2,2);c.fillRect(x+3,y,2,2);c.fillRect(x-1,y+1,7,2);c.fillRect(x,y+3,5,2);c.fillRect(x+1,y+5,3,1);c.fillRect(x+2,y+6,1,1);
  }

  _bubbleDraw(c,text,x,y,accent=P.navy) {
    if(!text) return;
    const str=clipped(text,27);c.font='6px monospace';
    const width=Math.min(174,Math.ceil(c.measureText(str).width)+12);
    const bx=Math.max(18,Math.min(W-width-18,Math.round(x-width/2))),by=Math.max(22,Math.round(y));
    c.fillStyle=P.ink;c.fillRect(bx-1,by-1,width+2,16);
    c.fillStyle=P.cream;c.fillRect(bx,by,width,14);
    c.fillStyle=accent;c.fillRect(bx,by,2,14);
    c.fillStyle=P.ink;c.fillRect(Math.round(x)-2,by+14,5,2);c.fillRect(Math.round(x)-1,by+16,3,1);
    c.fillStyle=P.cream;c.fillRect(Math.round(x)-1,by+13,3,2);
    this._text(c,str,bx+6,by+10,P.ink,6);
  }

  _draw() {
    if(this._destroyed) return;
    const c=this.ctx;c.imageSmoothingEnabled=false;c.clearRect(0,0,W,H);c.drawImage(this._background,0,0);
    this._drawWindows(c);
    // The doorway opens only while a real hire or departing specialist is near it.
    const doorWidth=Math.round(24*(1-this._doorOpen));
    c.fillStyle=P.wood;c.fillRect(44,37,doorWidth,29);
    if(doorWidth>5) {c.fillStyle=P.gold;c.fillRect(44+doorWidth-5,51,2,2);c.fillStyle=P.woodDark;c.fillRect(46,39,Math.max(0,doorWidth-4),1);}
    const live=[...this.agents.values()].filter(a=>a.visible);
    for(const a of live) if(a.slot>=0) {
      const d=DESKS[a.slot];
      c.fillStyle=['working','waiting_task'].includes(a.state)?P.screen:P.blue;c.fillRect(d.x+19,d.y-7,20,11);
      if(a.state==='working') {
        const shift=this.reducedMotion?0:Math.floor(this.time*3)%3;
        c.fillStyle=P.darkgreen;c.fillRect(d.x+21,d.y-5,11+shift,1);c.fillRect(d.x+21,d.y-2,14-shift,1);c.fillRect(d.x+21,d.y+1,7+shift,1);
        if(a.task.status==='revising'||a.task.status==='needs_review') {c.fillStyle=P.coral;c.fillRect(d.x+34,d.y-5,3,3);}
      }
    }
    this._drawClock(c);this._drawCoffeeSteam(c);
    const oscar={id:'oscar',role:'oscar',x:292,y:68,state:this.oscarState,direction:'down',walkFrame:0,paper:this.oscarState==='reviewing',mug:this.oscarState==='idle'&&Math.floor(this.time/12)%3===1};
    this._sprite(c,oscar,true);
    // Oscar is seated behind the front lip of his desk.
    c.fillStyle=P.woodLight;c.fillRect(258,72,68,13);c.fillStyle=P.woodDark;c.fillRect(258,85,68,4);
    c.fillStyle=P.ink;c.fillRect(272,70,29,13);c.fillStyle=this.oscarState==='reviewing'?P.gold:P.screen;c.fillRect(274,72,25,8);
    if(this.oscarState==='reviewing') {
      c.fillStyle=P.cream;c.fillRect(305,73,12,9);c.fillStyle=P.blue;c.fillRect(307,75,7,1);c.fillRect(307,78,6,1);
      if(!this.reducedMotion&&Math.floor(this.time*4)%2) {c.fillStyle=ROLES.oscar.skin;c.fillRect(302,71,4,4);}
    }
    this._text(c,'OSCAR',278,96,P.cream,6);
    live.sort((a,b)=>a.y-b.y||a.x-b.x);
    for(const a of live) this._sprite(c,a);
    // Tiny status marks distinguish waiting, creation, correction and approval.
    for(const a of live) {
      const x=Math.round(a.x),y=Math.round(a.y);
      if(a.state==='working'&&!this.reducedMotion&&Math.floor(this.time*3)%3===0) {c.fillStyle=a.task.status==='needs_review'?P.coral:P.gold;c.fillRect(x+12,y-24,2,2);c.fillRect(x+15,y-27,1,2);}
      if(a.state==='handoff') {c.fillStyle=P.gold;c.fillRect(x-16,y-22,3,3);c.fillRect(x-15,y-25,1,2);}
      if(a.task.status==='approved'&&['resting','coffee','chat'].includes(a.state)) {c.fillStyle=P.mint;c.fillRect(x+10,y-20,2,2);c.fillRect(x+12,y-22,2,2);}
    }
    this._drawAtmosphere(c);this._drawLamps(c);this._drawPropFeedback(c);
    for(const a of live) if(this.time<a.bubbleUntil) this._bubbleDraw(c,a.bubble,a.x,a.y-46,ROLES[a.role].shirt);
    if(this.time<this._oscarBubbleUntil) this._bubbleDraw(c,this._oscarBubble,292,26,P.green);
    if(this._propBubble&&this.time<this._propBubble.until) this._bubbleDraw(c,this._propBubble.text,this._propBubble.x,this._propBubble.y,P.coral);
    const count=live.filter(a=>!a.retiring&&a.missionId===this.missionId).length;
    this._text(c,'OSCAR ET LES AGENTS',16,13,P.cream,8);
    this._text(c,`ÉQUIPE ${String(count).padStart(2,'0')} / 08`,W/2+23,13,P.mint,7,'center');
    this._text(c,this.mission?.provider==='demo'?'DÉMO · SANS IA':'OSCAR & CO.',W-18,13,this.mission?.provider==='demo'?P.gold:P.coral,7,'right');
    if(!this.mission&&!live.length) this._bubbleDraw(c,'Une mission recrute les talents.',292,173,P.coral);
    if(this._manualPaused) {
      c.fillStyle='#202c45bb';c.fillRect(210,154,156,35);c.fillStyle=P.cream;c.fillRect(225,165,3,12);c.fillRect(231,165,3,12);
      this._text(c,'ATELIER EN PAUSE',245,174,P.cream,8);
    }
    this.frame++;
  }
}
