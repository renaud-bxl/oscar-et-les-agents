// Local phrases only: this module never fetches data or calls a language model.
const freeze = rows => Object.freeze(rows);
export const CHARACTER_LINE_BANKS = Object.freeze({
  fr: Object.freeze({
    oscar: freeze([
      "Une idée floue ? Parfait. J’ai un tableau blanc et beaucoup de bonne volonté.",
      "Les bonnes idées entrent sans rendez-vous. Les réunions de trois heures attendent dehors.",
      "Je peux transformer votre « et si… » en premières étapes. C’est ma petite spécialité.",
      "Un projet ambitieux ? Je vais chercher des talents, pas une excuse.",
      "Je délègue les tâches. Pour le gâteau d’anniversaire, je supervise personnellement.",
      "Il y a cinq métiers ici et au moins vingt opinions sur la meilleure police de caractères.",
      "Vous apportez l’idée. Je m’occupe de trouver qui aime les tableaux Excel.",
      "Un objectif clair, c’est mon GPS. Il ne dit jamais « faites demi-tour au prochain café ».",
      "Le bouton parfait n’existe pas encore. Un premier essai bien pensé, si.",
      "Les contraintes font partie du brief. Même « il faut que ce soit joli ». Surtout celle-là.",
      "On peut commencer petit. Les grandes aventures aussi avaient un premier dossier.",
      "Je ne valide pas un travail parce qu’il porte une jolie cravate. Je le relis.",
      "Ma porte est ouverte. Sauf quand Moka a décidé que c’était sa porte.",
      "Une recherche, un livre, un logiciel ? Mon tableau blanc a de la place.",
      "Une bonne source vaut mieux que quinze « je crois que ». Le chat n’est pas une source.",
      "Un exemple de votre style m’aiderait. Je préfère votre signature à celle du hasard.",
      "On peut demander une première version. Les brouillons ont le droit d’avoir les cheveux en bataille.",
      "Je crois au travail d’équipe. Surtout quand quelqu’un sait enfin où est le fichier final.",
      "Le dernier fichier nommé « final-vraiment-final » mérite parfois une dernière relecture.",
      "Un projet sans étape, c’est une armoire sans étagères. Tout finit par terre.",
      "Vous pouvez me dire « je ne sais pas par où commencer ». C’est déjà un début.",
      "Je sais faire un plan B. Mais d’abord, donnons une vraie chance au plan A.",
      "Moka supervise le confort. Moi, je supervise ce que l’équipe vous remet.",
      "Votre prochaine idée a peut-être juste besoin d’un bureau et d’un peu d’élan.",
    ]),
    zoe: freeze([
      "Votre liste de choses à faire a-t-elle encore invité des amis pendant la nuit ?",
      "On peut ranger vos priorités. Je garde un tiroir pour les « juste une petite question ».",
      "Une demande libre ? Allez-y. Mes lunettes sont prêtes, et mon agenda ne juge pas.",
      "Je peux préparer une synthèse de vos mails. Les newsletters ne présideront pas la réunion.",
      "Un rendez-vous a besoin d’une date. « Un de ces quatre » me complique un peu le classement.",
      "Une pizzeria, un itinéraire, une idée de sortie ? Donnez-moi le lieu et vos envies.",
      "Je peux trier l’urgent, l’important et le « on me relance depuis lundi ».",
      "Le secret d’une bonne journée ? Une priorité claire. Et savoir où sont ses clés.",
      "Votre agenda mérite de respirer. Il n’a pas postulé pour devenir un Tetris.",
      "On peut préparer demain. Votre vous du futur vous fera peut-être un petit signe de tête.",
      "Je prépare les propositions. Vous gardez le dernier mot, et le point d’exclamation.",
      "J’aime les demandes précises. Mais « aidez-moi à m’organiser » est un très bon départ.",
      "Un service connecté pour vos mails ; une simple question pour le reste. Je m’adapte.",
      "Les réponses que je prépare restent à relire. Même les formules de politesse ont droit à un contrôle.",
      "Une routine bien choisie, c’est une chose de moins à garder dans un coin de sa tête.",
      "Vos priorités peuvent changer. L’agenda ne prend pas ça personnellement.",
      "Vous cherchez un document ? Donnez-moi une piste. « Celui avec le truc » en est presque une.",
      "Une liste courte vaut parfois mieux qu’un roman de choses à faire. Sauf si vous écrivez un roman.",
      "Je peux faire le point sans envoyer le moindre message. Les boutons attendront votre feu vert.",
      "Un rendez-vous, un courrier, une question pratique : dites-moi ce qui vous encombre l’esprit.",
      "Un créneau libre est un créneau libre. Il n’est pas obligé de devenir une réunion.",
      "Je garde les idées au propre. Pour le rangement de votre bureau, Moka a déjà un avis.",
      "Dites-moi ce qui compte aujourd’hui. On laissera les douze fausses urgences patienter.",
      "Je peux préparer une prochaine étape simple. La montagne peut attendre qu’on ait trouvé les chaussures.",
    ]),
  }),
  en: Object.freeze({
    oscar: freeze([
      "A hazy idea? Perfect. I have a whiteboard and plenty of good intentions.",
      "Good ideas can walk right in. Three-hour meetings can wait outside.",
      "I can turn your “what if…” into first steps. It is a little speciality of mine.",
      "An ambitious project? I will look for talent, not an excuse.",
      "I delegate tasks. Birthday cake quality control stays with me.",
      "Five professions here, and at least twenty opinions on the best typeface.",
      "You bring the idea. I find the person who actually enjoys spreadsheets.",
      "A clear goal is my GPS. It never says “turn back at the next coffee machine”.",
      "The perfect button may take a while. A thoughtful first version can start sooner.",
      "Constraints belong in the brief. Especially “please make it look good”.",
      "We can start small. Even great adventures began with a first folder.",
      "A smart tie will not get a draft approved. I still read it.",
      "My door is open. Unless Moka has decided it is his door.",
      "Research, a book or some software? There is room on my whiteboard.",
      "One good source beats fifteen “I think so” claims. The cat is not a source.",
      "An example of your style would help. I prefer your signature to a random guess.",
      "We can begin with a draft. Drafts are allowed to have messy hair.",
      "I believe in teamwork. Especially when someone knows where the final file went.",
      "A file called “final-really-final” may still deserve one last read.",
      "A project without steps is a cupboard without shelves. Everything ends up on the floor.",
      "You can say “I do not know where to start”. That is already a start.",
      "I can make a plan B. First, let us give plan A a proper chance.",
      "Moka supervises comfort. I supervise what the team delivers to you.",
      "Your next idea might only need a desk and a little momentum.",
    ]),
    zoe: freeze([
      "Has your to-do list invited more friends over during the night?",
      "We can sort your priorities. I keep a drawer for “just one tiny question”.",
      "An open question? Go ahead. My glasses are ready and my calendar will not judge.",
      "I can prepare an email summary. Newsletters will not be chairing the meeting.",
      "An appointment needs a date. “One of these days” is a little harder to file.",
      "A pizzeria, a route or a day out? Tell me the area and what you fancy.",
      "I can separate urgent, important and “they have been chasing me since Monday”.",
      "A good day starts with a clear priority. And knowing where your keys are.",
      "Your calendar needs breathing room. It did not apply to become Tetris.",
      "We can prepare tomorrow. Your future self might give you a grateful nod.",
      "I prepare the suggestions. You keep the final word and the exclamation mark.",
      "I like clear requests. But “help me get organised” is a very good start.",
      "A connected service for your email; a plain question for other things. I can adapt.",
      "My suggested replies stay for you to review. Even polite greetings deserve a check.",
      "A useful routine means one less thing taking up space in your head.",
      "Your priorities can change. Your calendar will not take it personally.",
      "Looking for a document? Give me a clue. “The one with the thing” almost counts.",
      "A short list can beat a novel of tasks. Unless writing a novel is your task.",
      "I can prepare an overview without sending a message. The buttons can wait for your go-ahead.",
      "An appointment, a letter or a practical question: tell me what is on your mind.",
      "A free slot is allowed to stay free. It does not have to become a meeting.",
      "I keep ideas tidy. Moka already has opinions on tidying your desk.",
      "Tell me what matters today. The twelve pretend emergencies can wait.",
      "I can prepare a simple next step. The mountain can wait until we find the shoes.",
    ]),
  }),
  nl: Object.freeze({
    oscar: freeze([
      "Een vaag idee? Prima. Ik heb een whiteboard en een flinke portie goede wil.",
      "Goede ideeën mogen zo binnenlopen. Vergaderingen van drie uur wachten buiten.",
      "Ik maak van je “wat als…” concrete eerste stappen. Dat is een kleine specialiteit van me.",
      "Een ambitieus project? Ik zoek talent, geen uitvlucht.",
      "Ik verdeel de taken. De kwaliteitscontrole van verjaardagstaart houd ik zelf.",
      "Vijf vakgebieden hier, en minstens twintig meningen over het beste lettertype.",
      "Jij brengt het idee. Ik zoek degene die echt blij wordt van spreadsheets.",
      "Een duidelijk doel is mijn gps. Die zegt nooit “keer om bij de volgende koffiemachine”.",
      "De perfecte knop vraagt misschien wat tijd. Een doordachte eerste versie kan al eerder.",
      "Randvoorwaarden horen in de briefing. Vooral “maak het alsjeblieft mooi”.",
      "We kunnen klein beginnen. Ook grote avonturen begonnen met een eerste map.",
      "Een mooie stropdas maakt een ontwerp niet goed. Ik lees het nog steeds na.",
      "Mijn deur staat open. Tenzij Moka heeft besloten dat het zijn deur is.",
      "Onderzoek, een boek of software? Mijn whiteboard heeft nog plaats.",
      "Eén goede bron is beter dan vijftien keer “ik denk het”. De kat telt niet als bron.",
      "Een voorbeeld van je stijl zou helpen. Ik kies liever jouw handtekening dan zomaar iets.",
      "We kunnen met een concept beginnen. Concepten mogen best een warrig kapsel hebben.",
      "Ik geloof in teamwork. Vooral als iemand weet waar het definitieve bestand staat.",
      "Een bestand met de naam “echt-definitief-nu” verdient soms nog één leesronde.",
      "Een project zonder stappen is een kast zonder planken. Alles belandt op de grond.",
      "Je mag zeggen “ik weet niet waar ik moet beginnen”. Dat is al een begin.",
      "Ik kan een plan B bedenken. Maar laten we plan A eerst een eerlijke kans geven.",
      "Moka houdt toezicht op het comfort. Ik kijk na wat het team aan jou oplevert.",
      "Je volgende idee heeft misschien alleen een bureau en een beetje vaart nodig.",
    ]),
    zoe: freeze([
      "Heeft je takenlijst vannacht weer nieuwe vrienden uitgenodigd?",
      "We kunnen je prioriteiten ordenen. Ik heb een lade voor “maar één klein vraagje”.",
      "Een vrije vraag? Ga je gang. Mijn bril staat klaar en mijn agenda oordeelt niet.",
      "Ik kan een overzicht van je mails maken. De nieuwsbrieven leiden de vergadering niet.",
      "Een afspraak heeft een datum nodig. “Een dezer dagen” is iets lastiger te archiveren.",
      "Een pizzeria, een route of een uitstapje? Vertel me waar en waar je zin in hebt.",
      "Ik kan dringend, belangrijk en “ze vragen er sinds maandag naar” uit elkaar halen.",
      "Een goede dag begint met één duidelijke prioriteit. En weten waar je sleutels zijn.",
      "Je agenda mag ademhalen. Die heeft niet gesolliciteerd om Tetris te worden.",
      "We kunnen morgen voorbereiden. Je toekomstige zelf knikt je misschien dankbaar toe.",
      "Ik bereid voorstellen voor. Jij houdt het laatste woord en het uitroepteken.",
      "Ik houd van duidelijke vragen. Maar “help me overzicht krijgen” is een prima begin.",
      "Een verbonden dienst voor je mail; een gewone vraag voor de rest. Ik pas me aan.",
      "Mijn voorgestelde antwoorden blijven voor jou ter controle. Ook beleefde groeten mogen even worden nagelezen.",
      "Een nuttige routine is één ding minder dat in je achterhoofd blijft rondspoken.",
      "Je prioriteiten mogen veranderen. Je agenda vat dat niet persoonlijk op.",
      "Zoek je een document? Geef me een aanwijzing. “Dat ene met dat ding” telt bijna.",
      "Een korte lijst is soms beter dan een roman vol taken. Tenzij je een roman schrijft.",
      "Ik kan een overzicht maken zonder iets te versturen. De knoppen wachten op jouw seintje.",
      "Een afspraak, een brief of een praktische vraag: vertel wat er door je hoofd speelt.",
      "Een vrij moment mag vrij blijven. Het hoeft geen vergadering te worden.",
      "Ik houd ideeën netjes. Over je bureau opruimen heeft Moka al een mening.",
      "Vertel wat vandaag telt. De twaalf zogenaamde spoedgevallen kunnen even wachten.",
      "Ik kan een eenvoudige volgende stap voorbereiden. De berg wacht wel tot we de schoenen hebben.",
    ]),
  }),
});

