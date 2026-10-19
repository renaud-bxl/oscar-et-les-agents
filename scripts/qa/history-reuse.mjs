/** Search, filters and reusable briefs against an isolated simulated office. */
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {withTeamPreference} from '../../public/welcome-guide.js';
import {startOfficeFixture,launchBrowser,preparePage} from './office-fixture.mjs';
const fixture=await startOfficeFixture(),browser=await launchBrowser(),output=process.env.OSCAR_QA_OUTPUT||path.join(os.tmpdir(),'oscar-history-reuse');await mkdir(output,{recursive:true});
const checks=[],findings=[];
try{
 const imported=await fixture.post('/api/documents/import',{name:'exemple.txt',base64:Buffer.from('Un exemple pour la reprise du brief.').toString('base64')});assert.equal(imported.status,201);const reference=imported.body;
 const original='Préparer une étude sur les énergies renouvelables.';
 const language='\n\nLangue demandée pour cette mission : néerlandais (Nederlands). Rédige le titre, le plan, les tâches, les comptes rendus, les retours d’Oscar, la livraison finale et les textes visibles des fichiers créés dans cette langue. Conserve les noms propres et les chemins techniques nécessaires.';
 const source=await fixture.post('/api/missions',{prompt:withTeamPreference(original,'8')+language,provider:'claude',referenceIds:[reference.id],references:[{id:reference.id,revision:reference.revision}],locale:'nl'});assert.equal(source.status,202);await fixture.app.engine.wait(source.body.id);
 const completed=fixture.app.engine.missions.get(source.body.id);completed.title='Étude Énergie solaire';fixture.app.engine.save(completed);
 const other=await fixture.post('/api/missions',{prompt:'Une autre analyse de contrôle.',provider:'codex'});await fixture.app.engine.wait(other.body.id);const attention=fixture.app.engine.missions.get(other.body.id);attention.status='needs_review';attention.title='Analyse à vérifier';fixture.app.engine.save(attention);
 const stopped=await fixture.post('/api/missions',{prompt:'QA_HOLD Projet arrêté',provider:'codex'});await fixture.post(`/api/missions/${stopped.body.id}/stop`);await fixture.app.engine.wait(stopped.body.id);
 const active=await fixture.post('/api/missions',{prompt:'QA_HOLD Projet en cours',provider:'codex'});assert.equal(active.status,202);
 const {page,errors,external}=await preparePage(browser,fixture.base),context=page.context(),posts=[];context.on('request',request=>{if(request.method()==='POST'&&request.url().endsWith('/api/missions'))posts.push(request.postDataJSON());});
 await page.locator('#hud-history').click();await page.waitForFunction(()=>document.querySelectorAll('.history-item').length===4);
 for(const[filter,status]of[['active','planning'],['completed','completed'],['attention','needs_review'],['cancelled','cancelled']]){await page.locator('#history-status').selectOption(filter);const rows=page.locator('.history-item');assert.equal(await rows.count(),1);const actual=await rows.first().getAttribute('data-status');assert.ok(filter==='active'?['planning','running','reviewing'].includes(actual):actual===status);}
 checks.push('Four status filters preserve their actual mission states');await page.locator('#history-status').selectOption('all');
 await page.locator('#history-search').fill('eTUDE ENERGIE');assert.equal(await page.locator('.history-item').count(),1);assert.equal(await page.locator('.history-item').getAttribute('data-mission'),completed.id);
 await page.locator('#history-search').fill('claude');assert.equal(await page.locator('.history-item').count(),1);await page.locator('#history-search').focus();fixture.app.engine.emit('change',fixture.app.engine.state());await page.waitForTimeout(80);assert.equal(await page.evaluate(()=>document.activeElement.id),'history-search');checks.push('Search matches accented titles and providers and retains focus during updates');
 await page.locator('.history-item').click();await page.waitForFunction(()=>document.querySelector('#file-list').childElementCount>0);if(await page.locator('#office-panel').evaluate(node=>node.open))await page.locator('#close-office-panel').click();await page.locator('.office-dock [data-open-panel=delivery]').click();
 const count=fixture.app.engine.missions.size,calls=fixture.metrics.calls;
 const[popped]=await Promise.all([context.waitForEvent('page'),page.locator('#reuse-mission').click()]);await popped.waitForLoadState('networkidle');popped.on('pageerror',error=>errors.push(error.message));await popped.waitForSelector('#office-panel[open][data-panel=brief]');
 assert.equal(await popped.locator('#mission-input').inputValue(),original);assert.equal(await popped.locator('#team-size').inputValue(),'8');assert.equal(await popped.locator('#provider-select').inputValue(),'claude');assert.equal(fixture.app.engine.missions.size,count);assert.equal(fixture.metrics.calls,calls);assert.equal(posts.length,0);checks.push('Clone opens an editable brief with provider and team size, with no launch');
 await popped.locator('#brief-documents').click();await popped.waitForSelector('#document-library-dialog[open]');assert.equal(await popped.locator('.document-library-selection input:checked').count(),1);await popped.keyboard.press('Escape');await popped.waitForSelector('#office-panel[open][data-panel=brief]');checks.push('Unchanged reference revision remains selected');
 const edited=original+' Ajouter mon nouveau cadrage.';await popped.locator('#mission-input').fill(edited);await popped.reload({waitUntil:'networkidle'});if(!await popped.locator('#office-panel').evaluate(node=>node.open))await popped.locator('.office-dock [data-open-panel=brief]').click();
 if(await popped.locator('#mission-input').inputValue()!==edited)findings.push('Reload of a reused brief overwrites the edited draft from the still-present reuse URL parameter.');else checks.push('A reused brief preserves later edits on reload');
 // Changing a reference must exclude the old revision from a fresh clone.
 await writeFile(path.join(fixture.app.documents.directory,reference.name),'Exemple modifié après la mission.');
 const changed=await context.newPage();await changed.goto(fixture.base+`/?new=1&reuse=${completed.id}`,{waitUntil:'networkidle'});await changed.waitForSelector('#office-panel[open][data-panel=brief]');assert.match(await changed.locator('#brief-draft-note').textContent(),/chang|disponibles/iu);await changed.locator('#brief-documents').click();await changed.waitForSelector('#document-library-dialog[open]');assert.equal(await changed.locator('.document-library-selection input:checked').count(),0);checks.push('Changed reference revision is excluded with an explanation');
 assert.equal(fixture.app.engine.missions.size,count);assert.equal(fixture.metrics.calls,calls);assert.equal(posts.length,0);assert.deepEqual(errors,[]);assert.deepEqual(external,[]);await changed.screenshot({path:path.join(output,'reference-modifiee.png')});
 const report={ok:!findings.length,checks,findings,errors,external,posts:posts.length};await writeFile(path.join(output,'rapport.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));assert.deepEqual(findings,[]);
}finally{await browser.close();await fixture.close();}
