import test from 'node:test';
import assert from 'node:assert/strict';
import {PixelWorld,officeScenePalette,officeMaterialColor} from '../public/pixel-world.js';

function scene(tasks) {
  const world=Object.create(PixelWorld.prototype),events=[],transitions=[];
  Object.assign(world,{mission:null,missionId:null,agents:new Map(),time:0,frame:0,
    oscarState:'idle',oscar:{x:250,y:275,id:'oscar',key:'oscar',role:'oscar',name:'Oscar',
      direction:'down',path:[],place:'welcome',destination:'welcome',nextVisitAt:18,visitUntil:0,visits:0},
    _reviewOwner:null,_reactions:new Map(),_statusMemo:'',_lastCompleted:null,
    reducedMotion:false,_destroyed:false,onStatus:()=>{},_draw:()=>{},_schedule:()=>{},
    onEvent:(kind,data)=>events.push({kind,...data,time:world.time,oscar:world.oscar.place})});
  const visit=world._visit;
  world._visit=function(a,state){transitions.push({id:a.id,state,time:this.time,x:a.x,y:a.y,oscar:this.oscar.place});visit.call(this,a,state);};
  const mission={id:'isolated-flow',status:'running',tasks};world.update(mission);
  function advance(seconds){for(let i=0;i<seconds*10;i++){world.time+=.1;for(const a of [...world.agents.values()])world._stepAgent(a,.1);world._updateOscar(.1);}}
  return {world,mission,events,transitions,advance};
}

test('Oscar reaches his desk and visits working agents using the real routes',()=>{
  const s=scene([{id:'designer',role:'design',status:'working'}]);
  assert.equal(s.world.oscar.destination,'desk');
  s.advance(12);assert.equal(s.world.oscar.place,'desk');
  assert.equal(s.events.filter(e=>e.kind==='oscar_arrived').length,1);
  s.advance(30);assert.ok(s.world.oscar.visits>=1);
  assert.equal(s.world.agents.get('isolated-flow:designer').state,'working');
});

test('Oscar returns to his own desk throughout assembly and keeps the delivered mission there',()=>{
  const s=scene([]);Object.assign(s.world.oscar,{x:1010,y:370,path:[],place:'visit',destination:'visit',visitUntil:999,nextVisitAt:0});
  s.mission.status='reviewing';s.mission.phase='Oscar assemble la livraison';s.world.update(s.mission);assert.equal(s.world.oscar.destination,'desk');s.advance(30);assert.equal(s.world.oscar.place,'desk');assert.equal(s.world.oscarState,'reviewing');
  s.mission.phase='Oscar prépare les formats de votre livraison';s.world.update(s.mission);s.advance(90);assert.equal(s.world.oscar.place,'desk');assert.equal(s.world.oscar.visits,0);
  s.mission.status='completed';s.mission.files=[{path:'Livraison/index.html',size:124}];s.world.update(s.mission);const original=JSON.stringify(s.mission);s.advance(240);assert.equal(s.world.oscar.place,'desk');assert.equal(s.world.oscar.destination,'desk');assert.equal(s.world.oscarState,'idle');assert.equal(JSON.stringify(s.mission),original);
  s.world.update(null);s.advance(30);assert.equal(s.world.oscar.place,'welcome','a deliberate new office can return Oscar to the entrance');
});

test('measured assembly keeps Oscar at his desk, while terminal records cannot fake active checking',()=>{
  for(const stage of ['assembly','final-review']){
    const s=scene([]);s.mission.performance={calls:[{agent:'Oscar',stage,status:'running',durationMs:null,startedAt:Date.now()}]};Object.assign(s.world.oscar,{x:155,y:285,place:'welcome',destination:'welcome',path:[]});s.world.update(s.mission);assert.equal(s.world.oscar.destination,'desk');s.advance(80);assert.equal(s.world.oscar.place,'desk');assert.equal(s.world.oscarState,'reviewing');
    for(const status of ['completed','needs_review']){s.mission.status=status;s.world.update(s.mission);s.advance(90);assert.equal(s.world.oscar.place,'desk');assert.equal(s.world.oscarState,'idle','a stale running call does not override the real terminal status');}
  }
  const s=scene([]);s.mission.status='assembling';s.world.update(s.mission);s.advance(80);assert.equal(s.world.oscar.place,'desk');assert.equal(s.world.oscarState,'reviewing');
});

test('a terminal mission reopened from the entrance stays available at Oscar’s desk without fake work',()=>{
  for(const status of ['completed','needs_review']){
    const s=scene([{id:'approved',role:'design',status:'approved'}]);s.mission.status=status;s.mission.phase='L’équipe m’a rendu ses dossiers. Je vérifie les résultats et je prépare votre livraison.';s.world.update(s.mission);const original=JSON.stringify(s.mission);s.advance(240);
    assert.equal(s.world.oscar.place,'desk');assert.equal(s.world.oscar.destination,'desk');assert.equal(s.world.oscarState,'idle');assert.equal(JSON.stringify(s.mission),original);
    assert.equal(s.world.agents.get('isolated-flow:approved').state,'home','a validated colleague goes home while Oscar remains available');
  }
});

