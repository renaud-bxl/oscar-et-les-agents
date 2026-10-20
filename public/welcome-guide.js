const STORAGE_KEY = 'oscar-guide-v1';
const TEAM_SIZES = new Set(['4','8','12','15','20']);

export function withTeamPreference(prompt, size = 'auto') {
  const text = String(prompt).trim();
  if (size !== 'auto' && !TEAM_SIZES.has(String(size))) throw new Error('Choisissez un effectif proposé dans la liste.');
  const result = size === 'auto' ? text : `${text}\n\nÉquipe souhaitée : recrute ${size} spécialistes distincts pour cette mission, avec des contributions utiles et complémentaires. Répartis-les entre recherche, rédaction, code, design et analyse selon les besoins, sans dépasser quatre agents par métier et vingt agents au total. Chaque agent reçoit une tâche et des livrables propres. Jusqu’à quatre spécialistes travaillent simultanément ; Oscar relit et assemble leurs résultats.`;
  if (result.length > 16000) throw new Error('Le brief et la consigne d’équipe dépassent 16 000 caractères. Raccourcissez légèrement le brief : votre texte est conservé.');
  return result;
}

export const WELCOME_STEPS = [
  {title:'Bienvenue chez Oscar.',label:'Le principe',icon:'✦',subtitle:'Une idée entre. Toute une équipe se met en mouvement.',paragraphs:['Oscar est votre chef de projet. Vous lui racontez ce que vous voulez créer ; il prépare un plan, recrute les spécialistes et relit leurs résultats.','Les personnages reflètent le travail des agents. Les cafés et les petites conversations donnent vie au bureau.'],tags:['Un chef qui organise','Des agents qui créent','Des fichiers à garder']},
  {title:'Votre compte, votre équipe.',label:'La connexion',icon:'↗',subtitle:'Connectez ChatGPT ou Claude avec leur outil officiel.',paragraphs:['Choisissez votre moteur. S’il manque, Oscar prépare le programme officiel ; la connexion se poursuit dans votre navigateur avec votre compte habituel. Aucune clé API à saisir.','Un abonnement compatible et ses quotas sont nécessaires aux vraies missions. Vous pouvez aussi découvrir le bureau avec la démo gratuite en appels IA.']},
  {title:'Quel projet vous ferait plaisir ?',label:'Votre mission',icon:'◈',subtitle:'84 points de départ. Et toutes vos propres idées.',paragraphs:['Un site, un logiciel, un jeu vidéo, des réseaux sociaux, une étude de concurrents… Choisissez un modèle puis répondez aux petites questions.','Vous relisez et pouvez modifier le brief avant de le confier à Oscar. « Mon idée » permet aussi de partir d’une page blanche.','Le Studio commence par votre idée : décrivez le sujet, les textes et le style. Lancez une création avec votre abonnement ou choisissez une composition locale, puis ajustez le résultat et exportez-le en SVG ou en PNG.','Avec « Dicter ma demande », racontez votre idée au microphone. Vous relisez et corrigez le texte reconnu avant de lancer le travail. Le navigateur demande votre accord ; la saisie au clavier reste disponible.'],tags:['Logiciels & jeux','Communication','Recherche & analyse'],action:['catalog','Explorer les missions']},
  {title:'Une belle bande de talents.',label:'Les agents',icon:'☺',subtitle:'Cinq métiers, jusqu’à vingt spécialistes.',paragraphs:['Recherche, rédaction, code, design et analyse : chaque agent a son prénom, sa tâche et ses fichiers. Jusqu’à quatre personnes peuvent rejoindre un même îlot.','Dans le brief ou le questionnaire, choisissez un effectif souhaité : automatique, 4, 8, 12, 15 ou 20. Quatre agents au maximum travaillent en parallèle dans une mission. Plus d’agents utilise davantage votre abonnement.'],tags:['Oscar recrute','Chaque agent contribue','Oscar vérifie'],action:['team-example','Préparer un exemple avec 15 agents']},
  {title:'Une idée peut en cacher trois autres.',label:'Plusieurs bureaux',icon:'⊞',subtitle:'Jusqu’à quatre missions indépendantes en même temps.',paragraphs:['Dans « Mes missions », cliquez sur « Créer une autre mission » pendant que votre équipe travaille. Un nouvel onglet ou une nouvelle fenêtre accueille un autre Oscar et sa propre équipe.','Chaque bureau conserve son projet et son lien. Arrêter une mission laisse les autres continuer. Vous retrouvez les projets précédents dans l’historique.'],action:['history','Voir mes missions']},
  {title:'Suivez les idées jusqu’aux fichiers.',label:'La livraison',icon:'↙',subtitle:'Le plan, le travail, la relecture… puis votre livraison.',paragraphs:['Cliquez sur une personne pour découvrir son rôle, sa tâche et son compte rendu. « Suivi » montre la progression ; « Livraison » rassemble le résultat et les fichiers.','Tout est conservé dans Documents/Oscar et les agents, dans un dossier par mission. Oscar signale les résultats à revoir. Relisez les créations avant de les utiliser ou de les publier.'],tags:['Les dossiers restent chez vous','Des retours visibles','Vous gardez la main'],action:['delivery','Découvrir la livraison']},
  {title:'Le bureau vit à votre rythme.',label:'L’ambiance',icon:'☀',subtitle:'Le soleil se promène. Le soir, les lampes prennent le relais.',paragraphs:['Par défaut, l’ambiance suit l’heure de votre ordinateur : aube, journée, coucher de soleil et nuit. Le cycle est décoratif, avec un lever à 6 h et une nuit à 20 h.','Cliquez sur les fenêtres pour changer d’ambiance, sur les lampes, l’horloge ou les personnages pour les faire réagir. Le mode automatique se retrouve dans les réglages. La pause fige les animations ; les missions continuent.','Oscar et Zoé sont les deux personnages qui parlent. Les réglages proposent deux voix pour chacun, en français, anglais et néerlandais. Écoutez les extraits avant de choisir ; l’installation locale reste volontaire. Les spécialistes travaillent en silence et les sous-titres restent disponibles.','La machine à café propose un soutien volontaire à Renaud : café 1 €, sandwich 5 €, snack 20 € ou resto 50 €. Le paiement se confirme chez PayPal.'],action:['settings','Voir les réglages']},
  {title:'Et après la création ?',label:'La publication',icon:'↗',subtitle:'De votre ordinateur à Internet, avec un aperçu avant l’envoi.',paragraphs:['Dans « Livraison », ouvrez « Publier ». Vous pourrez connecter GitHub avec son outil officiel, ou renseigner votre hébergement FTP/FTPS pour un site statique.','L’aperçu présente les fichiers et la destination. Vous confirmez ensuite l’envoi. Les codes FTP ne sont pas conservés. Les applications qui demandent un serveur ou une base de données ont besoin d’un hébergement adapté.'],action:['delivery','Voir les options de publication']},
  {title:'Vos autres outils ont leur place.',label:'Les connecteurs',icon:'∞',subtitle:'Messagerie, vidéo et services, avec leurs autorisations officielles.',paragraphs:['L’assistant des connecteurs vous accompagne en trois étapes : retrouver votre compte, vérifier le service, puis confier votre demande. Les accès déjà autorisés dans ChatGPT ou Claude peuvent être réutilisés quand leur client les rend disponibles.','« Retrouver mes connexions » vérifie vos accès sans demander leurs mots de passe. Gmail et Agenda vérifiés peuvent être utilisés par Zoé ; pour les autres plugins, préparez un brief à reprendre dans votre client. Higgsfield demande une confirmation du coût avant toute génération.'],action:['connectors','Découvrir les connecteurs']},
  {title:'Zoé vous simplifie la journée.',label:'Votre assistante',icon:'✦',subtitle:'Mails, agenda ou questions libres : choisissez ce dont vous avez besoin.',paragraphs:['Zoé consulte vos mails et votre agenda avec le compte choisi. Dans Agenda, « Mon agenda demain » prépare votre journée. « Ajouter un rendez-vous » propose des détails modifiables, puis demande votre confirmation avant un ajout dans l’agenda principal Google via Codex. Aucun e-mail n’est envoyé.','« Demande libre » fonctionne sans connecteur : recherches Web, restaurants, comparatifs, textes ou idées. Pour une recherche près de chez vous, indiquez une ville ou autorisez la position approximative. Vous pouvez refuser la géolocalisation et saisir le lieu.','« Lancer maintenant » répond à votre demande ponctuelle. « Programmer » crée une routine de lecture distincte. Les boutons de dictée sont aussi disponibles dans les missions, le studio, les connecteurs et les routines : relisez le texte avant de l’utiliser.'],action:['secretary','Ouvrir Zoé']},
  {title:'Vos documents donnent le ton.',label:'Vos documents',icon:'↥',subtitle:'Des exemples pour guider l’équipe et des fichiers prêts à utiliser.',paragraphs:['Ajoutez un document ou un dossier dans « Modèles et exemples » : Word, Excel, PDF, texte, Markdown, CSV ou JSON. Sélectionnez jusqu’à huit références pour une mission. Les originaux sont conservés ; chaque équipe travaille à partir de ses propres copies.','Choisissez Word, PDF ou Excel pour la livraison. Les outils d’export s’installent sur cet ordinateur après votre confirmation. Un modèle Word avec {{CONTENU}} conserve les éléments autour de cette zone ; un exemple PDF ne garantit pas une mise en page identique.','La bibliothèque permet aussi d’exporter le texte d’une mission terminée. Les fichiers apparaissent dans sa livraison et restent accessibles depuis son dossier.'],action:['documents','Ouvrir les modèles et exemples']},
  {title:'Une habitude devient une mission.',label:'Automatiser',icon:'↻',subtitle:'Choisissez quoi faire et quand Oscar doit s’y mettre.',paragraphs:['Créez un rendez-vous quotidien, hebdomadaire ou à intervalle régulier. Vous pouvez mettre une automatisation en pause, la lancer vous-même et ouvrir le résultat de son dernier passage.','Le bureau et l’ordinateur doivent rester ouverts et éveillés. Un accès aux mails demande un connecteur Gmail officiel autorisé en lecture ; les propositions de réponse sont conservées localement, sans envoi automatique.'],action:['automations','Voir les automatisations']},
  {title:'À vous de faire entrer l’équipe.',label:'C’est parti',icon:'✧',subtitle:'Un premier projet, ou juste une petite visite ?',paragraphs:['Choisissez une mission pour vous laisser guider, racontez votre idée librement ou lancez une démonstration sans appel à un modèle.','Le bouton « ? » en haut du bureau permet de retrouver ce guide à tout moment.'],finish:true},
];
const STEPS=WELCOME_STEPS;

