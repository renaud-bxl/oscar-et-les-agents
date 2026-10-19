const text = (id, label, placeholder, required = true) => ({ id, label, placeholder, required, type: 'text' });
const area = (id, label, placeholder, required = true) => ({ id, label, placeholder, required, type: 'textarea' });
const select = (id, label, options) => ({ id, label, options, required: true, type: 'select' });
const sources = () => area('sources', 'Quels documents ou liens pouvez-vous fournir ?', 'Liens publics ou chemins de fichiers locaux. Précisez les documents manquants ; ne joignez pas de données personnelles inutiles.', false);
const period = () => text('periode', 'Quelle période faut-il couvrir ?', 'Ex. : depuis janvier 2025 jusqu’à aujourd’hui, avec la date de vérification.');
const readership = () => text('lecteurs', 'Pour quels lecteurs et quel usage ?', 'Ex. : des lecteurs débutants, une équipe de travail ou une présentation publique.');
const writingScope = () => select('etape', 'Quelle première étape souhaitez-vous préparer ?', ['Le plan détaillé et un court extrait', 'Le plan et un premier chapitre pilote', 'Une partie précise à retravailler']);
const writingRights = () => area('materiaux', 'Quels matériaux vous appartiennent ou sont autorisés ?', 'Vos notes, un extrait de votre manuscrit ou des documents que vous avez le droit d’utiliser. Indiquez les limites et les éléments à anonymiser.', false);

const SOURCE_CHECKS = 'Utilise d’abord des sources officielles et primaires consultables. Pour chaque affirmation importante, donne le titre du document, son institution ou auteur, sa date, sa référence, son lien et la page ou section pertinente ; date la dernière vérification. Distingue faits vérifiés, interprétations, hypothèses et informations introuvables. Ne fabrique aucune citation, statistique, référence ni consultation de document. Si un document est inaccessible, signale-le et adapte le résultat. Ne collecte pas de coordonnées privées ni de données personnelles sans rapport avec le sujet.';
const PARLIAMENT_CHECKS = 'Identifie l’assemblée, la législature, le niveau de pouvoir compétent et la langue des documents. Distingue projet ou proposition de loi, décret ou ordonnance, amendement, texte adopté, publication et entrée en vigueur. Vérifie le stade de procédure et la date avant de parler de droit applicable ; ne présente jamais un texte en discussion comme une loi en vigueur. Sépare la recherche documentaire d’un avis juridique. Les positions attribuées à des acteurs doivent être appuyées sur leurs déclarations publiques datées.';
const WRITING_CHECKS = 'Produis un texte original et respecte les droits sur les manuscrits et documents fournis. Ne reprends pas de passages protégés non autorisés et ne copie pas la voix distinctive d’un auteur contemporain. Ne transforme pas une invention en fait ou en citation réelle. Pour les personnes réelles, limite-toi aux éléments autorisés ou aux sources publiques pertinentes et distingue clairement faits, souvenirs et interprétations. Préserve les originaux. Un projet de livre se traite par étapes : livre le plan, les choix éditoriaux et une première partie raisonnable (environ 800 à 1 500 mots, sauf extrait plus court demandé), puis un programme de rédaction et de validation ; ne prétends pas livrer un livre entier en une seule mission.';
const LOCAL_OUTPUT = 'Livre des documents Markdown et, pour les tableaux utiles, des fichiers CSV dans Livraison/. Donne des explications simples en français. Les éléments non fournis restent à confirmer. Prépare les livrables sans publier, envoyer, contacter, s’inscrire, acheter ou déposer de document auprès d’une institution. Aucune démarche externe automatique.';

function template({ id, title, icon, description, category, questions, deliverables, checks = '', research = false, parliament = false, writing = false }) {
  return {
    id, title, icon, description, category, questions,
    buildPrompt(answers = {}) {
      const context = questions.map(question => {
        const value = answers[question.id];
        return `${question.label}\n${typeof value === 'string' && value.trim() ? value.trim() : 'Non fourni : à préciser ou à proposer explicitement.'}`;
      }).join('\n\n');
      return `${title}.\n\nMON CONTEXTE\n${context}\n\nCE QUE J’ATTENDS\n${deliverables}\n\nCRITÈRES DE VALIDATION\n${[checks, research && SOURCE_CHECKS, parliament && PARLIAMENT_CHECKS, writing && WRITING_CHECKS].filter(Boolean).join('\n')}\n\n${LOCAL_OUTPUT}`;
    },
  };
}
const research = config => template({ ...config, category: config.category || 'analysis', research: true });
const parliament = config => research({ ...config, category: 'parliament', parliament: true });
const writing = config => template({ ...config, category: 'writing', writing: true });
const visualRights = () => area('elements', 'Quels éléments fournis pouvez-vous utiliser ?', 'Vos textes, logos, dessins ou images autorisées, avec leur origine et leurs conditions d’utilisation. Sinon, demandez un dessin entièrement original.', false);
const visualStyle = () => select('style', 'Quel style visuel souhaitez-vous ?', ['Clair et minimaliste', 'Coloré et illustré', 'Chaleureux et artisanal', 'Élégant et éditorial', 'Proposez une direction adaptée']);
const visualFormat = () => text('format', 'Pour quel support et quelles dimensions ?', 'Ex. : écran 1 200 × 800 px, publication sociale ou affiche A4. Précisez les contraintes connues.');
const DESIGN_CHECKS = 'Crée un dessin original en SVG autonome et modifiable, accompagné si utile d’une présentation HTML locale. Organise les groupes, nomme les éléments et conserve les textes éditables ; donne les couleurs, dimensions, polices de remplacement et conseils d’adaptation. N’ajoute ni script, ni dépendance distante, ni ressource externe à charger pour afficher le SVG. Utilise seulement les images, marques et matériaux dont l’utilisateur confirme les droits ; signale toute autorisation à vérifier. Si une image ne peut pas être intégrée avec les droits et conditions nécessaires, propose un dessin original ou un emplacement clairement identifié. N’imite pas une franchise ou un logo existant. Ne prétends pas avoir généré une photographie, une image bitmap par IA, une marque juridiquement disponible ou un fichier certifié pour l’imprimeur. Les exports bitmap éventuels doivent provenir d’un rendu réel des fichiers fournis, avec leur méthode indiquée.';
const design = config => template({ ...config, category: 'design', checks: [config.checks, DESIGN_CHECKS].filter(Boolean).join('\n') });

