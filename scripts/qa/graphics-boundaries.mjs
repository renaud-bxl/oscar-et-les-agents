/** Visual boundary checks against an isolated office with simulated providers. */
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {startOfficeFixture,launchBrowser,preparePage} from './office-fixture.mjs';

const output=process.env.OSCAR_QA_OUTPUT||path.join(os.tmpdir(),'oscar-graphics-boundaries');
await mkdir(output,{recursive:true});
const fixture=await startOfficeFixture(),browser=await launchBrowser(),checks=[],errors=[],external=[];
let page;
const check=(name,evidence)=>{checks.push({name,...evidence});};
const screenshot=async name=>{await page.screenshot({path:path.join(output,`${name}.png`)});};
const closePanel=async()=>{await page.locator('#close-office-panel').click();await page.waitForFunction(()=>!document.querySelector('#office-panel').open);};
const widths=[320,360,390,640,641,768,900,901,1024,1280,1400,1600,1920];
const longBriefs={
  fr:'Préparer une proposition commerciale complète pour une bibliothèque de quartier, avec une introduction, un calendrier et des documents accessibles. '.repeat(12),
  en:'Prepare a complete commercial proposal for a neighbourhood library, including an introduction, a delivery schedule and accessible documents. '.repeat(12),
  nl:'Maak een volledig commercieel voorstel voor een buurtbibliotheek, met een inleiding, een uitvoeringsplanning en toegankelijke documenten. '.repeat(12),
};

try{
  for(const locale of ['fr','en','nl']){
    const prepared=await preparePage(browser,fixture.base);
    page=prepared.page;errors.push(prepared.errors);external.push(prepared.external);
    await page.evaluate(async language=>(await import('/i18n.js')).setLocale(language),locale);
    for(const width of widths){
      await page.setViewportSize({width,height:width===320?568:width>=1600?1080:844});
      const office=await page.evaluate(()=>{
        const bounds=node=>{const r=node.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom};};
        const brand=bounds(document.querySelector('.immersive-brand')),actions=bounds(document.querySelector('.hud-actions'));
        const subline=document.querySelector('.hud-subline'),dock=document.querySelector('.office-dock');
        const labels=[...dock.querySelectorAll('button')].filter(node=>node.getBoundingClientRect().width).map(node=>({text:node.textContent.trim(),button:bounds(node),label:bounds(node.querySelector('.dock-label'))}));
        return {viewport:innerWidth,documentWidth:document.documentElement.scrollWidth,brand,actions,subline:{width:subline.clientWidth,scroll:subline.scrollWidth},dock:{width:dock.clientWidth,scroll:dock.scrollWidth},labels};
      });
      assert.ok(office.documentWidth<=width,`${locale}/${width}: document overflows`);
      assert.ok(office.brand.right<=office.actions.left+1,`${locale}/${width}: Oscar overlaps language controls`);
      assert.ok(office.subline.scroll<=office.subline.width+1,`${locale}/${width}: office status clipped`);
      assert.ok(office.dock.scroll<=office.dock.width+1,`${locale}/${width}: dock overflows`);
      for(const label of office.labels){
        assert.ok(label.label.left>=label.button.left-1&&label.label.right<=label.button.right+1,`${locale}/${width}: ${label.text} escapes its button`);
      }
      check(`${locale}/${width}: office navigation`,office);
      if([320,768,1920].includes(width)){
        for(const mode of ['day','night']){await page.evaluate(value=>window.__oscarWorld.setAmbienceMode(value),mode);await page.waitForTimeout(80);await screenshot(`${locale}-office-${mode}-${width}`);}
      }
      await page.locator('.office-dock [data-open-panel=progress]').click();
      const progress=await page.locator('#phase-steps').evaluate(node=>{
        const body=document.querySelector('#office-panel-body').getBoundingClientRect();
        return {width:node.clientWidth,scroll:node.scrollWidth,steps:[...node.querySelectorAll(':scope > span')].map(step=>{const r=step.getBoundingClientRect();return {text:step.textContent,left:r.left,right:r.right,visibleLeft:body.left,visibleRight:body.right};})};
      });
      assert.equal(progress.steps.length,4);
      assert.ok(progress.scroll<=progress.width+1,`${locale}/${width}: progress steps clipped`);
      for(const step of progress.steps)assert.ok(step.left>=step.visibleLeft&&step.right<=step.visibleRight,`${locale}/${width}: ${step.text} outside panel`);
      check(`${locale}/${width}: four readable progress steps`,progress);
      if([320,1920].includes(width))await screenshot(`${locale}-progress-${width}`);
      await closePanel();
      await page.locator('.office-dock [data-open-panel=catalog]').click();
      const cards=await page.locator('.mission-template').evaluateAll(nodes=>nodes.map(node=>({text:node.textContent.trim().slice(0,100),width:node.clientWidth,scroll:node.scrollWidth})));
      assert.ok(cards.length>=84);
      if(width<=360){
        const firstTwo=await page.locator('.mission-template').evaluateAll(nodes=>nodes.slice(0,2).map(node=>{const r=node.getBoundingClientRect();return {top:r.top,bottom:r.bottom};}));
        assert.ok(firstTwo[1].top>=firstTwo[0].bottom,`${locale}/${width}: catalogue cards must stack at narrow widths`);
      }
      for(const card of cards)assert.ok(card.scroll<=card.width+1,`${locale}/${width}: catalogue card overflows: ${card.text}`);
      check(`${locale}/${width}: catalogue text stays in every card`,{cards:cards.length,maxOverflow:Math.max(...cards.map(card=>card.scroll-card.width))});
      if(width===320){
        const longCard=page.locator('.mission-template[data-template=proposition-commerciale-detaillee]');
        await longCard.scrollIntoViewIfNeeded();await screenshot(`${locale}-long-catalogue-320`);
      }
      await closePanel();
    }
    await page.locator('.office-dock [data-open-panel=brief]').click();
    await page.locator('#mission-input').fill(longBriefs[locale]);
    await page.setViewportSize({width:320,height:568});
    assert.equal(await page.locator('#mission-input').inputValue(),longBriefs[locale]);
    await screenshot(`${locale}-long-brief-320`);
    await page.setViewportSize({width:1920,height:1080});
    assert.equal(await page.locator('#mission-input').inputValue(),longBriefs[locale]);
    check(`${locale}: long brief preserved across viewport changes`,{characters:longBriefs[locale].length});
    await page.context().close();page=null;
  }
  assert.deepEqual(errors.flat(),[]);assert.deepEqual(external.flat(),[]);assert.equal(fixture.metrics.calls,0);
  await writeFile(path.join(output,'report.json'),JSON.stringify({ok:true,checks,errors:errors.flat(),external:external.flat(),metrics:fixture.metrics},null,2));
  console.log(`${checks.length} visual boundary checks passed; ${output}`);
}catch(error){
  await page?.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});
  await writeFile(path.join(output,'report.json'),JSON.stringify({ok:false,error:error.stack,checks,errors:errors.flat(),external:external.flat(),metrics:fixture.metrics},null,2));
  throw error;
}finally{await browser.close();await fixture.close();}
