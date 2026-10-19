/** Studio drafts and uncertain launches, using an isolated server and fake engines. */
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {startOfficeFixture,launchBrowser,preparePage} from './office-fixture.mjs';

const fixture=await startOfficeFixture(),browser=await launchBrowser();
const output=process.env.OSCAR_QA_OUTPUT||path.join(os.tmpdir(),'oscar-studio-recovery');
await mkdir(output,{recursive:true});
const checks=[],errors=[],external=[];
const record=(name,detail={})=>{checks.push({name,...detail});console.log(JSON.stringify(checks.at(-1)));};
const open=async page=>{await page.locator('#open-creative-studio').click();await page.waitForSelector('#creative-studio[open]');};
const locale=async(page,value)=>page.evaluate(async value=>{const{setLocale}=await import('/i18n.js');setLocale(value);},value);
async function setup({references=false,label='local'}={}){
 const prepared=await preparePage(browser,fixture.base),page=prepared.page;errors.push(prepared.errors);external.push(prepared.external);
 if(references){await page.locator('#hud-settings').click();await page.locator('#settings-documents').click();await page.waitForSelector('#document-library-dialog[open]');await page.locator('.document-library-selection input').first().check();await page.keyboard.press('Escape');await page.locator('#close-office-panel').click();}
 await open(page);const text=`Créer une couverture illustrée originale pour le livre Les jours clairs, contrôle ${label}.`;
 await page.locator('.creative-description').fill(text);await page.locator('.creative-brief-options select').nth(0).selectOption('illustration');await page.locator('.creative-brief-options select').nth(1).selectOption('A4');
 return{page,text};
}
async function loseResponse(item,{beforeAcceptance=false}={}){
 const{page}=item;item.bodies=[];let dropped=false;
 await page.route('**/api/missions',async route=>{
  if(route.request().method()!=='POST'){await route.continue();return;}
  item.bodies.push(route.request().postDataJSON());
  if(dropped){await route.continue();return;}
  dropped=true;if(beforeAcceptance){await route.abort('failed');return;}const response=await route.fetch();assert.equal(response.status(),202);item.lost=await response.json();await fixture.app.engine.wait(item.lost.id);await route.abort('failed');
 });
 await page.locator('.creative-oscar').click();await page.waitForSelector('.creative-message.creative-error');if(!beforeAcceptance)assert.ok(item.lost?.id);
 item.count=fixture.app.engine.missions.size;item.calls=fixture.metrics.calls;
}
async function reload(item){
 await item.page.reload({waitUntil:'networkidle'});await open(item.page);
 assert.equal(await item.page.locator('.creative-description').inputValue(),item.text);
 assert.equal(await item.page.locator('.creative-brief-options select').nth(0).inputValue(),'illustration');
 assert.equal(await item.page.locator('.creative-brief-options select').nth(1).inputValue(),'A4');
 assert.equal(fixture.app.engine.missions.size,item.count);assert.equal(fixture.metrics.calls,item.calls);
}
async function replay(item){
 const[response]=await Promise.all([item.page.waitForResponse(response=>response.url()===fixture.base+'/api/missions'&&response.request().method()==='POST'||response.url().startsWith(fixture.base+'/api/mission-requests/')&&response.status()===200),item.page.locator('.creative-oscar').click()]);
 const body=await response.json();return{status:response.status(),body:body.mission||body};
}
try{
 const imported=await fixture.post('/api/documents/import',{name:'studio-reprise.txt',base64:Buffer.from('Un exemple de composition pour la reprise du studio.').toString('base64')});assert.equal(imported.status,201);
 const draft=await setup({label:'brouillon'});draft.count=fixture.app.engine.missions.size;draft.calls=fixture.metrics.calls;await reload(draft);assert.equal(await draft.page.locator('.creative-description').getAttribute('readonly'),null);record('The description, support and format survive reload without launching anything');await draft.page.context().close();
 for(const references of[false,true]){
  const item=await setup({references,label:references?'avec exemple':'sans exemple'});await loseResponse(item);await reload(item);
  assert.notEqual(await item.page.locator('.creative-description').getAttribute('readonly'),null);assert.equal(await item.page.locator('.creative-brief-options select').nth(0).isDisabled(),true);
  const held=[];if(!references){for(let index=0;index<4;index++){const started=await fixture.post('/api/missions',{prompt:`QA_HOLD Capacité du studio ${index}`,provider:'codex'});assert.equal(started.status,202);held.push(started.body.id);}await item.page.waitForFunction(()=>document.querySelector('#office-capacity').textContent.includes('4 / 4'));item.count=fixture.app.engine.missions.size;item.calls=fixture.metrics.calls;}
  if(references){await locale(item.page,'en');await item.page.evaluate(()=>{document.querySelector('#provider-select').value='claude';});await writeFile(path.join(fixture.app.documents.directory,imported.body.name),'L’exemple a changé après l’acceptation de la mission.');}
  const result=await replay(item);assert.equal(result.status,200);assert.equal(result.body.id,item.lost.id);assert.equal(item.bodies.length,1);assert.equal(fixture.app.engine.missions.size,item.count);assert.equal(fixture.metrics.calls,item.calls);
  await item.page.waitForSelector('#office-panel[open][data-panel=delivery]');
  assert.equal(await item.page.locator('#creative-studio').getAttribute('open'),null);assert.equal(await item.page.evaluate(()=>Boolean(document.activeElement?.isConnected)&&!document.activeElement.closest('[hidden]')),true);
  const receipt=await item.page.evaluate(()=>JSON.parse(localStorage.getItem('oscar.writing-drafts.v1')||'{"entries":[]}').entries.find(entry=>entry.slot==='studio'));assert.equal(receipt,undefined);
  record('An explicit Studio retry after reload finds the accepted mission without another POST',{references,changedContext:references,fullCapacity:!references,noExtraModelCalls:true});for(const id of held)await fixture.post(`/api/missions/${id}/stop`);await Promise.all(held.map(id=>fixture.app.engine.wait(id)));await item.page.context().close();
 }
 const changed=await setup({label:'langue modifiée'});await loseResponse(changed);await reload(changed);let lookup='missing';await changed.page.route('**/api/mission-requests/**',route=>lookup==='network'?route.abort('failed'):route.fulfill({status:lookup==='checking'?202:lookup==='error'?503:404,contentType:'application/json',body:JSON.stringify(lookup==='checking'?{status:'checking'}:{error:'Reçu indisponible pour ce contrôle.'})}));
 for(const pending of['checking','error','network']){lookup=pending;await changed.page.locator('.creative-oscar').click();await changed.page.waitForSelector('.creative-message.creative-error');assert.equal(changed.bodies.length,1);assert.equal(fixture.app.engine.missions.size,changed.count);assert.equal(fixture.metrics.calls,changed.calls);}record('An uncertain, failed or interrupted receipt lookup never permits a fallback POST');lookup='missing';await locale(changed.page,'en');
 await changed.page.locator('.creative-oscar').click();await changed.page.waitForSelector('.creative-message.creative-error');assert.equal(changed.bodies.length,1);assert.equal(fixture.app.engine.missions.size,changed.count);assert.equal(fixture.metrics.calls,changed.calls);record('Changing the language after an uncertain launch blocks retry without a POST or new identity');
 for(const language of['fr','en','nl']){await locale(changed.page,language);await changed.page.setViewportSize({width:390,height:844});if(language!=='fr'){assert.notEqual(await changed.page.locator('.creative-oscar').textContent(),'Reprendre la demande envoyée');assert.notEqual(await changed.page.locator('.creative-new-request').textContent(),'Préparer une nouvelle création');assert.ok(!(await changed.page.locator('#creative-studio .writing-draft p').textContent()).startsWith('Demande envoyée sans confirmation.'));}await changed.page.screenshot({path:path.join(output,`studio-reprise-${language}.png`)});assert.equal(await changed.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
 await locale(changed.page,'fr');const recovered=await replay(changed);assert.equal(recovered.status,202);assert.equal(recovered.body.id,changed.lost.id);assert.deepEqual(changed.bodies[1],changed.bodies[0]);assert.equal(fixture.metrics.calls,changed.calls);record('A missing receipt lookup permits only the exact original POST and identity');await changed.page.context().close();
 const interrupted=await setup({label:'avant réception'});await loseResponse(interrupted,{beforeAcceptance:true});await reload(interrupted);const accepted=await replay(interrupted);assert.equal(accepted.status,202);assert.deepEqual(interrupted.bodies[1],interrupted.bodies[0]);await fixture.app.engine.wait(accepted.body.id);assert.equal(fixture.app.engine.missions.size,interrupted.count+1);record('A request interrupted before acceptance can be retried with its original identity after reload');await interrupted.page.context().close();
 const renewed=await setup({label:'nouveau départ'});await loseResponse(renewed);await reload(renewed);await renewed.page.locator('.creative-new-request').click();assert.equal(await renewed.page.locator('.creative-description').getAttribute('readonly'),null);const created=await replay(renewed);assert.equal(created.status,202);assert.notEqual(created.body.id,renewed.lost.id);assert.notEqual(renewed.bodies.at(-1).requestId,renewed.bodies[0].requestId);await fixture.app.engine.wait(created.body.id);assert.equal(fixture.app.engine.missions.size,renewed.count+1);record('Preparing another creation explicitly detaches the old receipt and gives the request a new identity');await renewed.page.context().close();
 const report={ok:true,checks,errors:errors.flat(),external:external.flat()};await writeFile(path.join(output,'rapport.json'),JSON.stringify(report,null,2));assert.deepEqual(report.errors,[]);assert.deepEqual(report.external,[]);console.log(JSON.stringify(report,null,2));
}catch(error){await writeFile(path.join(output,'rapport.json'),JSON.stringify({ok:false,error:error.stack,checks,errors:errors.flat(),external:external.flat()},null,2));throw error;}
finally{await browser.close();await fixture.close();}
