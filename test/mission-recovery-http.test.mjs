import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {createAtelierServer} from '../server.mjs';
import {requestMissionRecovery} from '../public/mission-recovery.js';

test('a lost repair response is resolved by reading the same mission, without posting again',async()=>{
  const mission={id:'project',status:'failed',recovery:{used:0,canResume:true}},calls=[];
  const response=await requestMissionRecovery(async(route,options)=>{calls.push({route,options});if(options)throw new Error('Lost response');return{...mission,status:'running',recovery:{used:0,canResume:false,reason:'active'}};},mission);
  assert.equal(response.status,'running');assert.equal(calls.length,2);assert.equal(calls.filter(call=>call.options?.method==='POST').length,1);
});

test('a rejected or unconfirmed repair is never silently submitted again',async()=>{
  const mission={id:'project',status:'failed',recovery:{used:0,canResume:true}};let posts=0,reads=0;
  await assert.rejects(requestMissionRecovery(async(_route,options)=>{if(options){posts++;throw new Error('Lost response');}reads++;return mission;},mission),/reprise n’a pas pu être confirmée/u);
  assert.equal(posts,1);assert.equal(reads,1);
  const rejected=Object.assign(new Error('Permission required'),{status:409});
  await assert.rejects(requestMissionRecovery(async()=>{throw rejected;},mission),error=>error===rejected);
  await assert.rejects(requestMissionRecovery(()=>assert.fail('No request is allowed'),{...mission,recovery:{canResume:false}}));
});

test('HTTP repair requires its explicit action, preserves the project and rejects duplicates',async t=>{
  const dataDir=await mkdtemp(path.join(os.tmpdir(),'oscar-http-recovery-'));
  const id=randomUUID(),folder=path.join(dataDir,'missions','Projet conservé'),work=path.join(folder,'travail');
  await mkdir(work,{recursive:true});await writeFile(path.join(work,'original.txt'),'Le document original reste intact.');
  const seed={id,title:'Projet conservé',prompt:'Créer un court rapport local.',provider:'codex',status:'failed',phase:'Interrompu',createdAt:Date.now(),updatedAt:Date.now(),events:[],result:null,error:'Délai dépassé',referenceIds:[],references:[],outputFormats:[],files:[{path:'original.txt',size:35}],tasks:[{id:'t1',role:'code',title:'Rédiger le rapport',instruction:'Créer rapport.md',criteria:'Le rapport existe.',deliverables:['rapport.md'],dependsOn:[],status:'failed',attempt:1,report:'',review:null}]};
  await writeFile(path.join(folder,'state.json'),JSON.stringify(seed));
  let creations=0,release;const held=new Promise(resolve=>{release=resolve;});
  const app=await createAtelierServer({dataDir,port:0,providers:[{id:'codex',available:true}],runner:async input=>{
    if(input.schema?.properties.tasks)assert.fail('Repair must not replan an existing project.');
    if(input.schema?.properties.reviews){const rows=JSON.parse(input.prompt.match(/TÂCHES À CONTRÔLER :\n([^\n]+)/u)[1]);return{text:JSON.stringify({reviews:rows.map(row=>({taskId:row.taskId,approved:true,feedback:'Fichier local contrôlé par un moteur simulé.'}))})};}
    if(input.schema?.properties.approved)return{text:JSON.stringify({approved:true,feedback:'Rapport local complet.'})};
    if(path.basename(input.cwd)==='t1-code'){creations++;await held;await writeFile(path.join(input.cwd,'rapport.md'),'# Rapport local\nLe travail de test est terminé.');return{text:'Rapport réel enregistré.'};}
    return{text:'# Résultat\nLe rapport est dans t1-code/rapport.md.'};
  }});
  t.after(async()=>{release();await app.close();await rm(dataDir,{recursive:true,force:true});});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${app.server.address().port}`;
  const post=async(body,extra='')=>{const r=await fetch(`${base}/api/missions/${id}/resume${extra}`,{method:'POST',headers:{'Content-Type':'application/json','X-Oscar-Client':'1'},body:JSON.stringify(body)});return{status:r.status,body:await r.json()};};
  assert.equal((await post({})).status,400);assert.equal((await post({confirmed:true,provider:'claude'})).status,400);assert.equal((await post({confirmed:true},'?retry=1')).status,400);assert.equal(creations,0);
  const before=app.engine.get(id).workDirectory;
  const accepted=await post({confirmed:true});assert.equal(accepted.status,202);assert.equal(accepted.body.id,id);assert.equal(accepted.body.workDirectory,before);
  const duplicate=await post({confirmed:true});assert.equal(duplicate.status,409);release();
  const done=await app.engine.wait(id);assert.equal(done.status,'completed',done.error);assert.equal(done.recovery.used,1);assert.equal(creations,1);assert.equal(await readFile(path.join(work,'original.txt'),'utf8'),'Le document original reste intact.');
  assert.equal((await post({confirmed:true})).status,409);assert.equal(creations,1);
});