const el = (tag, className, text) => {
  const value = document.createElement(tag);
  if (className) value.className = className;
  if (text !== undefined) value.textContent = text;
  return value;
};

export class WelcomeGuide {
  constructor({getState, onChooseProvider=()=>{}, onConnect=async()=>{}, onRefresh=async()=>{}, onAction=()=>{}, onClose=()=>{}}) {
    Object.assign(this,{getState,onChooseProvider,onConnect,onRefresh,onAction,onClose});
    this.index=0;this.chosen=null;this.busy=false;this.error='';this.attempted=false;
    this.dialog=el('dialog','welcome-guide');this.dialog.id='welcome-guide';
    this.dialog.setAttribute('aria-labelledby','guide-title');
    this.dialog.addEventListener('cancel',()=>this.remember());
    this.dialog.addEventListener('close',()=>{if(this.dialog.open)return;this.remember();this.onClose();if(this.returnFocus?.isConnected)this.returnFocus.focus({preventScroll:true});});
    document.body.append(this.dialog);
  }
  get isOpen(){return this.dialog.open;}
  remember(){try{localStorage.setItem(STORAGE_KEY,'seen');}catch{}}
  maybeOpen(){if(this.attempted)return;this.attempted=true;let seen=false;try{seen=!!localStorage.getItem(STORAGE_KEY);}catch{}if(!seen)this.open();}
  open(){if(this.isOpen)return;this.returnFocus=document.activeElement;this.index=0;this.error='';this.render();this.dialog.showModal();this.dialog.querySelector('.guide-next').focus({preventScroll:true});}
  close(){this.remember();this.dialog.close();}
  go(index){this.index=Math.max(0,Math.min(STEPS.length-1,index));this.error='';this.render();this.dialog.querySelector('#guide-title').focus({preventScroll:true});}
  act(action){this.close();this.onAction(action);}
  render(){
    const step=STEPS[this.index];this.dialog.replaceChildren();
    const rail=el('aside','guide-rail');rail.setAttribute('aria-label','Étapes du guide');
    rail.append(el('span','guide-wordmark','Oscar'),el('span','guide-wordmark-sub','et les Agents'));
    const art=el('div','guide-art');art.setAttribute('aria-hidden','true');
    art.append(el('span','guide-art-orbit'),el('span','guide-art-bubble',step.icon));
    const character=el('span','guide-character');character.append(el('i','guide-hair'),el('i','guide-eyes'),el('i','guide-smile'),el('i','guide-shirt'));art.append(character);
    const friends=el('div','guide-friends');for(let i=0;i<5;i++)friends.append(el('i'));art.append(friends);rail.append(art);
    const nav=el('nav','guide-steps');nav.setAttribute('aria-label','Parcours de découverte');
    STEPS.forEach((item,i)=>{const button=el('button',i===this.index?'current':'',`${String(i+1).padStart(2,'0')}  ${item.label}`);button.type='button';if(i===this.index)button.setAttribute('aria-current','step');button.addEventListener('click',()=>this.go(i));nav.append(button);});rail.append(nav);
    const main=el('section','guide-main');
    const header=el('div','guide-topline');header.append(el('span','section-kicker',`LE PETIT GUIDE · ${this.index+1} / ${STEPS.length}`));
    const language=el('select','guide-language');language.setAttribute('data-locale-select','');language.setAttribute('aria-label','Langue de l’application');for(const [code,name] of [['fr','Français'],['en','English'],['nl','Nederlands']]){const option=el('option','',name);option.value=code;language.append(option);}header.append(language);
    const skip=el('button','guide-skip','Fermer le guide ×');skip.type='button';skip.addEventListener('click',()=>this.close());header.append(skip);main.append(header);
    const content=el('div','guide-content');const heading=el('h2','',step.title);heading.id='guide-title';heading.tabIndex=-1;
    content.append(heading,el('p','guide-subtitle',step.subtitle));
    for(const paragraph of step.paragraphs)content.append(el('p','guide-paragraph',paragraph));
    if(step.tags){const tags=el('div','guide-tags');for(const text of step.tags)tags.append(el('span','',text));content.append(tags);}
    if(this.index===1){this.connection=el('div','guide-connection');content.append(this.connection);this.renderConnection();}
    if(step.action){const button=el('button','text-button guide-action',`${step.action[1]} ↗`);button.type='button';button.addEventListener('click',()=>this.act(step.action[0]));content.append(button);}
    if(step.finish){const actions=el('div','guide-finish-actions');for(const [action,text] of [['catalog','Choisir une mission ↗'],['brief','Raconter mon idée'],['demo','Visiter en démo']]){const button=el('button',action==='catalog'?'primary-button':'text-button',text);button.type='button';button.addEventListener('click',()=>this.act(action));actions.append(button);}content.append(actions);}
    main.append(content);
    const footer=el('footer','guide-footer');const back=el('button','text-button','← Précédent');back.type='button';back.disabled=this.index===0;back.addEventListener('click',()=>this.go(this.index-1));
    const next=el('button','primary-button guide-next',this.index===STEPS.length-1?'Entrer dans le bureau ↗':this.index===0?'Commençons ↗':'Continuer →');next.type='button';next.addEventListener('click',()=>this.index===STEPS.length-1?this.close():this.go(this.index+1));footer.append(back,next);main.append(footer);
    this.dialog.append(rail,main);
  }
  updateState(){if(this.isOpen&&this.index===1)this.renderConnection();}
  renderConnection(){
    if(!this.connection)return;
    const data=this.getState();const providers=data.providers||[];
    if(!this.chosen)this.chosen=data.preferredProvider||providers.find(p=>p.auth?.loggedIn===true)?.id||'codex';
    const provider=providers.find(p=>p.id===this.chosen),login=data.logins?.[this.chosen];
    const pending=['installing','connecting'].includes(login?.status);
    const connected=!!provider?.available&&provider?.auth?.loggedIn===true;
    const active=(data.activeMissions||[]).some(m=>m.provider===this.chosen&&['planning','running','reviewing'].includes(m.status));
    const focus=document.activeElement?.dataset.guideControl;
    const signature=JSON.stringify([this.chosen,this.busy,this.error,pending,connected,active,login?.status,login?.message,provider?.available]);if(signature===this.connection.dataset.signature)return;this.connection.dataset.signature=signature;
    this.connection.replaceChildren();
    const choices=el('div','guide-provider-choices');
    for(const [id,name,detail] of [['codex','ChatGPT','via Codex'],['claude','Claude','via Claude Code']]){const button=el('button','guide-provider');button.type='button';button.dataset.guideControl=id;button.setAttribute('aria-pressed',String(this.chosen===id));button.append(el('strong','',name),el('small','',detail));button.addEventListener('click',()=>{this.chosen=id;this.error='';this.onChooseProvider(id);this.renderConnection();});choices.append(button);}
    const status=el('p',`guide-connection-status${connected?' connected':''}`,this.error||login?.message||(connected?'✓ Connexion d’abonnement détectée sur cet ordinateur.':provider?.available?'Votre outil est prêt. Connectez votre compte dans le navigateur.':'Le programme officiel sera préparé sur votre ordinateur, puis proposera la connexion.'));status.setAttribute('role',this.error?'alert':'status');
    const actions=el('div','guide-connect-actions');
    const connect=el('button','primary-button',pending?login.status==='installing'?'Préparation en cours…':'Connexion dans le navigateur…':connected?'Compte connecté ✓':!provider?.available?'Préparer et connecter ↗':'Se connecter dans le navigateur ↗');connect.type='button';connect.dataset.guideControl='connect';connect.disabled=this.busy||pending||connected||active;
    connect.addEventListener('click',()=>{this.onChooseProvider(this.chosen);this.run(()=>this.onConnect(this.chosen));});
    const refresh=el('button','text-button','Vérifier la connexion');refresh.type='button';refresh.dataset.guideControl='refresh';refresh.disabled=this.busy||pending;refresh.addEventListener('click',()=>this.run(this.onRefresh));actions.append(connect,refresh);
    this.connection.append(choices,status,actions);
    if(active)this.connection.append(el('p','guide-note','Une mission utilise ce moteur. Attendez sa fin avant de modifier sa connexion.'));
    if(focus)this.connection.querySelector(`[data-guide-control="${focus}"]`)?.focus({preventScroll:true});
  }
  async run(action){const focus=document.activeElement?.dataset.guideControl;this.busy=true;this.error='';this.renderConnection();try{await action();}catch(error){this.error=error.message;}finally{this.busy=false;if(this.isOpen&&this.index===1){this.renderConnection();if(focus&&(!this.connection.contains(document.activeElement)||document.activeElement===this.dialog)){const control=[...this.connection.querySelectorAll('[data-guide-control]')].find(item=>item.dataset.guideControl===focus&&!item.disabled);(control||this.dialog.querySelector('.guide-next'))?.focus({preventScroll:true});}}}}
  destroy(){this.dialog.remove();}
}
