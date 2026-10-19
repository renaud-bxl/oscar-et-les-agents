import test from 'node:test';
import assert from 'node:assert/strict';
import { DraftStorage, draftScope } from '../public/draft-storage.js';
const memory = () => { const data=new Map();return {data,getItem:key=>data.get(key)||null,setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key)}; };
test('les écrits se restaurent par bureau, sans lancer une mission ni conserver de service ou de position',()=>{
 const storage=memory(),a=new DraftStorage({scope:'bureau-a',storage}),b=new DraftStorage({scope:'bureau-b',storage});
 assert.equal(a.write('secretary',{text:'Une question à terminer',mode:'free',provider:'codex',latitude:50,longitude:4,connectorName:'gmail',token:'SECRET',files:['secret.pdf']}),true);
 assert.deepEqual(a.read('secretary'),{text:'Une question à terminer',mode:'free',provider:'codex'});assert.equal(b.read('secretary'),null);
 assert.ok(!JSON.stringify([...storage.data.values()]).includes('SECRET'));assert.equal(a.remove('secretary'),true);assert.equal(a.read('secretary'),null);
});
test('les brouillons expirent après sept jours et les dates futures ne sont pas acceptées',()=>{
 const storage=memory();let now=100000;const draft=new DraftStorage({storage,now:()=>now});draft.write('oscar',{text:'À reprendre'});now+=7*86400000;assert.equal(draft.read('oscar'),null);assert.equal(storage.data.size,0);
 draft.write('oscar',{text:'Plus tard'});now-=120000;assert.equal(draft.read('oscar'),null);
});
test('la taille et le nombre des bureaux sont bornés et le plus récent reste disponible',()=>{
 const storage=memory();let now=100000;for(let i=0;i<20;i++)new DraftStorage({storage,scope:'bureau-'+i,now:()=>++now,maxEntries:4,maxBytes:3000}).write('oscar',{text:'x'.repeat(1500)});
 const data=JSON.parse([...storage.data.values()][0]);assert.ok(data.entries.length<=4);assert.ok(JSON.stringify(data).length<=3000);assert.ok(new DraftStorage({scope:'bureau-19',storage,now:()=>now}).read('oscar'));
});
test('un stockage bloqué ou invalide conserve une interface utilisable',()=>{
 const blocked=new DraftStorage({storage:{getItem(){throw new Error();},setItem(){throw new Error();},removeItem(){throw new Error();}}});assert.equal(blocked.read('oscar'),null);assert.equal(blocked.write('oscar',{text:'Reste en mémoire du formulaire'}),false);assert.equal(blocked.available,false);
 const storage=memory();storage.setItem('oscar.writing-drafts.v1','{INVALID');const draft=new DraftStorage({storage});assert.equal(draft.read('oscar'),null);assert.equal(storage.data.size,0);
});
test('le jeton de requête non confirmé peut survivre à une actualisation, seuls les identifiants valides sont acceptés',()=>{
 const storage=memory(),draft=new DraftStorage({storage});draft.write('secretary',{text:'La même demande',requestId:'request_12345678',requestHash:'a'.repeat(64)});assert.equal(new DraftStorage({storage}).read('secretary').requestId,'request_12345678');
 draft.write('oscar',{text:'Le même projet',teamSize:'8',requestId:'oscar_12345678',requestHash:'b'.repeat(64)});assert.equal(new DraftStorage({storage}).read('oscar').teamSize,'8');assert.equal(new DraftStorage({storage}).read('oscar').requestId,'oscar_12345678');
 draft.write('secretary',{text:'Autre demande',requestId:'../../secret',requestHash:'raw private content'});assert.deepEqual(draft.read('secretary'),{text:'Autre demande'});
});
test('les clés et les noms de champs arbitraires ne sont jamais enregistrés',()=>{
 const storage=memory(),draft=new DraftStorage({storage});assert.equal(draft.write('account',{text:'secret'}),false);assert.equal(draft.write('oscar',{token:'secret'}),true);assert.equal(storage.data.size,0);assert.equal(draft.read('oscar'),null);
 assert.equal(draftScope({href:'http://localhost:4850/?mission=alpha-123'},null),'alpha-123');assert.equal(draftScope({href:'http://localhost:4850/?mission=../../private'},null),'home');
});
test('les nouveaux onglets ont des brouillons indépendants, stables lors des changements de mission et rechargements',()=>{
 const first=memory(),second=memory(),blank={href:'http://localhost:4850/?new=1'},mission={href:'http://localhost:4850/?mission=alpha-123'};
 const a=draftScope(blank,first),b=draftScope(blank,second);assert.notEqual(a,b);assert.match(a,/^office_/);assert.equal(draftScope(blank,first),a);assert.equal(draftScope(mission,first),a);assert.equal(draftScope(mission,second),b);
 const blocked={getItem(){throw new Error();}};assert.equal(draftScope(blank,blocked),'home');
});
test('le studio restaure ses choix et le brief exact du reçu, sans compte, fichier ni dessin',()=>{
 const storage=memory(),draft=new DraftStorage({scope:'atelier',storage}),studioBrief='  Brief soumis\navec une mise en page exacte.\n';
 const safe={text:'Créer une couverture originale',studioPreset:'illustration',studioFormat:'A4',studioBrief,requestId:'studio_12345678',requestHash:'c'.repeat(64)};
 draft.write('studio',{...safe,provider:'claude',mode:'service',teamSize:'20',title:'non conservé',account:'compte privé',token:'SECRET',svg:'<svg>PRIVATE</svg>',blob:'blob:SECRET',latitude:50,longitude:4,references:[{id:'PRIVATE'}]});
 assert.deepEqual(new DraftStorage({scope:'atelier',storage}).read('studio'),safe);
 const raw=JSON.stringify([...storage.data.values()]);for(const forbidden of ['SECRET','PRIVATE','compte privé','claude','latitude','longitude','non conservé'])assert.ok(!raw.includes(forbidden));
 draft.write('oscar',safe);assert.deepEqual(draft.read('oscar'),{text:safe.text,requestId:safe.requestId,requestHash:safe.requestHash});
});
test('le studio rejette les reçus incomplets, surdimensionnés et les choix inconnus sans tronquer un brief soumis',()=>{
 const storage=memory(),draft=new DraftStorage({storage}),base={text:'Brouillon à garder',studioPreset:'branding',studioFormat:'16:9',studioBrief:'Brief exact',requestId:'studio_12345678',requestHash:'d'.repeat(64)};
 for(const invalid of [{studioBrief:'x'.repeat(16001)},{studioBrief:''},{requestId:'../private'},{requestHash:'not-a-fingerprint'},{requestId:undefined}]){
  draft.write('studio',{...base,...invalid});assert.deepEqual(draft.read('studio'),{text:base.text,studioPreset:'branding',studioFormat:'16:9'});
 }
 draft.write('studio',{text:base.text,studioPreset:'<svg>',studioFormat:'A0'});assert.deepEqual(draft.read('studio'),{text:base.text});
 draft.write('studio',{...base,studioPreset:'unknown'});assert.deepEqual(draft.read('studio'),{text:base.text,studioFormat:'16:9'});
});
test('le reçu du studio respecte la durée et la limite globale des brouillons',()=>{
 const storage=memory();let now=100000;const draft=new DraftStorage({storage,now:()=>now,maxBytes:2048});
 draft.write('studio',{text:'Une idée',studioPreset:'social',studioFormat:'1:1',studioBrief:'x'.repeat(3000),requestId:'studio_12345678',requestHash:'e'.repeat(64)});assert.equal(draft.read('studio'),null);assert.equal(storage.data.size,0);
 draft.write('studio',{text:'Une idée',studioPreset:'social',studioFormat:'1:1',studioBrief:'Brief exact',requestId:'studio_12345678',requestHash:'e'.repeat(64)});now+=7*86400000;assert.equal(draft.read('studio'),null);assert.equal(storage.data.size,0);
});
