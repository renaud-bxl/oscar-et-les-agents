import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {translate} from '../public/i18n.js';
import messages from '../public/translations-team.js';
import {missionProblemSummary} from '../public/delivery-progress.js';

async function fixture(){
  const source=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
  // Execute the application's real renderer in a small DOM, without starting
  // the app, discovering accounts, or connecting to its live event stream.
  const render=source.slice(source.indexOf('function renderMember('),source.indexOf('\nfunction openMember('));
  assert.ok(render.startsWith('function renderMember('));
  class Element{
    constructor(tag,cls='',text=''){this.tag=tag;this.className=cls;this.children=[];this.dataset={};this._text=text;this.replacements=0;}
    set textContent(value){this._text=String(value);this.children=[];}get textContent(){return this._text+this.children.map(child=>child.textContent).join('');}
    append(...children){this.children.push(...children);}replaceChildren(...children){this._text='';this.children=children;this.replacements++;}
    addEventListener(){}querySelector(){return null;}
  }
  const elements=new Map(),element=id=>{if(!elements.has(id))elements.set(id,new Element('div'));return elements.get(id);};
  const context=vm.createContext({oscarAssistant:{setVisible(){}},missionProblemSummary,mission:{id:'member-test',status:'running',tasks:[{id:'research',role:'recherche',agentName:'Lina',title:'Vérifier les règles',status:'working'},{id:'code',role:'code',agentName:'Alex',title:'Intégrer les résultats',status:'queued',dependsOn:['research']},{id:'unrelated',role:'design',agentName:'Alma',title:'Dessiner',status:'working'}]},lastMemberSignature:'',openedQuip:'Bonjour',getRole:role=>({label:role}),roleOf:role=>role,agentName:task=>task.agentName||task.id,ROLE_DETAILS:{code:['Service','Livrables','Contrôle'],oscar:['Service','Livrables','Contrôle']},taskStatus:{working:'En cours',reviewing:'Vérification',approved:'Validé',queued:'À venir'},missionStatus:{running:'En cours'},translate:value=>value,$:element,node:(...args)=>new Element(...args),CSS:{escape:value=>value}});
  vm.runInContext(render,context);return{context,elements,render:()=>context.renderMember('code','code'),list:element('member-tasks')};
}

test('an open colleague sheet refreshes changing prerequisite states while preserving unchanged snapshots',async()=>{
  const f=await fixture();f.render();const first=f.list.children[0],contribution=()=>f.list.children[0].children.find(child=>child.className==='member-contributions');assert.match(contribution().textContent,/LinaVérifier les règlesEn cours/u);
  f.context.mission=structuredClone(f.context.mission);f.render();assert.equal(f.list.children[0],first);assert.equal(f.list.replacements,1);
  f.context.mission.tasks[2].status='approved';f.render();assert.equal(f.list.children[0],first,'an unrelated task must not rebuild the open form');
  for(const[status,label]of[['reviewing','Vérification'],['approved','Validé']]){f.context.mission.tasks[0].status=status;f.render();assert.ok(contribution().textContent.endsWith(label));}
  assert.equal(f.list.replacements,3);f.context.mission.tasks[0].agentName='Camille';f.context.mission.tasks[0].title='Nouvelles règles';f.render();assert.match(contribution().textContent,/CamilleNouvelles règlesValidé/u);
  f.context.mission.tasks.shift();f.render();assert.equal(contribution(),undefined,'a removed prerequisite must not remain falsely visible');
});

test('an open specialist sheet replaces jokes and stale activity labels when its mission fails',async()=>{
  const f=await fixture();f.context.openedQuip='Le bug était entre la chaise et la cafetière.';f.context.mission.tasks[1].status='blocked';f.render();
  assert.equal(f.elements.get('member-quip').textContent,'Cette contribution attend les apports indiqués ci-dessous.');
  const before=f.list.children[0];f.context.mission.status='failed';f.context.mission.error='Le moteur n’a pas renvoyé de JSON valide.\n{"private":"payload"}';f.context.mission.performance={calls:[{stage:'review',status:'failed'}]};
  f.context.mission.tasks[0].status='reviewing';f.context.mission.tasks[1].activity='Attend la validation des contributions';const original=JSON.stringify(f.context.mission);f.render();
  assert.notEqual(f.list.children[0],before);assert.equal(f.elements.get('member-quip').textContent,'Oscar n’a pas pu lire sa réponse de vérification.');
  assert.match(f.elements.get('member-expertise').textContent,/Aucun appel du moteur n’est en cours/u);assert.match(f.elements.get('member-expertise').textContent,/Ouvrir le suivi/u);assert.doesNotMatch(f.elements.get('member-expertise').textContent,/payload/u);
  assert.match(f.list.textContent,/Vérification à reprendre/u);assert.match(f.list.textContent,/Dernière activité enregistrée :/u);assert.doesNotMatch(f.list.textContent,/Vérification$/u);assert.equal(JSON.stringify(f.context.mission),original);
  const unchanged=f.list.children[0];f.render();assert.equal(f.list.children[0],unchanged);
});

test('team capacity and slot explanations have French, English and Dutch interfaces',()=>{
  const source='Jusqu’à vingt spécialistes travaillent en parallèle dans l’ensemble de vos bureaux ; les autres attendent une place ou une contribution nécessaire.';
  assert.ok(messages[source]);for(const[key,value]of Object.entries(messages))for(const locale of['en','nl']){assert.equal(typeof value[locale],'string');assert.equal(translate(key,locale),value[locale]);assert.notEqual(translate(key,locale),key);}
});