const languages = new Set(['fr', 'en', 'nl']);
const name = value => typeof value === 'string' ? value.replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) : '';
const stamp = value => typeof value === 'number' ? value : Date.parse(value);
export function dayPeriod(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  const hour = date.getHours();
  return hour >= 6 && hour < 12 ? 'morning' : hour >= 12 && hour < 18 ? 'afternoon' : hour >= 18 && hour < 22 ? 'evening' : 'night';
}
export function weatherContext(weather, now = Date.now()) {
  if (!weather || weather.status !== 'ready' || !Number.isFinite(now)) return null;
  const observed = stamp(weather.validAt ?? weather.observedAt), fetched = stamp(weather.fetchedAt);
  if (!Number.isFinite(observed) || !Number.isFinite(fetched) || fetched > now + 60000 || now - fetched > 2 * 3600000 || observed > now + 3600000 || now - observed > 3 * 3600000) return null;
  if (weather.validUntil !== undefined && (!Number.isFinite(stamp(weather.validUntil)) || stamp(weather.validUntil) <= now)) return null;
  if (weather.expiresAt !== undefined && (!Number.isFinite(stamp(weather.expiresAt)) || stamp(weather.expiresAt) <= now)) return null;
  if (typeof weather.code === 'string' && ['sun', 'cloud', 'rain', 'snow', 'thunder', 'fog'].includes(weather.code)) return { sun: 'clear', thunder: 'storm' }[weather.code] || weather.code;
  const code = Number(weather.code);
  if (!Number.isInteger(code)) return null;
  if (code === 0) return 'clear';
  if ([1, 2, 3].includes(code)) return 'cloud';
  if ([45, 48].includes(code)) return 'fog';
  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return 'rain';
  if ([71, 73, 75, 77, 85, 86].includes(code)) return 'snow';
  if ([95, 96, 99].includes(code)) return 'storm';
  return null;
}
const WEATHER = {
  fr: { clear: 'Les prévisions annoncent un ciel dégagé dans votre région.', cloud: 'Les prévisions annoncent des nuages dans votre région.', fog: 'Les prévisions annoncent du brouillard dans votre région.', rain: 'Les prévisions annoncent de la pluie dans votre région.', snow: 'Les prévisions annoncent des précipitations hivernales dans votre région.', storm: 'Les prévisions annoncent des orages dans votre région.' },
  en: { clear: 'The forecast indicates clear skies in your area.', cloud: 'The forecast indicates clouds in your area.', fog: 'The forecast indicates fog in your area.', rain: 'The forecast indicates rain in your area.', snow: 'The forecast indicates wintry precipitation in your area.', storm: 'The forecast indicates thunderstorms in your area.' },
  nl: { clear: 'De verwachting geeft een heldere hemel aan in je regio.', cloud: 'De verwachting geeft bewolking aan in je regio.', fog: 'De verwachting geeft mist aan in je regio.', rain: 'De verwachting geeft regen aan in je regio.', snow: 'De verwachting geeft winterse neerslag aan in je regio.', storm: 'De verwachting geeft onweer aan in je regio.' },
};
const CONTEXT_LINES = {
  "fr": {
    "oscar": {
      "night": [
        "À {time}, même mes graphiques portent un pyjama. On prépare quand même une belle idée ?",
        "Une idée à {time} ? D’accord. Je mets le tableau blanc en mode veilleuse.",
        "Le bureau est presque endormi. Vos idées, elles, ont encore les yeux grands ouverts.",
        "À cette heure-ci, les bonnes idées prennent l’ascenseur pour ne pas réveiller les voisins."
      ],
      "morning": [
        "Les idées arrivent en même temps que la lumière. On leur trouve une première étape ?",
        "Bonjour au projet du jour. Je lui ai gardé une place près du tableau blanc.",
        "Une matinée neuve et un tableau blanc propre : c’est presque intimidant.",
        "Le cerveau s’étire, le bureau aussi. Quelle idée fait sa rentrée ce matin ?"
      ],
      "evening": [
        "Les lampes prennent le relais. On peut encore éclaircir une bonne idée.",
        "Le soleil range son bureau. Moi, je peux vous aider à ranger votre projet.",
        "Une idée de fin de journée ? Elles aiment parfois faire une entrée remarquée.",
        "Le bureau passe en soirée. Les bonnes idées n’ont toujours pas trouvé le bouton sortie."
      ]
    },
    "zoe": {
      "night": [
        "Mon agenda allait se coucher. À {time}, il accepte encore les petites questions.",
        "Il est {time}. Mes lunettes tiennent bon ; les faux rendez-vous urgents peuvent dormir.",
        "Même les listes de choses à faire ont droit à un pyjama. On prépare juste la prochaine étape ?",
        "Le bureau chuchote. Je peux mettre les idées au propre sans réveiller tout l’immeuble."
      ],
      "morning": [
        "Votre journée vient d’ouvrir les yeux. On lui évite douze réunions d’un coup ?",
        "Bonjour aux priorités du jour. Les fausses urgences patientent dans le couloir.",
        "Une matinée, quelques vraies priorités et un agenda qui peut respirer. Beau programme.",
        "Les messages peuvent attendre une minute : commençons par ce qui compte pour vous."
      ],
      "evening": [
        "On peut préparer demain. Votre réveil n’en sera peut-être pas moins bruyant, mais votre liste sera plus claire.",
        "La journée retire sa cravate. On garde les bonnes idées pour demain ?",
        "Votre agenda a lui aussi fait sa journée. Je peux préparer la suite en douceur.",
        "Les lampes sont allumées. Il reste une petite place pour mettre de l’ordre dans les idées."
      ]
    }
  },
  "en": {
    "oscar": {
      "night": [
        "At {time}, even my charts are wearing pyjamas. Shall we give your idea a first step?",
        "An idea at {time}? All right. I will put the whiteboard into night-light mode.",
        "The office is nearly asleep. Your ideas still seem wide awake.",
        "At this hour, good ideas take the lift so they do not wake the neighbours."
      ],
      "morning": [
        "Ideas are arriving with the daylight. Shall we find them a first step?",
        "Hello to today’s project. I saved it a place by the whiteboard.",
        "A fresh morning and a clean whiteboard: almost intimidating.",
        "The brain is stretching and so is the office. Which idea is joining us this morning?"
      ],
      "evening": [
        "The lamps are taking over. We can still shed light on a good idea.",
        "The sun is clearing its desk. I can help you clear up your project.",
        "An end-of-day idea? They sometimes like to make a grand entrance.",
        "The office has switched to evening. Good ideas still cannot find the exit button."
      ]
    },
    "zoe": {
      "night": [
        "My calendar was heading to bed. At {time}, it can still handle a small question.",
        "It is {time}. My glasses are holding up; pretend emergencies can go to sleep.",
        "Even to-do lists deserve pyjamas. Shall we just prepare the next step?",
        "The office is whispering. I can tidy up ideas without waking the whole building."
      ],
      "morning": [
        "Your day has just opened its eyes. Shall we spare it twelve meetings at once?",
        "Hello to today’s priorities. Pretend emergencies can wait in the corridor.",
        "A morning, a few real priorities and a calendar with breathing room. A good start.",
        "Messages can wait a moment: let us begin with what matters to you."
      ],
      "evening": [
        "We can prepare tomorrow. Your alarm may still be loud, but your list will be clearer.",
        "The day is taking off its tie. Shall we save the good ideas for tomorrow?",
        "Your calendar has worked a full day too. I can prepare what comes next gently.",
        "The lamps are on. There is still a little room to put ideas in order."
      ]
    }
  },
  "nl": {
    "oscar": {
      "night": [
        "Om {time} dragen zelfs mijn grafieken een pyjama. Geven we je idee toch een eerste stap?",
        "Een idee om {time}? Goed. Ik zet het whiteboard op nachtlampstand.",
        "Het bureau slaapt bijna. Je ideeën zijn blijkbaar nog klaarwakker.",
        "Op dit uur nemen goede ideeën de lift om de buren niet wakker te maken."
      ],
      "morning": [
        "De ideeën komen tegelijk met het daglicht binnen. Geven we ze een eerste stap?",
        "Goedemorgen, project van vandaag. Ik heb een plaatsje bij het whiteboard vrijgehouden.",
        "Een nieuwe ochtend en een schoon whiteboard: bijna intimiderend.",
        "Het brein rekt zich uit en het bureau ook. Welk idee schuift deze ochtend aan?"
      ],
      "evening": [
        "De lampen nemen het over. We kunnen nog steeds licht op een goed idee werpen.",
        "De zon ruimt haar bureau op. Ik help je graag je project helder te krijgen.",
        "Een idee aan het einde van de dag? Die maken soms graag een opvallende entree.",
        "Het bureau schakelt over naar de avond. Goede ideeën kunnen de uitgang nog steeds niet vinden."
      ]
    },
    "zoe": {
      "night": [
        "Mijn agenda wilde net naar bed. Om {time} kan er nog wel een klein vraagje bij.",
        "Het is {time}. Mijn bril houdt stand; zogenaamde spoedgevallen mogen gaan slapen.",
        "Zelfs takenlijsten verdienen een pyjama. Bereiden we alleen de volgende stap voor?",
        "Het bureau fluistert. Ik kan ideeën ordenen zonder het hele gebouw wakker te maken."
      ],
      "morning": [
        "Je dag doet net zijn ogen open. Besparen we hem twaalf vergaderingen tegelijk?",
        "Goedemorgen, prioriteiten van vandaag. Zogenaamde spoedgevallen wachten even op de gang.",
        "Een ochtend, een paar echte prioriteiten en een agenda met ademruimte. Een mooi begin.",
        "Berichten kunnen even wachten: laten we beginnen bij wat voor jou telt."
      ],
      "evening": [
        "We kunnen morgen voorbereiden. Je wekker blijft misschien luid, maar je lijst wordt duidelijker.",
        "De dag doet zijn stropdas af. Bewaren we de goede ideeën voor morgen?",
        "Je agenda heeft ook een werkdag achter de rug. Ik kan het vervolg rustig voorbereiden.",
        "De lampen branden. Er is nog een beetje ruimte om orde in de ideeën te brengen."
      ]
    }
  }
};
const WEATHER_ASIDES = {
  "fr": {
    "oscar": {
      "clear": "Mes idées ont sorti les lunettes de soleil.",
      "cloud": "Le tableau blanc reste notre coin de ciel dégagé.",
      "fog": "Au moins, on peut garder les objectifs bien visibles.",
      "rain": "Les idées peuvent entrer sans parapluie.",
      "snow": "Le tableau blanc est assorti au programme.",
      "storm": "On peut faire un remue-méninges sans les éclairs."
    },
    "zoe": {
      "clear": "L’agenda peut garder un peu de place pour prendre l’air.",
      "cloud": "On peut quand même éclaircir les priorités.",
      "fog": "Je garde les priorités bien visibles, elles.",
      "rain": "Je peux mettre vos idées au sec dans une liste.",
      "snow": "Les rendez-vous n’ont pas encore demandé de moufles.",
      "storm": "Les fausses urgences peuvent éviter de faire du tonnerre."
    }
  },
  "en": {
    "oscar": {
      "clear": "My ideas have found their sunglasses.",
      "cloud": "The whiteboard can be our clear patch of sky.",
      "fog": "At least we can keep the goals in plain sight.",
      "rain": "Ideas can come in without an umbrella.",
      "snow": "The whiteboard is dressed for the occasion.",
      "storm": "We can brainstorm without the lightning."
    },
    "zoe": {
      "clear": "The calendar can leave a little room for fresh air.",
      "cloud": "We can still clear up your priorities.",
      "fog": "I can keep the priorities in plain sight.",
      "rain": "I can keep your ideas dry in a tidy list.",
      "snow": "The appointments have not requested mittens yet.",
      "storm": "Pretend emergencies can keep the thunder down."
    }
  },
  "nl": {
    "oscar": {
      "clear": "Mijn ideeën hebben hun zonnebril gevonden.",
      "cloud": "Het whiteboard kan ons stukje heldere hemel zijn.",
      "fog": "De doelen kunnen we gelukkig wel goed zichtbaar houden.",
      "rain": "Ideeën mogen zonder paraplu naar binnen.",
      "snow": "Het whiteboard past helemaal bij de gelegenheid.",
      "storm": "We kunnen brainstormen zonder bliksem."
    },
    "zoe": {
      "clear": "De agenda mag wat plaats vrijhouden om een luchtje te scheppen.",
      "cloud": "We kunnen je prioriteiten toch helder krijgen.",
      "fog": "De prioriteiten houd ik wel goed zichtbaar.",
      "rain": "Ik kan je ideeën drooghouden in een nette lijst.",
      "snow": "De afspraken hebben nog geen wanten aangevraagd.",
      "storm": "Zogenaamde spoedgevallen mogen hun gedonder even bewaren."
    }
  }
};
const HELLO = {
  fr: { morning: 'Bonjour', afternoon: 'Bonjour', evening: 'Bonsoir', night: 'Bonsoir' },
  en: { morning: 'Good morning', afternoon: 'Good afternoon', evening: 'Good evening', night: 'Hello' },
  nl: { morning: 'Goedemorgen', afternoon: 'Goedemiddag', evening: 'Goedenavond', night: 'Hallo' },
};

