/** Room framing and non-obstructive notices, with twenty simulated workers. */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {startOfficeFixture,launchBrowser,preparePage} from './office-fixture.mjs';

const output=process.env.OSCAR_QA_OUTPUT||path.join(os.tmpdir(),'oscar-office-visibility');
await mkdir(output,{recursive:true});
const fixture=await startOfficeFixture(),browser=await launchBrowser(),checks=[];
const now=Date.now();
const mission={id:randomUUID(),title:'Vingt spécialistes — contrôle visuel isolé',prompt:'Un essai de cadrage sans moteur ni compte.',provider:'codex',status:'running',phase:'Oscar vérifie les contributions de l’équipe',createdAt:now,updatedAt:now,
  tasks:['recherche','redaction','code','design','analyse'].flatMap(role=>Array.from({length:4},(_,i)=>({id:`${role}-${i}`,role,status:'working',attempt:1,title:`Contribution ${role} ${i+1}`}))),events:[],files:[],result:'',error:null,
  performance:{calls:[{agent:'Oscar',stage:'review',status:'running',durationMs:null,startedAt:now}]}};
fixture.app.engine.missions.set(mission.id,mission);fixture.app.engine.save(mission);
let page,errors,external;
try{
  ({page,errors,external}=await preparePage(browser,fixture.base));
  await page.goto(fixture.base+'/?mission='+mission.id,{waitUntil:'networkidle'});
  await page.waitForFunction(()=>window.__oscarWorld?.snapshot().agents.length===20);
  await page.evaluate(()=>{const world=window.__oscarWorld;world.setPaused(true);for(let i=0;i<600;i++){world.time+=.1;for(const agent of world.agents.values())world._stepAgent(agent,.1);world._updateOscar(.1);}world.setPaused(false);});
  const workers=await page.evaluate(()=>window.__oscarWorld.snapshot().agents);
  assert.equal(workers.filter(a=>a.state==='working'&&a.visible).length,20);assert.equal(new Set(workers.map(a=>a.desk)).size,20);
  checks.push({name:'twenty real, distinct simulated workplaces',count:workers.length});
  await page.locator('.delivery-progress-toggle').click();
  for(const [width,height] of [[1100,1100],[1920,1080],[2560,1440],[3440,1440],[844,390],[390,844]]){
    await page.setViewportSize({width,height});
    await page.waitForFunction(({width,height})=>{const v=window.__oscarWorld.snapshot().viewport;return v.width===width&&v.height===height;},{width,height});
    const geometry=await page.evaluate(()=>{
      const v=window.__oscarWorld.snapshot().viewport,hud=document.querySelector('.office-hud').getBoundingClientRect(),dock=document.querySelector('.office-dock').getBoundingClientRect();
      return {v,hudBottom:hud.bottom,dockTop:dock.top,roomBottom:v.offsetY+850*v.scale,roomRight:v.offsetX+1440*v.scale};
    });
    assert.ok(geometry.v.offsetY>=geometry.hudBottom+10,`${width}: windows hidden by header`);
    assert.ok(geometry.roomBottom<=geometry.dockTop-10,`${width}: lounge hidden by dock`);
    assert.ok(geometry.v.offsetX>=0&&geometry.roomRight<=width,`${width}: room sides cropped`);
    checks.push({name:`complete room ${width}×${height}`,...geometry});
    if(width>=1100)await page.screenshot({path:path.join(output,`office-${width}.png`)});
  }
  await page.setViewportSize({width:1920,height:1080});
  await page.locator('.delivery-progress-toggle').click();
  assert.equal(await page.locator('.delivery-progress-toggle').getAttribute('aria-expanded'),'true');
  // A user who reopens the details keeps them open, including through a refresh.
  fixture.app.engine.save(mission);
  await page.waitForTimeout(10500);
  assert.equal(await page.locator('.delivery-progress-toggle').getAttribute('aria-expanded'),'true');
  await page.locator('.delivery-progress-toggle').click();
  assert.equal(await page.locator('.delivery-progress-details').isVisible(),false);
  await page.locator('.delivery-progress-open').click();
  await page.waitForFunction(()=>document.querySelector('#office-panel').open);
  await page.locator('#close-office-panel').click();
  checks.push({name:'manual collapse, reopen and navigation remain usable'});
  // A new selected mission gets its own automatic collapse countdown.
  const second={...structuredClone(mission),id:randomUUID(),createdAt:Date.now(),updatedAt:Date.now()};
  fixture.app.engine.missions.set(second.id,second);fixture.app.engine.save(second);
  await page.goto(fixture.base+'/?mission='+second.id,{waitUntil:'networkidle'});
  await page.locator('.delivery-progress').waitFor({state:'visible'});
  await page.waitForFunction(()=>document.querySelector('.delivery-progress')?.dataset.collapsed==='true',{},{timeout:14000});
  await page.locator('.delivery-progress-toggle').click();
  assert.equal(await page.locator('.delivery-progress-details').isVisible(),true);
  checks.push({name:'normal progress settles automatically after ten visible seconds'});
  await page.locator('#hud-settings').click();
  await page.locator('#voice-test').click();
  await page.locator('#close-office-panel').click();
  await page.locator('#speech-caption').waitFor({state:'visible'});
  await page.locator('#speech-caption').waitFor({state:'hidden',timeout:11000});
  await page.evaluate(()=>window.__oscarWorld.interact('plant'));
  await page.locator('#office-toast').waitFor({state:'visible'});
  await page.locator('#office-toast').waitFor({state:'hidden',timeout:10000});
  checks.push({name:'real application captions and scenery notices disappear automatically'});
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.equal(fixture.metrics.calls,0);
  await writeFile(path.join(output,'report.json'),JSON.stringify({ok:true,checks,errors,external,metrics:fixture.metrics},null,2));
  console.log(`${checks.length} office visibility checks passed; ${output}`);
}catch(error){
  await page?.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});
  await writeFile(path.join(output,'report.json'),JSON.stringify({ok:false,error:error.stack,checks,errors,external,metrics:fixture.metrics},null,2));throw error;
}finally{await browser.close();await fixture.close();}