export const EXTRA_TEMPLATES = [
  parliament({
    id: 'recherche-parlementaire-belgique', icon: '🏛️', title: 'Faire une recherche parlementaire belge',
    description: 'Retrouver les travaux pertinents et comprendre qui est compétent.',
    questions: [text('sujet', 'Sur quel sujet porte votre recherche parlementaire ?', 'Ex. : les aides à la rénovation et leur contrôle.'), select('assemblee', 'Quelle assemblée faut-il examiner ?', ['Chambre des représentants', 'Sénat', 'Parlement wallon', 'Parlement de Bruxelles-Capitale', 'Parlement de la Fédération Wallonie-Bruxelles', 'Parlement flamand', 'Parlement de la Communauté germanophone', 'Identifier d’abord le niveau compétent']), period(), sources()],
    deliverables: 'Établis d’abord la compétence institutionnelle. Livre une note de synthèse et un tableau des questions, réponses, propositions, rapports et débats pertinents, avec leurs références officielles, dates et statut. Décris les recherches effectuées et les limites de couverture.',
  }),
  parliament({
    id: 'question-parlementaire', icon: '❓', title: 'Préparer une question parlementaire',
    description: 'Un brouillon fondé sur des faits, avec les références à vérifier.',
    questions: [text('sujet', 'Quel problème souhaitez-vous soulever ?', 'Décrivez les faits observés sans attribuer d’intention non établie.'), text('competence', 'À quelle assemblée et à quel portefeuille ministériel ?', 'Précisez le niveau de pouvoir ; si vous hésitez, demandez sa vérification.'), select('type', 'Quel type de question préparez-vous ?', ['Question écrite', 'Question orale', 'À déterminer selon les règles de l’assemblée']), sources()],
    deliverables: 'Prépare une fiche factuelle sourcée, les questions déjà posées sur le sujet et un brouillon neutre avec contexte bref et questions numérotées. Vérifie la compétence et les règles publiques de recevabilité accessibles. Signale les points à faire valider avant un dépôt, sans prétendre à une recevabilité acquise.',
  }),
  parliament({
    id: 'suivi-proposition-loi', icon: '📜', title: 'Suivre un texte législatif',
    description: 'Une chronologie qui distingue discussion, adoption et entrée en vigueur.',
    questions: [text('texte', 'Quel texte faut-il suivre ?', 'Titre, numéro de document ou lien vers la fiche officielle.'), text('institution', 'Dans quelle institution ou quel pays ?', 'Ex. : Chambre des représentants de Belgique.'), period(), sources()],
    deliverables: 'Reconstitue la chronologie du texte, ses versions et amendements, les votes disponibles et le dernier état vérifiable. Prépare un tableau des prochaines étapes seulement lorsqu’elles sont officiellement annoncées et une liste des points de vigilance. Ne confonds pas adoption, publication et entrée en vigueur.',
  }),
  parliament({
    id: 'debats-amendements', icon: '🗣️', title: 'Analyser des débats et amendements',
    description: 'Relier les échanges, les modifications proposées et les votes connus.',
    questions: [text('dossier', 'Quel dossier ou quelle séance faut-il analyser ?', 'Numéro, titre, date ou lien officiel.'), text('enjeu', 'Quel enjeu voulez-vous comprendre ?', 'Ex. : les changements proposés à l’article sur le financement.'), select('angle', 'Quel résultat vous aiderait le plus ?', ['Une synthèse des débats', 'Un tableau comparatif des amendements', 'Les deux, avec une chronologie']), sources()],
    deliverables: 'Identifie les versions examinées, résume les arguments attribués et compare chaque amendement pertinent avec le texte de référence. Indique son auteur public, sa date, son sort et l’effet allégué ou observé, sans inventer un vote absent. Sépare le compte rendu des échanges de ton analyse.',
  }),
  parliament({
    id: 'comparatif-positions', icon: '⚖️', title: 'Comparer des positions publiques',
    description: 'Un comparatif équilibré, fondé sur des prises de position datées.',
    questions: [text('sujet', 'Sur quelle question comparer les positions ?', 'Ex. : le financement des transports publics.'), area('acteurs', 'Quels acteurs ou groupes faut-il comparer ?', 'Noms d’institutions, partis ou organisations ; aucun profil privé.'), period(), sources()],
    deliverables: 'Construis une grille commune de comparaison et une fiche par acteur à partir de sources publiques datées. Montre convergences, divergences, évolutions et absences de position documentée. Une absence de source ne signifie pas une absence d’opinion ; présente les limites de façon équilibrée.',
  }),
  research({
    id: 'cartographie-acteurs', icon: '🧭', title: 'Cartographier les acteurs d’un sujet',
    description: 'Comprendre les rôles institutionnels et les liens publics documentés.',
    questions: [text('sujet', 'Quel sujet ou secteur voulez-vous explorer ?', 'Ex. : la rénovation énergétique en Wallonie.'), text('zone', 'Quel territoire et quel périmètre ?', 'Institutions publiques, associations et organisations professionnelles, par exemple.'), select('angle', 'Quels liens souhaitez-vous éclairer ?', ['Compétences et responsabilités', 'Coopérations et financements publics', 'Une vue d’ensemble documentée']), sources()],
    deliverables: 'Livre une carte Mermaid et un tableau des acteurs avec rôle, compétence, liens publics établis et références. Distingue lien formel, déclaration de coopération et hypothèse. Limite les personnes citées à leur rôle public pertinent ; ne collecte ni coordonnées privées ni profils personnels.',
  }),
  parliament({
    id: 'note-audition', icon: '🎙️', title: 'Préparer une audition',
    description: 'Un dossier de séance et des questions ouvertes, sans réponses inventées.',
    questions: [text('objet', 'Quel est l’objet de l’audition ?', 'Ex. : évaluer la mise en œuvre d’un dispositif public.'), area('invites', 'Quels rôles ou organismes seront entendus ?', 'Uniquement les fonctions et organismes utiles à l’audition.'), text('duree', 'Quel temps de parole et quel objectif ?', 'Ex. : dix minutes pour clarifier les résultats et les limites.'), sources()],
    deliverables: 'Prépare une note de cadrage, les points factuels à confirmer, des questions ouvertes classées par thème et des relances. Appuie les questions sur les documents disponibles. Ne rédige pas de réponses supposées des personnes auditionnées et distingue les participants annoncés des suggestions.',
  }),
  research({
    id: 'dossier-thematique', icon: '📚', title: 'Constituer un dossier thématique',
    description: 'Une synthèse structurée, un lexique et une bibliographie vérifiable.',
    questions: [text('sujet', 'Quel sujet faut-il documenter ?', 'Ex. : l’accès aux soins dans les zones rurales.'), readership(), period(), sources()],
    deliverables: 'Livre une synthèse exécutive, une analyse organisée, un lexique, une chronologie si pertinente et une bibliographie annotée. Relie les affirmations à leurs sources et repère les controverses, lacunes documentaires et questions encore ouvertes.',
  }),
  parliament({
    id: 'recherche-union-europeenne', icon: '🇪🇺', title: 'Explorer un dossier européen',
    description: 'Relier Commission, Parlement, Conseil et textes officiels.',
    questions: [text('sujet', 'Quel dossier européen vous intéresse ?', 'Titre, thème, numéro de procédure ou référence EUR-Lex.'), select('angle', 'Quel angle voulez-vous explorer ?', ['Le parcours législatif', 'Les obligations et dates applicables', 'Les positions institutionnelles', 'Un panorama du dossier']), period(), sources()],
    deliverables: 'Recherche les références pertinentes dans EUR-Lex et les sources officielles des institutions européennes. Distingue proposition, règlement, directive, résolution et texte en vigueur. Indique les étapes connues, les dates d’application ou transposition vérifiées et les liens avec le niveau national sans les présumer.',
  }),
  research({
    id: 'archives-officielles', icon: '🗄️', title: 'Retrouver des archives officielles',
    description: 'Des références retrouvables et un relevé des pièces encore manquantes.',
    questions: [text('objet', 'Quel document ou événement recherchez-vous ?', 'Titre approximatif, auteur public, institution ou mots-clés.'), text('fonds', 'Quels fonds, institutions ou pays ?', 'Ex. : archives parlementaires et journal officiel belge.'), period(), sources()],
    deliverables: 'Prépare un inventaire des pièces retrouvées avec cote, titre, date, institution, lien et conditions d’accès connues. Explique la stratégie de recherche et distingue document consulté, simple notice de catalogue et pièce non retrouvée. Ne prétends jamais avoir lu une archive inaccessible.',
  }),
  research({
    id: 'collecte-multisources', icon: '🔗', title: 'Croiser plusieurs sources',
    description: 'Une matrice des faits, des contradictions et du niveau de preuve.',
    questions: [text('question', 'Quelle affirmation ou question voulez-vous examiner ?', 'Formulez une question précise et vérifiable.'), area('pistes', 'Quelles versions ou sources faut-il confronter ?', 'Collez les liens ou résumez les affirmations à comparer.'), select('sortie', 'Quel résultat attendez-vous ?', ['Une vérification factuelle', 'Une synthèse de plusieurs points de vue', 'Un tableau des accords et contradictions']), period()],
    deliverables: 'Établis une matrice affirmation/source avec origine, date, méthode, indépendance et limites de preuve. Remonte aux sources primaires et signale les reprises d’une même source. Classe les conclusions en établi, incertain ou non vérifiable, sans fausse équivalence ni conclusion forcée.',
  }),
  research({
    id: 'veille-thematique', icon: '🔭', title: 'Préparer une veille thématique',
    description: 'Un premier état des lieux et une méthode pour les prochains relevés.',
    questions: [text('sujet', 'Quel sujet voulez-vous suivre ?', 'Ex. : les appels à projets culturels dans ma région.'), area('perimetre', 'Quelles langues, zones et sources faut-il couvrir ?', 'Précisez les exclusions et les sources prioritaires.'), select('rythme', 'Quel rythme de mise à jour envisagez-vous ?', ['Chaque semaine', 'Chaque mois', 'À chaque nouvelle étape officielle']), sources()],
    deliverables: 'Livre un premier relevé daté, un registre de sources, des requêtes réutilisables et une grille de suivi avec critères de pertinence. Propose un rythme de contrôle et des règles de dédoublonnage. Il s’agit d’un état des lieux et d’un protocole : ne prétends pas qu’une surveillance ou des notifications automatiques sont activées.',
  }),

  writing({
    id: 'ecrire-roman', icon: '📖', title: 'Commencer un roman',
    description: 'Une intrigue, une structure et une première partie à développer.',
    questions: [area('idee', 'Quelle histoire avez-vous envie de raconter ?', 'Le point de départ, le conflit et ce qui vous attire dans cette histoire.'), text('genre', 'Quel genre, quels lecteurs et quelle ambiance ?', 'Ex. : un mystère chaleureux pour adultes, dans une ville imaginaire.'), writingScope(), writingRights()],
    deliverables: 'Propose une prémisse, les enjeux, un synopsis avec la fin, les arcs des personnages et un plan de chapitres. Rédige seulement l’extrait ou le chapitre pilote demandé, puis un programme de travail avec étapes de validation. Signale les choix encore ouverts.',
  }),
  writing({
    id: 'ecrire-nouvelles', icon: '🪶', title: 'Écrire une nouvelle',
    description: 'Un récit court original, construit autour d’un effet précis.',
    questions: [area('idee', 'Quel point de départ voulez-vous explorer ?', 'Une rencontre, un dilemme, un lieu ou une image.'), text('lecteurs', 'Pour quels lecteurs et quelle émotion finale ?', 'Ex. : des adultes, avec une chute douce-amère.'), select('format', 'Quel format souhaitez-vous travailler ?', ['Une nouvelle courte de 800 à 1 200 mots', 'Le plan d’un recueil et une première nouvelle', 'La réécriture d’une nouvelle fournie']), writingRights()],
    deliverables: 'Définis le point de vue, la tension et la progression. Selon le format choisi, livre une nouvelle courte complète, ou un plan de recueil et une première nouvelle, ou une réécriture accompagnée des choix éditoriaux. Vérifie la cohérence, les transitions et la force de la fin.',
  }),
  writing({
    id: 'ecrire-essai', icon: '💭', title: 'Construire un essai',
    description: 'Une thèse, des objections et une première section argumentée.',
    questions: [text('these', 'Quelle idée voulez-vous défendre ou explorer ?', 'Formulez votre question et votre point de vue de départ.'), readership(), area('arguments', 'Quels arguments et documents avez-vous déjà ?', 'Vos notes, références et objections à prendre au sérieux.'), writingScope()],
    deliverables: 'Formule une problématique, distingue thèse et hypothèses, construis un plan argumenté et traite les principales objections de bonne foi. Rédige une première section sourcée et propose les étapes suivantes. Identifie les affirmations qui nécessitent une recherche complémentaire.',
    research: true,
  }),
  writing({
    id: 'biographie-autorisee', icon: '👤', title: 'Préparer une biographie autorisée',
    description: 'Une trame respectueuse, fondée sur les matériaux et accords disponibles.',
    questions: [area('sujet', 'De qui racontez-vous le parcours et avec quelle autorisation ?', 'Précisez votre lien, le périmètre de l’accord et les sujets exclus, sans joindre de justificatifs personnels.'), readership(), area('chronologie', 'Quels événements et témoignages sont établis ?', 'Distinguez vos souvenirs, les témoignages autorisés et les sources publiques.'), writingRights()],
    deliverables: 'Livre une chronologie annotée, un plan, une courte première section et une liste de vérifications ou questions d’entretien à faire valider. N’invente ni dialogue, ni souvenir, ni consentement. Marque les informations sensibles ou contradictoires à confirmer et les limites de l’autorisation déclarée.',
  }),
  writing({
    id: 'livre-pratique', icon: '🧰', title: 'Concevoir un livre pratique',
    description: 'Un parcours clair, des exemples et un premier chapitre utile.',
    questions: [text('sujet', 'Quel savoir-faire voulez-vous transmettre ?', 'Ex. : créer un potager sur un petit balcon.'), readership(), area('resultats', 'Que devra savoir faire le lecteur ?', 'Trois compétences concrètes et les limites du sujet.'), writingScope()],
    deliverables: 'Prépare la promesse éditoriale sans résultat garanti, un sommaire progressif et les exercices ou fiches utiles. Rédige un premier chapitre avec exemple et liste de vérification. Identifie les points techniques à sourcer et propose une rédaction par étapes.',
  }),
  writing({
    id: 'livre-jeunesse', icon: '🧸', title: 'Imaginer un livre jeunesse',
    description: 'Une histoire adaptée à l’âge et des intentions d’illustration originales.',
    questions: [text('age', 'À quel âge et à quel mode de lecture pensez-vous ?', 'Ex. : 5 à 7 ans, lecture accompagnée par un adulte.'), area('histoire', 'Quelle aventure ou émotion voulez-vous partager ?', 'Le personnage principal, son envie et la découverte à la fin.'), select('format', 'Quel type de livre souhaitez-vous préparer ?', ['Un album court avec découpage en doubles pages', 'Un petit roman avec un chapitre pilote', 'Un conte court à lire à voix haute']), writingRights()],
    deliverables: 'Propose un concept, un vocabulaire adapté à l’âge, un découpage et des intentions d’illustration originales. Rédige un conte court ou les premières doubles pages, ou un chapitre pilote selon le format. Ne présente pas des intentions de dessin comme des images déjà produites.',
  }),
  writing({
    id: 'plan-livre', icon: '🗂️', title: 'Structurer mon livre',
    description: 'Un sommaire solide et un calendrier de rédaction par étapes.',
    questions: [text('concept', 'Quel est le sujet et la promesse du livre ?', 'Ce que le lecteur viendra chercher et ce qui rend ce projet particulier.'), readership(), area('matiere', 'Quelle matière avez-vous déjà ?', 'Notes, scènes, recherches, chapitres ou idées encore dispersées.'), select('structure', 'Quel type de structure recherchez-vous ?', ['Un récit de fiction', 'Un essai ou un document', 'Un guide pratique', 'À déterminer ensemble'])],
    deliverables: 'Établis un diagnostic de la matière fournie, un angle éditorial et un sommaire détaillé. Pour chaque chapitre, donne son rôle, les éléments disponibles, les recherches manquantes et un critère de validation. Ajoute une courte ouverture possible et un calendrier réaliste sans rédiger tout le livre.',
  }),
  writing({
    id: 'personnages-univers', icon: '🌍', title: 'Créer mes personnages et mon univers',
    description: 'Une bible cohérente pour écrire sans perdre le fil.',
    questions: [area('univers', 'Quel monde et quelles règles imaginez-vous ?', 'Époque, lieux, limites et ce qui diffère de notre quotidien.'), area('personnages', 'Quels personnages et quels conflits avez-vous déjà ?', 'Leurs envies, leurs liens et ce qui pourrait les faire évoluer.'), text('ton', 'Quel genre et quel ton souhaitez-vous ?', 'Ex. : aventure lumineuse, fantastique intime ou comédie familiale.'), writingRights()],
    deliverables: 'Livre une bible d’univers, des fiches de personnages avec motivations et contradictions, une carte de leurs relations et les règles de continuité. Distingue les éléments fournis des propositions. Ajoute une courte scène originale qui met les règles à l’épreuve, pas un roman complet.',
  }),
  writing({
    id: 'chapitre-pilote', icon: '✍️', title: 'Rédiger un chapitre pilote',
    description: 'Tester une voix narrative avant de poursuivre le manuscrit.',
    questions: [area('situation', 'Que doit-il se passer dans ce chapitre ?', 'Situation de départ, personnage, conflit et point d’arrivée souhaité.'), text('narration', 'Quel point de vue et quel temps de narration ?', 'Ex. : première personne au présent, ou proposez une option cohérente.'), text('lecteurs', 'Quels lecteurs, quel ton et quelle longueur cible ?', 'Un chapitre pilote raisonnable, par exemple 1 200 mots.'), writingRights()],
    deliverables: 'Présente brièvement les choix narratifs, puis rédige un seul chapitre pilote original. Vérifie point de vue, temporalité, rythme et cohérence avec les éléments fournis. Termine par quelques questions de validation et un plan de suite, sans écrire le reste du livre.',
  }),
  writing({
    id: 'revision-manuscrit', icon: '🛠️', title: 'Réviser mon manuscrit',
    description: 'Un diagnostic éditorial et une révision suivie d’un extrait.',
    questions: [area('texte', 'Quel extrait autorisé voulez-vous travailler ?', 'Collez un extrait court ou indiquez le chemin de votre manuscrit.'), select('priorite', 'Quelle est votre priorité de révision ?', ['Structure et progression', 'Personnages et cohérence', 'Clarté et rythme des phrases', 'Un diagnostic général avant réécriture']), text('intention', 'Quelle intention et quelle voix faut-il préserver ?', 'Le public, le ton et ce que vous ne souhaitez pas changer.'), text('perimetre', 'Quelle partie faut-il traiter en premier ?', 'Ex. : le premier chapitre ; le reste sera planifié par étapes.')],
    deliverables: 'Livre un diagnostic hiérarchisé avec exemples, un plan de révision et une version proposée du seul extrait prioritaire. Explique les modifications et distingue correction nécessaire et choix de goût. Préserve l’original et n’affirme pas avoir révisé les parties non traitées.',
  }),
  writing({
    id: 'relecture-correction', icon: '✅', title: 'Relire et corriger un texte',
    description: 'Corriger avec mesure et expliquer les changements importants.',
    questions: [area('texte', 'Quel texte voulez-vous faire relire ?', 'Collez un texte que vous avez le droit d’utiliser ou son chemin local.'), select('niveau', 'Quel niveau d’intervention acceptez-vous ?', ['Orthographe et grammaire uniquement', 'Corrections et fluidité légère', 'Réécriture expliquée en préservant le sens']), text('usage', 'À qui s’adresse le texte et dans quelle langue ?', 'Ex. : un courrier professionnel en français de Belgique.'), area('contraintes', 'Quels termes ou formulations faut-il conserver ?', 'Noms validés, vocabulaire métier ou préférence de ton.', false)],
    deliverables: 'Fournis le texte corrigé, un relevé des changements importants et les passages ambigus à faire valider. Ne change pas les faits ou les engagements sans le signaler. Si le texte est trop long, traite un extrait annoncé et propose un découpage pour la suite.',
  }),
  writing({
    id: 'dossier-editeur', icon: '📬', title: 'Préparer un dossier pour un éditeur',
    description: 'Un synopsis, une note d’intention et une lettre à personnaliser.',
    questions: [text('livre', 'Quel livre souhaitez-vous présenter ?', 'Genre, sujet, longueur prévue et état réel du manuscrit.'), area('resume', 'Quel est le récit ou l’argument complet ?', 'Incluez la fin si c’est une fiction ; une note d’éditeur n’est pas un texte de suspense.'), text('destination', 'Quel lectorat et quelle ligne éditoriale visez-vous ?', 'Une collection ou un type de maison ; aucun envoi automatique.'), writingRights()],
    deliverables: 'Prépare un pitch, un synopsis complet, une note d’intention et une lettre personnalisable. Ajoute une présentation d’auteur limitée aux faits fournis et une liste de pièces à vérifier selon les consignes publiques de la maison ciblée. Ne prétends ni à une soumission effectuée ni à un accord éditorial.',
  }),

  template({
    id: 'dossier-presse', icon: '📰', category: 'communication', title: 'Préparer un dossier de presse',
    description: 'Les faits essentiels, des angles utiles et des supports prêts à relire.',
    questions: [text('actualite', 'Quelle actualité souhaitez-vous présenter ?', 'Ex. : l’ouverture d’un lieu culturel ou le lancement d’un projet.'), text('public', 'Quels médias ou publics sont concernés ?', 'Types de médias et territoire, sans liste de contacts privés.'), area('faits', 'Quels faits, chiffres et citations sont confirmés ?', 'Noms publics autorisés, dates validées et sources des chiffres.'), sources()],
    deliverables: 'Livre un dossier de presse structuré, un communiqué court, une fiche de faits et des questions-réponses. Identifie les illustrations ou autorisations encore nécessaires. Les citations non fournies restent des propositions à valider ; ne crée pas de propos attribués ni de liste de coordonnées privées.',
  }),
  template({
    id: 'discours', icon: '🎤', category: 'communication', title: 'Rédiger un discours',
    description: 'Une prise de parole structurée, naturelle et adaptée à l’occasion.',
    questions: [text('occasion', 'Pour quelle occasion prenez-vous la parole ?', 'Ex. : l’anniversaire d’une association ou une présentation de projet.'), text('public', 'À qui vous adressez-vous et dans quel rôle ?', 'Le public attendu et votre lien avec lui.'), text('duree', 'Quelle durée et quel message principal ?', 'Ex. : cinq minutes pour remercier et ouvrir une nouvelle étape.'), area('faits', 'Quels souvenirs et faits pouvez-vous utiliser ?', 'Seulement les anecdotes autorisées et les informations confirmées.')],
    deliverables: 'Prépare un plan minuté, un discours oral complet, des indications de respiration discrètes et une version courte. Calibre la longueur à la durée, préserve la voix de l’orateur et n’invente ni anecdote personnelle ni citation attribuée.',
  }),
  research({
    id: 'lettre-thematique', icon: '📨', category: 'communication', title: 'Créer une lettre d’information thématique',
    description: 'Sélectionner des informations fiables et expliquer leur intérêt.',
    questions: [text('theme', 'Quel thème et quelle période pour cette édition ?', 'Ex. : les nouveautés culturelles du mois dans ma région.'), readership(), select('format', 'Quel format de lecture préférez-vous ?', ['Trois informations commentées', 'Cinq brèves et un dossier court', 'Une synthèse avec des liens pour approfondir']), sources()],
    deliverables: 'Prépare une ligne éditoriale, une sélection datée d’informations et le texte d’une édition complète avec liens sources. Explique le critère de sélection et distingue information, commentaire et élément sponsorisé éventuel. Prépare un brouillon seulement, sans collecte d’abonnés ni envoi.',
  }),
  research({
    id: 'rapport-annuel', icon: '📊', category: 'organisation', title: 'Construire un rapport annuel',
    description: 'Mettre en récit une année d’activité avec des chiffres traçables.',
    questions: [text('structure', 'Quelle structure et quel exercice faut-il présenter ?', 'Ex. : une association, pour l’année 2025.'), readership(), area('bilan', 'Quelles réalisations et données sont confirmées ?', 'Activités, résultats, limites et chiffres dont vous pouvez préciser l’origine.'), sources()],
    deliverables: 'Propose un sommaire, un rapport narratif à partir des éléments fournis et des tableaux d’indicateurs avec méthode de calcul. Signale les trous et incohérences. N’invente aucun compte, résultat ou certification et ne présente pas le document comme des comptes approuvés ou audités.',
  }),
  template({
    id: 'traduction-adaptation', icon: '🌐', category: 'writing', title: 'Traduire et adapter un texte',
    description: 'Une traduction contextualisée avec les choix de vocabulaire expliqués.',
    questions: [area('texte', 'Quel texte autorisé faut-il traduire ?', 'Collez un extrait ou indiquez le chemin du document et sa langue source.'), text('langue', 'Vers quelle langue et quelle variante ?', 'Ex. : anglais britannique ou néerlandais de Belgique.'), text('public', 'Pour quels lecteurs et quel support ?', 'Ex. : une page de présentation destinée à un public non spécialiste.'), select('approche', 'Quel niveau d’adaptation souhaitez-vous ?', ['Fidélité proche du texte source', 'Formulation naturelle pour le public cible', 'Adaptation éditoriale avec changements expliqués'])],
    deliverables: 'Livre la traduction de l’extrait annoncé, un glossaire et les ambiguïtés à valider. Préserve noms, nombres et engagements, et signale les adaptations. N’affirme pas fournir une traduction jurée ou certifiée. Respecte les droits du texte fourni et traite les documents longs par sections.',
  }),
  research({
    id: 'benchmark-logiciels', icon: '💻', title: 'Comparer des logiciels',
    description: 'Une grille de choix reliée à vos usages, aux coûts et aux limites.',
    questions: [text('besoin', 'Quelle tâche le logiciel doit-il permettre ?', 'Ex. : gérer les projets d’une petite association.'), area('criteres', 'Quels critères sont indispensables ?', 'Budget, systèmes compatibles, langues, données locales, export et accessibilité.'), area('solutions', 'Quelles solutions voulez-vous comparer ?', 'Noms ou liens connus ; sinon, demandez une sélection argumentée.', false), text('contexte', 'Pour combien de personnes et quel contexte ?', 'Ex. : cinq bénévoles sur Mac et Windows, avec un budget annuel limité.')],
    deliverables: 'Construis une matrice de critères pondérés, compare les fonctionnalités et tarifs publics datés, l’export, les dépendances et limites. Utilise les documentations officielles et sépare les fonctions documentées des tests réellement effectués. Propose un choix motivé sans inscription ni achat et sans inventer de tarifs.',
  }),
  template({
    id: 'tutoriel', icon: '🧑‍🏫', category: 'organisation', title: 'Rédiger un tutoriel pas à pas',
    description: 'Un parcours vérifiable, avec prérequis et solutions aux erreurs fréquentes.',
    questions: [text('objectif', 'Que doit réussir le lecteur ?', 'Une tâche précise, avec un résultat observable.'), text('niveau', 'Quel est son niveau et son environnement ?', 'Ex. : débutant sur Mac, avec la version connue du logiciel.'), sources(), area('difficultes', 'Quels blocages ou précautions faut-il expliquer ?', 'Ex. : préserver les fichiers originaux et prévoir un retour en arrière.', false)],
    deliverables: 'Livre prérequis, étapes numérotées, résultats attendus, erreurs fréquentes et une vérification finale. Base les détails techniques sur la documentation fournie ou officielle actuelle. Signale ce qui a réellement été essayé et les étapes non vérifiées ; ne simule pas des captures ou tests inexistants.',
    research: true,
  }),
  template({
    id: 'faq-documentee', icon: '💬', category: 'organisation', title: 'Rédiger une FAQ documentée',
    description: 'Des réponses cohérentes qui renvoient aux bonnes sources.',
    questions: [text('sujet', 'Quel service, projet ou sujet faut-il expliquer ?', 'Ex. : le fonctionnement d’un espace associatif partagé.'), readership(), area('questions', 'Quelles questions faut-il traiter ?', 'Questions réelles anonymisées ou thèmes à couvrir.'), sources()],
    deliverables: 'Organise une FAQ par thèmes, rédige des réponses courtes puis détaillées et associe chaque règle aux documents fournis. Ajoute un tableau question/source/date de validation et les points à confirmer. N’invente pas de tarifs, délais, garanties ou politique applicable.',
  }),
  template({
    id: 'cahier-charges', icon: '📝', category: 'software', title: 'Écrire un cahier des charges',
    description: 'Définir le besoin et les critères de réussite avant de construire.',
    questions: [area('besoin', 'Quel problème et quels utilisateurs faut-il servir ?', 'Décrivez les situations concrètes, pas seulement une liste d’écrans.'), area('perimetre', 'Quelles fonctions sont indispensables ou exclues ?', 'Distinguez la première version et les évolutions possibles.'), text('contraintes', 'Quelles contraintes et ressources sont confirmées ?', 'Budget connu, délais souhaités, appareils, accessibilité et données.'), sources()],
    deliverables: 'Livre le contexte, les utilisateurs, les parcours, les exigences fonctionnelles et techniques, les exclusions et des critères d’acceptation vérifiables. Sépare impératifs, préférences et hypothèses. Ajoute risques, questions ouvertes et un premier découpage réalisable sans inventer d’engagement de budget ou de délai.',
  }),
  template({
    id: 'documentation-logiciel', icon: '📘', category: 'software', title: 'Documenter un logiciel',
    description: 'Expliquer l’installation, les usages et les limites réellement observées.',
    questions: [text('logiciel', 'Quel logiciel ou dépôt faut-il documenter ?', 'Lien public ou chemin local, version et branche si connues.'), select('public', 'À qui s’adresse la documentation ?', ['Aux utilisateurs', 'Aux personnes qui installent et administrent', 'Aux développeurs', 'Aux utilisateurs et aux développeurs']), area('parcours', 'Quels parcours faut-il expliquer en priorité ?', 'Ex. : installer, créer un projet, exporter les données et résoudre une erreur.'), sources()],
    deliverables: 'Examine les fichiers et références accessibles. Livre un guide de démarrage, les usages prioritaires, prérequis, configuration sans secrets, dépannage et limites. Cite la version examinée et distingue commandes vérifiées et propositions. N’invente aucune option ni fonctionnalité absente et ne copie pas de clés ou identifiants.',
  }),
  template({
    id: 'dossier-associatif', icon: '🤲', category: 'organisation', title: 'Préparer un dossier associatif',
    description: 'Présenter une action, ses moyens et son impact sans chiffres inventés.',
    questions: [text('association', 'Quelle association et quel projet présentez-vous ?', 'Objet, territoire et public concerné.'), text('destination', 'À qui le dossier est-il destiné ?', 'Ex. : un partenaire, un conseil d’administration ou un appel à projets précis.'), area('moyens', 'Quelles actions, ressources et données sont confirmées ?', 'Calendrier, équipe, budget connu et résultats observés.'), sources()],
    deliverables: 'Livre une présentation, les besoins, le plan d’action, les moyens fournis, les indicateurs et les pièces à réunir. Si un appel à projets est fourni, fais correspondre ses critères aux éléments disponibles. Ne prétends pas à une éligibilité, un financement ou un dépôt acquis ; n’invente ni budget ni bénéficiaires.',
  }),
  template({
    id: 'proposition-commerciale-detaillee', icon: '🤝', category: 'communication', title: 'Construire une proposition commerciale complète',
    description: 'Relier besoins, livrables, options et points de validation.',
    questions: [area('demande', 'Quel besoin client et quels résultats faut-il cadrer ?', 'Contexte, utilisateurs et résultats attendus sans garantie inventée.'), area('solution', 'Quelle solution et quels livrables proposez-vous ?', 'Distinguez le socle, les options et ce qui est hors périmètre.'), area('conditions', 'Quels prix, délais et conditions sont confirmés ?', 'Uniquement les montants et engagements validés ; sinon, notez « à chiffrer ».'), text('validation', 'Comment le client validera-t-il la proposition ?', 'Ex. : une réunion pour décider du périmètre et des critères de réception.')],
    deliverables: 'Prépare une proposition structurée, un tableau des livrables et exclusions, les options, hypothèses et critères de réception. Reprends uniquement les prix et conditions fournis ; marque les inconnues à confirmer. Ajoute un résumé et les prochaines validations, sans créer de contrat réputé signé ni envoyer la proposition.',
  }),
  design({
    id: 'creation-visuelle', icon: '🎨', title: 'Créer un visuel original',
    description: 'Un dessin vectoriel personnalisé, modifiable et prêt à adapter.',
    questions: [area('idee', 'Que doit raconter ce visuel ?', 'Votre message, le sujet à dessiner, le public et les textes exacts à inclure.'), visualFormat(), visualStyle(), visualRights()],
    deliverables: 'Propose deux directions visuelles brièvement expliquées, puis réalise une version cohérente de la direction la plus adaptée. Livre le SVG autonome, une prévisualisation HTML locale et une fiche pour modifier textes et couleurs. Distingue les propositions des éléments validés. Vérifie l’affichage, les débordements et la lisibilité à la taille demandée.',
  }),
  design({
    id: 'branding-kit', icon: '🪄', title: 'Créer un kit de marque',
    description: 'Couleurs, typographies et éléments visuels réunis dans une même direction.',
    questions: [text('marque', 'Quel nom et quelle signature faut-il utiliser ?', 'Les textes exacts confirmés ; signalez une signature encore à proposer.'), area('personnalite', 'Que fait la marque et quelle personnalité doit-elle avoir ?', 'Public, valeurs, ambiance et ce qui doit la distinguer.'), area('supports', 'Sur quels supports utiliserez-vous ce kit ?', 'Ex. : site, documents, réseaux sociaux et cartes de visite.'), visualRights()],
    deliverables: 'Livre une planche de direction artistique en HTML, une palette avec références, des choix typographiques avec alternatives système et des éléments SVG originaux réutilisables. Ajoute une signature graphique simple, ses variantes et trois exemples d’application. Présente les propositions comme des pistes à valider, sans garantie de disponibilité juridique de la marque.',
  }),
  design({
    id: 'affiche-evenement', icon: '🎟️', title: 'Dessiner une affiche d’événement',
    description: 'Hiérarchiser les informations et donner envie de participer.',
    questions: [area('evenement', 'Quelles informations de l’événement sont confirmées ?', 'Titre, date, heure, lieu, tarif et modalités ; les informations absentes resteront à confirmer.'), visualFormat(), visualStyle(), visualRights()],
    deliverables: 'Crée une affiche SVG originale avec titre, informations pratiques hiérarchisées et illustration vectorielle adaptée. Livre une prévisualisation HTML et une fiche des dimensions et marges. N’invente ni date, ni prix, ni logo de partenaire. Signale les vérifications de format, fond perdu et couleurs à faire avec l’imprimeur avant impression.',
  }),
  design({
    id: 'affiche-publicitaire', icon: '📣', title: 'Créer une affiche publicitaire',
    description: 'Un message clair, une composition originale et une action à proposer.',
    questions: [area('offre', 'Quelle offre et quel message pouvez-vous annoncer ?', 'Bénéfice vérifiable, textes, prix confirmé et action souhaitée du public.'), visualFormat(), visualStyle(), visualRights()],
    deliverables: 'Prépare deux pistes de composition puis réalise une affiche SVG autonome avec accroche, illustration originale et appel à l’action. Livre la source modifiable et une prévisualisation HTML. Reprends uniquement les prix et promesses confirmés. Les textes manquants sont des propositions visibles à valider ; aucune campagne n’est lancée.',
  }),
  design({
    id: 'logo-vectoriel', icon: '🔷', title: 'Concevoir un logo vectoriel',
    description: 'Des pistes originales et un logo SVG avec variantes simples.',
    questions: [text('nom', 'Quel nom exact et quelle signature doivent apparaître ?', 'Respectez l’orthographe de la marque ; la signature peut être facultative.'), area('identite', 'Que représente la marque et pour quel public ?', 'Activité, valeurs, impression souhaitée et symboles à éviter.'), select('forme', 'Quel type de logo souhaitez-vous explorer ?', ['Un nom dessiné ou composé avec soin', 'Un symbole et un nom', 'Un emblème simple', 'Proposez la forme adaptée']), visualRights()],
    deliverables: 'Crée trois pistes simples originales en SVG, justifie leur lisibilité puis développe la plus adaptée en couleur, monochrome et fond sombre. Fournis groupes modifiables, zone de protection indicative et test à petite taille. Distingue concept créatif et recherche d’antériorité : aucune disponibilité juridique n’est garantie.',
  }),
  design({
    id: 'illustration-vectorielle', icon: '🖍️', title: 'Dessiner une illustration vectorielle',
    description: 'Une scène originale en formes et couleurs faciles à modifier.',
    questions: [area('scene', 'Quelle scène voulez-vous illustrer ?', 'Personnages originaux, lieu, action et éléments à inclure ou éviter.'), visualFormat(), visualStyle(), visualRights()],
    deliverables: 'Compose une illustration originale en SVG avec groupes nommés, palette et composition lisible. Livre le fichier autonome, un aperçu HTML et une description textuelle de la scène. Les personnages, formes et décors doivent être originaux ; ne remplace pas une photographie demandée par un dessin en prétendant avoir produit une photo.',
  }),
  design({
    id: 'pack-reseaux-visuels', icon: '📱', title: 'Créer un pack de visuels sociaux',
    description: 'Trois compositions cohérentes pour une série de publications.',
    questions: [area('serie', 'Quel thème et quels textes pour cette série ?', 'Trois messages confirmés ou un thème à décliner avec des textes à valider.'), select('format', 'Quel format de publication souhaitez-vous ?', ['Instagram · portrait 1 080 × 1 350 px', 'Story · vertical 1 080 × 1 920 px', 'LinkedIn · paysage 1 200 × 627 px', 'Un format personnalisé à préciser dans le brief']), visualStyle(), visualRights()],
    deliverables: 'Livre trois visuels SVG distincts et cohérents dans le format demandé, avec textes éditables et une planche HTML locale. Explique comment les adapter, garder les marges et remplacer les textes. Ne publie rien et n’annonce pas un export bitmap qui n’a pas réellement été réalisé.',
  }),
  design({
    id: 'infographie', icon: '📊', title: 'Construire une infographie',
    description: 'Rendre une information compréhensible sans déformer les données.',
    questions: [area('donnees', 'Quelles données et sources autorisées faut-il représenter ?', 'Valeurs exactes, unités, période, liens et droits d’utilisation connus.'), text('message', 'Que doit comprendre le lecteur en premier ?', 'Le public, la question principale et le message à vérifier dans les données.'), visualFormat(), visualStyle()],
    deliverables: 'Vérifie les données fournies puis crée une infographie SVG avec titre, légende, unités, références et date. Ajoute une version textuelle accessible et le tableau des données en CSV. Respecte les échelles et distingue les données manquantes ; ne crée ni chiffres, ni sources, ni graphiques trompeurs.',
  }),
  design({
    id: 'presentation-produit', icon: '📦', title: 'Mettre un produit en valeur',
    description: 'Une fiche visuelle et une présentation locale aux informations confirmées.',
    questions: [area('produit', 'Quel produit et quelles caractéristiques sont confirmés ?', 'Nom, usages, bénéfices vérifiables, dimensions et prix si connus.'), text('public', 'À qui s’adresse cette présentation et pour quel usage ?', 'Ex. : une fiche de découverte pour de futurs clients.'), select('format', 'Quel support voulez-vous préparer ?', ['Une fiche produit illustrée', 'Une page web de présentation locale', 'Une planche de présentation pour un rendez-vous']), visualRights()],
    deliverables: 'Livre une fiche SVG claire et une présentation HTML locale avec hiérarchie des caractéristiques, usages et points à confirmer. Utilise des dessins schématiques originaux ou les images fournies autorisées, sans prétendre à une photographie du produit réel. Ne crée pas de faux avis, de certification ou de paiement fonctionnel.',
  }),
  design({
    id: 'icones-pictogrammes', icon: '✳️', title: 'Créer des icônes et pictogrammes',
    description: 'Une famille de petits signes cohérents, lisibles et réutilisables.',
    questions: [area('liste', 'Quels concepts les icônes doivent-elles représenter ?', 'Listez jusqu’à six concepts prioritaires et leur usage.'), select('style', 'Quel dessin convient à vos icônes ?', ['Traits fins et simples', 'Formes pleines et contrastées', 'Coins arrondis et aspect chaleureux', 'Une proposition adaptée à mon interface']), text('dimensions', 'Quelles tailles et contraintes faut-il respecter ?', 'Ex. : une grille de 24 × 24, lisible à 24 et 48 px, sur fond clair et sombre.'), visualRights()],
    deliverables: 'Livre jusqu’à six icônes SVG autonomes, une grille commune et une planche HTML avec labels accessibles. Harmonise épaisseurs, marges et angles ; vérifie chaque signe à petite taille. Fournis une fiche de couleurs et d’intégration, sans dépendance à une police d’icônes ou à un service externe.',
  }),
  design({
    id: 'couverture-livre', icon: '📕', title: 'Imaginer une couverture de livre',
    description: 'Une direction graphique originale qui rend le titre et le genre lisibles.',
    questions: [text('texte', 'Quels titre, sous-titre et nom d’auteur faut-il afficher ?', 'Uniquement les textes et noms que vous êtes autorisé à utiliser.'), area('livre', 'Quel genre, quel lectorat et quelle ambiance ?', 'Résumez le livre, son ton et ce que la couverture doit suggérer sans tout raconter.'), text('format', 'Quel format de couverture et quelles mesures sont connus ?', 'Ex. : première de couverture 14 × 21 cm. Le dos demande les mesures confirmées par l’imprimeur.'), visualRights()],
    deliverables: 'Propose deux directions puis réalise une première de couverture SVG modifiable avec illustration originale et hiérarchie typographique. Livre une prévisualisation HTML. Ne calcule pas un dos de livre sans les caractéristiques confirmées du papier et du nombre de pages ; signale les vérifications d’impression encore nécessaires.',
  }),
  design({
    id: 'banniere-web', icon: '🖥️', title: 'Dessiner une bannière web',
    description: 'Une composition adaptable à l’ordinateur et au téléphone.',
    questions: [area('message', 'Quel message et quelle action faut-il mettre en avant ?', 'Textes confirmés, nom de marque et rôle de la bannière dans la page.'), text('dimensions', 'Où sera-t-elle affichée et dans quelles dimensions ?', 'Largeur ordinateur, espace disponible sur téléphone et marges à préserver.'), visualStyle(), visualRights()],
    deliverables: 'Livre une bannière SVG pour grand écran, une variante mobile et une page HTML responsive de démonstration. Garde les textes lisibles, les groupes éditables et la zone utile identifiable. Un bouton de démonstration ne doit pas prétendre effectuer une commande, un achat ou un envoi réel.',
  }),
];
