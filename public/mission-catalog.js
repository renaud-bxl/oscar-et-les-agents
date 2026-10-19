import { EXTRA_TEMPLATES } from './mission-extras.js';
import { getLocale, translate } from './i18n.js';

const answer = (answers, key, fallback = 'À proposer selon le contexte') => {
  const value = answers?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
};

const text = (id, label, placeholder, required = true) => ({ id, label, type: 'text', placeholder, required });
const area = (id, label, placeholder, required = true) => ({ id, label, type: 'textarea', placeholder, required });
const select = (id, label, options) => ({ id, label, type: 'select', options, required: true });

function mission(title, context, deliverables, checks, research = false) {
  return `${title}\n\nMON CONTEXTE\n${context}\n\nCE QUE J’ATTENDS\n${deliverables}\n\nCRITÈRES DE VALIDATION\n${checks}${research ? '\nPour toute recherche, utilise des sources consultables et donne leurs liens, leurs dates et la date de vérification. Distingue les faits vérifiés, les estimations et les informations introuvables. Ne fabrique pas de chiffres ni de sources.' : ''}\n\nPrésente le résultat en français, avec des explications simples. Si une information manque, indique ton hypothèse et évite d’inventer un fait. Fournis les fichiers utiles dans le dossier de livraison. Prépare uniquement les livrables : ne publie rien, n’envoie aucun message, ne contacte personne, ne souscris à aucun service, n’achète rien et ne déploie rien. Les éventuelles étapes de publication, d’envoi, d’achat ou de déploiement doivent rester des propositions à me soumettre.`;
}

export const MISSION_CATEGORIES = [
  {id:'all',label:'Toutes les idées'}, {id:'software',label:'Web & logiciels'},
  {id:'games',label:'Jeux vidéo'}, {id:'communication',label:'Communication'},
  {id:'design',label:'Design'}, {id:'analysis',label:'Recherche & analyse'},
  {id:'organisation',label:'Organisation'},
  {id:'parliament',label:'Parlement & institutions'}, {id:'writing',label:'Écriture & livres'},
];
const DEFAULT_CATEGORIES = {
  'reseaux-sociaux':'communication','site-internet':'software','concurrents':'analysis',
  'strategie-contenu':'communication',newsletter:'communication','lancement-produit':'communication',
  'identite-visuelle':'design','dossier-presentation':'communication','analyser-donnees':'analysis',
  automatisation:'software','article-seo':'communication','preparation-reunion':'organisation',
  'plan-commercial':'communication','script-podcast':'communication',
};

