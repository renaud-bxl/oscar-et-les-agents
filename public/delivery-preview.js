import {translate} from './i18n.js';

const node=(tag,cls,text)=>{const el=document.createElement(tag);if(cls)el.className=cls;if(text!==undefined)el.textContent=text;return el;};
const safePath=value=>typeof value==='string'&&value.length<512&&!/[\x00-\x1f\x7f\\:?*<>|]/u.test(value)&&value.split('/').every(part=>part&&!part.startsWith('.'));
const ignored=value=>/(?:^|\/)(?:References|Contributions|Rapports|reports|reference|verification|vérification|tests?)(?:\/|$)/iu.test(value);
export function deliveryPreviewCandidate(mission){
  const files=(mission?.files||[]).filter(file=>safePath(file?.path)&&!ignored(file.path));
  const pages=files.filter(file=>/(?:^|\/)index\.html$/u.test(file.path));
  const entry=pages.find(file=>/^(?:Livraison|livraison)\/index\.html$/u.test(file.path))||pages.find(file=>file.path==='index.html')||(pages.length===1?pages[0]:null);
  if(entry)return{kind:'browser',file:entry};
  if(pages.length)return null; // Never guess which of several independent projects is the delivery.
  const images=files.filter(file=>/\.(?:png|jpe?g|webp|svg)$/iu.test(file.path)&&Number.isFinite(file.size)&&file.size>0&&file.size<=20*1024*1024);
  const image=images.find(file=>/^(?:Livraison|livraison)\//u.test(file.path))||images[0];
  return image?{kind:'image',file:image}:null;
}
export function isolatedPreviewUrl(value){
  try{const url=new URL(value);return url.protocol==='http:'&&url.hostname==='127.0.0.1'&&/^\d{1,5}$/u.test(url.port)&&!url.username&&!url.password&&!url.search&&!url.hash&&/^\/[a-zA-Z0-9_-]{24,128}\/(?:[^/]+\/)*index\.html$/u.test(url.pathname)?url.href:null;}catch{return null;}
}
export class DeliveryPreview{
  constructor({container,request,onPrepared=()=>{}}){Object.assign(this,{container,request,onPrepared});this.epoch=0;this.root=node('section','delivery-preview');this.root.setAttribute('aria-label','Aperçu du résultat');this.title=node('h3','','Votre résultat');this.body=node('div','delivery-preview-body');this.note=node('p','delivery-preview-note');this.link=node('a','text-button','Ouvrir dans un navigateur ↗');this.link.target='_blank';this.link.rel='noopener noreferrer';this.link.hidden=true;this.root.append(this.title,this.body,this.note,this.link);container.append(this.root);}
  async open(mission,{entry}={}){
    this.cleanup();const explicit=(mission?.files||[]).find(file=>file.path===entry&&safePath(file.path)&&!ignored(file.path)&&/(?:^|\/)index\.html$/u.test(file.path));const epoch=++this.epoch,candidate=explicit?{kind:'browser',file:explicit}:deliveryPreviewCandidate(mission);this.root.hidden=!candidate;this.link.hidden=true;if(!candidate)return;
    this.body.textContent='';this.note.textContent=translate(mission.status==='completed'?'Le résultat reste conservé dans votre dossier.':'Aperçu partiel : Oscar n’a pas validé la livraison.');
    if(candidate.kind==='image'){
      const image=node('img','delivery-preview-image');image.alt=candidate.file.path;image.setAttribute('data-no-translate','');image.loading='eager';image.decoding='async';image.addEventListener('error',()=>{if(epoch===this.epoch)this.note.textContent=translate('L’image ne peut pas être affichée ici. Ouvrez le fichier ou son dossier.');});
      image.src=`/api/missions/${encodeURIComponent(mission.id)}/files/${candidate.file.path.split('/').map(encodeURIComponent).join('/')}`;this.body.append(image);return;
    }
    this.body.textContent=translate('Ouverture de votre jeu ou site…');
    try{
      const result=await this.request(`/api/missions/${encodeURIComponent(mission.id)}/browser-preview`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({entry:candidate.file.path})});
      if(epoch!==this.epoch)return;const url=isolatedPreviewUrl(result.url);if(!url)throw new Error('L’aperçu du navigateur n’a pas pu être vérifié.');
      const frame=node('iframe','delivery-preview-frame');frame.title=translate('Votre jeu ou site, prêt à essayer');frame.setAttribute('sandbox','allow-scripts');frame.setAttribute('allow','camera \'none\'; microphone \'none\'; geolocation \'none\'; payment \'none\'');frame.referrerPolicy='no-referrer';frame.src=url;this.frame=frame;this.body.replaceChildren(frame);this.link.href=url;this.link.hidden=false;
      this.note.textContent=translate(mission.status==='completed'?'Essayez votre jeu ou site ici. Les ressources externes ne sont pas chargées dans cet aperçu local.':'Aperçu partiel : Oscar n’a pas validé la livraison.');this.onPrepared(result);
    }catch(error){if(epoch!==this.epoch)return;this.body.textContent=translate('L’aperçu n’a pas pu être ouvert. Vos fichiers restent dans le dossier.');this.note.textContent=translate(error.message);}
  }
  cleanup(){this.epoch++;if(this.frame){this.frame.src='about:blank';this.frame.remove();this.frame=null;}for(const image of this.body.querySelectorAll('img'))image.removeAttribute('src');this.body.replaceChildren();this.link.hidden=true;this.link.removeAttribute('href');}
  destroy(){this.cleanup();this.root.remove();}
}
export class ResultPreviewDialog{
  constructor({request,onFolder,onPublish,onClose=()=>{}}){Object.assign(this,{request,onFolder,onPublish,onClose});this.dialog=node('dialog','result-preview-dialog');this.dialog.setAttribute('aria-labelledby','result-preview-title');const header=node('header','result-preview-header');this.title=node('h2');this.title.id='result-preview-title';this.title.setAttribute('data-no-translate','');const close=node('button','icon-button','×');close.type='button';close.setAttribute('aria-label','Fermer l’aperçu du résultat');close.addEventListener('click',()=>this.close());header.append(this.title,close);this.host=node('div','result-preview-host');this.path=node('p','result-preview-path');this.path.setAttribute('data-no-translate','');this.error=node('p','completion-error');this.error.hidden=true;this.error.setAttribute('role','alert');const footer=node('footer','result-preview-actions');this.folder=node('button','completion-action','Ouvrir le dossier de tous les fichiers ↗');this.folder.type='button';this.folder.addEventListener('click',async()=>{try{await onFolder(this.mission.id);}catch(error){this.error.textContent=error.message;this.error.hidden=false;}});this.publish=node('button','completion-action completion-action-primary','Publier le projet ↗');this.publish.type='button';this.publish.addEventListener('click',()=>{const item=this.mission,root=this.projectRoot;this.close();onPublish(item,root);});footer.append(this.folder,this.publish);this.dialog.append(header,this.host,this.path,this.error,footer);document.body.append(this.dialog);this.preview=new DeliveryPreview({container:this.host,request,onPrepared:result=>{this.projectRoot=result.root;}});this.dialog.addEventListener('close',()=>{this.preview.cleanup();this.onClose();});}
  open(mission,{entry}={}){this.mission=mission;this.projectRoot=undefined;this.title.textContent=mission.title||translate('Votre résultat');this.path.textContent=mission.workDirectory||mission.folderName||'';this.publish.hidden=mission.status!=='completed'||mission.provider==='demo';this.error.hidden=true;if(!this.dialog.open)this.dialog.showModal();return this.preview.open(mission,{entry});}
  close(){this.preview.cleanup();if(this.dialog.open)this.dialog.close();}
  destroy(){this.close();this.preview.destroy();this.dialog.remove();}
}