export class CharacterLines {
  constructor({ random = Math.random, now = () => new Date() } = {}) { this.random = random; this.now = now; this.bags = new Map(); this.previous = new Map(); }
  next(role, options = {}) {
    const character = role === 'secretaire' || role === 'secretary' ? 'zoe' : role;
    if (!['oscar', 'zoe'].includes(character)) return '';
    const locale = languages.has(options.locale) ? options.locale : 'fr';
    const lines = CHARACTER_LINE_BANKS[locale][character], key = `${locale}:${character}`;
    let bag = this.bags.get(key);
    if (!bag?.length) {
      bag = lines.map((_, index) => index);
      for (let index = bag.length - 1; index > 0; index--) { const draw = Math.min(1 - Number.EPSILON, Math.max(0, Number(this.random()) || 0)); const chosen = Math.floor(draw * (index + 1)); [bag[index], bag[chosen]] = [bag[chosen], bag[index]]; }
      if (bag[bag.length - 1] === this.previous.get(key)) [bag[0], bag[bag.length - 1]] = [bag[bag.length - 1], bag[0]];
      this.bags.set(key, bag);
    }
    const chosen = bag.pop(); this.previous.set(key, chosen);
    const date = options.now === undefined ? this.now() : options.now, instant = date instanceof Date ? date.getTime() : Number(date);
    const firstName = name(options.firstName ?? options.name), greeting = `${HELLO[locale][dayPeriod(date)]}${firstName ? `, ${firstName}` : ''}.`;
    const condition = weatherContext(options.weather, instant), period = dayPeriod(date);
    const context = CONTEXT_LINES[locale][character][period];
    const clock = Number.isFinite(instant) ? new Date(instant).toLocaleTimeString({fr:'fr-BE',en:'en-GB',nl:'nl-BE'}[locale],{hour:'2-digit',minute:'2-digit',hourCycle:'h23'}) : null;
    const phrase = context && chosen < context.length && clock ? context[chosen].replaceAll('{time}',clock) : lines[chosen];
    // Keep the weather explicitly framed as a forecast. Only a fresh, validated
    // forecast can add a weather joke; the drawing alone never supplies facts.
    const weatherLine = condition ? `${WEATHER[locale][condition]}${chosen % 3 === 0 ? ` ${WEATHER_ASIDES[locale][character][condition]}` : ''}` : null;
    return [greeting, ...(weatherLine ? [weatherLine] : []), phrase].join(' ').slice(0, 500);
  }
}
export default CharacterLines;
