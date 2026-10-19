# Oscar et les Agents

Donnez une mission à Oscar. Il recrute les bons spécialistes, ils arrivent dans un grand bureau illustré et animé, travaillent, rendent leurs dossiers… et prennent un café quand leur travail est validé.

**Version 0.5.0** — une application locale en **français, anglais et néerlandais**, avec **ChatGPT via Codex** ou **Claude Code**, sans clé API à saisir.

![Le bureau illustré d’Oscar, les îlots de travail et le coin café](docs/bureau.png)

## Installer et ouvrir

Dans **Codex** ou **Claude Code**, avec accès à votre ordinateur, vous pouvez simplement demander :

> Installe et lance Oscar et les agents : https://github.com/renaud-bxl/oscar-et-les-agents

L’agent trouve les instructions du dépôt et prépare le bon moteur.

Sur **macOS ou Linux**, vous pouvez aussi coller cette commande dans un terminal :

```sh
curl -fsSL https://raw.githubusercontent.com/renaud-bxl/oscar-et-les-agents/main/install.sh | sh
```

L’installation vous demande votre moteur : **ChatGPT**, **Claude** ou **les deux**. Elle prépare les outils manquants dans le dossier de l’application, ouvre la connexion officielle dans le navigateur si nécessaire, puis ouvre le bureau. Une connexion d’abonnement déjà présente est conservée. Les identifiants restent gérés par les outils officiels.

Pour choisir directement :

```sh
# ChatGPT / Codex
curl -fsSL https://raw.githubusercontent.com/renaud-bxl/oscar-et-les-agents/main/install.sh | sh -s -- --engine codex

# Claude Code
curl -fsSL https://raw.githubusercontent.com/renaud-bxl/oscar-et-les-agents/main/install.sh | sh -s -- --engine claude

# Les deux
curl -fsSL https://raw.githubusercontent.com/renaud-bxl/oscar-et-les-agents/main/install.sh | sh -s -- --engine both
```

Node.js 22.18 ou plus récent est nécessaire ; s’il manque, l’installateur prépare une version portable de Node.js 24 depuis le site officiel. Il ne demande pas de droits administrateur et ne remplace pas vos outils globaux. Le bootstrap automatique vise macOS et Linux ; Windows n’est pas encore validé.

Les fois suivantes, ouvrez **Oscar et les agents** dans votre dossier Applications sur Mac, ou double-cliquez sur **Lancer.command**. Le bureau est disponible sur **http://localhost:4850**. Le lanceur retrouve un bureau déjà ouvert.

## Votre première visite

Un guide vous accueille au premier lancement : le rôle d’Oscar, la connexion, les missions, les agents, les livraisons et les réglages. Vous pouvez le fermer et le retrouver avec le bouton **?** du bureau ou **Revoir le guide de découverte** dans les réglages.

Choisissez **ChatGPT** ou **Claude** dans le guide. Si son programme officiel manque, **Préparer et connecter** l’installe dans le dossier de l’application, puis lance la connexion officielle dans votre navigateur. Ce parcours est aussi accessible depuis les réglages et les questionnaires ; une connexion déjà reconnue est conservée. La connexion d’un moteur en cours d’utilisation attend la fin de ses missions.

Le choix **Français / English / Nederlands**, dans le guide ou les réglages, est mémorisé dans ce navigateur. Il s’applique à l’interface, aux questionnaires, au résumé à relire et à la langue demandée aux agents pour les prochaines missions. Vos réponses personnelles restent telles que vous les écrivez. Les missions déjà produites et leurs fichiers ne sont pas retraduits automatiquement.

## Une équipe qui travaille vraiment

- **Oscar** : prépare le plan, recrute, contrôle, demande les corrections et assemble la livraison.
- **Lina — recherche** : sources, concurrents, marché et informations vérifiables.
- **Noé — rédaction** : articles, messages, scripts et documents.
- **Sam — code** : pages web, scripts et outils.
- **Alma — design** : structure visuelle, HTML/CSS/SVG et lisibilité.
- **Jules — analyse** : données, calculs, comparaisons et recommandations étayées.
- **Zoé — secrétariat** : prépare le point sur les messages et l’agenda, avec un service autorisé en lecture seule.

