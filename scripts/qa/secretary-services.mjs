/** Exercise Zoé's services through an isolated office; every account and model is simulated. */
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {startOfficeFixture,launchBrowser,preparePage} from './office-fixture.mjs';

const output=process.env.OSCAR_QA_OUTPUT||path.join(os.tmpdir(),'oscar-secretary-services');
await mkdir(output,{recursive:true});
const fixture=await startOfficeFixture(),checks=[],posts=[],simulatedReads=[];
let browser,page,errors=[],external=[],releaseRoutines;
const record=(name,detail={})=>{checks.push({name,...detail});console.log(JSON.stringify(checks.at(-1)));};
const gmail={client:'codex',name:'qa-gmail',displayName:'Gmail · simulation',source:'chatgpt',inherited:true,status:'authorized',appId:'connector_qa_gmail',readOnlyAutomation:{available:true,service:'gmail'}};
const calendar={...gmail,name:'qa-calendar',displayName:'Google Agenda · simulation',appId:'connector_qa_calendar',readOnlyAutomation:{available:true,service:'calendar'}};
const drive={...gmail,name:'qa-drive',displayName:'Google Drive · simulation',appId:'connector_qa_drive',readOnlyAutomation:{available:true,service:'app'}};
const unavailable={...drive,name:'qa-design',displayName:'Design · simulation',appId:'connector_qa_design',readOnlyAutomation:{available:false,service:null}};
const oldDrive={...drive,name:'qa-old-drive',displayName:'Old Drive · simulation',stale:true,status:'unverified',readOnlyAutomation:{available:false,service:'app'}};
const confirmed=[drive,unavailable,calendar,oldDrive,gmail];
let snapshot={catalog:[],connections:structuredClone(confirmed),jobs:[],clients:{codex:{available:true,status:'checking'},claude:{available:true,status:'checking'}}};
let snapshots=0;
fixture.app.connectors.state=async()=>{snapshots++;return structuredClone(snapshot);};
fixture.app.connectors.readPlan=async({client,name})=>{
 const row=snapshot.connections.find(item=>item.client===client&&item.name===name&&item.stale!==true&&['authorized','connected'].includes(item.status)&&item.readOnlyAutomation?.available===true);
 assert.ok(row,'Only a confirmed simulated service may be selected.');
 simulatedReads.push({client,name});fixture.metrics.connectorReads++;
 return Object.freeze({client,name,type:row.readOnlyAutomation.service,source:'chatgpt',appId:row.appId,enabledTools:['read']});
};

