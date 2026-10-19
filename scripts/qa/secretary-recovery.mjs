/** Browser regressions for exact service selection and uncertain Zoé requests. */
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {startOfficeFixture,launchBrowser,preparePage} from './office-fixture.mjs';

const output=process.env.OSCAR_QA_OUTPUT||path.join(os.tmpdir(),'oscar-secretary-recovery');
await mkdir(output,{recursive:true});
const fixture=await startOfficeFixture(),checks=[],posts=[],reads=[];
let browser,page,errors=[],external=[];
const gmail={client:'codex',name:'qa-gmail',displayName:'Gmail · simulation',source:'chatgpt',inherited:true,status:'authorized',appId:'connector_qa_gmail',readOnlyAutomation:{available:true,service:'gmail'}};
const drive={...gmail,name:'qa-drive',displayName:'Google Drive · simulation',appId:'connector_qa_drive',readOnlyAutomation:{available:true,service:'app'}};
const claudeDrive={...drive,client:'claude',name:'claudeai-drive',source:'claude.ai',status:'connected',readOnlyAutomation:{available:true,service:'drive'}};
let rows=[gmail,drive,claudeDrive];
fixture.app.connectors.state=async()=>({catalog:[],connections:structuredClone(rows),jobs:[],clients:{codex:{available:true,status:'available'},claude:{available:true,status:'available'}}});
fixture.app.connectors.readPlan=async({client,name})=>{const row=rows.find(r=>r.client===client&&r.name===name&&!r.stale&&r.readOnlyAutomation.available);assert.ok(row,'Only the selected confirmed simulated service may be read.');reads.push({client,name});return Object.freeze({client,name,type:row.readOnlyAutomation.service,source:'chatgpt',appId:row.appId,enabledTools:['read']});};
const record=(name,details={})=>{checks.push({name,...details});console.log(JSON.stringify(checks.at(-1)));};