test('approved and failed workers hand their folders to Oscar before coffee or departure',()=>{
  const tasks=[{id:'approved',role:'design',status:'working'},{id:'failed',role:'code',status:'working'}];
  const s=scene(tasks);s.advance(28);
  tasks[0].status='approved';tasks[1].status='failed';s.world.update(s.mission);s.advance(65);
  for(const task of tasks){
    const handoff=s.transitions.find(e=>e.id===task.id&&e.state==='handoff');
    assert.ok(handoff,`${task.id} must deliver a folder`);
    assert.ok(Math.hypot(handoff.x-730,handoff.y-330)<5,'folder is delivered at Oscar’s desk');
    const departure=s.transitions.find(e=>e.id===task.id&&['to_coffee','leaving'].includes(e.state));
    assert.ok(departure);assert.ok(departure.time>handoff.time);
    assert.equal(departure.oscar,'desk','Oscar is present before a worker leaves the review');
  }
  assert.ok(s.events.some(e=>e.kind==='coffee'&&e.id==='approved'));
  assert.ok(s.events.some(e=>e.kind==='exit'&&e.id==='failed'));
  assert.equal(s.events.some(e=>e.kind==='coffee'&&e.id==='failed'),false);
});

test('a second correction delivers a fresh folder before another coffee break',()=>{
  const task={id:'writer',role:'redaction',status:'approved',attempt:1};
  const s=scene([task]);s.advance(35);
  assert.ok(s.events.some(e=>e.kind==='coffee'));
  task.status='revising';task.attempt=2;s.world.update(s.mission);s.advance(20);
  task.status='approved';s.world.update(s.mission);s.advance(35);
  assert.equal(s.events.filter(e=>e.kind==='handoff').length,2);
  const a=s.world.agents.get('isolated-flow:writer');
  assert.deepEqual([...a.handoffAttempts],[1,2]);
});

test('reopening a result that needs review hands over its folder and stops visual work',()=>{
  const task={id:'researcher',role:'recherche',status:'needs_review',attempt:2};
  const s=scene([task]);s.mission.status='needs_review';s.world.update(s.mission);
  const original=JSON.stringify(s.mission);s.advance(120);
  const a=s.world.agents.get('isolated-flow:researcher');
  assert.equal(a.state,'needs_review');assert.equal(a.paper,false);assert.equal(a.mug,false);
  assert.deepEqual([...a.handoffAttempts],[2]);
  assert.equal(s.events.filter(e=>e.kind==='handoff').length,1);
  assert.equal(s.events.some(e=>['approved','coffee'].includes(e.kind)),false);
  assert.equal(JSON.stringify(s.mission),original,'the scene never approves or resumes the real task');
});

test('a final rejection after handoff waits for attention instead of returning to work',()=>{
  const task={id:'researcher',role:'recherche',status:'working',attempt:2};
  const s=scene([task]);s.advance(25);
  task.status='reviewing';s.world.update(s.mission);s.advance(25);
  assert.equal(s.events.filter(e=>e.kind==='handoff').length,1);
  task.status='needs_review';s.mission.status='needs_review';s.world.update(s.mission);s.advance(120);
  assert.equal(s.world.agents.get('isolated-flow:researcher').state,'needs_review');
  assert.equal(s.events.filter(e=>e.kind==='handoff').length,1);
  assert.equal(s.events.some(e=>['approved','coffee'].includes(e.kind)),false);
});

test('four reopened results needing review release their desks when another mission is selected',()=>{
  for(const beforeSwitch of [12,120]) {
    const tasks=Array.from({length:4},(_,i)=>({id:'old'+i,role:'recherche',status:'needs_review',attempt:2}));
    const s=scene(tasks);s.mission.status='needs_review';s.world.update(s.mission);s.advance(beforeSwitch);
    const next={id:'next-mission',status:'running',tasks:Array.from({length:4},(_,i)=>({id:'new'+i,role:'recherche',status:'working',attempt:1}))};
    s.world.update(next);s.advance(120);
    assert.equal([...s.world.agents.values()].some(a=>a.missionId===s.mission.id),false);
    const current=[...s.world.agents.values()];assert.equal(current.length,4);
    assert.ok(current.every(a=>a.visible&&a.state==='working'&&a.missionId===next.id));
    assert.equal(s.events.filter(e=>e.kind==='handoff').length,4,'each rejected result is handed over before leaving');
    assert.equal(s.events.filter(e=>e.kind==='exit').length,4);
    assert.equal(s.events.some(e=>['approved','coffee'].includes(e.kind)),false);
  }
});

test('reopened failed results hand over before departure and cancelled tasks never recruit',()=>{
  const s=scene([{id:'failed',role:'code',status:'failed',attempt:2},{id:'cancelled',role:'design',status:'cancelled',attempt:1}]);
  s.mission.status='failed';s.world.update(s.mission);const original=JSON.stringify(s.mission);s.advance(120);
  assert.equal(s.world.agents.size,0);
  assert.deepEqual(s.events.filter(e=>e.id==='failed').map(e=>e.kind),['hire','handoff','exit']);
  assert.equal(s.events.some(e=>e.id==='cancelled'),false);
  assert.equal(JSON.stringify(s.mission),original);
});

