import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {mkdtempSync,rmSync,writeFileSync,readFileSync,readdirSync,symlinkSync,existsSync} from 'node:fs';
import {createAtelierServer} from '../server.mjs';
import {DocumentLibrary} from '../lib/document-library.mjs';
import {Personalization} from '../lib/personalization.mjs';

const WORD=Buffer.from('UEsDBBQAAAAAADEnU13HHBc8CAAAAAgAAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbDxUeXBlcy8+UEsDBBQAAAAAADEnU11LUQoiHQAAAB0AAAARAAAAd29yZC9kb2N1bWVudC54bWw8ZG9jdW1lbnQ+T3JpZ2luYWw8L2RvY3VtZW50PlBLAQIUAxQAAAAAADEnU13HHBc8CAAAAAgAAAATAAAAAAAAAAAAAACAAQAAAABbQ29udGVudF9UeXBlc10ueG1sUEsBAhQDFAAAAAAAMSdTXUtRCiIdAAAAHQAAABEAAAAAAAAAAAAAAIABOQAAAHdvcmQvZG9jdW1lbnQueG1sUEsFBgAAAAACAAIAgAAAAIUAAAAAAA==','base64');
const PDF=Buffer.from('%PDF-1.4\n% Fixture only\n%%EOF');
const plan={title:'Note publique',approach:'Rédiger puis vérifier.',tasks:[{role:'redaction',title:'Rédiger la note',instruction:'Préparer une note sourcée.',criteria:'Texte complet.',deliverables:[]}]};
async function setup(t,options={}){
 const dataDir=mkdtempSync(path.join(os.tmpdir(),'oscar-server-docs-'));
 const app=await createAtelierServer({port:0,dataDir,providers:[],demoDelay:0,...options});await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{await app.close();rmSync(dataDir,{recursive:true,force:true});});
 const base=`http://127.0.0.1:${app.server.address().port}`;
 const send=(route,body={},method='POST',headers={})=>fetch(base+route,{method,headers:{'Content-Type':'application/json','X-Oscar-Client':'1',...headers},body:JSON.stringify(body)});
 return{app,dataDir,base,send};
}

test('profile and document routes preserve local guards, explicit consent, import limits and known folders',async t=>{
 const opened=[],weatherCalls=[];
 const{app,base,send}=await setup(t,{openFolder:async value=>opened.push(value),personalizationFactory:options=>new Personalization({...options,fetchImpl:async(url)=>{weatherCalls.push(url);const now=new Date().toISOString();return new Response(JSON.stringify({properties:{timeseries:[{time:now,data:{instant:{details:{air_temperature:12}},next_1_hours:{summary:{symbol_code:'cloudy'}}}}]}}));}})});
 assert.equal((await fetch(base+'/api/profile')).status,200);assert.equal((await fetch(base+'/api/profile/weather')).status,200);assert.equal(weatherCalls.length,0);
 const locations=await fetch(base+'/api/profile/regions?q=Bruxelles&language=nl').then(value=>value.json());assert.equal(locations.regions[0].id,'2800866');assert.equal(weatherCalls.length,0);
 assert.equal((await send('/api/profile',{name:'Renaud',region:'',latitude:null,longitude:null,weatherEnabled:false},'POST',{Origin:'https://external.invalid'})).status,403);
 assert.equal((await send('/api/profile',{name:'Renaud',region:'Bruxelles',latitude:50.8503,longitude:4.3517,weatherEnabled:true})).status,200);assert.equal(weatherCalls.length,0);
 const weather=await fetch(base+'/api/profile/weather').then(value=>value.json());assert.equal(weather.weather.status,'ready');assert.equal(weatherCalls.length,1);assert.match(weatherCalls[0],/lat=50\.85&lon=4\.35$/);
 assert.equal((await fetch(base+'/api/documents')).status,200);
 const importResponse=await send('/api/documents/import',{name:'Maximum.txt',base64:Buffer.alloc(5*1024*1024,65).toString('base64')});assert.equal(importResponse.status,201);const item=await importResponse.json();assert.equal(item.size,5*1024*1024);
 assert.equal((await send('/api/documents/import',{name:'File.txt',base64:'YQ==',path:'/private/file'})).status,400);
 assert.equal((await send('/api/documents/import',{name:'Too large.txt',base64:'A'.repeat(7*1024*1024)})).status,413);
 assert.equal((await send('/api/profile',{name:'A'.repeat(100001)})).status,413);
 assert.equal((await send('/api/documents/install',{confirmed:false})).status,400);
 assert.equal((await send('/api/documents/open-folder',{path:'/arbitrary/ignored'})).status,200);assert.deepEqual(opened,[app.documents.directory]);
 assert.equal((await send('/api/documents/'+item.id,{},'DELETE',{Origin:'https://external.invalid'})).status,403);
 assert.equal((await fetch(base+'/api/documents/'+item.id,{method:'DELETE',headers:{'X-Oscar-Client':'1'}})).status,403);
 assert.equal((await send('/api/documents/'+item.id,{},'DELETE')).status,200);assert.equal((await app.documents.state()).items.length,0);
 for(const file of ['personalization-dialog.js','personalization-dialog.css','character-lines.js','document-library.js','document-library.css','voice-preview-oscar-2-fr.wav','voice-preview-zoe-vera-v2-en.wav','voice-preview-oscar-paul-v2-fr.wav','office-theme-init.js','office-theme.css','mission-timing.js','translations-performance.js','translations-voices.js'])assert.equal((await fetch(base+'/'+file)).status,200,file);
 for(const old of ['voice-preview-oscar-fr.wav','voice-preview-zoe-2-en.wav'])assert.equal((await fetch(base+'/'+old)).status,404);
 assert.equal((await fetch(base+'/../lib/personalization.mjs')).status,404);assert.equal((await fetch(base+'/resources/cities.json')).status,404);
});

