import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,symlinkSync,existsSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Atelier,PLAN_SCHEMA} from '../lib/orchestrator.mjs';

const roots=['index.html','README.md','manifest.json','verification.md','regles.md'];
const files={
 'index.html':'<!doctype html><link rel="stylesheet" href="style.css"><script type="module" src="src/game.js"></script><img src="assets/background.png">',
 'README.md':'Documentation fictive pour tester le transport local, aucun jeu réellement testé.',
 'manifest.json':'{"icon":"assets/alt.svg"}','verification.md':'Scénario simulé.','regles.md':'Trois chutes.',
 'style.css':'@font-face{font-family:local;src:url("fonts/local.woff2")}',
 'src/game.js':'import "./physics.js";fetch("./constants.json");const player={src:"../assets/player.svg"};new Audio("../audio/catch.wav");',
 'src/physics.js':'export const fixture=1;','src/constants.json':'{"lives":3}',
 'assets/player.svg':'<svg xmlns="http://www.w3.org/2000/svg"><circle r="10"/></svg>',
 'assets/background.png':'PNG fixture bytes.','assets/alt.svg':'<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>',
 'fonts/local.woff2':'Font fixture bytes.','audio/catch.wav':'Audio fixture bytes.',
};
function setup(t,{damage}={}){
 const dataDir=mkdtempSync(path.join(os.tmpdir(),'oscar-package-integration-')),trace=[];let app;
 const task=(role,title,deliverables,dependsOn=[])=>({role,title,instruction:'Produire la contribution locale du scénario.',criteria:'Le paquet est présent et vérifié honnêtement.',deliverables,dependsOn});
 const plan={title:'Transport intégral du jeu',approach:'Une intégration suivie de sa recette.',sharedBrief:'Scénario de transport local uniquement, modèles simulés.',tasks:[task('code','Intégrer le jeu',roots),task('analyse','Effectuer la recette',['recette.md'],['t1'])]};
 const runAgent=async input=>{
  if(input.schema===PLAN_SCHEMA)return{text:JSON.stringify(plan)};
  const mission=[...app.missions.values()].find(item=>input.cwd===app.workDir(item.id)||input.cwd.startsWith(app.workDir(item.id)+path.sep));
  if(input.schema?.properties.reviews){
   const requested=JSON.parse(input.prompt.match(/TÂCHES À CONTRÔLER :\n([^\n]+)/u)[1]);
   for(const row of requested){
    trace.push({kind:'review',id:row.taskId,packageFiles:row.packageFiles});
    if(row.taskId==='t1'){
     if(damage==='mutated')writeFileSync(path.join(app.workDir(mission.id),'t1-code','assets','player.svg'),'<svg xmlns="http://www.w3.org/2000/svg"><circle r="99"/></svg>');
    }
   }
   return{text:JSON.stringify({reviews:requested.map(row=>({taskId:row.taskId,approved:true,feedback:'Avis favorable simulé ; la garde matérielle doit encore vérifier le paquet.'}))})};
  }
  if(input.schema?.properties.approved)return{text:JSON.stringify({approved:true,feedback:'Validation finale simulée du scénario de transport, pas du gameplay.'})};
  const current=mission.tasks.find(item=>path.basename(input.cwd)===`${item.id}-${item.role}`);
  if(!current)return{text:'Bilan simulé de transport local.'};
  trace.push({kind:'creation',id:current.id});
  if(current.id==='t1'){
   for(const [relative,value]of Object.entries(files)){
    const target=path.join(input.cwd,relative);mkdirSync(path.dirname(target),{recursive:true});
    if(damage==='symlink'&&relative==='assets/player.svg'){
     const outside=path.join(dataDir,'outside.svg');writeFileSync(outside,'<svg xmlns="http://www.w3.org/2000/svg"><circle r="77"/></svg>');
     rmSync(target,{force:true});symlinkSync(outside,target);continue;
    }
    writeFileSync(target,value);
   }
  }else{
   for(const [relative,value]of Object.entries(files))assert.equal(readFileSync(path.join(input.cwd,'Contributions','t1-code',relative),'utf8'),value,`QA must receive ${relative}.`);
   assert.equal(current.inputContributions[0].files.length,14);writeFileSync(path.join(input.cwd,'recette.md'),'Les quatorze fichiers sont présents dans le scénario de transport. Aucun test de jeu réel n’est revendiqué.');
  }
  return{text:'Rapport fictif, sans appel réel au moteur ni compte.'};
 };
 app=new Atelier({dataDir,providers:[{id:'codex',available:true}],runAgent});
 t.after(async()=>{for(const id of app.runs.keys())app.stop(id);await Promise.all([...app.runs.keys()].map(id=>app.wait(id)));rmSync(dataDir,{recursive:true,force:true});});
 return{app,trace,dataDir};
}