test('a finished result reserves Oscar’s desk immediately and never causes a visit to a non-working agent',()=>{
  const task={id:'alma',role:'design',status:'working'},s=scene([task]);s.advance(12);for(let i=0;i<300&&s.world.oscar.destination!=='visit';i++)s.advance(.1);
  assert.equal(s.world.oscar.destination,'visit');const visits=s.world.oscar.visits,routes=[];
  const route=s.world._oscarRoute;s.world._oscarRoute=function(place,point){if(place!==this.oscar.destination)routes.push(place);return route.call(this,place,point);};
  task.status='approved';s.world.update(s.mission);assert.equal(s.world.oscar.destination,'desk');s.advance(180);
  assert.equal(s.world.oscar.visits,visits);assert.deepEqual(routes,['desk']);assert.equal(s.events.filter(event=>event.kind==='handoff').length,1);assert.equal(s.events.find(event=>event.kind==='handoff').oscar,'desk');assert.ok(s.events.some(event=>event.kind==='coffee'));assert.equal(s.world.oscar.place,'desk');
});

test('arrival at an empty desk waits for Oscar before recording a real handoff',()=>{
  const task={id:'alma',role:'design',status:'working'},s=scene([task]);s.advance(12);const a=s.world.agents.get('isolated-flow:alma');task.status='reviewing';
  Object.assign(s.world.oscar,{x:1300,y:810,place:'visit',destination:'visit',path:[],visitUntil:s.world.time+20});s.world._reviewOwner=a.key;Object.assign(a,{x:730,y:330,path:[],afterTravel:'handoff',paper:true});s.world._arrived(a);
  assert.equal(a.state,'waiting_oscar');assert.equal(a.handoffAttempts.size,0);assert.equal(s.events.some(event=>event.kind==='handoff'),false);
  s.advance(40);assert.equal(s.events.filter(event=>event.kind==='handoff').length,1);assert.equal(s.events.find(event=>event.kind==='handoff').oscar,'desk');assert.equal(a.state,'waiting_review');assert.equal(a.mug,false);
});

test('four colleagues queue their deliveries, wait for actual approval and each deposit exactly once',()=>{
  const tasks=Array.from({length:4},(_,i)=>({id:`designer-${i}`,role:'design',status:'working',attempt:1})),s=scene(tasks);s.advance(25);for(const task of tasks)task.status='reviewing';s.world.update(s.mission);const original=JSON.stringify(s.mission);s.advance(100);
  const handoffs=s.events.filter(event=>event.kind==='handoff');assert.equal(handoffs.length,4);assert.ok(handoffs.every(event=>event.oscar==='desk'));assert.equal(s.events.some(event=>event.kind==='coffee'),false);assert.ok([...s.world.agents.values()].every(a=>a.state==='waiting_review'&&!a.paper&&!a.mug));assert.equal(JSON.stringify(s.mission),original);
  for(let i=1;i<handoffs.length;i++)assert.ok(handoffs[i].time-handoffs[i-1].time>=1.3,'each handoff gets its own desk time');
  for(const task of tasks)task.status='approved';s.world.update(s.mission);s.advance(30);assert.equal(s.events.filter(event=>event.kind==='handoff').length,4);for(const task of tasks)assert.ok(s.events.some(event=>event.kind==='coffee'&&event.id===task.id));
});

test('a new result still reaches Oscar if an update skipped its short correcting phase',()=>{
  const task={id:'alma',role:'design',status:'approved',attempt:1},s=scene([task]);s.advance(40);const a=s.world.agents.get('isolated-flow:alma');assert.equal(s.events.filter(event=>event.kind==='handoff').length,1);
  task.attempt=2;task.status='reviewing';s.world.update(s.mission);s.advance(70);assert.deepEqual([...a.handoffAttempts],[1,2]);assert.equal(s.events.filter(event=>event.kind==='handoff').length,2);assert.equal(a.state,'waiting_review');assert.equal(a.mug,false);
});

test('delivery-stage speech belongs to the colleague and does not announce a coffee break early',()=>{
  const s=scene([{id:'alma',role:'design',status:'approved'}]),a=s.world.agents.get('isolated-flow:alma');s.world._clickCounts=new Map();s.world.onInteract=()=>{};s.world.onSelect=()=>{};
  for(const[state,expected]of [['to_oscar','Mon résultat pour Oscar.'],['review_queue','Mon dossier est prêt.'],['handoff','À toi de vérifier !'],['waiting_review','J’attends le retour.'],['needs_review','À vérifier']]){a.state=state;s.world._selectActor(a);assert.equal(a.bubble,expected);clearTimeout(s.world._selectionTimer);s.world._selectionTimer=null;}
});

