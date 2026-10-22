import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,realpath} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {AppUpdates} from '../lib/app-updates.mjs';
import {appUpdateView} from '../public/app-updates.js';

async function fixture(t,fetchImpl){
  const base=await realpath(await mkdtemp(path.join(os.tmpdir(),'oscar-update-receipt-'))),root=path.join(base,'installation'),dataDir=path.join(base,'personal-data'),restartId='a'.repeat(64),currentVersion='0.6.12';
  const files={'package.json':JSON.stringify({name:'oscar-et-les-agents',version:currentVersion}),'server.mjs':'// fixture','launch.mjs':'// fixture','public/index.html':'<!doctype html>','lib/orchestrator.mjs':'// fixture','scripts/install.mjs':'// fixture'};
  for(const[name,bytes]of Object.entries(files)){await mkdir(path.dirname(path.join(root,name)),{recursive:true});await writeFile(path.join(root,name),bytes);}
  await mkdir(path.join(dataDir,'app-updates'),{recursive:true});await writeFile(path.join(dataDir,'app-updates','result.json'),JSON.stringify({status:'updated',fromVersion:'0.6.11',toVersion:currentVersion,restartId,finishedAt:1000}));
  const calls=[];const updates=new AppUpdates({root,dataDir,currentVersion,env:{OSCAR_UPDATE_RESTART_ID:restartId},fetchImpl:(url,options)=>{calls.push({url,options});return fetchImpl(url,options);},requestShutdown:()=>assert.fail('No restart permitted'),prepare:()=>assert.fail('No download permitted'),launch:()=>assert.fail('No update worker permitted')});await updates.ready;
  t.after(async()=>{await updates.close();await rm(base,{recursive:true,force:true});});return{updates,calls};
}
const release=version=>new Response(JSON.stringify({tag_name:'v'+version,draft:false,prerelease:false,html_url:'https://github.com/renaud-bxl/oscar-et-les-agents/releases/tag/v'+version,body:'Version publique simulée.'}));

test('a successful restart receipt cannot hide checking or the next available release',async t=>{
  let resolve;const f=await fixture(t,()=>new Promise(done=>{resolve=done;}));assert.equal(f.updates.state.status,'updated');assert.equal(f.calls.length,0);const pending=f.updates.check();await Promise.resolve();assert.equal(f.updates.state.status,'checking');assert.equal(f.updates.state.result.status,'updated');
  resolve(release('0.6.13'));const checked=await pending;assert.equal(checked.status,'available');assert.equal(checked.currentVersion,'0.6.12');assert.equal(checked.latestVersion,'0.6.13');assert.equal(checked.canInstall,true);assert.equal(checked.maintenance,false);assert.deepEqual(checked.result,{status:'updated',fromVersion:'0.6.11',toVersion:'0.6.12',finishedAt:1000});
  const view=appUpdateView(checked,{clientVersion:'0.6.12',locale:'fr'});assert.equal(view.available,true);assert.equal(view.reloadRequired,false);assert.equal(view.label,'Une nouvelle version d’Oscar est disponible.');assert.equal(view.canInstall,true);assert.equal(f.calls.length,1);assert.ok(f.calls[0].url.endsWith('/releases/latest'));
});

test('later up-to-date checks and network failures remain truthful while retaining update history',async t=>{
  for(const outcome of['current','offline'])await t.test(outcome,async t=>{
    const f=await fixture(t,async()=>{if(outcome==='offline')throw new Error('Synthetic offline');return release('0.6.12');});const checked=await f.updates.check();assert.equal(checked.status,outcome==='offline'?'error':'up_to_date');assert.equal(checked.result.status,'updated');assert.equal(checked.canInstall,false);assert.equal(checked.maintenance,false);
    const view=appUpdateView(checked,{clientVersion:'0.6.12',locale:'fr'});assert.equal(view.reloadRequired,false);if(outcome==='offline'){assert.equal(checked.error.code,'UPDATE_NETWORK');assert.match(view.label,/hors connexion/u);}else{assert.equal(checked.error,null);assert.equal(view.label,'Oscar est à jour.');}assert.equal(f.calls.length,1);
  });
});