try{
 browser=await launchBrowser();({page,errors,external}=await preparePage(browser,fixture.base));
 page.on('request',r=>{if(r.method()==='POST'&&r.url()===fixture.base+'/api/secretary')posts.push(r.postDataJSON());});
 const open=async()=>{await page.locator('.office-dock [data-open-panel=team]').click();await page.locator('#open-secretary').click();};
 const refresh=async()=>{await page.locator('.secretary-aside .secretary-refresh').click();await page.waitForFunction(()=>!document.querySelector('.secretary-aside .secretary-refresh').disabled);};
 const locale=async value=>page.evaluate(async value=>(await import('/i18n.js')).setLocale(value),value);
 await open();await page.locator('[data-secretary-mode=service]').click();await page.locator('#secretary-client').selectOption('codex');await page.locator('#secretary-connection').selectOption('codex:qa-drive');await page.locator('#secretary-prompt').fill('Retrouve mon compte rendu dans Drive.');
 rows=[gmail,{...drive,stale:true,status:'unverified',readOnlyAutomation:{available:false,service:'app'}},claudeDrive];await refresh();
 assert.equal(await page.locator('#secretary-connection').inputValue(),'');assert.equal(await page.locator('.secretary-run').isEnabled(),false);
 await refresh();await locale('en');assert.equal(await page.locator('#secretary-connection').inputValue(),'');assert.equal(await page.locator('#secretary-prompt').inputValue(),'Retrouve mon compte rendu dans Drive.');
 rows=[gmail,drive,claudeDrive];await refresh();assert.equal(await page.locator('#secretary-connection').inputValue(),'');
 await page.locator('#secretary-connection').selectOption('codex:qa-drive');await page.locator('#secretary-client').selectOption('claude');assert.equal(await page.locator('#secretary-connection').inputValue(),'');
 await page.locator('#secretary-connection').selectOption('claude:claudeai-drive');await page.locator('[data-secretary-mode=mail]').click();assert.equal(await page.locator('#secretary-connection').inputValue(),'');
 assert.equal(posts.length,0);assert.equal(reads.length,0);record('Lost service, engine and mode choices stay empty across refreshes and language changes');await page.screenshot({path:path.join(output,'service-choice-required.png')});

 await page.locator('[data-secretary-mode=service]').click();await page.locator('#secretary-client').selectOption('codex');await page.locator('#secretary-connection').selectOption('codex:qa-drive');await page.locator('#secretary-prompt').fill('Retrouve mon document de reprise dans Drive.');
 let lostMission;await page.route(fixture.base+'/api/secretary',async route=>{const response=await route.fetch();lostMission=await response.json();await route.abort('failed');},{times:1});
 await page.locator('.secretary-run').click();await page.waitForFunction(()=>!document.querySelector('.secretary-error').hidden);assert.ok(lostMission?.id);await fixture.app.engine.wait(lostMission.id);
 assert.equal(await page.locator('#secretary-prompt').isDisabled(),true);assert.equal(await page.locator('#secretary-client').isDisabled(),true);assert.equal(await page.locator('[data-secretary-mode=free]').isDisabled(),true);
 const persisted=await page.evaluate(()=>localStorage.getItem('oscar.writing-drafts.v1'));assert.doesNotMatch(persisted,/connectorName|qa-drive|coordinates|latitude|longitude/);
 const held=[];for(let i=0;i<4;i++){const response=await fixture.post('/api/missions',{prompt:'QA_HOLD Réserve de capacité simulée '+i,provider:'codex'});assert.equal(response.status,202);held.push(response.body.id);}
 for(const provider of fixture.app.engine.providers)provider.auth.loggedIn=false;rows=[];
 const before={calls:fixture.metrics.calls,missions:fixture.app.engine.missions.size,posts:posts.length,reads:reads.length};await locale('nl');await page.reload({waitUntil:'networkidle'});await page.waitForFunction(()=>window.__oscarWorld);await open();
 assert.equal(await page.locator('#secretary-prompt').isDisabled(),true);assert.equal(await page.locator('.secretary-run').isEnabled(),true);assert.equal(await page.locator('#secretary-connection').isDisabled(),true);
 const receiptResponse=page.waitForResponse(r=>r.url()===fixture.base+'/api/secretary-requests/'+posts[0].requestId);await page.locator('.secretary-run').click();assert.equal((await receiptResponse).status(),200);await page.waitForSelector('.secretary-answer-text');
 assert.deepEqual({calls:fixture.metrics.calls,missions:fixture.app.engine.missions.size,posts:posts.length,reads:reads.length},before);
 assert.equal(await page.locator(`.secretary-answer[data-mission-id="${lostMission.id}"]`).count(),1);record('Accepted Drive request recovers after reload and language change with no service, login, free slot, read or model call',{missionId:lostMission.id,...before});await page.screenshot({path:path.join(output,'accepted-request-recovered.png')});
 for(const id of held)fixture.app.engine.stop(id);await Promise.all(held.map(id=>fixture.app.engine.wait(id)));for(const provider of fixture.app.engine.providers)provider.auth.loggedIn=true;rows=[gmail,drive,claudeDrive];fixture.app.engine.emit('change',fixture.app.engine.state());

 await locale('fr');await page.locator('[data-secretary-mode=free]').click();await page.locator('#secretary-prompt').fill('Propose une idée de repas simple.');
 await page.route(fixture.base+'/api/secretary',route=>route.abort('failed'),{times:1});await page.locator('.secretary-run').click();await page.waitForFunction(()=>!document.querySelector('.secretary-error').hidden);
 const absentBody=posts.at(-1),countBefore=posts.length,callsBefore=fixture.metrics.calls,readsBefore=reads.length;
 for(const response of [{status:503,body:{error:'Indisponibilité simulée'}},{status:202,body:{status:'checking'}}]){
  await page.route(fixture.base+'/api/secretary-requests/'+absentBody.requestId,route=>route.fulfill({status:response.status,contentType:'application/json',body:JSON.stringify(response.body)}),{times:1});await page.locator('.secretary-run').click();await page.waitForFunction(()=>!document.querySelector('.secretary-run').disabled);assert.equal(await page.locator('#secretary-prompt').isDisabled(),true);assert.equal(await page.locator('#secretary-client').isDisabled(),true);assert.equal(posts.length,countBefore);assert.equal(fixture.metrics.calls,callsBefore);
 }
 const absentResponse=page.waitForResponse(r=>r.url()===fixture.base+'/api/secretary-requests/'+absentBody.requestId);const acceptedResponse=page.waitForResponse(r=>r.url()===fixture.base+'/api/secretary'&&r.request().method()==='POST');await page.locator('.secretary-run').click();assert.equal((await absentResponse).status(),404);const retried=await(await acceptedResponse).json();await fixture.app.engine.wait(retried.id);assert.deepEqual(posts.at(-1),absentBody);assert.equal(reads.length,readsBefore);
 record('Lookup errors and checking never POST; a confirmed 404 retries the exact original free request and identity',{requestId:absentBody.requestId,missionId:retried.id});
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);await writeFile(path.join(output,'report.json'),JSON.stringify({checks,errors,external,posts,reads,metrics:fixture.metrics},null,2));
}finally{await browser?.close();await fixture.close();}