test('dark mode paints real wall, floor and furniture colors without a global shade or changed skin tone',()=>{
  const world=Object.create(PixelWorld.prototype);world._theme='dark';world.viewport={width:1440,height:850,scale:1,offsetX:0,offsetY:0};world._line=()=>{};
  const gradients=[],fills=[],c={createLinearGradient(){const gradient={stops:[],addColorStop(position,color){this.stops.push([position,color]);}};gradients.push(gradient);return gradient;},fillRect(){fills.push(this.fillStyle);}};
  world._drawViewportBackdrop(c);const palette=officeScenePalette('dark');assert.deepEqual(gradients.map(gradient=>gradient.stops.map(([,color])=>color)),[[palette.wallTop,palette.wallBottom],[palette.floorTop,palette.floorBottom]]);assert.equal(fills.length,2,'only the room surfaces are filled; no gray overlay');assert.notEqual(palette.floorBottom,officeScenePalette('light').floorBottom);
  assert.notEqual(officeMaterialColor('#f8e6cf','dark'),'#f8e6cf');assert.equal(officeMaterialColor('#edbd9a','dark'),'#edbd9a','characters keep their skin colors');assert.equal(officeMaterialColor('#fffaf0eb','dark'),'#2c4350eb');
  const luminance=color=>color.slice(1).match(/../gu).map(hex=>parseInt(hex,16)/255).map(n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4).reduce((sum,n,i)=>sum+n*[.2126,.7152,.0722][i],0),fg=luminance(officeMaterialColor('#304f43','dark')),bg=luminance(officeMaterialColor('#fffdf6','dark'));assert.ok((fg+.05)/(bg+.05)>7,'department signs remain highly readable');
});

test('the furniture cache rebuilds once per real theme change instead of on each frame',()=>{
  const world=Object.create(PixelWorld.prototype);world._theme='light';let built=0,drawn=0;world._makeBackground=()=>({revision:++built});world._draw=()=>drawn++;
  assert.equal(world._setTheme('dark'),true);for(let i=0;i<240;i++)assert.equal(world._setTheme('dark'),false);assert.equal(built,1);assert.equal(drawn,1);assert.equal(world._setTheme('light'),true);assert.equal(built,2);assert.equal(world._setTheme('invalid'),false);
});

test('a completed mission sends its colleague home after handoff, without replaying on every refresh',()=>{
  const task={id:'alma',role:'design',status:'approved',attempt:1},s=scene([task]);s.mission.status='completed';s.world.update(s.mission);const original=JSON.stringify(s.mission);
  for(let i=0;i<480;i++){s.advance(.5);s.world.update(structuredClone(s.mission));}
  const a=s.world.agents.get('isolated-flow:alma'),states=s.transitions.filter(event=>event.id===task.id).map(event=>event.state);
  for(const state of ['handoff','leaving','home'])assert.ok(states.includes(state),state);
  assert.equal(states.includes('coffee'),false,'a completed delivery does not add a new coffee break');
  assert.equal(a.state,'home');assert.equal(a.visible,false);assert.equal(a.slot,-1);
  for(const kind of ['hire','handoff','approved','exit'])assert.equal(s.events.filter(event=>event.kind===kind).length,1,kind);
  const approved=s.events.find(event=>event.kind==='approved'),exit=s.events.find(event=>event.kind==='exit');
  assert.ok(exit.time-approved.time>0&&exit.time-approved.time<15,'the colleague walks straight home after the required handoff');
  assert.ok(s.transitions.find(event=>event.state==='leaving').time-s.transitions.find(event=>event.state==='handoff').time>=1.3,'final validation still allows the folder handoff to finish');
  assert.equal(states.includes('resting'),false);assert.equal(JSON.stringify(s.mission),original);assert.equal(s.world.oscar.place,'desk');
  s.world.update(null);s.advance(20);s.world.update(s.mission);s.advance(120);
  assert.equal(s.world.agents.size,0,'returning to the delivered project does not recruit its departed colleague again');
  assert.equal(s.events.filter(event=>event.kind==='hire').length,1);
});

test('approved colleagues take a break and leave their desks free after mission completion',()=>{
  const tasks=Array.from({length:4},(_,i)=>({id:`alma-${i}`,role:'design',status:'working',attempt:1})),s=scene(tasks);s.advance(25);for(const task of tasks)task.status='approved';s.world.update(s.mission);s.advance(30);s.mission.status='completed';s.world.update(s.mission);const original=JSON.stringify(s.mission);s.advance(200);
  for(const task of tasks){const states=s.transitions.filter(event=>event.id===task.id).map(event=>event.state);assert.ok(states.includes('leaving'));assert.ok(states.includes('home'));assert.equal(s.events.filter(event=>event.id===task.id&&event.kind==='handoff').length,1);assert.equal(s.events.filter(event=>event.id===task.id&&event.kind==='approved').length,1);assert.equal(s.events.filter(event=>event.id===task.id&&event.kind==='exit').length,1);}
  assert.ok(s.events.some(event=>event.kind==='coffee'),'approved colleagues can still take a break before final validation');
  const agents=[...s.world.agents.values()];assert.equal(agents.length,4);assert.ok(agents.every(a=>!a.visible&&a.slot===-1&&a.task.status==='approved'));assert.equal(JSON.stringify(s.mission),original);
  const departures=s.transitions.filter(event=>event.state==='leaving').map(event=>event.time);assert.ok(new Set(departures).size>1,'the team does not leave as one superposed sprite');
});

