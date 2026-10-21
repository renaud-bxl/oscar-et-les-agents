# Oscar et les Agents

Donnez une mission à Oscar. Il recrute les bons spécialistes, ils arrivent dans un grand bureau illustré et animé, travaillent, rendent leurs dossiers… et prennent un café quand leur travail est validé.

**Version 0.6.7** — une application locale en **français, anglais et néerlandais**, avec **ChatGPT via Codex** ou **Claude Code**, sans clé API à saisir.

Pour un jeu navigateur au brief clair, Oscar recrute désormais une équipe de sept ou huit spécialistes : recherche, analyse, deux ou trois designers, rédaction et deux développeurs. Les collègues se transmettent leurs contributions validées ; le moteur, l’interface, les dessins et les textes sont réunis dans un seul jeu. Le panneau Équipe montre les métiers et les tâches en attente. Les déplacements contournent les postes et les collègues qui collaborent peuvent échanger au lounge. La détection d’un connecteur ne garantit pas l’autorisation de chaque action : une erreur de permission reste expliquée, sans nouvelle autorisation automatique. Les PDF se lisent directement dans le bureau avec un lecteur local passif, sans dépendre du lecteur PDF du navigateur. Les licences du moteur embarqué sont détaillées dans [PDFJS-NOTICES.md](PDFJS-NOTICES.md).

![Le bureau illustré d’Oscar, les îlots de travail et le coin café](docs/bureau.png)