function softwareTemplate({id,title,icon,description,focus,features,files}) {
  return {id,title,icon,description,category:'software',questions:[
    text('nom','Comment voulez-vous appeler ce projet ?','Ex. : Mon Atelier, Projet Nova…'),
    area('besoin','À qui servira ce logiciel et quel problème doit-il résoudre ?','Décrivez les personnes, leur besoin et ce qui doit devenir plus simple.'),
    area('fonctions','Quelles sont les trois fonctions les plus importantes ?',features),
    select('plateforme','Où voulez-vous l’utiliser ?',['Dans mon navigateur, sur mon ordinateur','Dans mon navigateur, aussi sur téléphone','Sur mon ordinateur : proposez la solution locale adaptée']),
    select('style','Quel univers visuel préférez-vous ?',['Clair, élégant et très lisible','Chaleureux, avec des illustrations','Professionnel, pour travailler efficacement','Coloré et ludique','Proposez un style adapté au projet']),
  ],buildPrompt:a=>mission(title+'.',`Nom : ${answer(a,'nom')}\nUtilisateurs et besoin : ${answer(a,'besoin')}\nFonctions prioritaires : ${answer(a,'fonctions')}\nSupport : ${answer(a,'plateforme')}\nStyle : ${answer(a,'style')}`,`${focus}\nLivre une première version cohérente qui réalise les fonctions prioritaires, avec des fichiers réellement utilisables dans Livraison/. ${files || 'Privilégie une application web locale avec HTML, CSS et JavaScript, sans installation de service externe.'} Fournis un README avec ouverture ou installation, utilisation, sauvegarde/export et limites. Pour une demande trop vaste, choisis un premier périmètre fonctionnel explicite puis propose la suite. Ne livre pas uniquement une maquette en affirmant qu’il s’agit d’un logiciel complet.`, 'Vérifie les parcours principaux et les erreurs prévisibles. Ajoute des tests pertinents pour la logique métier et précise ceux effectivement exécutés. Préserve les fichiers fournis. Une démonstration avec données fictives doit le signaler. Une fonction de connexion, paiement, partage ou envoi non connectée doit être clairement présentée comme telle. Ne collecte aucun identifiant ni clé API. Aucun déploiement ou installation dans un compte externe. Pour un prototype mobile, ne prétends pas avoir produit un binaire natif ou publié dans un magasin d’applications.')};
}
function gameTemplate({id,title,icon,description,genre,mechanics}) {
  return {id,title,icon,description,category:'games',questions:[
    text('nom','Quel sera le nom du jeu ?','Ex. : Les aventures de Pistache'),
    area('univers','Dans quel univers se déroule-t-il ?','Personnages, lieux, ambiance… Inventez ou demandez une proposition.'),
    area('regles','Que doit faire le joueur pour gagner ?',mechanics),
    select('public','Pour qui et avec quelles commandes ?',['Tout public : clavier et souris','Tout public : téléphone et ordinateur','Enfants : commandes simples et grosses cibles','Joueurs habitués : clavier, rythme plus soutenu']),
    select('graphismes','Quel style graphique voulez-vous ?',['Dessin animé doux et expressif','Illustration colorée et joyeuse','Minimaliste et élégant','Rétro assumé','Surprenez-moi avec une direction cohérente']),
  ],buildPrompt:a=>mission(title+'.',`Titre : ${answer(a,'nom')}\nUnivers : ${answer(a,'univers')}\nRègles souhaitées : ${answer(a,'regles')}\nJoueurs et commandes : ${answer(a,'public')}\nDirection graphique : ${answer(a,'graphismes')}`,`Crée un ${genre} jouable localement dans le navigateur. ${mechanics} Livre le code intégré, les dessins originaux réalisés en Canvas/SVG/CSS et un mode d’emploi dans Livraison/. Prévois un écran d’accueil, les commandes expliquées, une boucle de jeu complète, un objectif de victoire ou score, un échec compréhensible, un redémarrage et une pause. Adapte les commandes tactiles si demandées. Si un son est ajouté, il démarre après une action de l’utilisateur et peut être coupé. Privilégie HTML/CSS/JavaScript sans dépendances distantes.`, 'Le jeu doit être jouable avec ses fichiers locaux et ne pas se limiter à une image ou un écran décoratif. Vérifie le démarrage, les commandes, les collisions ou règles, la victoire/défaite et le redémarrage. Documente les tests réellement effectués, les limites et les améliorations possibles. N’utilise aucun personnage, logo, musique ou dessin repris d’une franchise. Ne prétends pas à un mode multijoueur en ligne s’il n’existe pas. Aucun achat intégré ni collecte de données.')};
}
const EXPANDED_TEMPLATES = [
  {
    id:'campagne-publicitaire',title:'Imaginer une campagne publicitaire',icon:'🎯',category:'communication',description:'Angles, textes et concepts visuels avant toute diffusion.',
    questions:[text('offre','Quelle offre voulez-vous présenter ?','Ex. : mon nouvel atelier de céramique'),text('public','Qui voulez-vous toucher ?','Ex. : des adultes à Bruxelles'),select('canal','Sur quel support ?',['Réseaux sociaux','Recherche web','Affiches et supports imprimés','Conseillez-moi']),text('moyens','Quels sont vos moyens et votre objectif ?','Ex. : un petit budget, pour obtenir des demandes de renseignements')],
    buildPrompt:a=>mission('Prépare les brouillons de ma campagne publicitaire.',`Offre : ${answer(a,'offre')}\nPublic : ${answer(a,'public')}\nSupport : ${answer(a,'canal')}\nMoyens : ${answer(a,'moyens')}`,'Propose trois angles distincts, leurs messages, cinq variantes d’annonces, trois concepts visuels et un plan de mesure. Livre les textes et une planche HTML/SVG.','Les promesses doivent rester vérifiables, les textes adaptés au support et les dépenses rester proposées. Ne lance aucune campagne et ne contacte personne.'),
  },
  {
    id:'boutique-en-ligne',title:'Préparer ma boutique en ligne',icon:'🛍️',category:'software',description:'Catalogue, panier local et parcours d’achat en démonstration.',
    questions:[text('marque','Que vend votre marque ?','Ex. : des accessoires fabriqués à la main'),area('produits','Quels produits faut-il présenter ?','Listez les produits, les descriptions et les prix connus.'),text('public','À qui s’adresse la boutique ?','Ex. : des amateurs de cadeaux originaux'),select('style','Quel style imaginez-vous ?',['Clair et élégant','Artisanal et chaleureux','Coloré et ludique'])],
    buildPrompt:a=>mission('Crée un prototype local de ma boutique.',`Marque : ${answer(a,'marque')}\nProduits : ${answer(a,'produits')}\nPublic : ${answer(a,'public')}\nStyle : ${answer(a,'style')}`,'Livre un site local avec catalogue, fiche produit, filtres si utiles, panier fonctionnel et calcul des totaux. La commande reste une démonstration explicitement signalée. Fournis les fichiers intégrés et un mode d’emploi.','Teste le panier, les quantités et les totaux. Aucun paiement réel ni faux message de commande confirmée. Ne crée pas de compte marchand. Signale les informations produit manquantes.'),
  },
  {
    id:'audit-site',title:'Améliorer mon site existant',icon:'🧭',category:'analysis',description:'Un diagnostic et des améliorations classées par priorité.',
    questions:[text('url','Quel site ou quels fichiers faut-il examiner ?','Une adresse publique ou le chemin de fichiers locaux'),text('objectif','Que souhaitez-vous améliorer ?','Ex. : rendre l’offre plus claire et obtenir davantage de contacts'),select('angle','Quel point regarder en priorité ?',['Lisibilité et navigation','Utilisation sur téléphone','Accessibilité','Contenus et référencement','Diagnostic global'])],
    buildPrompt:a=>mission('Réalise un diagnostic de mon site.',`Site ou fichiers : ${answer(a,'url')}\nObjectif : ${answer(a,'objectif')}\nPriorité : ${answer(a,'angle')}`,'Examine les éléments accessibles. Livre un diagnostic sourcé, une liste de corrections par impact/effort, des exemples de contenus et une proposition locale pour une page améliorée.','Distingue les observations des mesures non effectuées. N’invente pas de statistiques, notes techniques ou accès au site. Ne modifie pas le site en production.',true),
  },
  {
    id:'formation',title:'Créer une formation',icon:'🎓',category:'organisation',description:'Un parcours, des exercices et un guide pour animer.',
    questions:[text('sujet','Que voulez-vous apprendre aux participants ?','Ex. : découvrir la photographie au smartphone'),text('public','Quel est leur niveau de départ ?','Ex. : des débutants'),text('duree','Quelle durée avez-vous ?','Ex. : deux séances de deux heures'),text('resultat','Que doivent-ils savoir faire à la fin ?','Ex. : cadrer, régler la lumière et retoucher simplement')],
    buildPrompt:a=>mission('Construis un parcours de formation.',`Sujet : ${answer(a,'sujet')}\nPublic : ${answer(a,'public')}\nDurée : ${answer(a,'duree')}\nCompétences visées : ${answer(a,'resultat')}`,'Livre un programme progressif, les contenus des séquences, des exercices avec corrigés, une évaluation et un guide d’animation en Markdown.','Respecte le temps disponible et le niveau. Chaque objectif doit avoir un exercice adapté et un critère de réussite.'),
  },
  {
    id:'support-client',title:'Organiser mon service client',icon:'💬',category:'organisation',description:'Une FAQ et des réponses types qui gardent votre ton.',
    questions:[text('activite','Quelle est votre activité ?','Ex. : une boutique de vélos'),area('questions','Quelles demandes reviennent souvent ?','Collez des exemples anonymisés, sans informations personnelles.'),area('regles','Quelles règles et informations faut-il respecter ?','Délais connus, horaires, fonctionnement…'),select('ton','Quel ton voulez-vous ?',['Chaleureux et rassurant','Sobre et professionnel','Court et direct'])],
    buildPrompt:a=>mission('Prépare les supports de mon service client.',`Activité : ${answer(a,'activite')}\nQuestions : ${answer(a,'questions')}\nRègles : ${answer(a,'regles')}\nTon : ${answer(a,'ton')}`,'Livre une FAQ, des modèles de réponse complets, un arbre de tri des demandes et les situations à traiter personnellement.','N’invente pas de garanties, conditions de vente ou délais. Aucun message envoyé ni branchement à une messagerie. Les exemples restent anonymes.'),
  },
  {
    id:'offre-commerciale',title:'Rédiger une offre commerciale',icon:'🤝',category:'communication',description:'Une proposition claire, adaptée à un client précis.',
    questions:[text('offre','Que proposez-vous ?','Ex. : une refonte de site vitrine'),area('besoin','Quel est le besoin du client ?','Contexte, résultat attendu et contraintes.'),area('perimetre','Que comprennent l’offre, le prix et les délais connus ?','Indiquez uniquement les éléments confirmés.'),text('prochaine','Quelle est la prochaine étape souhaitée ?','Ex. : une réunion de validation du périmètre')],
    buildPrompt:a=>mission('Rédige ma proposition commerciale.',`Offre : ${answer(a,'offre')}\nBesoin : ${answer(a,'besoin')}\nPérimètre confirmé : ${answer(a,'perimetre')}\nProchaine étape : ${answer(a,'prochaine')}`,'Livre une proposition structurée avec contexte, solution, livrables, calendrier, prix fournis et prochaine étape. Prépare un document Markdown et une présentation HTML.','N’invente aucun prix, engagement, délai ou résultat. Les éléments à confirmer doivent être visibles. Prépare un brouillon, sans envoi au client.'),
  },
  softwareTemplate({id:'logiciel-sur-mesure',title:'Créer un logiciel sur mesure',icon:'🛠️',description:'Une première version fonctionnelle pour votre besoin précis.',focus:'Conçois l’architecture simple du logiciel, sa logique métier et ses écrans.',features:'Ex. : ajouter un projet, suivre son avancement et exporter la liste.'}),
  softwareTemplate({id:'application-web',title:'Créer une application web',icon:'🖥️',description:'Des écrans reliés et de vraies interactions.',focus:'Crée une application avec des vues cohérentes, une navigation complète et une gestion explicite de ses données locales.',features:'Ex. : gérer une collection, rechercher un élément et sauvegarder mes données.'}),
  softwareTemplate({id:'tableau-de-bord',title:'Construire un tableau de bord',icon:'📈',description:'Des indicateurs, des graphiques et des filtres utiles.',focus:'Crée un tableau de bord local avec import de données simples, calculs traçables, filtres et export. Identifie explicitement les données d’exemple.',features:'Ex. : importer un CSV, comparer les mois et filtrer les catégories.'}),
  softwareTemplate({id:'gestion-clients',title:'Créer un outil de gestion clients',icon:'🗂️',description:'Un carnet local pour suivre contacts et projets.',focus:'Crée un outil local avec fiches clients, suivi des étapes et recherche. Prévois une sauvegarde/export explicite et des exemples fictifs.',features:'Ex. : enregistrer un contact, noter les échanges et voir les relances à préparer.'}),
  softwareTemplate({id:'outil-fichiers',title:'Créer un outil pour mes fichiers',icon:'📁',description:'Classer, convertir ou préparer des fichiers en préservant les originaux.',focus:'Crée un outil de traitement local de fichiers, avec prévisualisation des opérations et copie de sortie. Ne modifie jamais les originaux pendant la préparation.',features:'Ex. : classer des images par date, détecter les doublons et exporter un inventaire.',files:'Choisis une interface web locale si adaptée, ou un script local documenté. Les tests utilisent uniquement des fichiers fictifs.'}),
  softwareTemplate({id:'extension-navigateur',title:'Créer une extension de navigateur',icon:'🧩',description:'Un petit outil à installer et essayer localement.',focus:'Crée une extension Chromium Manifest V3 minimale et documentée, en limitant les permissions aux besoins exprimés.',features:'Ex. : garder des notes pour un site et les retrouver dans une petite fenêtre.',files:'Livre manifest.json, les fichiers nécessaires et les étapes pour charger l’extension décompressée. N’installe et ne publie rien automatiquement. Justifie les permissions.'}),
  softwareTemplate({id:'prototype-mobile',title:'Prototyper une application mobile',icon:'📱',description:'Un prototype web tactile pour essayer le parcours.',focus:'Crée un prototype mobile en application web responsive avec des écrans reliés, commandes tactiles et états vides/erreurs lisibles. Signale qu’il s’agit d’une version web locale.',features:'Ex. : créer une routine, cocher les actions du jour et consulter l’historique.'}),
  softwareTemplate({id:'outil-pedagogique',title:'Créer un outil pédagogique',icon:'📚',description:'Un outil interactif qui explique, exerce et corrige.',focus:'Crée une application locale d’apprentissage avec explications progressives, exercices, corrections et progression locale.',features:'Ex. : apprendre les fractions avec des dessins, des exercices et des explications.'}),
  gameTemplate({id:'jeu-video',title:'Créer mon propre jeu vidéo',icon:'🎮',description:'Un univers original et une première version jouable.',genre:'jeu vidéo 2D',mechanics:'Définis une mécanique centrale claire, un objectif et une courte progression. Propose trois niveaux ou situations distinctes.'}),
  gameTemplate({id:'jeu-plateforme',title:'Créer un jeu de plateforme',icon:'🦊',description:'Sauter, explorer et atteindre le bout du niveau.',genre:'jeu de plateforme 2D',mechanics:'Prévois déplacements, saut, collisions, obstacles et un niveau complet avec départ, arrivée et reprise après échec.'}),
  gameTemplate({id:'jeu-puzzle',title:'Inventer un jeu de puzzle',icon:'💡',description:'Des règles simples et des niveaux qui font réfléchir.',genre:'jeu de puzzle 2D',mechanics:'Crée au moins trois puzzles résolubles avec une difficulté progressive, une règle expliquée et un bouton pour recommencer le niveau.'}),
  gameTemplate({id:'jeu-gestion',title:'Créer un jeu de gestion',icon:'🏡',description:'Gérer un petit café, une ferme ou un monde à vous.',genre:'jeu de gestion',mechanics:'Prévois une boucle complète de ressources, choix, coûts et objectifs. Les règles et les effets des actions doivent être visibles et cohérents.'}),
  gameTemplate({id:'jeu-cartes',title:'Imaginer un jeu de cartes',icon:'🃏',description:'Un jeu original avec des règles et un adversaire local.',genre:'jeu de cartes local',mechanics:'Définis des cartes originales, les règles d’un tour, une condition de victoire et un adversaire local simple si le jeu en nécessite un.'}),
  gameTemplate({id:'quiz-interactif',title:'Créer un quiz interactif',icon:'🏆',description:'Questions, score et explications après chaque réponse.',genre:'quiz interactif',mechanics:'Prévois plusieurs questions, la validation des réponses, les explications, le score final et la possibilité de rejouer. Vérifie les réponses factuelles et donne leurs sources.'}),
  gameTemplate({id:'aventure-interactive',title:'Créer une aventure à choix',icon:'🗺️',description:'Des personnages, des décisions et plusieurs fins.',genre:'jeu d’aventure à choix',mechanics:'Écris une histoire originale avec des choix qui changent réellement la suite, un inventaire si utile et au moins trois fins accessibles.'}),
  gameTemplate({id:'jeu-arcade',title:'Créer un jeu d’arcade',icon:'🛸',description:'Une partie courte, un score et l’envie de recommencer.',genre:'jeu d’arcade 2D',mechanics:'Prévois une action simple à maîtriser, un score, une difficulté progressive, une fin de partie claire et un redémarrage immédiat.'}),
];