Ces personnages représentent des agents IA. Chaque tâche démarre un agent distinct. Oscar choisit les métiers nécessaires ; il n’appelle pas automatiquement les cinq pour une petite demande. Les animations montrent les états réels des tâches. Les pauses et les discussions sont décoratives ; elles ne retardent pas les appels aux modèles.

Un résultat refusé repasse une fois en correction. Les fichiers obligatoires sont contrôlés sur le disque. L’assemblage final est ensuite relu. Un refus persistant reste **à revoir** et n’est pas annoncé comme une livraison validée. Ces contrôles IA et matériels complètent votre relecture ; ils ne garantissent pas l’absence d’erreur.

## Quatre-vingt-quatre missions pour démarrer

La bibliothèque propose **84 points de départ**, avec catégories et recherche : logiciels sur mesure, applications web, tableaux de bord, outils locaux, sites, boutiques, communication, design, recherche, analyse et organisation.

Huit parcours sont dédiés aux jeux : jeu 2D sur mesure, plateforme, puzzle, gestion, cartes, quiz, aventure à choix et arcade. Les livraisons visent une première version locale jouable ou utilisable, avec son mode d’emploi et ses vérifications. Un prototype mobile reste une application web ; une boutique de démonstration n’encaisse aucun paiement.

Les nouveaux parcours **Parlement & institutions** couvrent la recherche parlementaire belge, les questions, le suivi d’un texte, les débats et amendements, les positions publiques, les auditions et les dossiers européens. D’autres missions structurent un dossier thématique, retrouvent des archives, croisent les sources ou préparent une veille. Les consignes exigent des références vérifiables et datées, distinguent un texte en discussion du droit en vigueur et signalent les documents inaccessibles. Une veille préparée ne crée pas de surveillance automatique ; une note documentaire ne constitue pas un avis juridique.

La catégorie **Écriture & livres** aide à commencer un roman, une nouvelle, un essai, une biographie autorisée, un guide pratique ou un livre jeunesse. Vous pouvez aussi construire un plan, des personnages et un univers, tester un chapitre, réviser, corriger ou préparer un dossier d’éditeur. Un projet de livre avance par étapes : plan, première partie et validations. Les droits sur les matériaux fournis et les faits concernant les personnes réelles doivent être respectés.

Des parcours complètent les usages professionnels : dossier de presse, discours, lettre thématique, rapport annuel, traduction, comparaison de logiciels, tutoriel, FAQ, cahier des charges, documentation, dossier associatif et proposition commerciale.

Douze missions de **design créatif** préparent un visuel original, un kit de marque, des affiches, un logo, une illustration, un pack de publications, une infographie, une présentation produit, des icônes, une couverture ou une bannière web. Les livrables sont des dessins vectoriels originaux en **SVG modifiable**, avec textes éditables et, selon le projet, une présentation HTML locale. Les images fournies doivent être autorisées ; ces parcours ne promettent pas une photographie ou une génération d’image bitmap par IA. La disponibilité juridique d’un logo et les contraintes finales de l’imprimeur restent à vérifier.

Le **studio créatif** permet aussi de composer des formes et des textes sur cet ordinateur, puis d’exporter un **SVG modifiable** ou un **PNG**. Il peut ouvrir un visuel livré par une mission. L’édition et l’export du studio ne consomment aucun quota de modèle ; une création confiée aux agents utilise votre abonnement. Le studio ne génère pas de photos et ne transforme pas automatiquement une image en dessin vectoriel.

Choisissez une carte, répondez aux questions, ajustez le résumé, puis confiez-le à Oscar. **Mon idée** permet de partir d’une demande libre. Les missions préparent des livrables : les contenus de réseaux sociaux restent des brouillons, les questions parlementaires ne sont pas déposées et les dossiers d’éditeur ne sont pas envoyés automatiquement. Une publication éventuelle passe par votre action et votre confirmation dans la livraison.

## Jusqu’à quatre bureaux en même temps

Pendant une mission, **Créer une autre mission** ouvre une nouvelle fenêtre avec son propre Oscar, son bureau et son équipe. Jusqu’à quatre missions peuvent avancer simultanément. Chaque bureau conserve son lien et ses fichiers ; arrêter une mission n’arrête pas les autres.

