import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync,writeFileSync,symlinkSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createAtelierServer} from '../server.mjs';
import {DocumentLibrary} from '../lib/document-library.mjs';
import {updateBlockers} from '../lib/update-maintenance.mjs';
const DOCX=Buffer.from('UEsDBBQAAAAAADEnU13HHBc8CAAAAAgAAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbDxUeXBlcy8+UEsDBBQAAAAAADEnU11LUQoiHQAAAB0AAAARAAAAd29yZC9kb2N1bWVudC54bWw8ZG9jdW1lbnQ+T3JpZ2luYWw8L2RvY3VtZW50PlBLAQIUAxQAAAAAADEnU13HHBc8CAAAAAgAAAATAAAAAAAAAAAAAACAAQAAAABbQ29udGVudF9UeXBlc10ueG1sUEsBAhQDFAAAAAAAMSdTXUtRCiIdAAAAHQAAABEAAAAAAAAAAAAAAIABOQAAAHdvcmQvZG9jdW1lbnQueG1sUEsFBgAAAAACAAIAgAAAAIUAAAAAAA==','base64');
const result={kind:'word',status:'ready',warnings:[],blocks:[{kind:'paragraph',runs:[{text:'Texte <script> inerte',bold:false,italic:false,underline:false}],heading:0,alignment:'left'}]};
async function setup(t,{read=async()=>result}={}){
 const dataDir=mkdtempSync(path.join(os.tmpdir(),'oscar-office-http-'));let models=0,readerCalls=0;
 const app=await createAtelierServer({port:0,dataDir,providers:[],runner:async()=>{models++;assert.fail('No model may be called by a document reader');},documentFactory:options=>new DocumentLibrary({...options,pythonBinary:'/fake/python',run:async(_binary,args,options)=>{if(args.includes('-c'))return'ok';assert(args.at(-1).endsWith('passive-office-worker.py'));readerCalls++;return JSON.stringify(await read(options));}})});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));t.after(async()=>{await app.close();rmSync(dataDir,{recursive:true,force:true});});
 const mission={id:'office-qa',provider:'demo',title:'Documents de démonstration',prompt:'Vérification sans modèle',status:'completed',phase:'Livraison disponible',tasks:[],events:[],files:[],result:'Livraison fictive',createdAt:Date.now(),updatedAt:Date.now()};app.engine.missions.set(mission.id,mission);mkdirSync(app.engine.workDir(mission.id),{recursive:true});writeFileSync(path.join(app.engine.workDir(mission.id),'note.docx'),DOCX);writeFileSync(path.join(app.engine.workDir(mission.id),'texte.txt'),'Texte local');app.engine.scanFiles(mission);app.engine.save(mission);
 const base=`http://127.0.0.1:${app.server.address().port}`,post=(route,body,headers={})=>fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json','X-Oscar-Client':'1',...headers},body:JSON.stringify(body)});
 return{app,base,post,dataDir,mission,get models(){return models;},get readerCalls(){return readerCalls;}};
}

test('Office HTTP requires exact known-file input, keeps document content passive and serves its local assets',async t=>{
 const f=await setup(t);const route='/api/missions/office-qa/document-preview';
 assert.equal((await f.post(route,{path:'note.docx'},{Origin:'https://untrusted.invalid'})).status,403);
 for(const body of [{path:'../outside.docx'},{path:'unknown.docx'},{path:'note.docx',extra:true},{path:17},{path:'texte.txt'}])assert((await f.post(route,body)).status>=400);
 assert.equal((await f.post('/api/missions/unknown/document-preview',{path:'note.docx'})).status,404);assert.equal(f.readerCalls,0);
 const response=await f.post(route,{path:'note.docx'});assert.equal(response.status,200,await response.clone().text());const body=await response.json();assert.equal(body.blocks[0].runs[0].text,'Texte <script> inerte');assert.equal(body.kind,'word');assert.equal(body.name,'note.docx');assert.match(body.revision,/^[a-f0-9]{64}$/u);assert.equal(body.path,undefined);assert.equal(f.models,0);assert.equal(f.readerCalls,1);
 for(const file of ['office-viewer.js','office-viewer.css','translations-office.js'])assert.equal((await fetch(f.base+'/'+file)).status,200,file);assert((await fetch(f.base).then(r=>r.text())).includes('/office-viewer.css'));
 const outside=path.join(f.dataDir,'outside.docx');writeFileSync(outside,DOCX);symlinkSync(outside,path.join(f.app.engine.workDir(f.mission.id),'linked.docx'));f.mission.files.push({path:'linked.docx',size:DOCX.length});assert.equal((await f.post(route,{path:'linked.docx'})).status,403);assert.equal(f.readerCalls,1);
});

test('Office reader reservations block maintenance and a disconnected client stops the local reader',{timeout:5000},async t=>{
 let enter,stopped=false;const started=new Promise(resolve=>{enter=resolve;});const f=await setup(t,{read:async({signal})=>{enter();return new Promise((_,reject)=>{signal.addEventListener('abort',()=>{stopped=true;reject(Object.assign(Error('Stopped'),{code:'ABORT_ERR'}));},{once:true});});}});
 const controller=new AbortController(),request=fetch(f.base+'/api/missions/office-qa/document-preview',{method:'POST',headers:{'Content-Type':'application/json','X-Oscar-Client':'1'},body:JSON.stringify({path:'note.docx'}),signal:controller.signal}).catch(error=>error);t.after(()=>controller.abort());await Promise.race([started,request.then(async response=>{throw new Error(response instanceof Response?'Reader did not start: '+await response.text():String(response));})]);
 assert.equal(f.app.officePreview.activeJobs,1);assert(updateBlockers({documents:f.app.documents}).includes('documents'));assert.throws(()=>f.app.maintenance.reserve(updateBlockers({documents:f.app.documents})),{code:'UPDATE_BUSY'});controller.abort();await request;
 for(let n=0;n<100&&f.app.officePreview.activeJobs;n++)await new Promise(resolve=>setTimeout(resolve,5));assert(stopped);assert.equal(f.app.officePreview.activeJobs,0);assert.equal(f.app.documents.readerControllers.size,0);assert.equal(f.models,0);
});

test('HTTP removal is bound to the shown revision and preserves a changed example',async t=>{
 const f=await setup(t),item=await f.app.documents.import({name:'Exemple.txt',base64:Buffer.from('Version affichée').toString('base64')});writeFileSync(path.join(f.app.documents.directory,item.name),'Version nouvelle à conserver');
 const remove=body=>fetch(f.base+'/api/documents/'+item.id,{method:'DELETE',headers:{'Content-Type':'application/json','X-Oscar-Client':'1'},body:JSON.stringify(body)});
 assert.equal((await remove({})).status,400);assert.equal((await remove({revision:item.revision})).status,409);assert.equal((await f.app.documents.state()).items.length,1);const current=await f.app.documents.item(item.id);assert.equal((await remove({revision:current.revision})).status,200);assert.equal((await f.app.documents.state()).items.length,0);assert.equal(f.models,0);
});