test('mission preflight pins revisions and copies references before the runner; approved exports use the immutable template',async t=>{
 let app,finalApproved=false,models=0,originalTemplate;const jobs=[];
 const fixture=await setup(t,{providers:[{id:'codex',available:true}],documentFactory:options=>new DocumentLibrary({...options,pythonBinary:'/simulated/python',run:async(_binary,args,{input}={})=>{if(args.includes('-c'))return'ok';if(args.at(-1).endsWith('reference-reader.py'))return JSON.stringify({text:'Original — modèle de démonstration',status:'ready',warnings:[],characters:33,styleHints:{}});assert.equal(finalApproved,true,'Export ran before final approval');const job=JSON.parse(input);jobs.push(job);return JSON.stringify({files:[{format:'pdf',base64:PDF.toString('base64')}],warnings:[]});}}),runner:async({cwd,schema,prompt})=>{
   models++;if(schema?.properties?.tasks){assert.ok(existsSync(path.join(cwd,'References')));const files=readdirSync(path.join(cwd,'References')).filter(name=>name.endsWith('.md'));assert.equal(readFileSync(path.join(cwd,'References',files[0]),'utf8'),'Source officielle publique');assert.ok(existsSync(path.join(cwd,'Modele de mise en page','References')));writeFileSync(path.join(app.documents.directory,originalTemplate.name),'Original modified by the user');return{text:JSON.stringify(plan)};}
   if(schema?.properties?.approved){if(prompt.includes('contrôle final'))finalApproved=true;return{text:JSON.stringify({approved:true,feedback:'Conforme.'})};}
   return{text:'# Note publique\n\nUn texte vérifiable pour la livraison.'};
 }});app=fixture.app;
 const reference=await app.documents.import({name:'Source.md',base64:Buffer.from('Source officielle publique').toString('base64')});originalTemplate=await app.documents.import({name:'Modele.docx',base64:WORD.toString('base64')});
 const wrong=await fixture.send('/api/missions',{prompt:'Une note',provider:'codex',references:[{id:reference.id,revision:'0'.repeat(64)}]});assert.equal(wrong.status,400);assert.equal(models,0);assert.equal(app.engine.missions.size,0);
 app.documents.runtime.available=false;assert.equal((await fixture.send('/api/missions',{prompt:'Une note',provider:'codex',outputFormats:['pdf']})).status,400);assert.equal(models,0);app.documents.runtime.available=true;
 app.documents.runtime.available=false;const missingReader=await fixture.send('/api/missions',{prompt:'Une note avec un exemple',provider:'codex',referenceIds:[originalTemplate.id]});assert.equal(missingReader.status,400);assert.equal((await missingReader.json()).code,'DOCUMENT_RUNTIME');assert.equal(models,0);assert.equal(app.engine.missions.size,0);app.documents.runtime.available=true;
 const created=await fixture.send('/api/missions',{prompt:'Une note',provider:'codex',references:[{id:reference.id,revision:reference.revision}],referenceIds:[reference.id],outputFormats:['pdf'],templateId:originalTemplate.id,templateRevision:originalTemplate.revision,locale:'nl'});assert.equal(created.status,202);const started=await created.json();await app.engine.wait(started.id);const done=app.engine.get(started.id);
 assert.equal(done.status,'completed',done.error);assert.equal(jobs.length,1);assert.equal(jobs[0].locale,'nl');assert.equal(jobs[0].template.base64,WORD.toString('base64'));assert.equal(done.references[0].revision,reference.revision);assert.equal(done.templateReference.revision,originalTemplate.revision);
 assert.ok(done.exports[0].path.startsWith('Livraison/Exports/'));assert.ok(done.files.some(file=>file.path===done.exports[0].path));assert.deepEqual(readFileSync(path.join(app.engine.workDir(done.id),done.exports[0].path)),PDF);
 assert.equal(readFileSync(path.join(app.documents.directory,reference.name),'utf8'),'Source officielle publique');assert.equal(readFileSync(path.join(app.documents.directory,originalTemplate.name),'utf8'),'Original modified by the user');
});