export const MISSION_TEMPLATES = [
  {
    id: 'reseaux-sociaux', title: 'Préparer mes réseaux sociaux', icon: '📣',
    description: 'Un calendrier de publications et des textes prêts à relire.',
    questions: [
      text('activite', 'Quelle est votre activité ?', 'Ex. : une boulangerie artisanale à Namur'),
      text('cible', 'À qui voulez-vous parler ?', 'Ex. : des habitants du quartier et des familles'),
      select('plateformes', 'Sur quels réseaux voulez-vous communiquer ?', ['Instagram', 'Facebook', 'LinkedIn', 'TikTok', 'Instagram et Facebook', 'Plusieurs réseaux : conseillez-moi']),
      select('objectif', 'Que voulez-vous obtenir ?', ['Faire connaître mon activité', 'Trouver de nouveaux clients', 'Présenter une nouveauté', 'Faire revenir mes clients', 'Créer une communauté']),
      select('ton', 'Comment voulez-vous vous exprimer ?', ['Simple et chaleureux', 'Professionnel et rassurant', 'Dynamique et enthousiaste', 'Créatif et décalé', 'Sobre et élégant']),
    ],
    buildPrompt: a => mission('Prépare ma communication sur les réseaux sociaux.', `Activité : ${answer(a, 'activite')}\nPublic : ${answer(a, 'cible')}\nRéseaux : ${answer(a, 'plateformes')}\nObjectif : ${answer(a, 'objectif')}\nTon : ${answer(a, 'ton')}`, 'Propose un calendrier de quatre semaines avec trois publications par semaine. Pour chaque publication, rédige un texte adapté au réseau, une idée de visuel, une invitation à agir et les mots-clés utiles. Livre le calendrier en tableau CSV et les brouillons dans un document Markdown.', 'Chaque brouillon doit être complet, adapté au public et au réseau, sans promesse non vérifiable. Le calendrier doit couvrir quatre semaines avec des idées variées. Les publications restent des brouillons et aucune publication externe ne doit être lancée.'),
  },
  {
    id: 'site-internet', title: 'Créer mon site internet', icon: '🌐',
    description: 'Un premier site local, clair et adapté au téléphone.',
    questions: [
      text('activite', 'Que présente votre site ?', 'Ex. : mon activité de photographe de mariage à Liège'),
      text('public', 'À qui s’adresse-t-il ?', 'Ex. : des couples qui préparent leur mariage'),
      select('objectif', 'Que doit permettre ce site ?', ['Présenter mon activité', 'Présenter mes réalisations', 'Expliquer une offre et inviter à me contacter', 'Présenter un événement', 'Présenter une association']),
      area('pages', 'Quelles pages ou informations voulez-vous y trouver ?', 'Ex. : accueil, prestations, réalisations, tarifs, contact. Vous pouvez aussi écrire « conseillez-moi ».', false),
      select('style', 'Quel style vous correspond ?', ['Clair et minimaliste', 'Chaleureux et accueillant', 'Coloré et dynamique', 'Élégant et sobre', 'Je souhaite une proposition adaptée à mon activité']),
    ],
    buildPrompt: a => mission('Crée un premier site internet utilisable localement.', `Activité : ${answer(a, 'activite')}\nPublic : ${answer(a, 'public')}\nObjectif : ${answer(a, 'objectif')}\nPages et informations : ${answer(a, 'pages')}\nStyle : ${answer(a, 'style')}`, 'Prépare le contenu, la direction visuelle puis un site cohérent avec index.html et les fichiers de style et de comportement nécessaires dans un dossier Livraison/. Fournis un mode d’emploi pour l’ouvrir sur mon ordinateur. Utilise des éléments locaux et simples. Si des coordonnées ou images manquent, utilise des emplacements clairement signalés.', 'Le site doit s’ouvrir localement, rester lisible sur téléphone et ordinateur et avoir une navigation fonctionnelle. Vérifie les liens internes et indique précisément les vérifications effectuées. N’invente ni témoignages ni coordonnées. Un formulaire sans service d’envoi doit annoncer clairement qu’il s’agit d’un aperçu. Ne déploie pas le site et n’ajoute aucun service payant.'),
  },
  {
    id: 'concurrents', title: 'Comprendre mes concurrents', icon: '🔎',
    description: 'Une comparaison documentée et des pistes pour se différencier.',
    questions: [
      text('activite', 'Que proposez-vous à vos clients ?', 'Ex. : des séances de yoga en petits groupes'),
      text('marche', 'Dans quelle ville, région ou marché travaillez-vous ?', 'Ex. : Bruxelles, pour des adultes débutants'),
      area('concurrents', 'Connaissez-vous déjà des concurrents ?', 'Noms ou sites internet, si vous en avez. Sinon, Oscar les recherchera.', false),
      select('angles', 'Que voulez-vous comparer en priorité ?', ['Les offres et les prix publics', 'La communication et les réseaux sociaux', 'L’expérience proposée aux clients', 'Les forces, faiblesses et différences', 'Une vue d’ensemble pour me positionner']),
    ],
    buildPrompt: a => mission('Analyse mes concurrents et propose des pistes de différenciation.', `Mon activité : ${answer(a, 'activite')}\nMarché : ${answer(a, 'marche')}\nConcurrents connus : ${answer(a, 'concurrents', 'À identifier et à justifier par une recherche')}\nComparaison prioritaire : ${answer(a, 'angles')}`, 'Sélectionne jusqu’à cinq concurrents pertinents et explique ce choix. Prépare un tableau comparatif en CSV et un rapport Markdown avec leurs offres, les éléments publics vérifiables, leurs différences et trois pistes concrètes pour mon activité.', 'Chaque comparaison doit être reliée à une source. Évite de présenter une information absente comme un défaut. Les prix doivent indiquer leur devise et leur date de consultation. Les recommandations doivent découler de la comparaison et rester réalistes pour le contexte fourni.', true),
  },
  {
    id: 'strategie-contenu', title: 'Trouver quoi publier', icon: '🗓️',
    description: 'Des sujets, des formats et un programme de contenu réaliste.',
    questions: [
      text('activite', 'De quoi souhaitez-vous parler ?', 'Ex. : les conseils de mon atelier de réparation vélo'),
      text('public', 'À qui voulez-vous être utile ?', 'Ex. : des personnes qui utilisent leur vélo tous les jours'),
      select('objectif', 'Quel est votre objectif principal ?', ['Devenir plus visible', 'Expliquer mon savoir-faire', 'Attirer des demandes de clients', 'Fidéliser ma communauté']),
      select('temps', 'Quel rythme pouvez-vous tenir ?', ['Une publication par semaine', 'Deux publications par semaine', 'Trois publications par semaine']),
      text('canaux', 'Où souhaitez-vous partager ces contenus ?', 'Ex. : mon site, LinkedIn et une lettre d’information'),
    ],
    buildPrompt: a => mission('Prépare une stratégie de contenu simple à suivre.', `Sujet et activité : ${answer(a, 'activite')}\nPublic : ${answer(a, 'public')}\nObjectif : ${answer(a, 'objectif')}\nRythme : ${answer(a, 'temps')}\nCanaux : ${answer(a, 'canaux')}`, 'Définis trois à cinq grands thèmes, puis un calendrier de six semaines au rythme choisi. Pour chaque idée, indique le sujet, le format, le canal, le bénéfice pour le public et une première phrase. Fournis un document de stratégie et un calendrier CSV.', 'Les idées doivent être variées, liées à l’objectif et réalisables au rythme indiqué. Explique comment réutiliser un même sujet sur plusieurs canaux et propose trois indicateurs simples à suivre. Le résultat doit rester un programme de préparation, sans publication.'),
  },
  {
    id: 'newsletter', title: 'Préparer une newsletter', icon: '✉️',
    description: 'Une lettre d’information complète, prête à relire avant envoi.',
    questions: [
      text('activite', 'Qui écrit cette lettre ?', 'Ex. : ma librairie indépendante'),
      text('public', 'Qui va la lire ?', 'Ex. : les clients intéressés par les nouveautés littéraires'),
      area('contenu', 'Quelles informations voulez-vous partager ?', 'Ex. : trois nouveautés, une rencontre samedi et un coup de cœur'),
      select('objectif', 'Que souhaitez-vous que les lecteurs fassent ?', ['Lire un contenu', 'Découvrir une nouveauté', 'Participer à un événement', 'Me contacter', 'Simplement garder le lien']),
      select('ton', 'Quel ton préférez-vous ?', ['Chaleureux et personnel', 'Clair et professionnel', 'Court et direct', 'Inspirant et enthousiaste']),
    ],
    buildPrompt: a => mission('Rédige le brouillon de ma prochaine lettre d’information.', `Expéditeur : ${answer(a, 'activite')}\nLecteurs : ${answer(a, 'public')}\nInformations à intégrer : ${answer(a, 'contenu')}\nObjectif : ${answer(a, 'objectif')}\nTon : ${answer(a, 'ton')}`, 'Propose trois objets, un court texte d’aperçu et une version complète de la lettre avec introduction, rubriques et invitation à agir. Fournis une version en texte simple et un fichier HTML local lisible sur téléphone.', 'Tous les éléments fournis doivent être repris sans inventer de dates, d’offres ou de liens. Signale les informations à compléter. Le HTML et le texte doivent raconter la même chose. N’envoie pas la lettre et n’importe aucune liste de contacts.'),
  },
  {
    id: 'lancement-produit', title: 'Préparer un lancement', icon: '🚀',
    description: 'Un plan de lancement et les premiers supports de présentation.',
    questions: [
      area('offre', 'Qu’allez-vous lancer ?', 'Décrivez votre produit, service ou nouvelle offre en quelques phrases.'),
      text('public', 'À qui cette nouveauté est-elle destinée ?', 'Ex. : des indépendants qui veulent mieux organiser leur semaine'),
      text('date', 'Quand souhaitez-vous la présenter ?', 'Ex. : début novembre, dans six semaines ou date à définir'),
      text('moyens', 'Quels moyens avez-vous déjà ?', 'Ex. : une petite liste de clients, Instagram et deux heures par semaine'),
      text('objectif', 'À quoi reconnaîtriez-vous un lancement réussi ?', 'Ex. : obtenir dix demandes de découverte, sans promettre ce résultat'),
    ],
    buildPrompt: a => mission('Prépare le lancement de ma nouvelle offre.', `Offre : ${answer(a, 'offre')}\nPublic : ${answer(a, 'public')}\nÉchéance : ${answer(a, 'date')}\nMoyens disponibles : ${answer(a, 'moyens')}\nObjectif souhaité : ${answer(a, 'objectif')}`, 'Prépare un message central, les raisons concrètes de s’intéresser à l’offre, un calendrier avant/pendant/après le lancement et les brouillons d’une annonce, d’une page de présentation et de trois publications. Fournis le calendrier en CSV et les textes en Markdown.', 'Le plan doit tenir compte des moyens et de l’échéance. Distingue les objectifs des résultats garantis. N’invente aucune caractéristique ni aucun témoignage. Les actions doivent rester proposées et les messages rester des brouillons.'),
  },
  {
    id: 'identite-visuelle', title: 'Donner un style à ma marque', icon: '🎨',
    description: 'Une direction visuelle et des exemples faciles à réutiliser.',
    questions: [
      text('nom', 'Quel est le nom de votre activité ?', 'Ex. : Les Jardins de Louise'),
      text('activite', 'Que faites-vous et pour qui ?', 'Ex. : des bouquets locaux pour des particuliers'),
      select('personnalite', 'Quelle impression voulez-vous donner ?', ['Naturelle et chaleureuse', 'Sérieuse et rassurante', 'Créative et joyeuse', 'Élégante et discrète', 'Moderne et accessible']),
      area('preferences', 'Y a-t-il des couleurs ou styles à privilégier ou éviter ?', 'Ex. : j’aime le vert et les formes simples ; je veux éviter le rose.', false),
      text('supports', 'Où cette identité sera-t-elle utilisée ?', 'Ex. : mon site, Instagram et mes cartes de visite'),
    ],
    buildPrompt: a => mission('Propose une première identité visuelle pour ma marque.', `Nom : ${answer(a, 'nom')}\nActivité et public : ${answer(a, 'activite')}\nImpression souhaitée : ${answer(a, 'personnalite')}\nPréférences : ${answer(a, 'preferences', 'Aucune préférence particulière fournie')}\nSupports : ${answer(a, 'supports')}`, 'Définis une direction visuelle argumentée, une palette avec ses codes couleur et des choix de caractères simples à utiliser. Crée un guide Markdown et une planche visuelle en HTML/CSS ou SVG avec des exemples de titre, bouton et support adapté à mon activité. Si tu proposes un signe de marque, présente-le comme un concept à valider.', 'Les exemples doivent former un ensemble cohérent et lisible, avec un contraste adapté. Les fichiers visuels doivent réellement exister et s’ouvrir localement. Ne copie pas une marque existante et ne présente pas le concept comme un logo juridiquement disponible ou une identité déjà validée.'),
  },
  {
    id: 'dossier-presentation', title: 'Présenter mon projet', icon: '📋',
    description: 'Un dossier structuré pour convaincre sans oublier l’essentiel.',
    questions: [
      area('projet', 'Quel projet voulez-vous présenter ?', 'Expliquez l’idée, son utilité et ce qui existe déjà.'),
      text('destinataire', 'À qui s’adresse cette présentation ?', 'Ex. : un partenaire, une association ou un futur client'),
      text('objectif', 'Qu’attendez-vous de cette personne ?', 'Ex. : un rendez-vous pour discuter d’un partenariat'),
      area('elements', 'Quels éléments faut-il absolument inclure ?', 'Ex. : l’équipe, le calendrier, le budget connu et les réalisations', false),
      select('longueur', 'Quel format vous serait le plus utile ?', ['Un dossier court de deux pages environ', 'Un dossier détaillé', 'Un texte organisé en huit diapositives']),
    ],
    buildPrompt: a => mission('Prépare le dossier de présentation de mon projet.', `Projet : ${answer(a, 'projet')}\nDestinataire : ${answer(a, 'destinataire')}\nDécision ou prochaine étape souhaitée : ${answer(a, 'objectif')}\nÉléments fournis : ${answer(a, 'elements', 'Aucun élément complémentaire fourni')}\nFormat : ${answer(a, 'longueur')}`, 'Rédige une présentation complète avec une progression claire : besoin, proposition, bénéfices, éléments de preuve disponibles, mise en œuvre et prochaine étape. Fournis le texte en Markdown et une version HTML locale avec une mise en page adaptée au format choisi.', 'Le dossier doit être compréhensible sans explication orale et adapté au destinataire. Les données manquantes doivent être signalées. Aucun chiffre, client, partenaire ou résultat ne doit être inventé. Pour les diapositives, prépare huit sections lisibles avec leurs notes de présentation.'),
  },
  {
    id: 'analyser-donnees', title: 'Comprendre mes chiffres', icon: '📊',
    description: 'Des calculs expliqués et une synthèse utile pour décider.',
    questions: [
      text('sujet', 'À quoi correspondent vos chiffres ?', 'Ex. : les ventes mensuelles de ma boutique'),
      area('donnees', 'Quelles données pouvez-vous fournir ?', 'Collez un petit tableau ici, ou indiquez le chemin d’un fichier local. Évitez les informations personnelles inutiles.'),
      text('question', 'Quelle question voulez-vous résoudre ?', 'Ex. : quels produits progressent et lesquels méritent mon attention ?'),
      text('periode', 'Quelle période faut-il regarder ?', 'Ex. : de janvier à septembre 2026'),
      select('sortie', 'Quel résultat préférez-vous ?', ['Une synthèse claire avec les principaux chiffres', 'Un tableau détaillé avec les calculs', 'Une synthèse avec des graphiques']),
    ],
    buildPrompt: a => mission('Analyse mes données et explique les conclusions utiles.', `Sujet : ${answer(a, 'sujet')}\nDonnées ou fichier local : ${answer(a, 'donnees')}\nQuestion : ${answer(a, 'question')}\nPériode : ${answer(a, 'periode')}\nPrésentation : ${answer(a, 'sortie')}`, 'Commence par vérifier les données disponibles, leurs unités et les valeurs manquantes. Effectue les calculs utiles, fournis les tableaux de résultat en CSV et un rapport Markdown. Ajoute des graphiques locaux si le format choisi le demande. Si un fichier indiqué est inaccessible, dis-le clairement et n’invente aucune donnée.', 'Les chiffres doivent pouvoir être reliés aux données fournies et les calculs doivent être expliqués. Distingue les observations des interprétations. Signale les données insuffisantes et les limites avant de proposer une décision. Aucun accès à un compte externe ni transfert de données ne doit être effectué.'),
  },
  {
    id: 'automatisation', title: 'Simplifier une tâche répétitive', icon: '⚙️',
    description: 'Une solution locale, expliquée et vérifiée sur un exemple.',
    questions: [
      area('tache', 'Quelle tâche répétez-vous souvent ?', 'Ex. : renommer chaque semaine des photos et les ranger dans des dossiers'),
      area('entree', 'Avec quoi commencez-vous ?', 'Ex. : un dossier de photos JPG avec des noms différents'),
      area('resultat', 'Quel résultat souhaitez-vous obtenir ?', 'Ex. : des copies classées par date, sans toucher aux originaux'),
      text('ordinateur', 'Quel ordinateur ou logiciel utilisez-vous ?', 'Ex. : un Mac, un PC Windows, un tableur…'),
      text('contraintes', 'Qu’est-ce qu’il faut absolument préserver ?', 'Ex. : les fichiers originaux et le nom de mes clients', false),
    ],
    buildPrompt: a => mission('Prépare une automatisation locale de ma tâche répétitive.', `Tâche actuelle : ${answer(a, 'tache')}\nÉléments de départ : ${answer(a, 'entree')}\nRésultat attendu : ${answer(a, 'resultat')}\nEnvironnement : ${answer(a, 'ordinateur')}\nÀ préserver : ${answer(a, 'contraintes', 'Préserver les données et fichiers originaux')}`, 'Propose l’approche la plus simple, puis crée les fichiers nécessaires à une automatisation locale et un mode d’emploi compréhensible. Prévois un aperçu des changements avant toute application. Vérifie la solution uniquement sur des exemples fictifs dans le dossier de travail et explique les vérifications réellement réalisées.', 'La solution doit préserver les originaux, signaler les erreurs et ne rien modifier en dehors du dossier de travail pendant sa préparation. Elle ne doit demander ni clé API ni abonnement supplémentaire. Si une connexion externe serait nécessaire, propose une marche à suivre et une alternative locale, sans la connecter automatiquement.'),
  },
  {
    id: 'article-seo', title: 'Rédiger un article pour mon site', icon: '📝',
    description: 'Un article utile, documenté et facile à trouver sur le Web.',
    questions: [
      text('sujet', 'Sur quel sujet voulez-vous écrire ?', 'Ex. : comment entretenir son vélo en hiver'),
      text('lecteurs', 'À qui s’adresse l’article ?', 'Ex. : des cyclistes débutants qui roulent en ville'),
      text('activite', 'Quelle activité ou quel site l’accueillera ?', 'Ex. : le site de mon atelier de réparation à Bruxelles'),
      text('recherche', 'Que pourrait taper votre lecteur dans un moteur de recherche ?', 'Ex. : entretien vélo hiver. Si vous ne savez pas, écrivez « à proposer ».', false),
      select('longueur', 'Quel niveau de détail voulez-vous ?', ['Un article court et pratique', 'Un guide complet', 'Un article avec une liste de questions fréquentes']),
    ],
    buildPrompt: a => mission('Rédige un article utile et documenté pour mon site internet.', `Sujet : ${answer(a, 'sujet')}\nLecteurs : ${answer(a, 'lecteurs')}\nSite et activité : ${answer(a, 'activite')}\nRecherche envisagée : ${answer(a, 'recherche')}\nFormat : ${answer(a, 'longueur')}`, 'Vérifie l’intention du lecteur et les informations factuelles, puis propose un titre, une courte description pour les moteurs de recherche, un plan et l’article complet en Markdown. Ajoute des questions fréquentes si le format choisi le demande. Fournis les sources à la fin.', 'L’article doit répondre directement à la question du lecteur, rester naturel et éviter les répétitions artificielles. N’annonce aucun classement garanti dans les moteurs de recherche. Les affirmations précises doivent être documentées et les conseils adaptés aux débutants. Aucun article ne doit être publié automatiquement.', true),
  },
  {
    id: 'preparation-reunion', title: 'Préparer une réunion utile', icon: '🤝',
    description: 'Un ordre du jour et les questions pour avancer concrètement.',
    questions: [
      text('sujet', 'Quel est le sujet de la réunion ?', 'Ex. : organiser le prochain événement de notre association'),
      text('participants', 'Qui sera présent ?', 'Indiquez les rôles : équipe, partenaire, client… Pas besoin de données personnelles.'),
      text('decision', 'Que faut-il avoir décidé à la fin ?', 'Ex. : choisir une date, un lieu et les prochaines responsabilités'),
      select('duree', 'Combien de temps avez-vous ?', ['15 minutes', '30 minutes', '45 minutes', 'Une heure', 'Une heure et demie']),
      area('contexte', 'Y a-t-il des informations ou difficultés à connaître ?', 'Ex. : un budget encore incertain ou un choix déjà discuté', false),
    ],
    buildPrompt: a => mission('Prépare une réunion claire, orientée vers les décisions.', `Sujet : ${answer(a, 'sujet')}\nParticipants : ${answer(a, 'participants')}\nDécision attendue : ${answer(a, 'decision')}\nDurée : ${answer(a, 'duree')}\nContexte : ${answer(a, 'contexte', 'Aucun contexte complémentaire fourni')}`, 'Fournis un ordre du jour minuté, les informations à préparer, les questions à poser et un modèle de compte rendu avec décisions, responsables et prochaines échéances. Ajoute un brouillon de message d’invitation, sans l’envoyer. Livre l’ensemble dans un document Markdown.', 'Le temps total doit respecter la durée choisie. Chaque point doit servir une décision ou une prochaine étape. Ne présente aucune décision comme déjà prise et n’invente ni disponibilité ni engagement des participants.'),
  },
  {
    id: 'plan-commercial', title: 'Développer mes ventes', icon: '📈',
    description: 'Un plan commercial réaliste et des messages à personnaliser.',
    questions: [
      area('offre', 'Que vendez-vous ?', 'Décrivez votre offre et son intérêt pour les clients.'),
      text('clients', 'Quels clients souhaitez-vous toucher ?', 'Ex. : des petites entreprises de ma région'),
      area('situation', 'Comment trouvez-vous vos clients aujourd’hui ?', 'Ex. : le bouche-à-oreille fonctionne, mais les demandes sont irrégulières'),
      text('moyens', 'Quels moyens pouvez-vous y consacrer ?', 'Ex. : trois heures par semaine et aucun budget publicitaire'),
      text('objectif', 'Quel progrès souhaitez-vous voir dans les trois prochains mois ?', 'Ex. : plus de demandes qualifiées et un suivi régulier'),
    ],
    buildPrompt: a => mission('Prépare un plan commercial pour les trois prochains mois.', `Offre : ${answer(a, 'offre')}\nClients recherchés : ${answer(a, 'clients')}\nSituation actuelle : ${answer(a, 'situation')}\nMoyens : ${answer(a, 'moyens')}\nObjectif : ${answer(a, 'objectif')}`, 'Propose des priorités hebdomadaires, des canaux adaptés, un argumentaire simple, trois brouillons de prise de contact et un modèle CSV pour suivre les démarches. Explique comment mesurer les progrès sans multiplier les indicateurs.', 'Le programme doit tenir compte du temps et des moyens. Distingue les hypothèses des résultats acquis. Les messages doivent être personnalisables et rester des brouillons. Ne collecte pas de listes de contacts, ne contacte personne et n’achète aucune publicité.'),
  },
  {
    id: 'script-podcast', title: 'Écrire un épisode de podcast', icon: '🎙️',
    description: 'Un déroulé et un script qui se disent naturellement à voix haute.',
    questions: [
      text('sujet', 'De quoi parlera cet épisode ?', 'Ex. : les premières étapes pour créer un potager sur un balcon'),
      text('auditeurs', 'Qui va l’écouter ?', 'Ex. : des débutants qui vivent en appartement'),
      select('format', 'Comment imaginez-vous l’épisode ?', ['Je parle seul', 'J’interviewe une personne', 'Nous discutons à deux']),
      select('duree', 'Quelle durée visez-vous ?', ['5 minutes', '10 minutes', '15 minutes', '20 minutes', '30 minutes']),
      area('points', 'Quelles idées ou informations doivent apparaître ?', 'Ex. : les erreurs fréquentes, le matériel utile et trois conseils concrets', false),
    ],
    buildPrompt: a => mission('Prépare le script de mon prochain épisode de podcast.', `Sujet : ${answer(a, 'sujet')}\nAuditeurs : ${answer(a, 'auditeurs')}\nFormat : ${answer(a, 'format')}\nDurée : ${answer(a, 'duree')}\nPoints souhaités : ${answer(a, 'points')}`, 'Prépare un déroulé minuté, une introduction accrocheuse, un script oral complet adapté au format et une conclusion. Pour une interview, rédige les questions et relances sans inventer les réponses ni les propos de l’invité. Ajoute un titre, une description et les sources utiles dans un document Markdown.', 'La longueur et le rythme doivent correspondre à la durée souhaitée. Les affirmations factuelles doivent être sourcées. Les transitions doivent être naturelles et les mots faciles à prononcer. N’imite aucune personne réelle et ne génère ni ne publie d’enregistrement.', true),
  },
  ...EXPANDED_TEMPLATES,
  ...EXTRA_TEMPLATES,
].map(template=>({...template,category:template.category || DEFAULT_CATEGORIES[template.id] || 'organisation'}));