test('the QA specialist receives all fourteen approved package files although the integration declared only five deliverables',async t=>{
 const {app,trace}=setup(t),initial=app.start({prompt:'Recrute une équipe et vérifie le transport complet du jeu.'}),done=await app.wait(initial.id);
 assert.equal(done.status,'completed',done.error);assert.equal(done.tasks[0].outputFingerprints.length,14);assert.equal(done.tasks[1].inputContributions[0].files.length,14);
 assert.equal(trace.find(item=>item.kind==='review'&&item.id==='t1').packageFiles.length,14,'Oscar sees the package manifest in the real review request.');
 assert.equal(trace.filter(item=>item.kind==='creation'&&item.id==='t2').length,1);
 for(const file of done.tasks[1].inputContributions[0].files)assert.equal(file.sha256,done.tasks[0].outputFingerprints.find(source=>file.path.endsWith('/'+source.path)).sha256);
});

test('changing an undeclared but referenced sprite during review cannot become an approved package or reach QA',async t=>{
 const {app,trace}=setup(t,{damage:'mutated'}),initial=app.start({prompt:'Recrute une équipe pour un paquet de jeu vérifié.'}),done=await app.wait(initial.id);
 assert.equal(done.status,'needs_review',done.error);assert.equal(done.tasks[0].status,'needs_review');assert.equal(done.tasks[0].attempt,2);
 assert.match(done.tasks[0].review.feedback,/assets\/player\.svg/u);assert.equal(trace.some(item=>item.kind==='creation'&&item.id==='t2'),false);
});

test('a referenced sprite symlink cannot copy an outside file or be approved by a favorable model',async t=>{
 const {app,trace,dataDir}=setup(t,{damage:'symlink'}),initial=app.start({prompt:'Recrute une équipe pour contrôler les fichiers locaux.'}),done=await app.wait(initial.id);
 assert.equal(done.status,'needs_review',done.error);assert.equal(trace.some(item=>item.kind==='creation'&&item.id==='t2'),false);
 assert.equal(readFileSync(path.join(dataDir,'outside.svg'),'utf8'),'<svg xmlns="http://www.w3.org/2000/svg"><circle r="77"/></svg>');
 assert.ok(!existsSync(path.join(app.workDir(initial.id),'t2-analyse','Contributions','t1-code','assets','player.svg')));
});

test('a legacy five-file approval receives a real salvage review before its expanded package can be passed to QA',async t=>{
 const {app,trace}=setup(t),initial=app.start({prompt:'Recrute une équipe pour tester une reprise de paquet.'});await app.wait(initial.id);
 const mission=app.missions.get(initial.id);mission.status='needs_review';mission.phase='Recette à compléter';mission.recovery={limit:1,used:0};
 mission.tasks[0].outputFingerprints=mission.tasks[0].outputFingerprints.filter(file=>roots.includes(file.path));
 mission.tasks[1].status='needs_review';mission.tasks[1].attempt=2;mission.tasks[1].review={approved:false,feedback:'Le paquet transmis par l’ancienne version était incomplet.'};
 app.save(mission);trace.length=0;
 app.resume(initial.id);const done=await app.wait(initial.id);
 assert.equal(done.status,'completed',done.error);assert.equal(done.recovery.used,1);assert.equal(done.tasks[0].outputFingerprints.length,14);
 assert.deepEqual(trace.filter(item=>item.kind==='review').map(item=>item.id),['t1','t2']);
 assert.equal(trace.some(item=>item.kind==='creation'),false,'Already present files are reviewed, not silently regenerated.');
 assert.equal(done.tasks[1].inputContributions[0].files.length,14);assert.equal(done.tasks[1].recoveryWriteRemaining,1,'Salvage review did not spend or renew a writing retry.');
});

