import test from 'node:test';
import assert from 'node:assert/strict';
import {simpleCodePlan} from '../lib/orchestrator.mjs';
import {translate} from '../public/i18n.js';

test('the actual local game plan has translated approach, task names, instructions and criteria',()=>{
  const plan=simpleCodePlan({provider:'codex',prompt:'Crée un petit jeu de plateforme dans mon navigateur avec des personnages et des décors.'});
  assert.ok(plan?.coordination);assert.ok(plan.tasks.length>=7);
  for(const source of[plan.approach,...plan.tasks.flatMap(task=>[task.title,task.instruction,task.criteria])])for(const locale of['en','nl']){
    const target=translate(source,locale);assert.notEqual(target,source,`${locale}: ${source}`);
    for(const file of source.match(/[a-z][a-z-]*\.(?:json|md|js|css|svg|html)\b/gu)||[])assert.ok(target.includes(file),`${locale}: preserve ${file}`);
    if(source.includes('Contributions/'))assert.ok(target.includes('Contributions/'));
  }
});

test('dependency failures and file-integrity notices are translated without changing paths',()=>{
  const sources=['Le plan contient une dépendance de tâche invalide.','Le plan contient un cycle de dépendances.','Une contribution a changé depuis sa validation. Oscar doit la vérifier de nouveau.','Les contributions dépassent la limite de copie locale de 50 Mo.','Attend une contribution validée par Oscar','Une contribution nécessaire n’a pas été validée par Oscar.','Alex intègre les contributions validées','Oscar vérifie les contributions de l’équipe','Oscar n’a pas fourni une validation distincte pour chaque contribution.','La livraison intégrée a changé depuis sa validation. Les contributions sont conservées.','J’ai contrôlé le jeu complet et réuni les contributions validées dans Livraison/.'];
  for(const source of sources)for(const locale of['en','nl'])assert.notEqual(translate(source,locale),source,`${locale}: ${source}`);
  for(const source of['Fichiers obligatoires absents, invalides ou modifiés pendant le contrôle : t1-design/ui-theme.css.','La livraison intégrée reste à vérifier : Livraison/index.html.'])for(const locale of['en','nl']){
    const target=translate(source,locale);assert.notEqual(target,source);assert.ok(target.includes(source.includes('t1-design')?'t1-design/ui-theme.css':'Livraison/index.html'));
  }
});
