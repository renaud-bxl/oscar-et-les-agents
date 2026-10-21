import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {WELCOME_STEPS} from '../public/welcome-guide.js';
import {routineTemplate} from '../public/automations-dialog.js';
import {connectorPurpose} from '../public/connectors-dialog.js';
import {translate} from '../public/i18n.js';

test('the guide explains free assistance, documents and dictation in all supported languages',()=>{
  const actions=new Set(WELCOME_STEPS.map(step=>step.action?.[0]));
  assert.ok(actions.has('secretary'));assert.ok(actions.has('documents'));
  const copy=WELCOME_STEPS.flatMap(step=>[step.title,step.label,step.subtitle,...step.paragraphs,...step.tags||[],...(step.action?[step.action[1],step.action[1]+' ↗']:[])]);
  assert.ok(copy.some(value=>value.includes('Dicter ma demande')));
  assert.ok(copy.some(value=>value.includes('sans connecteur')));
  assert.ok(copy.some(value=>value.includes('géolocalisation')));
  for(const value of copy)for(const language of ['en','nl']){
    if(language==='en'&&value==='Communication')continue;
    assert.notEqual(translate(value,language),value,`${language}: ${value}`);
  }
});

test('staffing hints describe the shared specialist capacity in each supported language',async()=>{
  const index=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
  const hints=[
    ...index.matchAll(/<small>(Jusqu’à 4 par métier et 20 au travail simultanément[^<]+)<\/small>/gu),
    ...index.matchAll(/id="team-flow-note">([^<]+)</gu)
  ].map(match=>match[1]);
  assert.equal(hints.length,3);
  for(const hint of hints){
    assert.match(hint,/l’ensemble de vos (?:missions|bureaux)/u);
    for(const language of ['en','nl'])assert.notEqual(translate(hint,language),hint,`${language}: ${hint}`);
  }
  const staffing=WELCOME_STEPS.find(step=>step.label==='Les agents').paragraphs.join(' ');
  assert.match(staffing,/vingt agents travaillent en parallèle dans l’ensemble de vos missions/u);
  assert.match(staffing,/quatre agents par métier/u);
  assert.match(staffing,/davantage votre abonnement/u);
  const offices=WELCOME_STEPS.find(step=>step.label==='Plusieurs bureaux');
  assert.match(offices.subtitle,/quatre missions/u);
  const orchestrator=await readFile(new URL('../lib/orchestrator.mjs',import.meta.url),'utf8');
  const demo=orchestrator.match(/this\.event\(m, 'Oscar', '(Je recrute huit spécialistes[^']+)'\);/u)?.[1];
  assert.ok(demo);
  for(const text of [demo,'Les spécialistes poursuivent leurs contributions','Le brief commun de l’équipe n’est pas valide.'])for(const language of ['en','nl'])assert.notEqual(translate(text,language),text,`${language}: ${text}`);
});

test('routine subjects are inserted literally and do not rewrite document citations',()=>{
  const subject='Commerce $& et [étude 2026]';
  const prompt='Prépare une veille sur [votre sujet]. Conserve [étude 2026] comme référence.';
  const result=routineTemplate(prompt,subject,'fr');
  assert.equal(result,'Prépare une veille sur Commerce $& et [étude 2026]. Conserve [étude 2026] comme référence.');
  assert.doesNotMatch(routineTemplate(prompt,'','fr'),/\[votre sujet\]/u);
});

test('connector explanations distinguish mail, calendar, creative credits and technical services',()=>{
  assert.match(connectorPurpose({readOnlyAutomation:{service:'gmail'}}),/Zoé ne les envoie pas/u);
  assert.match(connectorPurpose({displayName:'Google Calendar'}),/événements restent inchangés/u);
  assert.match(connectorPurpose({name:'Higgsfield'}),/crédits/u);
  assert.match(connectorPurpose({name:'node_repl'}),/outil technique/u);
  for(const connection of [{name:'Gmail'},{name:'Google Calendar'},{name:'GitHub'},{name:'Drive'},{name:'Higgsfield'},{name:'Adobe'},{name:'Slack'},{name:'Search'},{name:'Other',inherited:true},{name:'node_repl'}])for(const language of ['en','nl']){
    const purpose=connectorPurpose(connection);assert.notEqual(translate(purpose,language),purpose,`${language}: ${purpose}`);
  }
});

test('update and document safety notices are translated',()=>{
  for(const source of ['Une nouvelle version du bureau est prête.','Recharger le bureau','Choisissez une demande avant de dicter.','Le texte dicté est trop long pour cette demande.','Les clients officiels vérifient vos accès. La liste se complète automatiquement ; aucune nouvelle autorisation n’est nécessaire pendant cette recherche.','Ce modèle Excel contient une formule active ou une connexion externe non prise en charge.'])for(const language of['en','nl'])assert.notEqual(translate(source,language),source);
});

test('routine draft guidance and ZIP download errors are translated',async()=>{
  const archive=await readFile(new URL('../lib/mission-archive.mjs',import.meta.url),'utf8');
  const notices=[...archive.matchAll(/(?:archiveError|TypeError)\('([^']+)'/gu)].map(match=>match[1]);
  notices.push('Choisissez le rythme','Votre sujet est conservé. Vérifiez qu’il figure bien dans la mission ci-dessous.','Brouillon retrouvé. Choisissez le rythme et l’heure avant d’enregistrer cette routine.','Le navigateur n’a pas confirmé l’effacement du brouillon.','Télécharger toute la mission · ZIP','Préparation de votre archive…','L’archive n’a pas pu être préparée. Ouvrez le dossier de travail.','L’archive reçue n’est pas reconnue. Ouvrez le dossier de travail.','Le téléchargement a été interrompu. Vous pouvez réessayer.','Archive préparée. Le téléchargement a été demandé au navigateur. Les fichiers cachés et dossiers de dépendances sont exclus.');
  for(const source of notices)for(const language of['en','nl'])assert.notEqual(translate(source,language),source,`${language}: ${source}`);
});