**[Ouvrir la page d’installation →](https://renaud-bxl.github.io/oscar-et-les-agents/)**

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
- **Zoé — assistance** : répond aux questions libres et recherches Web, ou lit les messages et l’agenda avec un service autorisé.

Ces personnages représentent des agents IA. Chaque tâche démarre un agent distinct. Oscar choisit les métiers nécessaires ; il n’appelle pas automatiquement les cinq pour une petite demande. Les animations montrent les états réels des tâches. Les pauses et les discussions sont décoratives ; elles ne retardent pas les appels aux modèles.

Un résultat refusé repasse une fois en correction. Les fichiers obligatoires sont contrôlés sur le disque. L’assemblage final est ensuite relu. Un refus persistant reste **à revoir** et n’est pas annoncé comme une livraison validée. Ces contrôles IA et matériels complètent votre relecture ; ils ne garantissent pas l’absence d’erreur.

## Quatre-vingt-quatre missions pour démarrer

La bibliothèque propose **84 points de départ**, avec catégories et recherche : logiciels sur mesure, applications web, tableaux de bord, outils locaux, sites, boutiques, communication, design, recherche, analyse et organisation.

Huit parcours sont dédiés aux jeux : jeu 2D sur mesure, plateforme, puzzle, gestion, cartes, quiz, aventure à choix et arcade. Les livraisons visent une première version locale jouable ou utilisable, avec son mode d’emploi et ses vérifications. Un prototype mobile reste une application web ; une boutique de démonstration n’encaisse aucun paiement.

Les nouveaux parcours **Parlement & institutions** couvrent la recherche parlementaire belge, les questions, le suivi d’un texte, les débats et amendements, les positions publiques, les auditions et les dossiers européens. D’autres missions structurent un dossier thématique, retrouvent des archives, croisent les sources ou préparent une veille. Les consignes exigent des références vérifiables et datées, distinguent un texte en discussion du droit en vigueur et signalent les documents inaccessibles. Une veille préparée ne crée pas de surveillance automatique ; une note documentaire ne constitue pas un avis juridique.

La catégorie **Écriture & livres** aide à commencer un roman, une nouvelle, un essai, une biographie autorisée, un guide pratique ou un livre jeunesse. Vous pouvez aussi construire un plan, des personnages et un univers, tester un chapitre, réviser, corriger ou préparer un dossier d’éditeur. Un projet de livre avance par étapes : plan, première partie et validations. Les droits sur les matériaux fournis et les faits concernant les personnes réelles doivent être respectés.

Des parcours complètent les usages professionnels : dossier de presse, discours, lettre thématique, rapport annuel, traduction, comparaison de logiciels, tutoriel, FAQ, cahier des charges, documentation, dossier associatif et proposition commerciale.

Douze missions de **design créatif** préparent un visuel original, un kit de marque, des affiches, un logo, une illustration, un pack de publications, une infographie, une présentation produit, des icônes, une couverture ou une bannière web. Les livrables sont des dessins vectoriels originaux en **SVG modifiable**, avec textes éditables et, selon le projet, une présentation HTML locale. Les images fournies doivent être autorisées ; ces parcours ne promettent pas une photographie ou une génération d’image bitmap par IA. La disponibilité juridique d’un logo et les contraintes finales de l’imprimeur restent à vérifier.

Le **studio créatif** commence par votre description, le support et le format. **Créer avec Oscar et les agents** lance une vraie mission sur votre abonnement ; ses SVG livrés peuvent ensuite être ouverts dans l’éditeur. Une alternative clairement indiquée **Composition locale · sans IA** dessine des compositions originales sur cet ordinateur. Les textes, couleurs et positions des éléments SVG sont modifiables ; **Annuler/Rétablir** permet de revenir sur les retouches. Les exports **SVG et PNG** reflètent vos changements. L’édition et les exports ne consomment pas de quota de modèle. Le studio ne promet pas de photographie et ne transforme pas automatiquement une image en dessin vectoriel.

Choisissez une carte, répondez aux questions, ajustez le résumé, puis confiez-le à Oscar. **Mon idée** permet de partir d’une demande libre. Les missions préparent des livrables : les contenus de réseaux sociaux restent des brouillons, les questions parlementaires ne sont pas déposées et les dossiers d’éditeur ne sont pas envoyés automatiquement. Une publication éventuelle passe par votre action et votre confirmation dans la livraison.

## Un recrutement complémentaire et un bureau vivant

Une illustration simple utilise une création par Alma et une vérification par Oscar, puis une copie locale des fichiers approuvés dans Livraison/. Un petit outil local clairement défini peut être confié directement à Sam. Les jeux font travailler une équipe complémentaire : recherche, règles et équilibrage, direction de l’interface, illustrations, textes et développement. Plusieurs designers ou développeurs peuvent intervenir quand leurs contributions sont distinctes. Oscar garde le rôle de chef, de contrôleur et d’assembleur final.

Pour les petits jeux de navigateur reconnus, un contrat commun définit les fichiers, la palette et l’interface du moteur. Les collègues reçoivent les contributions nécessaires après validation d’Oscar ; l’intégration reprend les modules et les dessins approuvés. Les projets complexes, les équipes explicitement demandées et les missions avec références gardent le plan complet adapté au brief. L’effectif n’est pas une promesse de rapidité : les étapes dépendantes attendent leurs prérequis et **quatre spécialistes au maximum travaillent en parallèle**. Si une contribution nécessaire reste refusée, les tâches qui en dépendent restent bloquées et la mission demande votre attention. Aucun appel en cours n’est interrompu par une mise à jour ; créer et vérifier un résultat peut toujours prendre plusieurs minutes.

**Suivi** affiche la durée réelle et les appels du moteur enregistrés pour les nouvelles missions. Les anciennes missions indiquent quand cette mesure n’existe pas ; aucune estimation de fin n’est inventée.

Le bouton soleil/lune du haut propose **Clair**, **Sombre** et **Automatique**. Le thème automatique devient sombre de 20 h à 8 h, selon l’ordinateur. La palette du bureau et les menus changent sans voile gris et sans altérer les couleurs des livrables. Après remise et validation du travail, les agents vont au café, au lounge ou se promènent. Oscar attend au bureau pour recevoir les dossiers et emprunte les allées pour contourner les sièges et les claviers.

Dans une équipe de jeu, un designer et un développeur dont les tâches sont liées peuvent se retrouver brièvement au lounge puis revenir à leur poste. Cet échange visuel est décoratif : il ne suspend pas les appels, ne valide rien et ne crée aucune fausse progression. La remise d’un nouveau résultat à Oscar reste prioritaire. Le mouvement réduit désactive ces sorties supplémentaires.

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
    ├── Modeles et exemples/      # références originales
    ├── personnalisation/        # prénom, région et météo consentie
    ├── dictee-locale/           # après installation de Whisper
    ├── .documents-runtime/      # après préparation Word/PDF/Excel
    ├── voix-conversation/        # après installation du pack Oscar et Zoé
    ├── voix-locales/             # anciennes voix légères facultatives
    └── missions/
        └── 2026-10-19 — Mon projet/
            ├── state.json
            └── travail/
                ├── Livraison.md
                ├── Livraison/
                ├── Rapports/
                ├── References/     # copies, textes extraits et manifeste
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

**Seuls Oscar et Zoé parlent** ; les spécialistes gardent leurs répliques écrites. Les réglages proposent **deux voix par personnage**, avec une préécoute indépendante avant de valider chaque choix. Le pack recommandé utilise [Pocket TTS](https://github.com/kyutai-labs/pocket-tts) en local pour le français, l’anglais et le néerlandais. Les tailles de téléchargement et d’installation sont indiquées avant confirmation. Les sous-titres restent disponibles pendant la préparation ou si aucune voix compatible n’est prête.

Ce pack demande **Python 3.10 à 3.14 sur macOS ou Linux**. Le bureau prépare un environnement vocal séparé à partir du Python présent ; s’il manque, les réglages l’indiquent et conservent les sous-titres. Le pack privilégie le modèle français à 24 couches, et les modèles anglais et néerlandais à 6 couches : environ **1,2 Go de modèles et voix**, plus le programme local et ses dépendances, avec environ **2,2 Go à prévoir sur le disque**. Les tailles détaillées affichées par le serveur priment sur ces indications arrondies.

Après installation, la synthèse fonctionne sur votre ordinateur, sans clé API ni service vocal distant. Oscar propose **Paul ou Charles**, et Zoé **Estelle ou Vera**, depuis les [poids sans clonage](https://huggingface.co/kyutai/pocket-tts-without-voice-cloning). **Paul et Estelle sont les choix automatiques.** Paul et Vera remplacent Marius et Alba avec de nouveaux identifiants : leurs anciens extraits et caches ne sont pas réutilisés. Les préférences Marius/Alba deviennent Paul/Vera ; les choix Charles/Estelle sont conservés. Le complément Paul/Vera contient six états, environ **83 Mo**, et réutilise les modèles existants. Les groupes et leurs tailles exactes sont affichés avant confirmation. Les douze extraits de démonstration correspondent aux quatre voix actuelles et s’écoutent avant installation, sans lecture automatique. Estelle provient d’une voix française ; Paul, Charles et Vera de voix anglophones. Écoutez le rendu dans votre langue avant de choisir : aucun accent natif ni qualité identique à Siri n’est promis. Vos propres textes nécessitent les fichiers installés. Chaque moteur conserve au plus **32 Mio et 100 extraits**, soit **64 Mio et 200 extraits** si Studio et Piper sont utilisés. Les demandes sont limitées à 500 caractères. Le chargement et la synthèse dépendent de votre ordinateur. Les voix système restent une option volontaire, sans repli automatique.

Le code Pocket TTS est MIT et ses poids sont CC BY 4.0. Estelle est CC0 ; Paul, Vera et Charles sont CC BY 4.0, avec attribution. Aucun enregistrement personnel n’est importé ou cloné. Les notices et la [provenance des voix](https://huggingface.co/kyutai/tts-voices) restent consultables. Les modèles et leurs licences sont conservés séparément du code de l’application. Les crédits des douze préécoutes incluses figurent dans [VOICE-NOTICES.md](VOICE-NOTICES.md). Les anciennes voix Piper restent dans une option secondaire : Siwis, Jessica et Pierre en français, Alba en anglais. Plus légères, elles conservent leurs propres notices : [Sherpa ONNX](https://k2-fsa.github.io/sherpa/onnx/javascript-api/examples/api_offline_tts.html) Apache 2.0, données Siwis/Alba CC BY 4.0 et Jessica/Pierre CC BY-SA 4.0, prononciation eSpeak NG GPL 3 ou ultérieure. Aucun composant vocal n’est téléchargé par une simple consultation de l’état.

La machine à café ouvre quatre soutiens volontaires à Renaud via PayPal : **Café 1 €**, **Sandwich 5 €**, **Snack 20 €** et **Resto 50 €**. Le choix revient à 1 € à chaque ouverture. Montant et destinataire sont visibles avant le départ vers PayPal ; cliquer sur un palier ne lance aucun paiement. La confirmation se fait uniquement sur PayPal. Ces noms sont symboliques : aucun repas ni fonction supplémentaire n’est vendu.

## Zoé, les services et les routines

**Demande libre** permet de poser une question, chercher sur le Web, comparer des options ou préparer un texte, avec votre abonnement connecté. Aucun service de messagerie n’est nécessaire. Pour une recherche « près de chez moi », vous pouvez donner une ville ou autoriser la position du navigateur ; seule une position arrondie à deux décimales est ajoutée à cette demande. Refuser la localisation laisse la saisie de ville disponible.

Dans **Zoé → Agenda**, choisissez **Mon agenda demain** ou posez votre question au clavier ou à la voix. Pour une création, dites par exemple « Ajoute dans mon agenda une réunion projet mercredi à 16 h pendant 45 minutes » ou cliquez sur **Ajouter un rendez-vous**. Zoé propose des dates complètes dans votre fuseau ; le titre, les horaires, le lieu et les informations restent modifiables. Vérifiez l’aperçu et cliquez sur **Confirmer l’ajout à mon agenda**. La durée proposée par défaut est une heure, toujours visible et modifiable.

L’ajout utilise uniquement l’outil `create_event` déjà exposé par la connexion Google Agenda officielle de **Codex / ChatGPT**, sans clé API, sans tour de modèle d’écriture et sans nouvel accès automatique. Il cible l’agenda principal, sans invité, invitation, visioconférence, rappel ni récurrence automatique. Claude conserve la consultation ; l’ajout depuis Claude n’est pas encore disponible. Une permission manquante est signalée par le service. Une confirmation expirée doit être préparée de nouveau. Un reçu local durable empêche un double clic ou une réponse perdue de créer deux fois le même rendez-vous. En cas de résultat incertain, contrôlez votre agenda avant une nouvelle création ; aucun réessai automatique n’est effectué. Les reçus sont conservés localement dans `Documents/Oscar et les agents/calendar-actions`.

Les onglets **Mails** et **Agenda** proposent les services de lecture réellement exposés par votre moteur. **Mes services** retrouve aussi Google Drive, GitHub et les autres connexions dont le client confirme les outils de lecture. Les services sans lecture disponible restent visibles avec leur état, sans être activés artificiellement. Le panneau **Connecteurs** comprend un assistant en trois étapes, explique les fonctions et états de chaque service, puis permet d’ouvrir Zoé ou de préparer un brief.

Les plugins déjà autorisés dans **ChatGPT** sont retrouvés par l’interface officielle du client Codex, et les connecteurs **Claude** exposés à Claude Code sont également recherchés. Le logiciel affiche leur origine et vérifie les accès avant chaque lecture. Un plugin visible dans un compte n’est utilisable ici que si le client local le rend disponible. Une autorisation expirée ou des permissions manquantes restent un échec explicite. Oscar ne lit ni ne copie les fichiers d’identifiants.

Pour Claude, Gmail, Google Agenda et Google Drive utilisent les métadonnées du client officiel, avec des adresses et outils de lecture précis. Cette découverte a été vérifiée avec Claude Code **2.1.303**, sans question au modèle. Si le client ne fournit pas les informations nécessaires, le service reste à vérifier ; un nom affiché ou la présence d’un compte ne suffit pas. Les autres connexions restent visibles pour préparer un brief, sans leur attribuer un accès de lecture non confirmé. L’utilisation des clients et abonnements reste soumise aux conditions de leurs fournisseurs.

Pour ajouter un service, ouvrez les plugins de ChatGPT ou les connecteurs Claude depuis l’assistant, autorisez-le dans le client officiel, puis cliquez sur **Retrouver mes connexions**. L’ajout d’un serveur MCP personnel reste disponible dans les options avancées ; il utilise la configuration et l’autorisation officielles, sous un nouveau nom, sans remplacer de serveur existant.

Zoé n’envoie aucun e-mail et ne crée aucun brouillon Gmail. Elle peut ajouter un rendez-vous ponctuel dans **l’agenda principal Google via Codex**, après votre confirmation dans une fenêtre séparée. Les lectures et routines restent en lecture seule ; aucun rendez-vous n’est modifié ou supprimé. Les propositions restent dans les fichiers locaux. Les lectures utilisent un seul service sélectionné, des outils explicitement autorisés en lecture seule et un accès revérifié au lancement. Les fonctions qui ne disposent pas d’outils de lecture confirmés restent accessibles par un brief à poursuivre dans le client connecté ; cela n’exécute pas leur action depuis Oscar.

Dans Zoé, **Travail immédiat** est le choix par défaut : une seule demande part maintenant, sans créer de routine. Pour une exécution régulière, choisissez un rythme puis **Programmer** ; les heures quotidiennes et en semaine sont modifiables.

Les routines peuvent s’exécuter chaque jour, en semaine, un jour hebdomadaire ou à intervalle régulier. Le sujet d’une veille a son propre champ : aucun texte entre crochets n’est à deviner. **Le bureau doit rester lancé et l’ordinateur éveillé.** Les horaires suivent le fuseau local, sans chevauchement d’une même routine ni rafale de rattrapage après fermeture. La pause conserve le travail déjà lancé. Les quatre missions simultanées et les quotas de l’abonnement s’appliquent aussi aux routines.

Après une réponse d’enregistrement perdue, **Retrouver ma demande** consulte le reçu local avant toute nouvelle soumission. Un rechargement ne programme rien. Une suppression conserve pendant sept jours un reçu sans contenu ni compte — identifiant, empreinte et expiration uniquement — pour empêcher une autre fenêtre de recréer la routine par une ancienne demande. Ce registre est limité à 1 000 reçus ; sa saturation suspend les nouvelles suppressions jusqu’à expiration, sans effacer de routine. Une nouvelle demande volontaire reçoit un nouvel identifiant.

Le connecteur [Higgsfield officiel](https://higgsfield.ai/creator-hub/help-center/integrations/what-is-higgsfield-mcp) prépare un brief à reprendre dans le client interactif. Les agents d’Oscar ne déclenchent pas ses générations payantes : le modèle, les paramètres et le coût en crédits se vérifient et se confirment dans le service. Outlook/Work IQ dépend des accès professionnels de l’organisation.

## Vos modèles et vos documents

**Modèles et exemples**, dans les réglages, le brief, le questionnaire ou la livraison, accepte des fichiers et dossiers Word, Excel, PDF, Markdown, texte, CSV et JSON. Ils restent dans `Documents/Oscar et les agents/Modeles et exemples`. Choisissez jusqu’à huit exemples : chaque mission reçoit des copies en lecture seule, épinglées à la version sélectionnée. **Vérifier le texte lu** montre le texte qu’Oscar peut consulter, sans modifier l’original. Les titres, tableaux et indications de styles Word, les cellules Excel et le texte des PDF sont préparés localement ; un scan sans texte est signalé, sans prétendre effectuer un OCR. Les formules ne sont pas calculées. La lecture est limitée à 64 000 caractères par référence, 256 000 par mission et 50 pages par PDF ; les extraits partiels restent signalés. Les originaux restent conservés. Limites : 5 Mo par fichier, 80 fichiers et 100 Mo pour la bibliothèque.

Choisissez les formats **Word, PDF et Excel** avant une mission ou exportez ensuite un texte livré. Les outils de lecture et d’export s’installent dans un environnement Python séparé, sans API ni service payant. Le lecteur PDF [pypdf 6.19.0](https://pypi.org/project/pypdf/6.19.0/), sous licence BSD-3-Clause, est épinglé avec les outils Word et Excel. Aucun lien ni ressource externe du document n’est chargé pendant la lecture. Les fichiers vérifiés sont ajoutés dans `Livraison/Exports` et restent accessibles dans le lecteur de livrables.

Un modèle Word natif conserve ses éléments et remplace la zone `{{CONTENU}}` par le texte produit. Excel conserve les feuilles du modèle et ajoute une feuille de livraison. Le PDF est composé depuis le texte : un exemple PDF ou une image ne garantit pas une reproduction identique de sa mise en page. Les documents de référence servent aussi à guider le ton et la structure ; les faits restent à vérifier.

## Dicter une demande

Les boutons **Dicter** sont disponibles dans le brief Oscar, Zoé, le formulaire de rendez-vous, le questionnaire des missions, le studio, les demandes aux connecteurs et les consignes des routines. Ils ouvrent un enregistrement volontaire. Autorisez le microphone, parlez, arrêtez puis réécoutez si vous le souhaitez. La transcription se fait localement ; corrigez le texte et cliquez sur **Utiliser ce texte**. Aucun enregistrement ni transcription ne lance une mission sans votre envoi.

Le moteur facultatif [Whisper small / faster-whisper](https://github.com/SYSTRAN/faster-whisper) couvre notamment le français, l’anglais et le néerlandais. Son installation indique les tailles et nécessite une confirmation : environ **487 Mo de modèle**, avec **1,1 Go d’espace conseillé** pour le modèle et le programme isolé. Python **3.10 à 3.13** est nécessaire. Les poids, leur version et leur empreinte sont vérifiés ; aucun service vocal distant ni clé API. Les enregistrements temporaires sont effacés après transcription ou annulation. Limites : 90 secondes, 8 Mio, WAV/WebM/Ogg/MP4 reconnus. La relecture reste nécessaire, en particulier pour les noms propres.

Si le navigateur refuse le microphone, la saisie au clavier reste disponible. L’annulation ferme l’enregistrement et libère le micro. La synthèse d’Oscar et Zoé s’arrête avant la prise de son pour éviter qu’ils se dictent eux-mêmes leur réponse.

## Retrouver ses textes et ses fichiers

Les textes en préparation pour Oscar, Zoé, le Studio et une nouvelle routine restent en brouillons dans ce navigateur pendant sept jours. Chaque onglet de bureau garde son propre espace. Un rechargement restaure le texte sans envoyer de demande ; **Effacer le brouillon** le retire. Les sélections de compte, documents, positions et mots de passe ne sont pas enregistrées dans ces brouillons. Les réglages de rythme d’une routine restent à confirmer.

Le Studio garde aussi le support, le format et le reçu de la dernière demande non confirmée. **Reprendre la demande envoyée** retrouve d’abord la mission déjà acceptée, sans recruter une deuxième équipe ni consommer un nouvel appel. Une vérification indisponible conserve le reçu ; elle ne relance rien. Pour changer de projet, **Préparer une nouvelle création** détache ce reçu après vous avoir rappelé de consulter l’historique.

Dans **Mes missions**, recherchez un titre, une date ou un moteur et filtrez les missions par statut. **Reprendre ce brief dans un nouveau bureau** ouvre une copie modifiable de la demande et de ses choix encore valides, sans démarrer de travail ni modifier la mission d’origine. Un exemple modifié ou supprimé n’est pas repris silencieusement.

Une livraison terminée propose **Télécharger toute la mission · ZIP**. L’archive contient le dossier de travail, y compris les résultats partiels d’une mission arrêtée ; les fichiers cachés et les dossiers `node_modules`/`vendor` sont exclus. Aucun lien symbolique n’est suivi. Limites : 500 fichiers, 15 Mo par fichier, 50 Mo de contenu. Le dossier reste directement accessible si le projet dépasse ces limites.

Le bureau signale une interface mise à jour et propose **Recharger le bureau**. Il ne recharge pas seul un formulaire pendant votre saisie.

## Un bureau qui vous reconnaît

Les réglages **Mon prénom et ma région** personnalisent les salutations d’Oscar et Zoé. Chacun dispose de vingt-quatre répliques par langue, avec un cycle sans répétition immédiate et un contexte adapté à l’heure locale. La région se cherche dans un catalogue local [GeoNames](https://www.geonames.org/), avec attribution CC BY 4.0 ; aucune localisation par adresse IP.

La météo est facultative et demande votre consentement. Une prévision récente de [MET Norway](https://www.met.no/en/free-meteorological-data) peut enrichir les répliques ; le logiciel n’invente pas le temps observé et ignore une prévision expirée. Les coordonnées sont arrondies avant requête et la source est indiquée. Le décor jour/nuit continue de suivre l’heure de l’ordinateur indépendamment de cette option.

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

L’application autonome est l’interface principale. `mcp.mjs` propose dix outils au client connecté ; le serveur du bureau doit être ouvert.

| Outil | Fonction |
| --- | --- |
| `oscar_status` | Lire l’état du bureau et ses missions. |
| `oscar_start_mission` | Confier un projet à Oscar, avec exemples et formats facultatifs. |
| `oscar_read_mission` | Retrouver la progression et les fichiers d’une mission. |
| `oscar_stop_mission` | Arrêter cette mission en conservant ses fichiers. |
| `oscar_read_deliverable` | Lire un livrable texte connu de la mission. |
| `oscar_list_connectors` | Afficher les métadonnées des connexions reconnues. |
| `oscar_document_library` | Lister les exemples disponibles et leurs révisions. |
| `oscar_read_reference` | Lire un extrait de référence et ses limites dans la version exacte. |
| `oscar_ask_zoe` | Poser une question libre ou demander une lecture autorisée de mails/agenda. |
| `oscar_export_documents` | Exporter une livraison terminée en Word, PDF ou Excel. |

Les capacités et outils privés sont toujours résolus côté serveur. Un paramètre MCP ne peut pas fabriquer une autorisation de compte. Les installations facultatives se confirment dans le bureau.

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