test('pause freezes the short break and reduced motion avoids repeated decorative walks before going home',()=>{
  const task={id:'alma',role:'design',status:'approved'},s=scene([task]);s.world.reducedMotion=true;s.world.update(s.mission);
  const a=s.world.agents.get('isolated-flow:alma');for(let i=0;i<1000&&a.state!=='lounge';i++)s.advance(.1);
  assert.equal(a.state,'lounge');assert.equal(a.path.length,0);assert.equal(s.events.filter(event=>event.kind==='handoff').length,1);assert.equal(s.transitions.some(event=>event.state==='to_stroll'),false);
  s.world._manualPaused=true;const before={time:s.world.time,x:a.x,y:a.y,state:a.state,events:s.events.length};s.world._tick(1000000);assert.deepEqual({time:s.world.time,x:a.x,y:a.y,state:a.state,events:s.events.length},before);
  s.world._manualPaused=false;s.mission.status='completed';s.world.update(s.mission);s.advance(30);assert.equal(a.state,'home');assert.equal(a.visible,false);assert.equal(s.events.filter(event=>event.kind==='exit').length,1);
});

test('a genuine new correction recalls a departed colleague and hands in only the new result',()=>{
  const task={id:'alma',role:'design',status:'approved',attempt:1},s=scene([task]);s.advance(100);
  const a=s.world.agents.get('isolated-flow:alma');assert.equal(a.state,'home');assert.equal(a.visible,false);
  task.status='revising';task.attempt=2;s.world.update(s.mission);s.advance(25);
  assert.equal(a.visible,true);assert.equal(a.state,'working');assert.ok(a.slot>=0);assert.deepEqual([...a.handoffAttempts],[1]);
  assert.equal(s.events.filter(event=>event.kind==='handoff').length,1,'returning to work is not a delivery');
  task.status='reviewing';s.world.update(s.mission);s.advance(30);assert.equal(a.state,'waiting_review');
  assert.deepEqual([...a.handoffAttempts],[1,2]);assert.equal(s.events.filter(event=>event.kind==='exit').length,1);
  task.status='approved';s.world.update(s.mission);s.advance(90);assert.equal(a.state,'home');assert.equal(a.visible,false);
  for(const kind of ['hire','handoff','approved','exit'])assert.equal(s.events.filter(event=>event.kind===kind).length,2,kind);
  for(let index=0;index<30;index++){s.world.update(structuredClone(s.mission));s.advance(.2);}
  assert.equal(a.state,'home');assert.equal(s.events.filter(event=>event.kind==='hire').length,2);
});

test('revoking approval during the walk home recalls the colleague without a fake new delivery',()=>{
  const task={id:'alma',role:'design',status:'approved',attempt:1},s=scene([task]),a=s.world.agents.get('isolated-flow:alma');
  for(let index=0;index<1000&&a.state!=='leaving';index++)s.advance(.1);
  assert.equal(a.state,'leaving');assert.equal(a.departureReason,'approved');
  task.status='needs_review';s.mission.status='needs_review';s.world.update(s.mission);s.advance(60);
  assert.equal(a.visible,true);assert.equal(a.state,'needs_review');assert.equal(a.mug,false);assert.equal(a.homeAfterApprovalAt,null);
  assert.equal(s.events.filter(event=>event.kind==='handoff').length,1);assert.equal(s.events.filter(event=>event.kind==='exit').length,0);
  s.advance(300);assert.equal(a.state,'needs_review','an unapproved result never sends its colleague home');
});

test('a real correction recalls an approved colleague before the departure deadline, and cancellation remains an exit',()=>{
  const task={id:'alma',role:'design',status:'approved',attempt:1},s=scene([task]),a=s.world.agents.get('isolated-flow:alma');
  for(let index=0;index<1000&&a.state!=='lounge';index++)s.advance(.1);
  assert.equal(a.state,'lounge');assert.ok(a.homeAfterApprovalAt>s.world.time);
  task.status='revising';task.attempt=2;s.world.update(s.mission);s.advance(60);
  assert.equal(a.state,'working');assert.equal(a.homeAfterApprovalAt,null);assert.equal(s.events.filter(event=>event.kind==='exit').length,0);
  task.status='cancelled';s.world.update(s.mission);s.advance(60);
  assert.equal(s.world.agents.size,0);assert.equal(s.events.filter(event=>event.kind==='exit').length,1);
  assert.equal(s.events.filter(event=>event.kind==='handoff').length,1);assert.equal(s.events.filter(event=>event.kind==='approved').length,1);
});