try{
 browser=await launchBrowser();
 ({page,errors,external}=await preparePage(browser,fixture.base));
 let routinesWaiting=false,routinesReleased=false;
 const routineGate=new Promise(resolve=>{releaseRoutines=()=>{routinesReleased=true;resolve();};});
 await page.route(fixture.base+'/api/automations',async route=>{
  if(route.request().method()==='GET'&&!routinesReleased){routinesWaiting=true;await routineGate;}
  await route.continue();
 });
 page.on('request',request=>{if(request.method()==='POST'&&[fixture.base+'/api/secretary',fixture.base+'/api/automations'].includes(request.url()))posts.push({route:new URL(request.url()).pathname,body:request.postDataJSON()});});

 await page.locator('.office-dock [data-open-panel=team]').click();
 await page.locator('#open-secretary').click();
 await page.locator('#secretary-client').selectOption('codex');
 await page.waitForFunction(()=>document.querySelector('#secretary-connection').value==='codex:qa-gmail');
 assert.equal(routinesWaiting,true);assert.equal(routinesReleased,false);
 assert.equal(await page.locator('.secretary-run').isEnabled(),true);
 assert.match(await page.locator('.secretary-connection-note[role=status]').textContent(),/services confirmés/u);
 assert.equal(await page.locator('#secretary-schedule').inputValue(),'immediate');
 assert.equal(await page.locator('.secretary-program').isVisible(),false);
 assert.equal(await page.locator('#secretary-schedule-time').isVisible(),false);
 record('Gmail remains selectable while both clients are checking and the routine request is held');
 await page.screenshot({path:path.join(output,'gmail-pendant-verification.png')});

 snapshot.connections=confirmed.map(row=>row.name===gmail.name?{...row,stale:true,status:'unverified',readOnlyAutomation:{available:false,service:'gmail'}}:structuredClone(row));
 await page.waitForFunction(()=>document.querySelector('#secretary-connection').value==='',null,{timeout:7000});
 assert.equal(await page.locator('.secretary-run').isEnabled(),false);
 assert.equal(await page.locator('#secretary-connection option[value="codex:qa-gmail"]').count(),0);
 snapshot.connections=structuredClone(confirmed);
 await page.waitForFunction(()=>document.querySelector('#secretary-connection').value==='codex:qa-gmail',null,{timeout:7000});
 assert.equal(await page.locator('.secretary-run').isEnabled(),true);
 assert.equal(routinesReleased,false);
 record('Automatic updates remove a stale Gmail authorization and restore a newly confirmed snapshot',{snapshots});
 releaseRoutines();

 snapshot.clients={codex:{available:true,status:'available'},claude:{available:true,status:'failed'}};
 await page.locator('.secretary-aside .secretary-refresh').click();
 await page.waitForFunction(()=>document.querySelector('.secretary-connection-note[role=status]').textContent.includes('vérifié de nouveau'));
 assert.equal(await page.locator('.secretary-run').isEnabled(),true);
 record('A failed Claude check does not block the confirmed Codex services');

 await page.locator('[data-secretary-mode=service]').click();
 const options=await page.locator('#secretary-connection option').evaluateAll(nodes=>nodes.slice(1).map(node=>({value:node.value,text:node.textContent,disabled:node.disabled})));
 assert.deepEqual(options.slice(0,2).map(row=>row.value),['codex:qa-gmail','codex:qa-calendar']);
 assert.equal(options.find(row=>row.value==='codex:qa-drive').disabled,false);
 assert.equal(options.find(row=>row.value==='codex:qa-design').disabled,true);
 assert.match(options.find(row=>row.value==='codex:qa-design').text,/lecture non disponible/u);
 assert.equal(options.find(row=>row.value==='codex:qa-old-drive').disabled,true);
 assert.match(options.find(row=>row.value==='codex:qa-old-drive').text,/connexion à vérifier/u);
 assert.equal(await page.locator('.secretary-run').isEnabled(),false);
 record('My services lists connected apps, keeps Gmail and Calendar first, and disables unavailable or stale reads');

 await page.keyboard.press('Escape');
 await page.locator('#open-connectors').click();
 await page.locator('[data-connector-control="use:codex:qa-drive"]').click();
 await page.waitForFunction(()=>document.querySelector('#secretary-dialog').open&&document.querySelector('#secretary-connection').value==='codex:qa-drive');
 assert.equal(await page.locator('[data-secretary-mode=service]').getAttribute('aria-pressed'),'true');
 assert.equal(await page.locator('[data-secretary-mode=calendar]').getAttribute('aria-pressed'),'false');
 assert.equal(await page.locator('[data-secretary-mode=mail]').getAttribute('aria-pressed'),'false');
 assert.equal(await page.locator('#secretary-client').inputValue(),'codex');
 assert.equal(await page.locator('#secretary-schedule').inputValue(),'immediate');
 record('Use with Zoé on the Google Drive card opens My services with exactly Google Drive selected');

 await page.locator('#secretary-prompt').fill('Retrouve le compte rendu de contrôle dans mon Google Drive simulé.');
 const missionsBefore=fixture.app.engine.missions.size,callsBefore=fixture.metrics.calls;
 const [directResponse]=await Promise.all([
  page.waitForResponse(response=>response.url()===fixture.base+'/api/secretary'&&response.request().method()==='POST'),
  page.locator('.secretary-run').click(),
 ]);
 const mission=await directResponse.json();assert.equal(directResponse.status(),202,JSON.stringify(mission));
 await fixture.app.engine.wait(mission.id);
 assert.equal(fixture.app.engine.get(mission.id).status,'completed');
 await page.waitForSelector('.secretary-answer-text');
 assert.equal(fixture.app.engine.missions.size,missionsBefore+1);
 assert.equal(fixture.metrics.calls-callsBefore,2);
 assert.equal(fixture.app.automations.entries.size,0);
 assert.deepEqual(posts.map(item=>item.route),['/api/secretary']);
 assert.equal(posts[0].body.mode,'service');assert.equal(posts[0].body.connectorName,'qa-drive');
 assert.equal('schedule' in posts[0].body,false);assert.equal('enabledTools' in posts[0].body,false);
 assert.deepEqual(simulatedReads,[{client:'codex',name:'qa-drive'}]);
 record('Immediate work creates one direct simulated request and no routine or implicit daily schedule');

 await page.locator('#secretary-schedule').selectOption('daily');
 assert.equal(await page.locator('#secretary-schedule-time').inputValue(),'02:00');
 assert.equal(await page.locator('.secretary-program').isVisible(),true);
 await page.locator('#secretary-schedule-time').fill('17:45');
 const callsBeforeSchedule=fixture.metrics.calls;
 const [scheduledResponse]=await Promise.all([
  page.waitForResponse(response=>response.url()===fixture.base+'/api/automations'&&response.request().method()==='POST'),
  page.locator('.secretary-program').click(),
 ]);
 const routine=await scheduledResponse.json();assert.equal(scheduledResponse.status(),201,JSON.stringify(routine));
 await page.waitForFunction(()=>!document.querySelector('.secretary-program').disabled);
 assert.deepEqual(routine.schedule,{frequency:'daily',time:'17:45'});
 assert.equal(routine.connectorName,'qa-drive');assert.equal(routine.assistantMode,'service');
 assert.equal(fixture.app.automations.entries.size,1);
 assert.equal(fixture.app.engine.missions.size,missionsBefore+1);
 assert.equal(fixture.metrics.calls,callsBeforeSchedule);
 assert.deepEqual(posts.at(-1).body.schedule,{frequency:'daily',time:'17:45'});
 await page.locator('#secretary-schedule').selectOption('weekdays');
 assert.equal(await page.locator('#secretary-schedule-time').inputValue(),'08:30');
 await page.locator('#secretary-schedule').selectOption('daily');
 assert.equal(await page.locator('#secretary-schedule-time').inputValue(),'17:45');
 record('An explicit daily routine keeps 17:45 and the chosen Drive connection without launching another mission');

 for(const [locale,tab,immediate,timeLabel] of [
  ['fr','◇ Mes services','Travail immédiat','Heure locale de la routine'],
  ['en','◇ My services','Work now','Local time for the routine'],
  ['nl','◇ Mijn diensten','Meteen aan het werk','Lokale tijd voor de routine'],
 ]){
  await page.evaluate(async locale=>{const {setLocale}=await import('/i18n.js');setLocale(locale);},locale);
  await page.waitForFunction(expected=>document.querySelector('[data-secretary-mode=service]').textContent===expected,tab);
  assert.equal(await page.locator('#secretary-schedule option[value=immediate]').textContent(),immediate);
  assert.equal((await page.locator('label:has(#secretary-schedule-time) span').textContent()).trim(),timeLabel);
  assert.equal(await page.locator('#secretary-schedule-time').inputValue(),'17:45');
  assert.equal(await page.locator('#secretary-connection').inputValue(),'codex:qa-drive');
  if(locale!=='fr')assert.doesNotMatch(await page.locator('#secretary-connection').textContent(),/lecture non disponible|connexion à vérifier/u);
  await page.screenshot({path:path.join(output,`services-${locale}.png`)});
 }
 record('French, English and Dutch translate tabs, immediate work, time labels and unavailable statuses without changing the selection or 17:45');

 for(const width of [390,320]){
  await page.setViewportSize({width,height:844});
  await page.locator('#secretary-dialog').evaluate(dialog=>{dialog.scrollTop=0;});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert.equal(await page.locator('#secretary-dialog').evaluate(dialog=>dialog.scrollWidth<=dialog.clientWidth),true);
  assert.equal(await page.locator('[data-secretary-mode=service]').isVisible(),true);
  await page.screenshot({path:path.join(output,`services-mobile-${width}.png`)});
 }
 record('My services remains readable without horizontal overflow at 390 and 320 pixels');
 await page.locator('#secretary-schedule').selectOption('immediate');
 assert.equal(await page.locator('.secretary-program').isVisible(),false);
 assert.equal(await page.locator('#secretary-schedule-time').isVisible(),false);
 assert.equal(posts.length,2);
 const claudeDrive={...drive,client:'claude',name:'qa-claude-drive',source:'claude.ai',status:'connected',readOnlyAutomation:{available:true,service:'drive'}};
 snapshot.connections.push(claudeDrive);snapshot.clients.claude={available:true,status:'available'};
 await page.setViewportSize({width:1440,height:1050});
 assert.equal(await page.locator(`.secretary-answer[data-mission-id="${mission.id}"]`).count(),1);
 assert.equal(await page.locator(`.secretary-answer[data-mission-id="${mission.id}"] .secretary-answer-engine`).textContent(),'Codex · ChatGPT');
 await page.locator('#secretary-client').selectOption('claude');
 assert.equal(await page.locator(`.secretary-answer[data-mission-id="${mission.id}"]`).count(),0);
 assert.equal(await page.locator('.secretary-answers').isVisible(),false);
 record('Switching from Codex Drive to Claude immediately removes the Codex answer from the current form');
 await page.locator('.secretary-aside .secretary-refresh').click();
 await page.waitForFunction(()=>document.querySelector('#secretary-connection option[value="claude:qa-claude-drive"]')?.disabled===false);
 await page.locator('#secretary-connection').selectOption('claude:qa-claude-drive');
 await page.locator('#secretary-prompt').fill('Préparer un point sur mes documents avec mon service Claude Drive simulé.');
 const [claudeResponse]=await Promise.all([page.waitForResponse(response=>response.url()===fixture.base+'/api/secretary'&&response.request().method()==='POST'),page.locator('.secretary-run').click()]);
 assert.equal(claudeResponse.status(),202);const claudeMission=await claudeResponse.json();await fixture.app.engine.wait(claudeMission.id);
 assert.equal(fixture.app.engine.get(claudeMission.id).status,'completed');assert.equal(posts.at(-1).body.provider,'claude');assert.equal(posts.at(-1).body.connectorName,'qa-claude-drive');assert.equal(posts.at(-1).body.mode,'service');assert.equal(fixture.app.automations.entries.size,1);
 await page.waitForSelector(`.secretary-answer[data-mission-id="${claudeMission.id}"] .secretary-answer-text`);
 assert.equal(await page.locator(`.secretary-answer[data-mission-id="${claudeMission.id}"] .secretary-answer-engine`).textContent(),'Claude Code');
 assert.equal(await page.locator(`.secretary-answer[data-mission-id="${mission.id}"]`).count(),0);
 await page.screenshot({path:path.join(output,'services-claude-answer.png')});
 await page.locator('[data-secretary-mode=mail]').click();
 assert.equal(await page.locator('.secretary-answer').count(),0);
 assert.equal(await page.locator('.secretary-answers').isVisible(),false);
 await page.locator('[data-secretary-mode=service]').click();
 assert.equal(await page.locator(`.secretary-answer[data-mission-id="${claudeMission.id}"]`).count(),1);
 await page.locator('#secretary-client').selectOption('auto');
 assert.equal(await page.locator(`.secretary-answer[data-mission-id="${mission.id}"]`).count(),1);
 assert.equal(await page.locator(`.secretary-answer[data-mission-id="${claudeMission.id}"]`).count(),1);
 assert.ok(fixture.app.engine.get(mission.id));assert.ok(fixture.app.engine.get(claudeMission.id));
 record('Claude shows its own labeled answer, Mails hides both Drive answers, and Automatic restores both without deleting mission history');
 record('Claude Drive remains selectable as My services and starts one immediate simulated reading with the chosen engine');
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.equal(fixture.metrics.dictationInstalls,0);
 await writeFile(path.join(output,'rapport.json'),JSON.stringify({ok:true,checks,posts,simulatedReads,snapshots,errors,external,metrics:fixture.metrics},null,2));
 console.log(JSON.stringify({ok:true,checks:checks.length,report:path.join(output,'rapport.json')}));
}catch(error){
 await page?.screenshot({path:path.join(output,'echec.png')}).catch(()=>{});
 await writeFile(path.join(output,'rapport.json'),JSON.stringify({ok:false,error:error.stack,checks,posts,simulatedReads,snapshots,errors,external,metrics:fixture.metrics},null,2));
 throw error;
}finally{
 releaseRoutines?.();
 await browser?.close();
 await fixture.close();
}
