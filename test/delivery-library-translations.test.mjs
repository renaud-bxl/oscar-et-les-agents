import test from 'node:test';
import assert from 'node:assert/strict';
import messages from '../public/translations-delivery-library.js';
import {translate} from '../public/i18n.js';
import {selectDeliveryProjects} from '../public/delivery-library.js';

test('actual library back navigation and short heading use their exact keys',()=>{
  assert.equal(translate('← Tous mes projets','fr'),'← Tous mes projets');
  assert.equal(translate('← Tous mes projets','en'),'← All my projects');
  assert.equal(translate('← Tous mes projets','nl'),'← Al mijn projecten');
  assert.equal(translate('Un dossier pour chaque demande','fr'),'Un dossier pour chaque demande');
  assert.equal(translate('Un dossier pour chaque demande','en'),'A folder for every request');
  assert.equal(translate('Un dossier pour chaque demande','nl'),'Een map voor elke vraag');
});

test('project library controls states and loading errors are loaded in French English Dutch',()=>{
  for(const[source,targets]of Object.entries(messages)){
    assert.equal(translate(source,'fr'),source);
    for(const locale of['en','nl']){
      assert.equal(typeof targets[locale],'string',`${locale}: ${source}`);
      assert.ok(targets[locale].trim());assert.notEqual(targets[locale],source);
      assert.equal(translate(source,locale),targets[locale]);
    }
  }
  for(const personal of['Mission personnelle : Pizza mania pour Ingrid','2026-10-21 — Au Café/Livraison/index.html'])for(const locale of['fr','en','nl'])assert.equal(translate(personal,locale),personal);
});

test('real library summaries translate each state while keeping personal titles requests and paths intact',()=>{
  const states=['planning','running','reviewing','assembling','completed','needs_review','failed','cancelled','unknown'];
  const missions=states.map((status,index)=>({id:`project-${index}`,status,provider:'codex',title:'État non renseigné',prompt:'Tous les projets',folderName:'2026-10-21 — À vérifier',filesCount:2}));
  missions.push({id:'demo',status:'completed',provider:'demo',title:'Démonstration personnelle',prompt:'Une visite du bureau'});
  const french=selectDeliveryProjects(missions,{locale:'fr'});
  for(const locale of['en','nl']){
    const translated=selectDeliveryProjects(missions,{locale});assert.equal(translated.length,missions.length);
    for(const item of translated){
      const original=french.find(project=>project.id===item.id);
      assert.notEqual(item.stateLabel,original.stateLabel);assert.notEqual(item.dateLabel,original.dateLabel);
      for(const field of['title','prompt','excerpt','folderName','status','filesCount'])assert.equal(item[field],original[field],`${locale}/${item.id}/${field}`);
    }
  }
  for(const query of['Interrompu','Interrupted','Onderbroken'])assert.deepEqual(selectDeliveryProjects(missions,{query,locale:'nl'}).map(item=>item.id),['project-6']);
});