test('Oscar takes the rear aisles around every desk instead of crossing chairs or keyboards',()=>{
  const s=scene([]),islands=[{x:170,y:350},{x:1050,y:350},{x:610,y:430},{x:270,y:610},{x:950,y:610}];
  for(const target of [{x:430,y:370},{x:1010,y:370},{x:890,y:470},{x:530,y:640},{x:1210,y:640}]){
    Object.assign(s.world.oscar,{x:720,y:237,path:[],place:'desk',destination:'desk'});s.world._oscarRoute('visit',target);
    assert.deepEqual(s.world.oscar.path[0],{x:720,y:205},'Oscar first steps away from his own desk toward its rear');
    for(const point of s.world.oscar.path)for(const island of islands)assert.equal(point.x>=island.x-20&&point.x<island.x+240&&point.y>=island.y-60&&point.y<island.y+150,false,`route crosses desk/chair clearance: ${JSON.stringify(point)}`);
  }
  const actor={x:130,y:270,slot:0,role:'recherche'},path=s.world._path(actor,{x:210,y:330});assert.ok(path.length);assert.ok(Math.hypot(path.at(-1).x-210,path.at(-1).y-330)<15,'the assigned colleague can still enter their own seat corridor');
  assert.equal(s.world._walkable(10,16,{actor:s.world.oscar}),false,'Oscar cannot take that colleague’s seat corridor');
});

test('queued and blocked contributions wait without fake keyboard work or validation',()=>{
  const tasks=[{id:'queue',role:'code',status:'queued'},{id:'blocked',role:'design',status:'blocked'}],s=scene(tasks),before=JSON.stringify(s.mission);s.advance(120);
  assert.ok([...s.world.agents.values()].every(a=>a.state==='waiting_task'));assert.equal(s.events.some(event=>['handoff','approved','coffee'].includes(event.kind)),false);assert.equal(JSON.stringify(s.mission),before);
  tasks[0].status='working';s.world.update(s.mission);s.advance(.2);assert.equal(s.world.agents.get('isolated-flow:queue').state,'working');assert.equal(s.world.agents.get('isolated-flow:blocked').state,'waiting_task');
  s.world._clickCounts=new Map();s.world.onInteract=()=>{};s.world.onSelect=()=>{};s.world._selectActor(s.world.agents.get('isolated-flow:blocked'));assert.equal(s.world.agents.get('isolated-flow:blocked').bubble,'J’attends une contribution.');clearTimeout(s.world._selectionTimer);
});

test('queued colleagues explain the actual missing contribution or available-slot wait without fake work',()=>{
  const tasks=[{id:'art',role:'design',status:'working'},{id:'code',role:'code',status:'queued',dependsOn:['art']},{id:'writer',role:'redaction',status:'queued'},{id:'blocked',role:'analyse',status:'blocked',dependsOn:['art']}],s=scene(tasks);s.advance(35);
  const code=s.world.agents.get('isolated-flow:code'),writer=s.world.agents.get('isolated-flow:writer'),blocked=s.world.agents.get('isolated-flow:blocked');
  assert.equal(code.waitReason,'J’attends une contribution.');assert.equal(writer.waitReason,'J’attends une place.');
  tasks[0].status='approved';s.world.update(s.mission);s.advance(.2);
  assert.equal(code.state,'waiting_task');assert.equal(code.waitReason,'J’attends une place.');assert.equal(code.bubble,'J’attends une place.');
  assert.equal(blocked.waitReason,'J’attends une contribution.','an explicitly blocked task stays blocked even if the visible upstream status changed');
  tasks[1].dependsOn=['missing'];s.world.update(s.mission);s.advance(.2);assert.equal(code.waitReason,'J’attends une contribution.');
  s.world._clickCounts=new Map();s.world.onInteract=()=>{};s.world.onSelect=()=>{};
  for(const actor of[code,writer]){s.world._selectActor(actor);assert.equal(actor.bubble,actor.waitReason);clearTimeout(s.world._selectionTimer);s.world._selectionTimer=null;}
  assert.ok([code,writer,blocked].every(actor=>actor.state==='waiting_task'&&!actor.mug&&!actor.paper));
  assert.equal(s.events.some(event=>event.id!=='art'&&['handoff','approved','coffee'].includes(event.kind)),false);
});

test('nine genuinely active colleagues start working without an animation concurrency limit',()=>{
  const roles=['recherche','analyse','design','redaction','code','design','code','design','recherche'];
  const s=scene(roles.map((role,i)=>({id:`worker-${i}`,role,status:'working'}))),before=JSON.stringify(s.mission);s.advance(40);
  assert.equal(s.world.agents.size,9);assert.ok([...s.world.agents.values()].every(actor=>actor.visible&&actor.state==='working'));
  assert.equal(new Set([...s.world.agents.values()].map(actor=>actor.slot)).size,9);assert.equal(JSON.stringify(s.mission),before);assert.equal(s.events.some(event=>['handoff','approved'].includes(event.kind)),false);
});

