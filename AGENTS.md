# Oscar et les Agents

Application locale en français : un chef Oscar, cinq métiers, missions guidées et bureau illustré animé.

## Installer et lancer pour une personne

Quand la personne demande d’installer et lancer ce dépôt, effectue le travail :

1. Depuis une copie du dépôt, lance `sh install.sh --engine codex` si tu es Codex/ChatGPT, `sh install.sh --engine claude` si tu es Claude Code, ou `--engine both` si la personne demande les deux. Pour un autre dossier, ajoute `--dir` avec son chemin absolu.
2. Le programme prépare Node.js et les moteurs manquants sans sudo, conserve les connexions d’abonnement et ouvre la connexion officielle dans le navigateur si nécessaire. Laisse la personne confirmer sa connexion dans son navigateur.
3. Le bureau s’ouvre sur http://localhost:4850. Les données se trouvent dans `~/Documents/Oscar et les agents`.

Ne demande jamais de clé API pour cette application. N’extrais ni ne copie les jetons de connexion. Ne supprime pas `--restricted` pour contourner une ancienne version Claude : l’installateur met le moteur à niveau localement.

## Développement

- Node.js >=22.18, modules ES, aucune dépendance à installer pour le serveur ou l’interface.
- `npm test` vérifie les parcours sans consommer de quota de modèle. Les appels réels ne sont nécessaires que si la modification touche leur intégration.
- `npm run serve` lance le serveur ; `npm start` ouvre aussi le navigateur.
- Ne versionne ni `data/`, ni `.tools/`, ni `.runtime/`, ni identifiants, journaux, briefs ou fichiers personnels.
- Les quatre missions utilisent des dossiers et contrôleurs d’arrêt indépendants.
- Oscar peut recruter jusqu’à vingt agents, au maximum quatre par métier, avec quatre spécialistes actifs à la fois par mission.
- Les personnages suivent l’état des tâches. Les animations et objets décoratifs ne modifient pas la progression réelle.
- Aucun paiement n’est effectué par le logiciel : le café ouvre un choix volontaire puis un lien vers la confirmation PayPal.
