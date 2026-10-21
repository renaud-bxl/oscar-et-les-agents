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

test('an already completed mission stays alive socially without replaying delivery or approval on every refresh',()=>{
  const task={id:'alma',role:'design',status:'approved',attempt:1},s=scene([task]);s.mission.status='completed';s.world.update(s.mission);const original=JSON.stringify(s.mission);
  for(let i=0;i<480;i++){s.advance(.5);s.world.update(structuredClone(s.mission));}
  const a=s.world.agents.get('isolated-flow:alma'),states=s.transitions.filter(event=>event.id===task.id).map(event=>event.state);
  for(const state of ['handoff','coffee','lounge','strolling','resting'])assert.ok(states.includes(state),state);
  assert.ok(states.filter(state=>state==='coffee').length>=2,'the terminal agent continues its breaks');assert.ok(a.leisureStep>=4);assert.equal(s.events.filter(event=>event.kind==='handoff').length,1);assert.equal(s.events.filter(event=>event.kind==='approved').length,1);assert.equal(JSON.stringify(s.mission),original);
  const rests=s.transitions.filter(event=>event.id===task.id&&event.state==='resting');for(const rest of rests){const next=s.transitions.find(event=>event.id===task.id&&event.time>rest.time&&event.state!=='resting');if(next)assert.ok(next.time-rest.time<8,'desk rests stay short in normal motion');}
});

test('working then approved then completed frees colleagues for coffee, chat and walks without overbooking their desks',()=>{
  const tasks=Array.from({length:4},(_,i)=>({id:`alma-${i}`,role:'design',status:'working',attempt:1})),s=scene(tasks);s.advance(25);for(const task of tasks)task.status='approved';s.world.update(s.mission);s.advance(20);s.mission.status='completed';s.world.update(s.mission);const original=JSON.stringify(s.mission);s.advance(200);
  for(const task of tasks){const states=s.transitions.filter(event=>event.id===task.id).map(event=>event.state);assert.ok(states.includes('coffee'));assert.ok(states.includes('chat'));assert.ok(states.includes('strolling'));assert.equal(s.events.filter(event=>event.id===task.id&&event.kind==='handoff').length,1);assert.equal(s.events.filter(event=>event.id===task.id&&event.kind==='approved').length,1);}
  const agents=[...s.world.agents.values()];assert.equal(agents.length,4);assert.equal(new Set(agents.map(a=>a.slot)).size,4);assert.ok(agents.every(a=>a.visible&&a.task.status==='approved'));assert.equal(JSON.stringify(s.mission),original);
});

test('pause freezes leisure and reduced motion avoids repeated decorative walks after a completed result',()=>{
  const task={id:'alma',role:'design',status:'approved'},s=scene([task]);s.mission.status='completed';s.world.reducedMotion=true;s.world.update(s.mission);s.advance(180);const a=s.world.agents.get('isolated-flow:alma');
  assert.equal(a.state,'lounge');assert.equal(a.path.length,0);assert.equal(s.events.filter(event=>event.kind==='handoff').length,1);assert.equal(s.transitions.some(event=>event.state==='to_stroll'),false);
  s.world._manualPaused=true;const before={time:s.world.time,x:a.x,y:a.y,state:a.state,events:s.events.length};s.world._tick(1000000);assert.deepEqual({time:s.world.time,x:a.x,y:a.y,state:a.state,events:s.events.length},before);
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

test('a designer and a developer with a real dependency have a bounded lounge exchange then return',()=>{
  const tasks=[{id:'art',role:'design',status:'approved',agentName:'Alma'},{id:'integration',role:'code',status:'working',agentName:'Alex',dependsOn:['art']}],s=scene(tasks);s.mission.executionMode='local-game-team';s.world.update(s.mission);const before=JSON.stringify(s.mission);
  for(let i=0;i<1200&&!s.world._collaboration?.until;i++)s.advance(.1);
  const meeting=s.world._collaboration;assert.ok(meeting?.until,'linked colleagues meet only after both arrive');const pair=meeting.keys.map(key=>s.world.agents.get(key));
  assert.ok(pair.every(a=>a.state==='collaboration'));assert.equal(pair[0].direction,'right');assert.equal(pair[1].direction,'left');assert.ok(Math.hypot(pair[0].x-pair[1].x,pair[0].y-pair[1].y)<=85);
  assert.equal(s.events.filter(event=>event.id==='art'&&event.kind==='handoff').length,1,'the designer delivers before the meeting');assert.equal(tasks[1].status,'working');assert.equal(JSON.stringify(s.mission),before);
  s.advance(35);assert.equal(s.world._collaboration,null);assert.equal(s.world.agents.get('isolated-flow:integration').state,'working');assert.ok(s.transitions.some(event=>event.id==='art'&&event.state==='resting'));assert.equal(JSON.stringify(s.mission),before);
});

test('lounge exchanges never involve unrelated roles or postpone a new result for Oscar',()=>{
  const tasks=[{id:'art',role:'design',status:'approved'},{id:'integration',role:'code',status:'working',dependsOn:[]}],s=scene(tasks);s.mission.executionMode='local-game-team';s.world.update(s.mission);s.advance(70);assert.equal(s.world._collaboration,undefined);
  tasks[1].dependsOn=['art'];s.world.update(s.mission);for(let i=0;i<1200&&!s.world._collaboration?.until;i++)s.advance(.1);assert.ok(s.world._collaboration?.until);
  tasks[1].status='reviewing';s.world.update(s.mission);s.advance(.2);assert.equal(s.world._collaboration,null);s.advance(40);assert.equal(s.events.filter(event=>event.id==='integration'&&event.kind==='handoff').length,1);assert.equal(s.world.agents.get('isolated-flow:integration').state,'waiting_review');
});

test('reduced motion disables optional collaboration excursions while preserving actual work',()=>{
  const s=scene([{id:'art',role:'design',status:'approved'},{id:'code',role:'code',status:'working',dependsOn:['art']}]);s.mission.executionMode='local-game-team';s.world.reducedMotion=true;s.world.update(s.mission);s.advance(150);
  assert.equal(s.world._collaboration,undefined);assert.equal(s.transitions.some(event=>event.state==='to_collaboration'),false);assert.equal(s.world.agents.get('isolated-flow:code').state,'working');
});

test('sprite depth keeps rear-aisle walkers behind seated colleagues and foreground walkers in front',()=>{
  const s=scene([{id:'seated',role:'recherche',status:'working'}]);s.advance(20);const a=s.world.agents.get('isolated-flow:seated'),drawn=[];
  Object.assign(s.world,{ctx:{setTransform(){},clearRect(){},translate(){},scale(){},drawImage(){}},canvas:{width:1440,height:850},viewport:{dpr:1,scale:1,offsetX:0,offsetY:0},_doorOpen:0,props:{},_sprite:(c,actor)=>drawn.push(actor.id)});
  for(const name of ['_drawViewportBackdrop','_drawWindows','_drawSunShadows','_drawAtmosphere','_drawClock','_drawCoffeeSteam','_drawSecretary','_screen','_oscarDesk','_drawLamps','_drawPropFeedback','_drawBubbles','_round','_ellipse','_text'])s.world[name]=()=>{};
  Object.assign(s.world.oscar,{x:a.x,y:a.y-62,path:[]});PixelWorld.prototype._draw.call(s.world);assert.ok(drawn.indexOf('oscar')<drawn.indexOf(a.id));
  drawn.length=0;Object.assign(s.world.oscar,{x:a.x,y:a.y+72});PixelWorld.prototype._draw.call(s.world);assert.ok(drawn.indexOf('oscar')>drawn.indexOf(a.id));
});