let wizardNumber = 0;

/** Translate labels and predefined choices, never the user's own writing. */
export function buildWizardSummary(template, answers = {}, locale = getLocale()) {
  if (locale === 'fr') return template.buildPrompt(answers);
  const context = template.questions.map(question => {
    const value = typeof answers[question.id] === 'string' ? answers[question.id].trim() : '';
    const displayed = value ? (question.options?.includes(value) ? translate(value, locale) : value) : translate('À préciser avec Oscar', locale);
    return `${translate(question.label, locale)}\n${displayed}`;
  }).join('\n\n');
  return `${translate(template.title, locale)}\n${translate(template.description, locale)}\n\n${translate('MON CONTEXTE', locale)}\n${context}`;
}

/** Keep the model's deliverables and validation rules outside the editable summary. */
export function buildWizardSubmission(template, answers, summary, locale = getLocale()) {
  if (locale === 'fr') return summary;
  const instructions = template.buildPrompt(answers);
  const marker = '\n\nCE QUE J’ATTENDS\n';
  const index = instructions.indexOf(marker);
  const requirements = index < 0 ? instructions : instructions.slice(index + 2);
  return `${summary}\n\nCONSIGNES COMPLÉMENTAIRES DU MODÈLE\n${requirements}\n\nAdapte les livrables aux précisions et corrections du résumé ci-dessus. Ne rétablis pas une ancienne réponse que l’utilisateur a modifiée dans son résumé. Rédige la mission et ses livrables dans la langue du résumé, en conservant les noms propres et les chemins techniques.`;
}