test('a rejected colleague queued for a free slot waits honestly before the real correction starts',()=>{
  const task={id:'art',role:'design',status:'reviewing',attempt:1},s=scene([task]);s.advance(40);const actor=s.world.agents.get('isolated-flow:art');assert.equal(actor.state,'waiting_review');
  task.status='queued';task.review={approved:false,feedback:'Reprendre le texte.'};s.world.update(s.mission);s.advance(.1);assert.equal(actor.state,'waiting_review');assert.equal(actor.bubble,'J’attends une place.');assert.equal(actor.mug,false);assert.equal(s.events.filter(event=>event.kind==='handoff').length,1);
  task.status='revising';task.attempt=2;s.world.update(s.mission);s.advance(.1);assert.equal(actor.state,'returning');s.advance(25);assert.equal(actor.state,'working');assert.equal(s.events.filter(event=>event.kind==='handoff').length,1,'a correction only hands over a new folder when its new result arrives');
});

test('Oscar coordinates actual workers while a submitted colleague waits, but real review calls recall him',()=>{
  const tasks=[{id:'art',role:'design',status:'working'},{id:'code',role:'code',status:'working'},{id:'writer',role:'redaction',status:'working'}],s=scene(tasks);s.mission.performance={calls:[]};s.advance(40);
  tasks[0].status='reviewing';s.world.update(s.mission);assert.equal(s.world.oscarState,'receiving','receiving a folder is distinct from a measured engine review');s.advance(40);
  assert.equal(s.world.agents.get('isolated-flow:art').state,'waiting_review');const afterHandoff=s.world.oscar.visits;s.advance(90);
  assert.ok(s.world.oscar.visits>afterHandoff,'a lounge wait alone does not hold Oscar at his desk');assert.equal(s.world.oscarState,'coordinating');assert.equal(s.events.filter(event=>event.id==='art'&&event.kind==='handoff').length,1);
  for(const stage of['review','assembly','final-review']){
    s.mission.performance.calls=[{agent:'Oscar',stage,status:'running',startedAt:1000,durationMs:null}];s.world.update(s.mission);assert.equal(s.world.oscar.destination,'desk');s.advance(30);const held=s.world.oscar.visits;
    s.advance(60);assert.equal(s.world.oscar.place,'desk');assert.equal(s.world.oscarState,'reviewing');assert.equal(s.world.oscar.visits,held);
    s.mission.performance.calls[0].status='completed';s.mission.performance.calls[0].durationMs=2000;s.world.update(s.mission);s.advance(45);assert.ok(s.world.oscar.visits>held);
  }
  assert.equal(s.events.filter(event=>event.id==='art'&&event.kind==='handoff').length,1);assert.equal(s.events.some(event=>event.id==='art'&&['approved','coffee'].includes(event.kind)),false);
});

test('a designer and a developer with a real dependency have a bounded lounge exchange then return',()=>{
  const tasks=[{id:'art',role:'design',status:'approved',agentName:'Alma'},{id:'integration',role:'code',status:'working',agentName:'Alex',dependsOn:['art']}],s=scene(tasks);s.mission.executionMode='local-game-team';s.world.update(s.mission);const before=JSON.stringify(s.mission);
  for(let i=0;i<1200&&!s.world._collaboration?.until;i++)s.advance(.1);
  const meeting=s.world._collaboration;assert.ok(meeting?.until,'linked colleagues meet only after both arrive');const pair=meeting.keys.map(key=>s.world.agents.get(key));
  assert.ok(pair.every(a=>a.state==='collaboration'));assert.equal(pair[0].direction,'right');assert.equal(pair[1].direction,'left');assert.ok(Math.hypot(pair[0].x-pair[1].x,pair[0].y-pair[1].y)<=85);
  assert.equal(s.events.filter(event=>event.id==='art'&&event.kind==='handoff').length,1,'the designer delivers before the meeting');assert.equal(tasks[1].status,'working');assert.equal(JSON.stringify(s.mission),before);
  s.advance(35);assert.equal(s.world._collaboration,null);assert.equal(s.world.agents.get('isolated-flow:integration').state,'working');assert.ok(s.transitions.some(event=>event.id==='art'&&event.state==='to_lounge'&&event.time>=meeting.until),'the approved designer returns to the lounge while the developer resumes work');assert.equal(JSON.stringify(s.mission),before);
});

test('reviewing colleagues wait face to face with quiet gestures and corrections recall them immediately',()=>{
  const tasks=Array.from({length:4},(_,i)=>({id:`review-${i}`,role:'design',status:'working',attempt:1})),s=scene(tasks);s.advance(25);for(const task of tasks)task.status='reviewing';s.world.update(s.mission);s.advance(80);
  const agents=[...s.world.agents.values()],before=JSON.stringify(s.mission);
  assert.ok(agents.every(a=>a.state==='waiting_review'&&!a.paper&&!a.mug));assert.equal(new Set(agents.map(a=>`${a.x},${a.y}`)).size,4);assert.ok(agents.every(a=>a.y>600&&['left','right'].includes(a.direction)));
  for(const a of agents){const other=s.world._socialPartner(a);assert.ok(other);assert.equal(a.direction,other.x>a.x?'right':'left');}
  let gestures=0;for(let i=0;i<150;i++){s.advance(.1);gestures+=agents.filter(a=>a.socialGestureUntil>s.world.time).length;}
  assert.ok(gestures>0);assert.equal(s.events.some(event=>['coffee','approved'].includes(event.kind)),false);assert.equal(JSON.stringify(s.mission),before);
  tasks[0].status='revising';tasks[0].attempt=2;s.world.update(s.mission);s.advance(.1);assert.equal(agents[0].state,'returning');assert.equal(agents[0].mug,false);s.advance(20);assert.equal(agents[0].state,'working');
  tasks[0].status='reviewing';s.world.update(s.mission);s.advance(35);assert.deepEqual([...agents[0].handoffAttempts],[1,2]);assert.equal(agents[0].state,'waiting_review');
});