test('manual document export requires a terminal mission and a known safe source, without running a model',async t=>{
 let models=0;const{app,base,dataDir,send}=await setup(t,{runner:async()=>{models++;throw new Error('No real model');},documentFactory:options=>new DocumentLibrary({...options,pythonBinary:'/simulated/python',run:async(_binary,args)=>args.includes('-c')?'ok':JSON.stringify({files:[{format:'pdf',base64:PDF.toString('base64')}],warnings:[]})})});
 const mission=app.engine.start({prompt:'Une visite de démonstration',provider:'demo'});await app.engine.wait(mission.id);
 const route=`/api/missions/${mission.id}/export`,result=await send(route,{path:'Demonstration.md',formats:['pdf']});assert.equal(result.status,200,await result.clone().text());const output=await result.json();assert.ok(output.files[0].path.startsWith('Livraison/Exports/'));assert.equal(models,0);
 assert.equal((await send(route,{path:null,formats:['pdf']},'POST',{Origin:'https://external.invalid'})).status,403);
 assert.equal((await send(route,{path:'../outside.txt',formats:['pdf']})).status,403);assert.equal((await send(route,{path:'/private/file.md',formats:['pdf']})).status,403);
 assert.equal((await send(route,{formats:['pdf'],sourceText:'arbitrary HTTP text'})).status,400);
 const work=app.engine.workDir(mission.id);writeFileSync(path.join(work,'Unlisted.md'),'Not in inventory');assert.equal((await send(route,{path:'Unlisted.md',formats:['pdf']})).status,403);
 const outside=path.join(dataDir,'private.md');writeFileSync(outside,'Private data');symlinkSync(outside,path.join(work,'Linked.md'));app.engine.missions.get(mission.id).files.push({path:'Linked.md',size:12});assert.equal((await send(route,{path:'Linked.md',formats:['pdf']})).status,403);
 assert.equal((await send('/api/missions/unknown/export',{formats:['pdf']})).status,404);
 const live=app.engine.missions.get(mission.id);live.status='running';assert.equal((await send(route,{formats:['pdf']})).status,409);live.status='completed';
 assert.equal((await fetch(base+`/api/missions/${mission.id}/files/${encodeURIComponent(output.files[0].path)}`)).status,200);
});
