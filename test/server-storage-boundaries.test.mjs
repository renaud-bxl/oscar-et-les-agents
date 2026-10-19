import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir,writeFile,rename,symlink,unlink,readdir} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createAtelierServer} from '../server.mjs';
import {DocumentLibrary} from '../lib/document-library.mjs';
const until=async predicate=>{for(let i=0;i<200;i++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,5));}throw Error('Expected cancellation was not observed');};
async function setup(t,options={}){const directory=await mkdtemp(path.join(os.tmpdir(),'oscar-storage-boundary-')),dataDir=path.join(directory,'local'),opened=[],folders=[];const app=await createAtelierServer({port:0,dataDir,providers:[],demoDelay:0,openFile:async file=>opened.push(file),openFolder:async folder=>folders.push(folder),...options});await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));t.after(async()=>{await app.close();await rm(directory,{recursive:true,force:true});});const mission=app.engine.start({provider:'demo',prompt:'Documents sans modèle'});await app.engine.wait(mission.id);const base=`http://127.0.0.1:${app.server.address().port}`,route=`/api/missions/${mission.id}`,post=(suffix,body={},options={})=>fetch(base+route+suffix,{method:'POST',headers:{'Content-Type':'application/json','X-Oscar-Client':'1'},body:JSON.stringify(body),...options});return{directory,dataDir,app,mission,base,route,post,opened,folders};}

test('downloads, native opening, folders and ZIP refuse symlinks in missions or the anchored data root',async t=>{
 const{directory,dataDir,app,mission,base,route,post,opened,folders}=await setup(t);
 for(const replaceRoot of [false,true]){
  const target=replaceRoot?dataDir:path.join(dataDir,'missions'),saved=target+'-original',outside=path.join(directory,replaceRoot?'outside-root':'outside-missions'),work=path.join(outside,...(replaceRoot?['missions']:[]),mission.folderName,'travail');
  await mkdir(work,{recursive:true});await writeFile(path.join(work,'external.txt'),'PRIVATE_SYNTHETIC_MARKER');await rename(target,saved);await symlink(outside,target);
  try{
   for(const suffix of ['/files/external.txt','/archive']){const response=await fetch(base+route+suffix);assert.equal(response.status,403,suffix);assert(!(await response.text()).includes('PRIVATE_SYNTHETIC_MARKER'));}
   assert.equal((await post('/open-file',{path:'external.txt'})).status,403);assert.equal((await post('/open-folder')).status,403);assert.equal(opened.length,0);assert.equal(folders.length,0);
  }finally{await unlink(target);await rename(saved,target);}
 }
 const valid=await fetch(base+route+'/files/Demonstration.md');assert.equal(valid.status,200);await valid.text();assert.equal((await post('/open-folder')).status,200);assert.equal((await fetch(base+route+'/archive')).status,200);
});

test('an initially linked data root is refused while a real directory under a legitimate canonical parent works',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'oscar-linked-root-'));t.after(()=>rm(directory,{recursive:true,force:true}));const actual=path.join(directory,'real'),linked=path.join(directory,'linked');await mkdir(actual);await symlink(actual,linked);
 await assert.rejects(createAtelierServer({port:0,dataDir:linked,providers:[]}),{code:'MISSION_FILE_FORBIDDEN'});
 const app=await createAtelierServer({port:0,dataDir:actual,providers:[],demoDelay:0});t.after(()=>app.close());const mission=app.engine.start({provider:'demo',prompt:'Dossier normal'});await app.engine.wait(mission.id);assert.equal(app.engine.get(mission.id).status,'completed');
});

test('abandoning a manual document export aborts the worker and leaves no partial delivery',async t=>{
 let enter,workerSignal;const started=new Promise(resolve=>{enter=resolve;});
 const{app,post}=await setup(t,{documentFactory:options=>new DocumentLibrary({...options,pythonBinary:'/mock/python',run:async(_binary,args,{signal}={})=>{if(args.includes('-c'))return'ok';workerSignal=signal;enter();return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Object.assign(Error('Stopped'),{code:'ABORT_ERR'})),{once:true}));}})});
 const controller=new AbortController(),response=post('/export',{formats:['pdf']},{signal:controller.signal}).catch(error=>error);await started;controller.abort();await response;await until(()=>workerSignal.aborted&&app.documents.exportTasks.size===0);
 const mission=[...app.engine.missions.values()][0],exports=path.join(app.engine.workDir(mission.id),'Livraison','Exports');assert.deepEqual(await readdir(exports),[]);assert.equal((mission.exports||[]).length,0);
});
