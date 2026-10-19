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

`OSCAR_QA_ROTATE_LOCALES=1` fait alterner français, anglais et néerlandais à chaque passage, en vérifiant que le texte personnel, le focus et la sélection restent conservés. Le rapport indique les langues effectivement exercées.

Ces scénarios complètent les tests de `npm test`. Ils ne prouvent pas l'autorisation d'un vrai compte, la disponibilité d'un fournisseur distant ou la qualité d'une voix : ces vérifications demandent un essai séparé et autorisé.

Deux contrôles ciblés peuvent aussi être lancés avec les mêmes variables Playwright : `node scripts/qa/dialog-lifecycle.mjs` vérifie les fermetures et réouvertures immédiates, sans interrompre la nouvelle dictée ou préécoute ; `node scripts/qa/history-reuse.mjs` vérifie les filtres, la recherche et la reprise d'un brief avec ses révisions de documents. La reprise prépare un formulaire modifiable et ne lance aucune nouvelle mission.

`node scripts/qa/mission-recovery.mjs` laisse le serveur accepter une mission simulée, puis coupe sa réponse avant qu'elle parvienne à l'interface. Il vérifie la reprise après rechargement, la conservation du moteur et de l'effectif, le refus d'une référence modifiée, ainsi que le renouvellement volontaire par une nouvelle demande. Les appels restent simulés : aucun quota réel n'est utilisé.

`node scripts/qa/secretary-services.mjs` vérifie les services de Zoé avec des connexions et moteurs simulés : routines lentes, autorisations périmées, carte Google Drive, travail immédiat sans routine, programmation à 17:45, traductions FR/EN/NL et affichage mobile ; le rapport et les captures vont dans `oscar-secretary-services` ou `OSCAR_QA_OUTPUT`.

`node scripts/qa/secretary-recovery.mjs` vérifie qu’un service perdu ne devient jamais un autre compte, puis coupe une réponse acceptée et retrouve la demande après rechargement et changement de langue, sans abonnement disponible, service accessible ou place libre. Les erreurs et vérifications en cours bloquent tout nouveau départ ; seul un reçu absent autorise la même intention et le même identifiant. Tous les comptes et appels restent simulés.

`node scripts/qa/studio-recovery.mjs` vérifie la conservation du brief, du support et du format, puis la reprise explicite après réponse perdue ou rechargement. Une mission acceptée est retrouvée sans nouveau départ, même avec quatre places occupées ; les erreurs de vérification ne déclenchent aucun appel supplémentaire. Le contrôle couvre aussi les langues FR/EN/NL et le mobile, avec des moteurs simulés.

`node scripts/qa/accessibility-navigation.mjs` vérifie les retours au clavier des réglages et de la fiche Oscar, Échap, les fermetures et réouvertures immédiates, ainsi que le passage volontaire des connecteurs à Zoé. Il coupe réellement le flux de mises à jour et vérifie le même champ, son texte, sa sélection et son focus après reconnexion. Les compteurs de zéro, un et plusieurs exemples suivent FR/EN/NL sans modifier les fichiers sélectionnés ni les textes personnels. Aucun lancement de mission, lecture de compte ou téléchargement de modèle n’est nécessaire.
