# Contrôles navigateur isolés

Ces outils démarrent leur propre serveur sur un port libre et créent un dossier temporaire supprimé à la fermeture. Les moteurs, Gmail et Agenda sont simulés. Ils n'utilisent jamais le bureau personnel, ses missions, ses connexions ou un quota de modèle. Les pages externes sont bloquées dans le navigateur.

Playwright et son navigateur doivent être disponibles séparément ; ils ne sont pas nécessaires à l'installation normale d'Oscar. Si le module n'est pas résolu par Node, définir `OSCAR_QA_PLAYWRIGHT` avec le chemin absolu du module et, si nécessaire, `OSCAR_QA_CHROMIUM` avec celui du navigateur.

```sh
node scripts/qa/office-e2e.mjs
```

Le parcours vérifie notamment les langues, la navigation, les brouillons, la dictée avant envoi, l'import d'exemples, Zoé, les missions simultanées, l'annulation, les livraisons, le ZIP, les routines et les préécoutes vocales. Il écrit un rapport JSON et des captures dans le dossier temporaire `oscar-office-e2e`, ou à l'emplacement `OSCAR_QA_OUTPUT`.

```sh
OSCAR_QA_DURATION_MS=300000 node scripts/qa/office-soak.mjs
```

Le contrôle prolongé tourne cinq minutes par défaut. `OSCAR_QA_UNTIL` accepte une échéance ISO explicite, dans les douze heures suivantes. Chaque passage exerce le planificateur avec une horloge simulée, puis vérifie la pause, les réponses, le focus et les brouillons. Il coupe périodiquement le flux de mises à jour pour vérifier sa reconnexion. Les mesures de mémoire et d'activité sont écrites toutes les 45 secondes ; leur évolution doit être interprétée avec le ramasse-miettes et le nombre de missions conservées, plutôt qu'avec un seuil arbitraire.

`OSCAR_QA_PULSE_MS` règle l'espacement des passages (cinq minutes par défaut, minimum deux secondes pour vérifier l'outil lui-même). `Ctrl+C` termine le contrôle et ferme le serveur isolé.

Ces scénarios complètent les tests de `npm test`. Ils ne prouvent pas l'autorisation d'un vrai compte, la disponibilité d'un fournisseur distant ou la qualité d'une voix : ces vérifications demandent un essai séparé et autorisé.

Deux contrôles ciblés peuvent aussi être lancés avec les mêmes variables Playwright : `node scripts/qa/dialog-lifecycle.mjs` vérifie les fermetures et réouvertures immédiates, sans interrompre la nouvelle dictée ou préécoute ; `node scripts/qa/history-reuse.mjs` vérifie les filtres, la recherche et la reprise d'un brief avec ses révisions de documents. La reprise prépare un formulaire modifiable et ne lance aucune nouvelle mission.

`node scripts/qa/mission-recovery.mjs` laisse le serveur accepter une mission simulée, puis coupe sa réponse avant qu'elle parvienne à l'interface. Il vérifie la reprise après rechargement, la conservation du moteur et de l'effectif, le refus d'une référence modifiée, ainsi que le renouvellement volontaire par une nouvelle demande. Les appels restent simulés : aucun quota réel n'est utilisé.

`node scripts/qa/secretary-services.mjs` vérifie les services de Zoé avec des connexions et moteurs simulés : routines lentes, autorisations périmées, carte Google Drive, travail immédiat sans routine, programmation à 17:45, traductions FR/EN/NL et affichage mobile ; le rapport et les captures vont dans `oscar-secretary-services` ou `OSCAR_QA_OUTPUT`.