/** A dedicated container hosts the wizard. This class only collects a brief. */
export class MissionWizard {
  constructor(container, { onComplete, onCancel } = {}) {
    if (!container?.ownerDocument || typeof container.appendChild !== 'function') throw new TypeError('Un élément de page est nécessaire pour afficher le formulaire.');
    this.container = container;
    this.document = container.ownerDocument;
    this.onComplete = typeof onComplete === 'function' ? onComplete : () => {};
    this.onCancel = typeof onCancel === 'function' ? onCancel : () => {};
    this.number = ++wizardNumber;
    this.session = 0;
    this.destroyed = false;
    this.root = null;
    this.onLanguageChange = () => {
      if (!this.root) return;
      if (this.summaryText !== null && this.summaryText === this.generatedSummaryText) this.summaryText = null;
      this.render();
    };
    this.document.addEventListener('oscar:language', this.onLanguageChange);
  }

  open(templateId) {
    if (this.destroyed) throw new Error('Ce formulaire a été fermé définitivement.');
    const template = MISSION_TEMPLATES.find(item => item.id === templateId);
    if (!template) throw new Error('Cette mission guidée est introuvable.');
    if (!this.root) this.previousFocus = this.document.activeElement;
    this.session++;
    this.template = template;
    this.answers = {};
    this.step = 0;
    this.summaryText = null;
    this.generatedSummaryText = null;
    this.summaryLocale = getLocale();
    this.busy = false;
    this.container.hidden = false;
    this.render();
    return this;
  }