Dans le brief ou le questionnaire, **Effectif souhaité** propose **automatique, 4, 8, 12, 15 ou 20 agents**. Oscar organise les contributions selon la demande, avec au maximum **quatre spécialistes par métier**. Alma, Maya, Jade et Rose peuvent par exemple proposer quatre contributions de design. Chaque agent garde son prénom, sa tâche et son dossier.

**Quatre spécialistes au maximum travaillent réellement en parallèle dans une mission**, même avec une équipe de vingt. Le choix d’un grand effectif multiplie les contributions et utilise davantage votre abonnement. Les quatre missions simultanées et les effectifs souhaités restent soumis aux quotas et limites de vos abonnements.

## Tout retrouver dans Documents

Dès l’ouverture, l’application crée :

```text
Documents/
└── Oscar et les agents/
    ├── preferences.json
    ├── automations.json
    ├── connectors.json
    ├── voix-conversation/        # après installation du pack Oscar et Zoé
    ├── voix-locales/             # anciennes voix légères facultatives
    └── missions/
        └── 2026-10-19 — Mon projet/
            ├── state.json
            └── travail/
                ├── Livraison.md
                ├── Livraison/
                ├── Rapports/
                └── dossiers-des-spécialistes/
```

Les briefs, le journal d’activité, les validations et les fichiers sont conservés dans ce dossier. **Mes missions dans Documents** l’ouvre depuis les réglages. Arrêter un agent conserve les fichiers déjà produits.

Chaque mission reçoit un dossier avec **sa date et un nom lisible**. Les homonymes portent un numéro ; aucun dossier existant n’est écrasé. À l’ouverture, les anciens dossiers de missions terminées portant un identifiant technique sont renommés quand cela peut être fait sans conflit. Les fichiers à l’intérieur gardent leurs noms et leur contenu. Le dossier d’une mission en cours reste stable. Depuis la livraison, ouvrez son dossier ou un document compatible dans son application habituelle ; les scripts et programmes ne sont pas ouverts automatiquement.

Le stockage des dossiers est local. Pour réaliser les missions, les outils officiels transmettent au fournisseur choisi les consignes et les contenus nécessaires à son travail. Le logiciel n’est donc pas un modèle fonctionnant hors ligne. Les identifiants de connexion restent gérés par les outils officiels ; ils ne sont pas copiés dans les livraisons.

## Un bureau qui occupe toute la fenêtre

Le bureau est l’écran principal : il remplit toute la fenêtre, avec un menu flottant et des panneaux qui s’ouvrent par-dessus la scène. Le tableau des missions, l’équipe et l’armoire des livraisons sont cliquables ; le menu donne aussi accès aux mêmes fonctions au clavier. Cliquer sur un îlot ouvre la fiche de son métier, ses contributions et ses points de contrôle ; cliquer sur un agent montre sa tâche et son compte rendu.

Le grand bureau adopte un dessin lisse, des couleurs douces, des ombres et des personnages expressifs. Cinq îlots de quatre postes rassemblent les métiers. Les agents entrent par la porte, marchent jusqu’à leur bureau, apportent leurs dossiers à Oscar puis vont au café après validation. Les fenêtres, les lampes, le chat, la machine à café et l’horloge réagissent au clic. L’horloge ouvre un petit panneau consacré à l’heure et à l’ambiance. La pause fige les animations ; les missions continuent.

Par défaut, la lumière suit **l’heure locale de votre ordinateur** : aube de **6 h à 8 h**, journée de **8 h à 18 h**, coucher de soleil de **18 h à 20 h**, puis nuit de **20 h à 6 h**. Ce cycle décoratif ne calcule pas le lever réel du soleil. Vous pouvez choisir une ambiance manuelle et régler les lumières ; ces choix sont mémorisés dans le navigateur. Le mode automatique se retrouve dans les réglages.

**Voir une démo** montre ce parcours avec huit personnages, dont quatre designers, sans appeler un modèle. Les missions guidées, le brief, les connexions, l’historique, le suivi et les fichiers restent accessibles sans quitter le bureau. Le bouton de plein écran inclut le menu et les panneaux. Le bandeau précise qu’il s’agit d’une simulation.

