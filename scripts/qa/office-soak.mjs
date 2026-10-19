/**
 * Optional sustained local QA. No model, mail, calendar, payment or remote calls.
 * OSCAR_QA_UNTIL: ISO timestamp, or OSCAR_QA_DURATION_MS (default five minutes).
 * OSCAR_QA_PULSE_MS may shorten the exercise for checking this harness itself.
 */
import assert from 'node:assert/strict';
import {mkdir,appendFile,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {startOfficeFixture,launchBrowser,preparePage} from './office-fixture.mjs';
const started=Date.now(),until=process.env.OSCAR_QA_UNTIL?Date.parse(process.env.OSCAR_QA_UNTIL):started+Number(process.env.OSCAR_QA_DURATION_MS||300000);
if(!Number.isFinite(until)||until<=started||until-started>12*3600000)throw new Error('Choose a future QA deadline within twelve hours.');
const pulseMs=Math.max(2000,Number(process.env.OSCAR_QA_PULSE_MS||300000));
const rotateLocales=process.env.OSCAR_QA_ROTATE_LOCALES==='1',localesExercised=new Set(['fr']);
const output=process.env.OSCAR_QA_OUTPUT||path.join(os.tmpdir(),'oscar-office-soak');await mkdir(output,{recursive:true});
let fixture,browser,stopped=false,interruption=null,page,errors=[],external=[],pulse=0,requests=0;
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{stopped=true;interruption??={signal,at:Date.now()};});
const timing=()=>{const finished=Date.now();return{started:new Date(started).toISOString(),expectedFinished:new Date(until).toISOString(),finished:new Date(finished).toISOString(),expectedDurationMs:until-started,actualDurationMs:finished-started,interruptedBy:interruption?.signal??null,interruptedAt:interruption?new Date(interruption.at).toISOString():null};};
const interruptedEarly=()=>interruption&&interruption.at<until;
const interruptionError=()=>Object.assign(new Error(`QA interrupted by ${interruption.signal} before the expected deadline.`),{code:'QA_INTERRUPTED'});
const requireCompletion=()=>{if(interruptedEarly())throw interruptionError();if(Date.now()<until)throw new Error('QA ended before the expected deadline.');};
const sample=async extra=>{
 const cdp=await page.context().newCDPSession(page);const heap=await cdp.send('Runtime.getHeapUsage');await cdp.detach();
 const value={pid:process.pid,at:new Date().toISOString(),elapsedSeconds:Math.round((Date.now()-started)/1000),pulse,serverRSS:process.memoryUsage().rss,serverHeap:process.memoryUsage().heapUsed,browserHeap:heap.usedSize,missions:fixture.app.engine.missions.size,active:fixture.app.engine.runs.size,requests,sseOpened:fixture.metrics.sseOpened,sseActive:fixture.metrics.sseActive,errors:errors.length,external:external.length,...extra};
 await appendFile(path.join(output,'samples.jsonl'),JSON.stringify(value)+'\n');process.stdout.write(JSON.stringify(value)+'\n');
};
try{
 fixture=await startOfficeFixture();browser=await launchBrowser();
 if(interruptedEarly())throw interruptionError();
 ({page,errors,external}=await preparePage(browser,fixture.base));page.on('request',()=>requests++);
 await page.locator('.office-dock [data-open-panel=brief]').click();await page.locator('#mission-input').fill('Demande locale conservée pendant le contrôle prolongé.');
 const routine=fixture.app.automations.create({label:'Contrôle périodique simulé',prompt:'Préparer une réponse de contrôle locale.',provider:'codex',assistant:true,assistantMode:'free',schedule:{frequency:'interval',intervalMinutes:15}});
 await sample({phase:'started'});let nextPulse=Date.now()+pulseMs,nextSample=Date.now()+45000;
 while(!stopped&&Date.now()<until){
  await delay(Math.min(1000,until-Date.now()));
  if(Date.now()>=nextPulse){
   pulse++;nextPulse=Date.now()+pulseMs;
   if(rotateLocales){const locale=['fr','en','nl'][pulse%3];await page.evaluate(async value=>(await import('/i18n.js')).setLocale(value),locale);localesExercised.add(locale);assert.equal(await page.locator('html').getAttribute('lang'),locale);}
   const paused=pulse%4===0;
   fixture.app.automations.update(routine.id,{enabled:!paused});
   const before=fixture.app.engine.missions.size;await fixture.advance(16*60000);
   await Promise.all([...fixture.app.engine.runs.keys()].map(id=>fixture.app.engine.wait(id)));
   assert.equal(fixture.app.engine.missions.size-before,paused?0:1,'A tick launches one eligible fake job, and a paused routine launches none.');
   assert.equal(fixture.app.engine.runs.size,0);
   assert.equal(await page.locator('#mission-input').inputValue(),'Demande locale conservée pendant le contrôle prolongé.');
   await page.locator('#mission-input').focus();await page.locator('#mission-input').evaluate(node=>node.setSelectionRange(8,14));
   fixture.app.engine.emit('change',fixture.app.engine.state());await page.waitForTimeout(100);
   assert.equal(await page.evaluate(()=>document.activeElement?.id),'mission-input');assert.deepEqual(await page.locator('#mission-input').evaluate(node=>[node.selectionStart,node.selectionEnd]),[8,14]);
   if(pulse%2===0){const prior=fixture.metrics.sseOpened;fixture.interruptEvents();await page.waitForFunction(()=>document.querySelector('#connection-dot')?.classList.contains('connected'),{timeout:10000});for(let attempt=0;attempt<100&&fixture.metrics.sseOpened===prior;attempt++)await delay(100);assert.ok(fixture.metrics.sseOpened>prior,'EventSource reconnects after the stream is cut.');assert.equal(fixture.metrics.sseActive,1);}
   if(pulse%3===0){await page.reload({waitUntil:'networkidle'});await page.locator('.office-dock [data-open-panel=brief]').click();assert.equal(await page.locator('#mission-input').inputValue(),'Demande locale conservée pendant le contrôle prolongé.');}
   if(pulse%6===0)await page.screenshot({path:path.join(output,`bureau-${pulse}.png`)});
   assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.equal(fixture.metrics.connectorReads,0);assert.equal(fixture.metrics.dictationInstalls,0);
   await sample({phase:'pulse',paused});
  }
  if(Date.now()>=nextSample){await sample({phase:'heartbeat'});nextSample=Date.now()+45000;}
 }
 requireCompletion();await sample({phase:'complete'});await writeFile(path.join(output,'rapport.json'),JSON.stringify({ok:true,...timing(),pulse,localesExercised:[...localesExercised],errors,external,metrics:fixture.metrics},null,2));
}catch(error){const failure=interruptedEarly()&&error.code!=='QA_INTERRUPTED'?interruptionError():error;await page?.screenshot({path:path.join(output,'echec.png')}).catch(()=>{});await writeFile(path.join(output,'rapport.json'),JSON.stringify({ok:false,...timing(),error:failure.stack,code:failure.code,...(failure!==error?{originalError:error.stack}:{}),pulse,localesExercised:[...localesExercised],errors,external,metrics:fixture?.metrics??null},null,2));throw failure;}
finally{try{await browser?.close();}finally{await fixture?.close();}}
