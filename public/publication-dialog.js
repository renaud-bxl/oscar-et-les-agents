const node=(tag,className,text)=>{const value=document.createElement(tag);if(className)value.className=className;if(text!==undefined)value.textContent=text;return value;};
const activeStatuses=new Set(['planning','running','reviewing']);

export class PublicationDialog {
  constructor({request,getMission,onClose=()=>{}}){
    Object.assign(this,{request,getMission,onClose});this.kind='github';this.busy=false;this.preview=null;this.timer=null;this.epoch=0;
    this.dialog=node('dialog','publication-dialog');this.dialog.id='publication-dialog';this.dialog.setAttribute('aria-labelledby','publication-title');
    this.dialog.addEventListener('close',()=>{if(this.dialog.open)return;this.epoch++;clearTimeout(this.timer);this.password.value='';this.preview=null;this.onClose();});
    document.body.append(this.dialog);this.build();
  }
  field(label,type='text',placeholder=''){
    const wrapper=node('label','publication-field');wrapper.append(node('span','',label));const input=node(type==='select'?'select':'input');if(type!=='select')input.type=type;if(placeholder)input.placeholder=placeholder;wrapper.append(input);input.addEventListener('input',()=>this.invalidate());return{wrapper,input};
  }
  build(){
    const header=node('header','publication-header');const heading=node('div');heading.append(node('span','section-kicker','DE LA CRÉATION À LA PUBLICATION'));const title=node('h2','','Publier votre projet');title.id='publication-title';heading.append(title);const close=node('button','icon-button','×');close.type='button';close.setAttribute('aria-label','Fermer la publication');close.addEventListener('click',()=>this.dialog.close());header.append(heading,close);
    const intro=node('p','publication-intro','Choisissez une destination, vérifiez les fichiers, puis confirmez l’envoi.');
    const tabs=node('div','publication-tabs');tabs.setAttribute('role','group');tabs.setAttribute('aria-label','Destination de publication');this.tabs={};
    for(const [kind,text] of [['github','GitHub'],['ftp','Hébergement FTP / FTPS']]){const button=node('button','',text);button.type='button';button.setAttribute('aria-pressed',String(kind===this.kind));button.addEventListener('click',()=>this.choose(kind));tabs.append(button);this.tabs[kind]=button;}
    this.github=node('section','publication-github');this.githubStatus=node('p','publication-provider-status');this.githubStatus.setAttribute('role','status');
    this.login=node('button','text-button','Connecter GitHub dans le navigateur ↗');this.login.type='button';this.login.addEventListener('click',()=>this.connect());
    this.device=node('p','publication-device');this.device.hidden=true;
    const repo=this.field('Nom du nouveau dépôt','text','mon-projet');this.repo=repo.input;this.repo.maxLength=100;this.repo.autocomplete='off';
    const visibility=this.field('Visibilité du dépôt','select');this.visibility=visibility.input;for(const [value,label]of[['private','Privé'],['public','Public']]){const option=node('option','',label);option.value=value;this.visibility.append(option);}
    this.installLink=node('a','text-button','Installer l’outil officiel GitHub ↗');this.installLink.href='https://cli.github.com/';this.installLink.target='_blank';this.installLink.rel='noopener noreferrer';this.installLink.hidden=true;
    this.github.append(this.githubStatus,this.login,this.installLink,this.device,repo.wrapper,visibility.wrapper,node('p','publication-note','Le projet sera envoyé dans un nouveau dépôt. GitHub seul ne met pas automatiquement votre site en ligne.'));
    this.ftp=node('section','publication-ftp');this.ftp.hidden=true;
    const protocol=this.field('Connexion à l’hébergement','select');this.protocol=protocol.input;for(const [value,label]of[['ftps','FTPS · connexion chiffrée'],['ftp','FTP · connexion non chiffrée']]){const option=node('option','',label);option.value=value;this.protocol.append(option);}
    const host=this.field('Serveur FTP','text','ftp.exemple.com');this.host=host.input;this.host.autocomplete='off';
    const port=this.field('Port','number','21');this.port=port.input;this.port.min='1';this.port.max='65535';
    const username=this.field('Identifiant FTP');this.username=username.input;this.username.autocomplete='off';
    const password=this.field('Mot de passe FTP','password');this.password=password.input;this.password.autocomplete='new-password';this.password.setAttribute('data-no-translate','');
    const directory=this.field('Dossier distant','text','/public_html');this.directory=directory.input;
    const publicUrl=this.field('Adresse publique du site (facultatif)','url','https://www.exemple.com');this.publicUrl=publicUrl.input;
    const grid=node('div','publication-field-grid');grid.append(host.wrapper,port.wrapper,username.wrapper,password.wrapper);
    this.ftp.append(protocol.wrapper,grid,directory.wrapper,publicUrl.wrapper,node('p','publication-note','Vos codes servent uniquement à cet envoi et ne sont pas enregistrés. Les fichiers de même nom dans le dossier distant seront remplacés. L’envoi FTP vise les sites statiques ; un logiciel avec serveur ou base de données demande un déploiement adapté.'));
    const entry=this.field('Dossier du projet dans la livraison (facultatif)','text','Détection automatique');this.entry=entry.input;
    this.inspect=node('button','primary-button','Vérifier les fichiers à publier');this.inspect.type='button';this.inspect.addEventListener('click',()=>this.inspectFiles());
    this.error=node('p','publication-error');this.error.setAttribute('role','alert');this.error.hidden=true;
    this.review=node('section','publication-review');this.review.hidden=true;
    this.target=node('p','publication-target');this.list=node('ul','publication-files');this.list.setAttribute('aria-label','Fichiers qui seront publiés');
    this.confirm=node('button','primary-button','Confirmer et publier');this.confirm.type='button';this.confirm.disabled=true;this.confirm.addEventListener('click',()=>this.publish());
    this.review.append(node('h3','','Vérifiez avant l’envoi'),this.target,this.list,this.confirm);
    this.status=node('p','publication-job-status');this.status.setAttribute('role','status');this.result=node('a','publication-result');this.result.target='_blank';this.result.rel='noopener noreferrer';this.result.hidden=true;
    const body=node('div','publication-body');body.append(intro,tabs,this.github,this.ftp,entry.wrapper,this.inspect,this.error,this.review,this.status,this.result);this.dialog.append(header,body);
  }
  async open(){
    const mission=this.getMission();if(!mission)return;
    this.missionId=mission.id;this.preview=null;this.review.hidden=true;this.error.hidden=true;this.status.textContent='';this.result.hidden=true;this.repo.value=String(mission.title||'mon-projet').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9-]+/g,'-').replace(/^-|-$/g,'').slice(0,80)||'mon-projet';
    this.password.value='';this.busy=false;this.dialog.showModal();this.updateControls();const epoch=++this.epoch;await this.refresh(epoch);this.poll(epoch);
  }
  choose(kind){if(this.busy)return;this.kind=kind;this.github.hidden=kind!=='github';this.ftp.hidden=kind!=='ftp';for(const [id,tab]of Object.entries(this.tabs))tab.setAttribute('aria-pressed',String(id===kind));this.invalidate();this.updateControls();}
  invalidate(){this.preview=null;this.review.hidden=true;this.confirm.disabled=true;this.error.hidden=true;}
  body(){return{kind:this.kind,entry:this.entry.value.trim(),repo:this.repo.value.trim(),visibility:this.visibility.value,...(this.kind==='ftp'?{ftp:{protocol:this.protocol.value,host:this.host.value.trim(),port:Number(this.port.value||21),username:this.username.value,password:this.password.value,directory:this.directory.value.trim()||'/',publicUrl:this.publicUrl.value.trim()}}:{})};}
  updateControls(){
    const mission=this.getMission();const running=activeStatuses.has(mission?.status);
    const upload=this.job?.status==='uploading';
    this.inspect.disabled=this.busy||running||upload||!(this.kind==='github'?this.providers?.github?.connected:this.providers?.ftp?.available);
    this.confirm.disabled=this.busy||running||upload||!this.preview;
    for(const input of this.dialog.querySelectorAll('input,select'))input.disabled=this.busy||upload;
    for(const tab of Object.values(this.tabs))tab.disabled=this.busy||upload;
    this.login.disabled=this.busy||this.providers?.github?.status==='connecting'||this.providers?.github?.connected;
    if(running)this.status.textContent='Attendez la fin de cette mission avant de publier sa livraison.';
  }
  async refresh(epoch=this.epoch){
    try{
      const [providers,job]=await Promise.all([this.request('/api/publishing'),this.request(`/api/missions/${encodeURIComponent(this.missionId)}/publication`)]);
      if(epoch!==this.epoch||!this.dialog.open)return;
      this.providers=providers;this.job=job;
      const gh=providers.github||{};this.githubStatus.textContent=gh.message||(gh.connected?`GitHub connecté · ${gh.user}`:gh.available?'Connectez votre compte GitHub pour créer un dépôt.':'Le programme officiel GitHub est nécessaire sur cet ordinateur. Installez GitHub CLI puis vérifiez à nouveau.');
      this.device.replaceChildren();this.device.hidden=!(gh.deviceCode&&gh.verificationUrl);
      if(!this.device.hidden){this.device.append(node('span','','Code de connexion : '),node('strong','',gh.deviceCode),node('span','',' · '));const link=node('a','','Ouvrir GitHub ↗');const url=new URL(gh.verificationUrl);if(url.protocol==='https:'&&url.hostname==='github.com'){link.href=url.href;link.target='_blank';link.rel='noopener noreferrer';this.device.append(link);}}
      this.login.hidden=!gh.available||gh.connected;
      this.installLink.hidden=!!gh.available;
      if(job.status&&job.status!=='idle')this.status.textContent=job.message||({uploading:'Publication en cours…',completed:'Publication terminée.',failed:'La publication n’a pas abouti.'}[job.status]||'');
      this.result.hidden=true;
      if(job.status==='completed'&&job.url){const url=new URL(job.url);if(['https:','http:'].includes(url.protocol)){this.result.href=url.href;this.result.textContent='Ouvrir le projet publié ↗';this.result.hidden=false;}}
      this.updateControls();
    }catch(error){if(epoch===this.epoch&&this.dialog.open)this.showError(error.message);}
  }
  poll(epoch){clearTimeout(this.timer);if(!this.dialog.open||epoch!==this.epoch)return;this.timer=setTimeout(async()=>{await this.refresh(epoch);this.poll(epoch);},2000);}
  async connect(){this.busy=true;this.updateControls();try{await this.request('/api/publishing/github/login',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});await this.refresh();}catch(error){this.showError(error.message);}finally{this.busy=false;this.updateControls();}}
  showError(message){this.error.textContent=message;this.error.hidden=false;}
  async inspectFiles(){
    this.busy=true;this.error.hidden=true;this.updateControls();const epoch=this.epoch;
    try{const data=await this.request(`/api/missions/${encodeURIComponent(this.missionId)}/publication/preview`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(this.body())});if(epoch!==this.epoch)return;this.preview=data;const destination=data.kind==='github'?`${data.destination.repo} · ${data.destination.visibility==='public'?'Public':'Privé'}`:`${data.destination.protocol.toUpperCase()} · ${data.destination.host}:${data.destination.port}${data.destination.directory}`;this.target.textContent=`${destination} · ${data.files.length} fichiers · ${Math.ceil(data.totalBytes/1024)} Ko`;this.list.replaceChildren(...data.files.map(file=>node('li','',file.path)));this.review.hidden=false;this.confirm.disabled=false;this.confirm.focus({preventScroll:true});}
    catch(error){if(epoch===this.epoch)this.showError(error.message);}finally{this.busy=false;this.updateControls();}
  }
  async publish(){
    if(!this.preview)return;this.busy=true;this.error.hidden=true;this.updateControls();const epoch=this.epoch;
    try{const job=await this.request(`/api/missions/${encodeURIComponent(this.missionId)}/publication`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...this.body(),confirmation:true,digest:this.preview.digest})});if(epoch!==this.epoch)return;this.job=job;this.status.textContent=job.message||'Publication en cours…';this.password.value='';this.preview=null;this.review.hidden=true;}
    catch(error){if(epoch===this.epoch)this.showError(error.message);}finally{this.busy=false;this.updateControls();}
  }
  destroy(){clearTimeout(this.timer);this.password.value='';this.dialog.remove();}
}