**Oscar et Zoé sont les deux voix du bureau** ; les spécialistes gardent leurs répliques écrites. Le pack recommandé utilise [Pocket TTS](https://github.com/kyutai-labs/pocket-tts) en local pour le français, l’anglais et le néerlandais. Un seul téléchargement volontaire prépare les deux personnages et les trois langues. Les tailles de téléchargement et d’installation sont indiquées avant confirmation. Les sous-titres restent disponibles pendant la préparation ou si aucune voix compatible n’est prête.

Ce pack demande **Python 3.10 à 3.14 sur macOS ou Linux**. Le bureau prépare un environnement vocal séparé à partir du Python présent ; s’il manque, les réglages l’indiquent et conservent les sous-titres. Le pack privilégie le modèle français à 24 couches, et les modèles anglais et néerlandais à 6 couches : environ **1,2 Go de modèles et voix**, plus le programme local et ses dépendances, avec environ **2,2 Go à prévoir sur le disque**. Les tailles détaillées affichées par le serveur priment sur ces indications arrondies.

Après installation, la synthèse fonctionne sur votre ordinateur, sans clé API ni service vocal distant. Le pack utilise uniquement les presets officiels **Marius pour Oscar** et **Estelle pour Zoé**, depuis les [poids sans clonage](https://huggingface.co/kyutai/pocket-tts-without-voice-cloning) ; aucun fichier de voix personnelle n’est demandé ou importé. Les extraits de démonstration permettent d’écouter les deux voix dans chaque langue **avant le téléchargement**. Ils ne démarrent pas automatiquement ; vos propres textes nécessitent ensuite le pack installé. Un cache local limité à **32 Mo et 100 extraits** évite de recalculer les mêmes répliques. Chaque demande est limitée à 500 caractères. Le premier chargement et la lecture peuvent prendre un instant ; le rendu, l’accent et la vitesse varient selon la langue et l’ordinateur. Préécoutez les voix pour les choisir. Les voix du système restent une option volontaire distincte ; elles ne sont jamais activées comme repli automatique.

Le code Pocket TTS est MIT et ses poids sont CC BY 4.0. Les presets Marius (don volontaire) et Estelle (enregistrement Kyutai) sont CC0 ; les notices et la [provenance des voix](https://huggingface.co/kyutai/tts-voices) restent consultables. Les modèles et leurs licences sont conservés séparément du code de l’application. Les anciennes voix Piper restent dans une option secondaire : Siwis, Jessica et Pierre en français, Alba en anglais. Plus légères, elles conservent leurs propres notices : [Sherpa ONNX](https://k2-fsa.github.io/sherpa/onnx/javascript-api/examples/api_offline_tts.html) Apache 2.0, données Siwis/Alba CC BY 4.0 et Jessica/Pierre CC BY-SA 4.0, prononciation eSpeak NG GPL 3 ou ultérieure. Aucun composant vocal n’est téléchargé par une simple consultation de l’état.

La machine à café ouvre quatre soutiens volontaires à Renaud via PayPal : **Café 1 €**, **Sandwich 5 €**, **Snack 20 €** et **Resto 50 €**. Le choix revient à 1 € à chaque ouverture. Montant et destinataire sont visibles avant le départ vers PayPal ; cliquer sur un palier ne lance aucun paiement. La confirmation se fait uniquement sur PayPal. Ces noms sont symboliques : aucun repas ni fonction supplémentaire n’est vendu.

## Zoé, les services et les routines

**Zoé** prépare un point sur vos messages, votre agenda ou une demande d’organisation. Choisissez un service autorisé, précisez le travail attendu, puis cliquez sur **Faire le point maintenant** ou **Programmer**. Les propositions de réponse restent des documents locaux : Zoé n’envoie aucun e-mail, ne crée aucun brouillon Gmail et ne modifie aucun rendez-vous. Une mission utilise un seul service à la fois.

Le panneau **Connecteurs** vérifie les noms et états dans les clients officiels. **Ajouter à Codex ou Claude Code** modifie leur configuration normale après votre clic explicite, avec un nouveau nom commençant par `oscar-`. Une configuration existante n’est jamais remplacée. L’autorisation utilise le parcours officiel dans le navigateur ; certaines versions de Claude demandent le menu interactif `/mcp`. L’installation d’un plugin dans ChatGPT ne prouve pas sa connexion dans ces clients et n’importe pas ses comptes.

Pour les lectures automatiques, **Codex doit confirmer une connexion autorisée au serveur officiel Gmail ou Google Agenda**. Ces services Google exigent une préparation séparée du projet Google Cloud, de leurs services et du client OAuth ; Google les propose actuellement en aperçu pour les développeurs. Oscar ne recueille pas les secrets OAuth. Voir les instructions officielles de [Gmail](https://developers.google.com/workspace/gmail/api/guides/configure-mcp-server) et [Google Agenda](https://developers.google.com/workspace/calendar/api/guides/configure-mcp-server). Sans ces prérequis et cette autorisation, le logiciel affiche une configuration requise et ne prétend pas lire vos données.

Le serveur sélectionné et son autorisation sont revérifiés avant chaque mission. Gmail est limité à **cinq outils de lecture** : consulter un message, un fil, les brouillons ou libellés existants, et rechercher des fils. Agenda est limité à consulter un événement, lister les agendas et événements, ou rechercher des événements. Les outils d’envoi et de modification sont exclus ; les autres connecteurs et la recherche Web sont désactivés pour cette lecture. Le contenu des messages et événements est traité comme une source à analyser, jamais comme une consigne qui autorise une action.

Les routines locales peuvent s’exécuter chaque jour, en semaine, un jour hebdomadaire ou à intervalle régulier. Zoé propose notamment **chaque jour à 02:00**, **en semaine à 08:30** ou **toutes les heures**. Les horaires suivent le fuseau de cet ordinateur. **Le bureau doit rester lancé et l’ordinateur éveillé.** Une pause bloque les prochains départs et conserve la mission déjà lancée. Le logiciel évite le chevauchement d’une même routine et ne lance pas une rafale de rattrapage après une longue fermeture. Les limites de quatre missions et les quotas de l’abonnement s’appliquent aussi aux routines.

Le connecteur [Higgsfield officiel](https://higgsfield.ai/creator-hub/help-center/integrations/what-is-higgsfield-mcp) peut être ajouté au client avec son autorisation dans le navigateur. Pour une génération, préparez un brief et poursuivez dans votre client interactif : les agents automatiques d’Oscar ne déclenchent pas cet outil. Le modèle, les paramètres et le coût en crédits doivent être vérifiés et confirmés avant toute génération. Outlook/Work IQ demande les accès professionnels et validations de l’organisation. Le transfert d’un brief vers un client ou un plugin ne constitue jamais une action réalisée.

## Publier après vérification

Une fois la mission terminée, **Livraison → Publier** propose GitHub ou un hébergement FTP/FTPS. Choisissez le dossier du projet, vérifiez la liste des fichiers et la destination dans l’aperçu, puis cliquez sur **Confirmer et publier**. Si les fichiers ou la destination changent, un nouvel aperçu est nécessaire. L’envoi est limité à 500 fichiers, 15 Mo par fichier et 50 Mo au total.

**GitHub** : l’outil officiel GitHub (`gh`) doit déjà être installé sur votre ordinateur. Le bouton de connexion utilise son parcours officiel dans le navigateur. Choisissez un **nouveau dépôt dans votre compte**, privé ou public. L’application y envoie les fichiers confirmés ; elle n’active pas GitHub Pages et ne met pas automatiquement le site en ligne. Un dépôt public rend ses fichiers accessibles à tous.

**FTP / FTPS** : indiquez votre hébergement, le dossier distant et les identifiants nécessaires à cet envoi. FTPS chiffre la connexion ; FTP ne la chiffre pas. Ces identifiants ne sont enregistrés ni dans les préférences ni dans les fichiers du projet. **Les fichiers de même nom dans le dossier distant seront remplacés.** Un transfert interrompu peut avoir déjà envoyé certains fichiers : vérifiez l’hébergement avant de recommencer.

Le transfert FTP vise un **site statique prêt à servir, avec son fichier index.html**. Il ne prépare pas un hébergement avec serveur applicatif, rendu côté serveur ou base de données. GitHub conserve le code mais ne configure pas non plus ces services. Une application qui en dépend demande un déploiement adapté, à préparer séparément.

## Connexion et fonctionnement

Le logiciel pilote les programmes officiels déjà connectés sur votre ordinateur. Il ne demande pas de clé API et ne lit, ne copie ni ne publie vos fichiers d’identifiants. Il n’utilise pas une connexion web ChatGPT ou Claude en arrière-plan.

- [Connexion Codex avec ChatGPT](https://learn.chatgpt.com/docs/auth) : le programme officiel ouvre le navigateur.
- [Claude Code](https://code.claude.com/docs/en/cli-reference) : version **2.1.248 ou plus récente** pour le mode restreint.

Le bouton de connexion dans le bureau permet de préparer un moteur manquant ou de renouveler une connexion dans le navigateur. Un état « connecté » enregistré ne garantit pas qu’un abonnement ou jeton n’a pas expiré ; une erreur réelle est affichée explicitement et n’est jamais remplacée par une fausse réponse. La démo reste accessible sans connexion à un modèle.

Les modèles restent ceux configurés par défaut dans vos outils. Codex garde son bac à sable et refuse les escalades automatiques. Claude conserve son mode restreint et une liste d’outils explicite ; cet adaptateur n’exécute pas de commandes pour Claude. Ses rapports doivent préciser les tests non exécutés.

Chaque appel à un moteur est limité à **douze minutes**, y compris une phase de préparation, de travail ou de relecture. Ce plafond ne garantit pas qu’une mission complexe sera terminée à temps ; elle peut nécessiter plusieurs appels ou s’arrêter en échec. Un arrêt ou une limite de temps conserve les fichiers déjà écrits et ne relance pas automatiquement la mission en consommant davantage de quota.

## Utilisation depuis un client MCP local

L’application autonome est l’interface principale. `mcp.mjs` expose aussi les outils d’état, de lancement, de lecture, d’arrêt et de lecture des livrables. Le serveur du bureau doit être ouvert.

```json
{
  "mcpServers": {
    "oscar-et-les-agents": {
      "command": "node",
      "args": ["/chemin/vers/oscar-et-les-agents/mcp.mjs"]
    }
  }
}
```

L’adaptateur n’est pas ajouté automatiquement à vos comptes. Les conversations web exigent une intégration distante et authentifiée ; ce logiciel local n’expose aucun serveur sur Internet.

## Développer

```sh
git clone https://github.com/renaud-bxl/oscar-et-les-agents.git
cd oscar-et-les-agents
npm start
```

Aucune dépendance de l’interface ou du serveur de base n’est à installer. Les programmes officiels Codex et Claude Code sont nécessaires pour les vraies missions. Les voix naturelles ajoutent leur moteur facultatif uniquement après confirmation dans les réglages.

- `npm test` : orchestration, livrables, corrections, missions parallèles, effectifs, arrêt, adaptateurs, connexions, installateur simulé, langues, ambiance, voix et publication simulée.
- `npm run serve` : serveur sans ouverture automatique.
- `npm run mcp` : adaptateur MCP stdio.
- `node scripts/install.mjs --engine both --dry-run` : vérifier le parcours d’installation sans rien installer.

`PORT` change le port. `OSCAR_DATA_DIR` (ou l’ancien `ATELIER_DATA_DIR`) change le dossier des données. `ATELIER_URL` indique au client MCP une autre URL HTTP locale. Les moteurs privés de l’application se trouvent dans `.tools/` et le runtime portable dans `.runtime/` ; ces dossiers ne sont pas versionnés.

Le serveur écoute uniquement sur 127.0.0.1, vérifie les origines et refuse les chemins de fichiers hors mission. Les livrables peuvent être prévisualisés ou téléchargés ; les fichiers actifs ne sont pas exécutés dans la page. Les préférences de langue, de voix, d’ambiance et de visite du guide sont propres au navigateur ; le moteur préféré, les routines, les métadonnées non secrètes des connecteurs et les données des missions sont conservés dans le dossier Documents.

## Création

[Créé par Renaud](https://www.facebook.com/renaud.brussels).

Inspiré du principe du [Bureau des agents](https://github.com/devlikemasta/bureau-des-agents). Le code, l’orchestration et les dessins de cette application sont une réalisation distincte ; aucune voix, musique ou image du projet de référence n’est reprise.

Licence MIT.
