/** Targeted keyboard, focus, language and reconnect checks in the simulated office. */
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {startOfficeFixture,launchBrowser,preparePage} from './office-fixture.mjs';
const output=process.env.OSCAR_QA_OUTPUT||path.join(os.tmpdir(),'oscar-accessibility-navigation');await mkdir(output,{recursive:true});
const fixture=await startOfficeFixture(),browser=await launchBrowser(),checks=[];let page,errors=[],external=[];
const record=(name,details={})=>{checks.push({name,...details});console.log(JSON.stringify(checks.at(-1)));};
const enter=async selector=>{await page.locator(selector).first().focus();await page.keyboard.press('Enter');};
const closeAll=async()=>{for(let i=0;i<8&&await page.locator('dialog[open]').count();i++){await page.keyboard.press('Escape');await page.waitForTimeout(50);}};
const locale=async value=>{await page.evaluate(async value=>(await import('/i18n.js')).setLocale(value),value);await page.waitForTimeout(30);};
const assertFocus=async selector=>assert.equal(await page.locator(selector).evaluate(n=>n===document.activeElement),true,selector);
try{
 ({page,errors,external}=await preparePage(browser,fixture.base));
 const utilities=[['connectors','#settings-connectors','#connectors-dialog','.icon-button'],['automations','#settings-automations','#automations-dialog','.automations-close'],['clock','[data-pixel-prop=clock]','.clock-dialog','.clock-close']];
 for(const language of ['fr','en','nl']){
  await locale(language);
  for(const [name,trigger,dialog,close]of utilities){
   for(const method of ['Escape','button']){
    await closeAll();await enter('#hud-settings');await enter(trigger);await page.waitForSelector(dialog+'[open]');
    if(method==='Escape')await page.keyboard.press('Escape');else await page.locator(dialog+' '+close).click();
    await page.waitForSelector('#office-panel[open][data-panel=settings]');await assertFocus(trigger);assert.equal(await page.locator(dialog).evaluate(n=>n.open),false);record('Utility returns to its settings control',{language,utility:name,method});
   }
   // A queued native close event from the old opening cannot close its replacement.
   await enter(trigger);await page.locator(dialog).evaluate((node,trigger)=>{node.close();document.querySelector(trigger).click();},trigger);await page.waitForTimeout(80);assert.equal(await page.locator(dialog).evaluate(n=>n.open),true);assert.equal(await page.locator(dialog).evaluate(n=>n.contains(document.activeElement)),true);if(name==='automations')await page.waitForFunction(()=>document.querySelectorAll('.automation-schedule-preview time').length===3);if(name==='clock'&&language==='fr'){const seconds=await page.locator('.clock-seconds').textContent();await page.waitForFunction(value=>document.querySelector('.clock-seconds')?.textContent!==value,seconds,{timeout:3000});}await page.keyboard.press('Escape');await page.waitForSelector('#office-panel[open][data-panel=settings]');await assertFocus(trigger);record('Immediate utility reopening retains the new dialog and its parent',{language,utility:name});await closeAll();
  }
  await enter('.office-dock [data-open-panel=team]');await enter('#team-oscar');await page.keyboard.press('Escape');await page.waitForSelector('#office-panel[open][data-panel=team]');await assertFocus('#team-oscar');record('Oscar returns to his team control',{language});
 }
 await closeAll();await enter('#hud-settings');await enter('#settings-connectors');await page.waitForFunction(()=>!document.querySelector('[data-connector-control=assistant-open]').disabled);await enter('[data-connector-control=assistant-open]');await page.waitForSelector('#secretary-dialog[open]');await page.waitForTimeout(100);assert.equal(await page.locator('#office-panel').evaluate(n=>n.open),false);await page.keyboard.press('Escape');await page.waitForTimeout(100);assert.equal(await page.locator('#office-panel').evaluate(n=>n.open),false);record('Intentional Connectors to Zoé navigation has no parent panel');
 await enter('.office-dock [data-open-panel=brief]');await page.locator('#mission-input').fill('Mon texte personnel reste exactement écrit ainsi.');await page.locator('#mission-input').evaluate(n=>{window.__qaBrief=n;n.focus();n.setSelectionRange(5,20);});const streams=fixture.metrics.sseOpened;fixture.interruptEvents();await page.waitForFunction(()=>document.activeElement===window.__qaBrief);for(let i=0;i<60&&fixture.metrics.sseOpened===streams;i++)await page.waitForTimeout(100);assert.ok(fixture.metrics.sseOpened>streams);assert.deepEqual(await page.locator('#mission-input').evaluate(n=>({same:n===window.__qaBrief,value:n.value,start:n.selectionStart,end:n.selectionEnd,focus:n===document.activeElement})),{same:true,value:'Mon texte personnel reste exactement écrit ainsi.',start:5,end:20,focus:true});record('SSE reconnect preserves input node, value, selection and focus');
 // Import only temporary plain-text fixtures. Their names and contents must not be translated.
 await enter('#brief-documents');await page.locator('#document-library-dialog input[type=file]').first().setInputFiles([{name:'Mon nom personnel.txt',mimeType:'text/plain',buffer:Buffer.from('Texte personnel inaltéré.')},{name:'Mijn tweede voorbeeld.txt',mimeType:'text/plain',buffer:Buffer.from('Tweede persoonlijke tekst.')}]);await page.waitForFunction(()=>document.querySelectorAll('.document-library-selection input').length===2);await page.keyboard.press('Escape');await page.waitForSelector('#office-panel[open]');
 for(const count of [0,1,2]){
  if(count){await enter('#brief-documents');await page.locator('.document-library-selection input').nth(count-1).check();await page.locator('.document-library-format input[value=docx]').check();await page.keyboard.press('Escape');await page.waitForSelector('#office-panel[open]');}
  const selected=await page.evaluate(()=>JSON.parse(localStorage.getItem('oscar-documents-v1')));
  for(const language of ['fr','en','nl']){await locale(language);const expected={fr:`${count} ${count===1?'exemple':'exemples'} · ${count?'Word':'Format libre'}`,en:`${count} ${count===1?'example':'examples'} · ${count?'Word':'Free format'}`,nl:`${count} ${count===1?'voorbeeld':'voorbeelden'} · ${count?'Word':'Vrij formaat'}`}[language];assert.equal(await page.locator('#brief-documents-status').textContent(),expected);assert.equal(await page.locator('#guided-documents-status').textContent(),expected);assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('oscar-documents-v1'))),selected);assert.equal(await page.locator('#mission-input').inputValue(),'Mon texte personnel reste exactement écrit ainsi.');record('Localized selection count preserves documents and writing',{language,count,status:expected});}
 }
 await enter('#brief-documents');assert.deepEqual((await page.locator('.document-library-item-copy strong').allTextContents()).sort(),['Mijn tweede voorbeeld.txt','Mon nom personnel.txt'].sort());assert.equal(await page.locator('.document-library-selection input:checked').count(),2);await page.keyboard.press('Escape');await closeAll();
 for(const language of ['en','nl']){await locale(language);await enter('#hud-settings');const text=await page.locator('#office-panel').innerText();for(const source of ['Vos outils et vos habitudes','Connectez vos services et préparez des missions récurrentes.','Créez vos visuels en SVG et PNG, ou reprenez les images de votre mission.'])assert.equal(text.includes(source),false);await page.screenshot({path:path.join(output,language+'-settings.png')});await closeAll();}
 assert.equal(fixture.metrics.calls,0);assert.equal(fixture.metrics.connectorReads,0);assert.equal(fixture.metrics.dictationInstalls,0);assert.equal(fixture.app.engine.missions.size,0);assert.equal(fixture.app.automations.entries.size,0);assert.deepEqual(errors,[]);assert.deepEqual(external,[]);record('Navigation and locale changes launch no mission, private read or download');await writeFile(path.join(output,'report.json'),JSON.stringify({ok:true,checks,errors,external,metrics:fixture.metrics},null,2));
}catch(error){await page?.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});await writeFile(path.join(output,'report.json'),JSON.stringify({ok:false,error:error.stack,checks,errors,external,metrics:fixture.metrics},null,2));throw error;}
finally{await browser.close();await fixture.close();}
