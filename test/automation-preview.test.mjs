import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,existsSync} from 'node:fs';
import os from 'node:os';import path from 'node:path';
import {createAtelierServer} from '../server.mjs';
import {translate} from '../public/i18n.js';

test('l’aperçu HTTP est local, strict, sans écriture, sans connexion et sans appel de modèle',async t=>{
 const dataDir=mkdtempSync(path.join(os.tmpdir(),'oscar-schedule-preview-'));let calls=0,readPlans=0;
 const app=await createAtelierServer({port:0,dataDir,providers:[],runner:async()=>{calls++;throw new Error('Aucun appel attendu');},connectorsFactory:()=>({ready:Promise.resolve(),active:new Set(),disabledNames:()=>[],readPlan:async()=>{readPlans++;throw new Error('Aucune lecture attendue');},close:async()=>{}})});await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));t.after(async()=>{await app.close();rmSync(dataDir,{recursive:true,force:true});});
 const base=`http://127.0.0.1:${app.server.address().port}`,post=(body,headers={})=>fetch(base+'/api/automations/preview',{method:'POST',headers:{'Content-Type':'application/json','X-Oscar-Client':'1',...headers},body:JSON.stringify(body)});
 const before=Date.now(),response=await post({schedule:{frequency:'interval',intervalMinutes:15}});assert.equal(response.status,200);const value=await response.json();assert.equal(value.nextRuns.length,3);assert.ok(value.generatedAt>=before);assert.ok(value.nextRuns[0]>=before+15*60000);assert.equal(value.nextRuns[1]-value.nextRuns[0],15*60000);assert.equal(value.requiresRunning,true);assert.equal(typeof value.timezone,'string');
 for(const body of [{schedule:{frequency:'daily'},prompt:'Ne doit jamais être exécuté'},{schedule:{frequency:'daily',connectorName:'gmail'}},{schedule:{frequency:'weekly',dayOfWeek:8}},{schedule:{frequency:'daily',time:'03:99'}}])assert.equal((await post(body)).status,400);
 assert.equal((await post({schedule:{frequency:'daily'}},{Origin:'https://other.invalid'})).status,403);assert.equal((await fetch(base+'/api/automations/preview')).status,404);
 assert.equal(calls,0);assert.equal(readPlans,0);assert.equal(app.engine.missions.size,0);assert.equal(app.automations.state().automations.length,0);assert.equal(existsSync(path.join(dataDir,'automations.json')),false);
});

test('les explications et messages des aperçus sont traduits en anglais et néerlandais',()=>{
 const messages=['Avant d’enregistrer, les trois prochains passages','Choisissez le rythme et l’heure pour voir les prochains passages.','Le bureau doit rester ouvert. Une mission précédente encore active ne sera pas doublée.','Choisissez un service déjà connecté. Son accès en lecture sera vérifié au prochain horaire ; enregistrer ne consulte aucun compte.','Aperçu uniquement : aucun rendez-vous n’est encore enregistré.','Calcul des horaires…','L’aperçu des horaires est indisponible. Votre formulaire est conservé.','Les trois prochains horaires','Choisissez seulement le rythme et l’heure pour obtenir un aperçu.','La routine est programmée. Le service sélectionné et ses autorisations de lecture seront vérifiés au prochain horaire ; enregistrer ne consulte aucun compte.','Choisissez un service de lecture compatible déjà connecté dans ChatGPT ou Claude. Son accès sera vérifié avant le prochain lancement ; aucune lecture n’a été effectuée pour enregistrer cette routine.'];
 for(const message of messages)for(const locale of ['en','nl'])assert.notEqual(translate(message,locale),message,`${locale}: ${message}`);
});
