import test from 'node:test';
import assert from 'node:assert/strict';
import messages from '../public/translations-delivery-progress.js';
import {translate} from '../public/i18n.js';
import {deliveryProgressSnapshot,deliveryProgressText} from '../public/delivery-progress.js';

test('every delivery progress label is available through the shared French English Dutch translation path',()=>{
  for(const[source,targets]of Object.entries(messages)){
    assert.equal(deliveryProgressText(source,'fr'),source);
    for(const locale of['en','nl']){
      assert.equal(typeof targets[locale],'string',`${locale}: ${source}`);
      assert.ok(targets[locale].trim());assert.notEqual(targets[locale],source);
      assert.equal(translate(source,locale),targets[locale]);
      assert.equal(deliveryProgressText(source,locale),targets[locale]);
    }
  }
});

test('actual review assembly final and terminal snapshots localize their fixed text without rewriting model activity',()=>{
  const scenarios=[
    ...['review','assembly','final-review'].flatMap(stage=>[10000,70000].map(now=>({now,mission:{id:'progress',provider:'codex',status:'reviewing',phase:'',performance:{calls:[{agent:'Oscar',stage,status:'running',startedAt:1000,durationMs:null}]},tasks:[{status:'reviewing'},{status:'approved'}],events:[{who:'Oscar',kind:'activity',at:2000,text:'Mon jeu personnel : Pizza de Renaud <script>dans les données</script>'}]}}))),
    ...['completed','needs_review','failed','cancelled'].map(status=>({now:70000,mission:{id:'progress',provider:'codex',status,phase:'',updatedAt:3000,tasks:[]}})),
    {now:70000,mission:{id:'progress',provider:'demo',status:'reviewing',phase:'',tasks:[]}},
    {now:70000,mission:{id:'progress',provider:'codex',status:'reviewing',phase:'',tasks:[]}},
  ];
  for(const{mission,now}of scenarios){
    const french=deliveryProgressSnapshot(mission,{now,locale:'fr'});
    assert.ok(french);
    for(const locale of['en','nl']){
      const translated=deliveryProgressSnapshot(mission,{now,locale});
      for(const field of['title','phase','note','actionLabel'])if(french[field])assert.notEqual(translated[field],french[field],`${mission.status}/${french.stage}/${field}/${locale}`);
      assert.deepEqual(translated.lastActivity,french.lastActivity,'Saved model activity stays source data.');
      assert.deepEqual(translated.counts,french.counts);
      assert.equal(translated.elapsedMs,french.elapsedMs);
    }
  }
});