  close() {
    this.session++;
    this.root?.remove();
    this.root = null;
    this.container.hidden = true;
    this.busy = false;
    if (this.previousFocus?.isConnected && typeof this.previousFocus.focus === 'function') this.previousFocus.focus();
    return this;
  }

  destroy() {
    this.close();
    this.document.removeEventListener('oscar:language', this.onLanguageChange);
    this.destroyed = true;
    this.answers = {};
    this.template = null;
    this.onComplete = () => {};
    this.onCancel = () => {};
  }

  element(tag, className, content) {
    const node = this.document.createElement(tag);
    if (className) node.className = className;
    if (content !== undefined) node.textContent = content;
    return node;
  }

  button(label, handler, className = '') {
    const button = this.element('button', className, label);
    button.type = 'button';
    button.disabled = this.busy;
    button.addEventListener('click', handler);
    return button;
  }

  saveAnswer(question, value) {
    if (this.answers[question.id] !== value) this.summaryText = null;
    this.answers[question.id] = value;
  }

  showError(message, input) {
    this.error.textContent = message;
    this.error.hidden = false;
    if (input) {
      input.setAttribute('aria-invalid', 'true');
      input.focus();
    }
  }

  render() {
    const oldRoot = this.root;
    const root = this.element('section', 'mission-wizard');
    root.setAttribute('aria-label', `Préparer la mission : ${this.template.title}`);
    this.root = root;
    const header = this.element('header');
    header.append(this.element('p', 'wizard-eyebrow', 'Oscar et les Agents · mission guidée'), this.element('h2', '', `${this.template.icon} ${this.template.title}`), this.element('p', '', this.template.description));
    root.appendChild(header);

    const isSummary = this.step === this.template.questions.length;
    const progress = this.element('div', 'wizard-progress');
    const count = this.template.questions.length + 1;
    progress.appendChild(this.element('span', '', isSummary ? 'Dernière étape · relire votre mission' : `Question ${this.step + 1} sur ${this.template.questions.length}`));
    const bar = this.element('progress');
    bar.max = count;
    bar.value = this.step + 1;
    bar.setAttribute('aria-label', 'Avancement de la préparation');
    progress.appendChild(bar);
    root.appendChild(progress);

    const form = this.element('form', isSummary ? 'wizard-summary' : 'wizard-question');
    form.noValidate = true;
    const inputId = `wizard-${this.number}-${this.step}`;
    let input;
    let question;
    if (isSummary) {
      form.appendChild(this.element('h3', '', 'Votre mission est prête à être confiée'));
      form.appendChild(this.element('p', '', 'Relisez le texte ci-dessous. Vous pouvez le modifier, ajouter une précision ou revenir à une réponse.'));
      const label = this.element('label', '', 'Votre mission pour Oscar');
      label.htmlFor = inputId;
      input = this.element('textarea', 'wizard-input');
      input.rows = 13;
      input.maxLength = 16000;
      if (this.summaryText === null) {
        this.summaryLocale = getLocale();
        this.summaryText = buildWizardSummary(this.template, this.answers, this.summaryLocale);
        this.generatedSummaryText = this.summaryText;
      }
      input.value = this.summaryText;
      input.addEventListener('input', () => { this.summaryText = input.value; input.removeAttribute('aria-invalid'); this.error.hidden = true; });
      form.append(label, input);
    } else {
      question = this.template.questions[this.step];
      const label = this.element('label', '', question.label);
      label.htmlFor = inputId;
      form.appendChild(label);
      if (question.type === 'select') {
        input = this.element('select', 'wizard-input');
        const placeholder = this.element('option', '', 'Choisir une réponse');
        placeholder.value = '';
        input.appendChild(placeholder);
        for (const option of question.options) {
          const choice = this.element('option', '', option);
          choice.value = option;
          input.appendChild(choice);
        }
      } else {
        input = this.element(question.type === 'textarea' ? 'textarea' : 'input', 'wizard-input');
        if (question.type === 'textarea') { input.rows = 4; input.maxLength = 2000; }
        else { input.type = 'text'; input.maxLength = 800; }
        if (question.placeholder) input.placeholder = question.placeholder;
      }
      input.value = this.answers[question.id] ?? '';
      input.required = Boolean(question.required);
      if (!question.required) form.appendChild(this.element('p', 'wizard-help', 'Cette réponse est facultative. Oscar pourra vous proposer une piste.'));
      input.addEventListener(question.type === 'select' ? 'change' : 'input', () => {
        this.saveAnswer(question, input.value);
        input.removeAttribute('aria-invalid');
        this.error.hidden = true;
      });
      form.appendChild(input);
    }
    input.id = inputId;
    input.disabled = this.busy;
    input.setAttribute('aria-describedby', `${inputId}-error`);
    this.input = input;
    this.error = this.element('p', 'wizard-error');
    this.error.id = `${inputId}-error`;
    this.error.hidden = true;
    this.error.setAttribute('role', 'alert');
    form.appendChild(this.error);

    const actions = this.element('div', 'wizard-actions');
    const cancel = this.button('Annuler', () => {
      if (this.busy) return;
      this.close();
      this.onCancel();
    }, 'wizard-cancel');
    actions.appendChild(cancel);
    if (this.step > 0) actions.appendChild(this.button('Précédent', () => {
      if (this.busy) return;
      if (isSummary) this.summaryText = input.value;
      else this.saveAnswer(question, input.value);
      this.step--;
      this.render();
    }, 'wizard-previous'));
    const next = this.element('button', 'wizard-next', this.busy ? 'Transmission en cours…' : isSummary ? 'Confier à Oscar' : 'Continuer');
    next.type = 'submit';
    next.disabled = this.busy;
    actions.appendChild(next);
    form.appendChild(actions);
    form.addEventListener('submit', event => {
      event.preventDefault();
      if (this.busy) return;
      if (isSummary) { void this.complete(input); return; }
      const value = input.value.trim();
      if (question.required && !value) { this.showError('Ajoutez une réponse pour continuer.', input); return; }
      this.saveAnswer(question, value);
      this.step++;
      this.render();
    });
    root.appendChild(form);
    if (oldRoot?.parentNode === this.container) oldRoot.replaceWith(root);
    else this.container.appendChild(root);
    if (!this.busy) input.focus();
  }

  async complete(input) {
    const summary = input.value.trim();
    if (!summary) { this.showError('Écrivez une mission avant de la confier à Oscar.', input); return; }
    const prompt = buildWizardSubmission(this.template, this.answers, summary, this.summaryLocale);
    if (prompt.length > 16000) { this.showError('La mission est trop longue. Gardez au maximum 16 000 caractères.', input); return; }
    this.summaryText = summary;
    const session = this.session;
    const template = this.template;
    this.busy = true;
    this.render();
    try {
      await this.onComplete(prompt, template);
      if (session === this.session) this.close();
    } catch (error) {
      if (session !== this.session) return;
      this.busy = false;
      this.render();
      this.showError(error?.message || 'La mission n’a pas pu être transmise. Votre texte est conservé ; vous pouvez réessayer.', this.input);
    }
  }
}