test('approval during the lounge trip goes to coffee, and invalidation removes the mug without a second handoff',()=>{
  const task={id:'alma',role:'design',status:'reviewing',attempt:1},s=scene([task]);
  for(let i=0;i<1000&&s.world.agents.get('isolated-flow:alma').state!=='to_review_wait';i++)s.advance(.1);
  const a=s.world.agents.get('isolated-flow:alma');assert.equal(a.state,'to_review_wait');task.status='approved';s.world.update(s.mission);s.advance(.1);assert.equal(a.state,'to_coffee');
  for(let i=0;i<1000&&a.state!=='coffee';i++)s.advance(.1);assert.equal(a.state,'coffee');assert.equal(a.mug,true);
  task.status='needs_review';s.world.update(s.mission);s.advance(.1);assert.equal(a.state,'to_review_wait');assert.equal(a.mug,false);s.advance(40);assert.equal(a.state,'needs_review');assert.equal(a.mug,false);assert.equal(s.events.filter(event=>event.kind==='handoff').length,1);
});

test('lounge exchanges never involve unrelated roles or postpone a new result for Oscar',()=>{
  const tasks=[{id:'art',role:'design',status:'approved'},{id:'integration',role:'code',status:'working',dependsOn:[]}],s=scene(tasks);s.mission.executionMode='local-game-team';s.world.update(s.mission);s.advance(70);assert.equal(s.world._collaboration,undefined);
  tasks[1].dependsOn=['art'];tasks[0].status='revising';tasks[0].attempt=2;s.world.update(s.mission);s.advance(20);tasks[0].status='approved';s.world.update(s.mission);for(let i=0;i<1200&&!s.world._collaboration?.until;i++)s.advance(.1);assert.ok(s.world._collaboration?.until);
  tasks[1].status='reviewing';s.world.update(s.mission);s.advance(.2);assert.equal(s.world._collaboration,null);s.advance(40);assert.equal(s.events.filter(event=>event.id==='integration'&&event.kind==='handoff').length,1);assert.equal(s.world.agents.get('isolated-flow:integration').state,'waiting_review');
});

test('reduced motion disables optional collaboration excursions while preserving actual work',()=>{
  const s=scene([{id:'art',role:'design',status:'approved'},{id:'code',role:'code',status:'working',dependsOn:['art']}]);s.mission.executionMode='local-game-team';s.world.reducedMotion=true;s.world.update(s.mission);s.advance(150);
  assert.equal(s.world._collaboration,undefined);assert.equal(s.transitions.some(event=>event.state==='to_collaboration'),false);assert.equal(s.world.agents.get('isolated-flow:code').state,'working');
});

test('sprite depth keeps rear-aisle walkers behind seated colleagues and foreground walkers in front',()=>{
  const s=scene([{id:'seated',role:'recherche',status:'working'}]);s.advance(20);const a=s.world.agents.get('isolated-flow:seated'),drawn=[],oscarStates=[];
  Object.assign(s.world,{ctx:{setTransform(){},clearRect(){},translate(){},scale(){},drawImage(){}},canvas:{width:1440,height:850},viewport:{dpr:1,scale:1,offsetX:0,offsetY:0},_doorOpen:0,props:{},_sprite:(c,actor)=>{drawn.push(actor.id);if(actor.role==='oscar')oscarStates.push(actor.state);}});
  for(const name of ['_drawViewportBackdrop','_drawWindows','_drawSunShadows','_drawAtmosphere','_drawClock','_drawCoffeeSteam','_drawSecretary','_screen','_oscarDesk','_drawLamps','_drawPropFeedback','_drawBubbles','_round','_ellipse','_text'])s.world[name]=()=>{};
  Object.assign(s.world.oscar,{x:a.x,y:a.y-62,path:[],place:'visit'});s.world.oscarState='coordinating';PixelWorld.prototype._draw.call(s.world);assert.ok(drawn.indexOf('oscar')<drawn.indexOf(a.id));assert.equal(oscarStates.at(-1),'visiting','Oscar greets a colleague without a floating work keyboard');
  drawn.length=0;Object.assign(s.world.oscar,{x:a.x,y:a.y+72});PixelWorld.prototype._draw.call(s.world);assert.ok(drawn.indexOf('oscar')>drawn.indexOf(a.id));
});