test('an independent renderer with a fallback bench reaches the integrator and final QA without owning the designers’ sprite',async t=>{
 const dataDir=mkdtempSync(path.join(os.tmpdir(),'oscar-component-bench-'));let app;const created=[],reviewed=[];
 const svg='<svg xmlns="http://www.w3.org/2000/svg"><rect width="20" height="20"/></svg>',renderer='export const image=new URL("../assets/building.svg",import.meta.url).href;export const fallback=true;',bench='<script type="module">import {fallback} from "../js/renderer.js";document.body.textContent=String(fallback);</script>';
 const task=(role,title,deliverables,dependsOn=[])=>({role,title,instruction:title,criteria:'Vérifier le fichier dans son périmètre, sans revendiquer un test de jeu.',deliverables,dependsOn});
 const tasks=[task('design','Créer le décor',['assets/building.svg']),task('code','Développer le rendu Canvas',['js/renderer.js','tests/rendu.html']),task('code','Assembler le jeu complet',['index.html','js/main.js'],['t1','t2']),task('analyse','Vérifier le paquet complet',['recette.md'],['t3'])];
 const runAgent=async input=>{
  if(input.schema===PLAN_SCHEMA)return{text:JSON.stringify({title:'Paquets de composant et application',approach:'Périmètres indépendants puis intégration.',sharedBrief:'Scénario fictif local.',tasks})};
  if(input.schema?.properties.reviews){const rows=JSON.parse(input.prompt.match(/TÂCHES À CONTRÔLER :\n([^\n]+)/u)[1]);for(const row of rows){reviewed.push(row.taskId);assert.deepEqual(row.packageIssues,[]);}return{text:JSON.stringify({reviews:rows.map(row=>({taskId:row.taskId,approved:true,feedback:'Fichiers du périmètre réellement lus dans le scénario simulé.'}))})};}
  if(input.schema?.properties.approved)return{text:JSON.stringify({approved:true,feedback:'Contrôle final simulé.'})};
  const current=[...app.missions.values()][0].tasks.find(item=>path.basename(input.cwd)===`${item.id}-${item.role}`);if(!current)return{text:'Bilan fictif.'};created.push(current.id);
  const write=(file,value)=>{mkdirSync(path.dirname(path.join(input.cwd,file)),{recursive:true});writeFileSync(path.join(input.cwd,file),value);};
  if(current.id==='t1')write('assets/building.svg',svg);
  if(current.id==='t2'){write('js/renderer.js',renderer);write('tests/rendu.html',bench);assert.equal(existsSync(path.join(input.cwd,'assets/building.svg')),false);}
  if(current.id==='t3'){
   assert.equal(readFileSync(path.join(input.cwd,'Contributions/t2-code/js/renderer.js'),'utf8'),renderer);
   write('assets/building.svg',readFileSync(path.join(input.cwd,'Contributions/t1-design/assets/building.svg')));write('js/renderer.js',readFileSync(path.join(input.cwd,'Contributions/t2-code/js/renderer.js')));
   write('index.html','<script type="module" src="js/main.js"></script>');write('js/main.js','import {fallback} from "./renderer.js";document.body.textContent=String(fallback);');
  }
  if(current.id==='t4'){assert.equal(current.inputContributions[0].files.length,4);assert.equal(readFileSync(path.join(input.cwd,'Contributions/t3-code/assets/building.svg'),'utf8'),svg);write('recette.md','Paquet transporté. Aucun vrai essai de jeu revendiqué.');}
  return{text:'Contribution fictive, sans test navigateur revendiqué.'};
 };
 app=new Atelier({dataDir,providers:[{id:'codex',available:true}],runAgent});t.after(async()=>{for(const id of app.runs.keys())app.stop(id);await Promise.all([...app.runs.keys()].map(id=>app.wait(id)));rmSync(dataDir,{recursive:true,force:true});});
 const initial=app.start({prompt:'Recrute une équipe pour vérifier le rendu indépendant puis son intégration.'}),done=await app.wait(initial.id);
 assert.equal(done.status,'completed',done.error);assert.equal(done.tasks[1].outputFingerprints.length,2);assert.equal(done.tasks[2].outputFingerprints.length,4);assert.deepEqual(created.slice().sort(),['t1','t2','t3','t4']);assert.equal(reviewed.length,4);assert.equal(done.recovery.used,0);
});
