import {getLocale,translate} from './i18n.js';
import {sanitizeStudioSvg} from './creative-studio.js';
import {PdfCanvasPreview} from './pdf-preview.js';
import {OfficeViewer} from './office-viewer.js';
import {officeText} from './translations-office.js';
import {deliveryHtmlEntries} from './delivery-preview.js';

const MAX_BYTES=20*1024*1024,MAX_TEXT=512*1024;
const TEXT_TYPES=new Set('txt md markdown csv tsv json jsonl log py js mjs cjs ts tsx jsx html htm css scss sass less yaml yml toml ini cfg conf sql xml rst tex ipynb c cpp h hpp java rs go sh bash zsh ps1 bat'.split(' '));
const NATIVE_TYPES=new Set('pdf png jpg jpeg webp gif bmp tif tiff avif txt md json csv log docx xlsx pptx odt ods odp'.split(' '));
const LOCALES={fr:'fr-BE',en:'en-GB',nl:'nl-BE'};
const node=(tag,className,text)=>{const element=document.createElement(tag);if(className)element.className=className;if(text!==undefined)element.textContent=text;return element;};
function fileInfo(mission,file) {
  const path=typeof file==='string'?file:file?.path;
  if(!/^[a-z\d-]{1,100}$/i.test(mission?.id||'')||typeof path!=='string'||!path||path.length>512||/[\x00-\x1f\x7f\\:?*<>|]/.test(path)||path.split('/').some(part=>!part||part.startsWith('.')))throw new Error('Ce fichier ne peut pas être ouvert depuis cette mission.');
  return{path,name:path.split('/').at(-1),extension:path.split('.').at(-1).toLowerCase(),size:Number.isFinite(file?.size)?file.size:null,url:`/api/missions/${encodeURIComponent(mission.id)}/files/${path.split('/').map(encodeURIComponent).join('/')}`};
}
function rasterMime(bytes) {
  if(bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71&&bytes[4]===13&&bytes[5]===10&&bytes[6]===26&&bytes[7]===10)return'image/png';
  if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return'image/jpeg';
  if(String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP')return'image/webp';
  return null;
}
function isPdf(bytes) {
  let start=bytes[0]===239&&bytes[1]===187&&bytes[2]===191?3:0;
  while(start<16&&[9,10,13,32].includes(bytes[start]))start++;
  return String.fromCharCode(...bytes.slice(start,start+5))==='%PDF-';
}
const jsonRequest=async(url,options={})=>{const response=await fetch(url,{credentials:'same-origin',...options});let data;try{data=await response.json();}catch{throw new Error('Le bureau a renvoyé une réponse inattendue.');}if(!response.ok)throw new Error(data.error||'Cette action n’a pas pu être réalisée.');return data;};

export class ArtifactViewer {
  constructor({request=jsonRequest,onClose=()=>{},onTest}={}) {
    Object.assign(this,{request,onClose,onTest});this.epoch=0;this.urls=new Set();this.destroyed=false;this.opened=false;this.nativeBusy=false;this.folderBusy=false;this.current=null;
    this.build();
    this._onClose=()=>{if(!this.dialog.open)this.finishedClosing();};this._onCancel=event=>{event.preventDefault();this.close();};
    this._onBackdrop=event=>{if(event.target!==this.dialog)return;const box=this.dialog.getBoundingClientRect();if(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom)this.close();};
    this._onLanguage=()=>{if(this.opened&&this.current){this.updateMeta();this.pdfPreview?.updateLabels();this.officePreview?.updateLabels();if(this.officePreview)this.officeLabels(this.current.info);}};
    this.dialog.addEventListener('close',this._onClose);this.dialog.addEventListener('cancel',this._onCancel);this.dialog.addEventListener('click',this._onBackdrop);document.addEventListener('oscar:language',this._onLanguage);
  }
  build() {
    this.dialog=node('dialog','artifact-viewer');this.dialog.id='artifact-viewer';this.dialog.setAttribute('aria-labelledby','artifact-viewer-title');
    const header=node('header','artifact-viewer-header'),heading=node('div','artifact-viewer-heading');heading.append(node('span','artifact-eyebrow','DANS LE DOSSIER DE LA MISSION'));
    this.title=node('h2','','Votre livrable');this.title.id='artifact-viewer-title';this.title.setAttribute('data-no-translate','');this.path=node('p','artifact-viewer-path');this.path.setAttribute('data-no-translate','');heading.append(this.title,this.path);
    const close=node('button','artifact-close','×');close.type='button';close.setAttribute('aria-label','Fermer l’aperçu du fichier');close.addEventListener('click',()=>this.close());this.closeButton=close;header.append(heading,close);
    const bar=node('div','artifact-preview-bar');this.meta=node('span','artifact-meta');this.meta.setAttribute('data-no-translate','');this.mode=node('span','artifact-mode');bar.append(this.meta,this.mode);
    this.content=node('div','artifact-preview');this.content.setAttribute('aria-label','Aperçu du fichier');
    this.error=node('p','artifact-error');this.error.setAttribute('role','alert');this.error.hidden=true;
    this.status=node('p','artifact-status');this.status.setAttribute('role','status');this.status.hidden=true;
    this.hint=node('p','artifact-hint');this.hint.hidden=true;
    const footer=node('footer','artifact-toolbar');
    this.download=node('a','artifact-download','Télécharger le fichier');this.download.addEventListener('click',event=>event.stopPropagation());
    this.native=node('button','artifact-native','Ouvrir dans mon application ↗');this.native.type='button';this.native.addEventListener('click',()=>this.openNative());
    this.folder=node('button','artifact-folder','Ouvrir le dossier ↗');this.folder.type='button';this.folder.addEventListener('click',()=>this.openFolder());
    this.retry=node('button','artifact-retry','Réessayer l’aperçu');this.retry.type='button';this.retry.hidden=true;this.retry.addEventListener('click',()=>this.load());
    this.testButton=node('button','artifact-native','Tester cette page');this.testButton.type='button';this.testButton.hidden=true;this.testButton.addEventListener('click',()=>this.testPage());
    footer.append(this.testButton,this.download,this.native,this.folder,this.retry);this.dialog.append(header,bar,this.error,this.status,this.content,this.hint,footer);document.body.append(this.dialog);
  }
  updateMeta() {
    if(!this.current)return;const info=this.current.info;
    this.meta.textContent=[info.extension.toUpperCase(),info.size===null?'':info.size<1024?`${info.size} ${translate('octets')}`:`${new Intl.NumberFormat(LOCALES[getLocale()],{maximumFractionDigits:1}).format(info.size/1024)} ${translate('Ko')}`].filter(Boolean).join(' · ');
  }
  showError(text){this.error.textContent=text;this.error.hidden=!text;}
  showStatus(text){this.status.textContent=text;this.status.hidden=!text;}
  placeholder(title,description,loading=false) {
    const box=node('div',`artifact-placeholder${loading?' artifact-loading':''}`),icon=node('span','artifact-document-icon');icon.setAttribute('aria-hidden','true');box.append(icon,node('strong','',title),node('p','',description));this.content.replaceChildren(box);
  }
  cleanup() {
    this.controller?.abort();this.controller=null;
    this.pdfPreview?.close();this.pdfPreview=null;
    this.officePreview?.destroy();this.officePreview=null;
    for(const image of this.content.querySelectorAll('img'))image.removeAttribute('src');this.content.replaceChildren();
    for(const url of this.urls)URL.revokeObjectURL(url);this.urls.clear();
  }
  url(blob){const url=URL.createObjectURL(blob);this.urls.add(url);return url;}
  active(epoch){return this.opened&&!this.destroyed&&epoch===this.epoch;}
  async bytes(url,limit,{truncate=false}={}) {
    const response=await fetch(url,{credentials:'same-origin',cache:'no-store',signal:this.controller.signal});
    if(!response.ok)throw new Error('Ce fichier n’est plus disponible dans la livraison. Vous pouvez ouvrir son dossier ou réessayer.');
    const length=Number(response.headers.get('content-length'));
    if(!truncate&&Number.isFinite(length)&&length>limit){await response.body?.cancel();throw new Error('Ce fichier dépasse la limite de 20 Mo pour l’aperçu. Téléchargez-le ou ouvrez-le dans son application.');}
    if(!response.body?.getReader){const data=new Uint8Array(await response.arrayBuffer());if(data.length>limit&&!truncate)throw new Error('Ce fichier dépasse la limite de 20 Mo pour l’aperçu. Téléchargez-le ou ouvrez-le dans son application.');return{bytes:data.slice(0,limit),truncated:data.length>limit};}
    const reader=response.body.getReader(),chunks=[];let total=0,truncated=false;
    try{while(true){const {done,value}=await reader.read();if(done)break;if(total+value.length>limit){if(!truncate)throw new Error('Ce fichier dépasse la limite de 20 Mo pour l’aperçu. Téléchargez-le ou ouvrez-le dans son application.');const remaining=limit-total;if(remaining>0)chunks.push(value.slice(0,remaining));total=limit;truncated=true;await reader.cancel();break;}chunks.push(value);total+=value.length;}}
    catch(error){try{await reader.cancel();}catch{}throw error;}
    const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return{bytes,truncated};
  }
  async showImage(blob,epoch,{caption='Image de la mission'}={}) {
    const url=this.url(blob),image=node('img','artifact-image');image.alt=this.current.info.name;
    await new Promise((resolve,reject)=>{
      const signal=this.controller?.signal;
      const release=()=>{image.onload=null;image.onerror=null;signal?.removeEventListener('abort',abort);};
      const abort=()=>{release();image.removeAttribute('src');reject(new DOMException('Aperçu interrompu.','AbortError'));};
      image.onload=()=>{release();resolve();};image.onerror=()=>{release();reject(new Error('Le navigateur ne peut pas afficher cette image.'));};
      if(signal?.aborted){abort();return;}signal?.addEventListener('abort',abort,{once:true});image.src=url;
    });
    if(!this.active(epoch))return;this.content.replaceChildren(image);this.mode.textContent=caption;
  }
  async showPdf(bytes,epoch) {
    const preview=new PdfCanvasPreview({onError:error=>{if(!this.active(epoch))return;this.showError(translate(error.message));this.placeholder('Votre fichier reste accessible.','Le dossier et le téléchargement restent disponibles pendant que vous réessayez.');this.mode.textContent='Aperçu indisponible';this.retry.hidden=false;}});this.pdfPreview=preview;
    await preview.open(bytes,this.content);if(!this.active(epoch))return;
    this.mode.textContent='PDF · lecture dans le bureau';this.hint.textContent='Aperçu local en lecture seule. Les liens, formulaires et scripts du PDF restent inactifs.';this.hint.hidden=false;
  }
  async showOffice(info,epoch) {
    const result=await this.request(`/api/missions/${encodeURIComponent(this.current.mission.id)}/document-preview`,{method:'POST',headers:{'Content-Type':'application/json','X-Oscar-Client':'1'},body:JSON.stringify({path:info.path}),signal:this.controller.signal});
    if(!this.active(epoch))return;
    this.officePreview=new OfficeViewer({container:this.content});this.officePreview.open(result);
    this.officeLabels(info);
  }
  officeLabels(info) {
    this.mode.textContent=officeText(info.extension==='docx'?'Word · lecture dans le bureau':'Excel · lecture dans le bureau',getLocale());
    this.hint.textContent=officeText('Lecture locale en lecture seule. La mise en page avancée reste accessible dans votre application habituelle.',getLocale());this.hint.hidden=false;
  }
  async load() {
    if(!this.current||!this.opened)return;const epoch=++this.epoch;this.cleanup();this.controller=new AbortController();this.showError('');this.showStatus('');this.retry.hidden=true;this.hint.hidden=true;
    const info=this.current.info;this.placeholder('Ouverture du fichier…','Votre livrable reste dans le dossier de cette mission.',true);this.mode.textContent='Chargement…';
    try{
      if(TEXT_TYPES.has(info.extension)) {
        const data=await this.bytes(info.url,MAX_TEXT,{truncate:true});if(!this.active(epoch))return;
        const pre=node('pre','artifact-text',new TextDecoder('utf-8').decode(data.bytes).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,''));pre.setAttribute('data-no-translate','');pre.tabIndex=0;this.content.replaceChildren(pre);this.mode.textContent='Texte · lecture seule';
        if(data.truncated){this.hint.textContent='L’aperçu affiche les 512 premiers Ko. Téléchargez le fichier ou ouvrez-le dans son application pour lire la suite.';this.hint.hidden=false;}
      } else if(['docx','xlsx'].includes(info.extension)) {
        await this.showOffice(info,epoch);
      } else if(['png','jpg','jpeg','webp','svg','pdf'].includes(info.extension)) {
        const {bytes}=await this.bytes(info.url,MAX_BYTES);if(!this.active(epoch))return;
        if(info.extension==='svg'){const source=sanitizeStudioSvg(new TextDecoder('utf-8').decode(bytes));await this.showImage(new Blob([source],{type:'image/svg+xml'}),epoch,{caption:'SVG vérifié · aperçu sans éléments actifs'});}
        else if(info.extension==='pdf') {
          if(!isPdf(bytes))throw new Error('Le contenu de ce fichier ne correspond pas à un PDF reconnu.');
          await this.showPdf(bytes,epoch);
        } else {const mime=rasterMime(bytes);if(!mime)throw new Error('Le contenu de ce fichier n’est pas une image PNG, JPEG ou WebP reconnue.');await this.showImage(new Blob([bytes],{type:mime}),epoch);}
      } else {
        this.placeholder('Ce format s’ouvre dans son application.','Téléchargez le fichier ou ouvrez son dossier. Aucun contenu de ce fichier n’est exécuté dans le bureau.');this.mode.textContent='Fichier à conserver';
      }
    }catch(error){if(!this.active(epoch)||error.name==='AbortError')return;this.showError(officeText(error.message||'L’aperçu n’a pas pu être chargé.',getLocale()));this.placeholder('Votre fichier reste accessible.','Le dossier et le téléchargement restent disponibles pendant que vous réessayez.');this.mode.textContent='Aperçu indisponible';this.retry.hidden=false;}
  }
  async openNative() {
    if(!this.current||this.nativeBusy||!NATIVE_TYPES.has(this.current.info.extension))return;const epoch=this.epoch;this.nativeBusy=true;this.native.disabled=true;this.showStatus('');
    try{await this.request(`/api/missions/${encodeURIComponent(this.current.mission.id)}/open-file`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:this.current.info.path})});if(this.active(epoch))this.showStatus('Le fichier a été confié à votre application habituelle. L’aperçu reste ouvert ici.');}
    catch(error){if(this.active(epoch))this.showError(error.message||'Le fichier n’a pas pu être ouvert dans son application.');}
    finally{this.nativeBusy=false;if(this.opened&&this.current)this.native.disabled=!NATIVE_TYPES.has(this.current.info.extension);}
  }
  async openFolder() {
    if(!this.current||this.folderBusy)return;const epoch=this.epoch;this.folderBusy=true;this.folder.disabled=true;this.showStatus('');
    try{await this.request(`/api/missions/${encodeURIComponent(this.current.mission.id)}/open-folder`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});if(this.active(epoch))this.showStatus('Le dossier de la mission a été ouvert. Votre aperçu reste ici.');}
    catch(error){if(this.active(epoch))this.showError(error.message||'Le dossier n’a pas pu être ouvert.');}
    finally{this.folderBusy=false;if(this.opened)this.folder.disabled=false;}
  }
  async testPage(){
    const current=this.current,epoch=this.epoch;
    if(!this.opened||this.testButton.hidden||this.testButton.disabled||typeof this.onTest!=='function'||!current||!['completed','needs_review','failed','cancelled'].includes(current.mission.status)||!deliveryHtmlEntries(current.mission).some(file=>file.path===current.info.path))return;
    this.testButton.disabled=true;this.showError('');
    try{await this.onTest(current.mission,{path:current.info.path,size:current.info.size});}
    catch(error){if(this.active(epoch))this.showError(translate(error.message||'L’aperçu n’a pas pu être ouvert. Vos fichiers restent dans le dossier.'));}
    finally{if(this.active(epoch))this.testButton.disabled=false;}
  }
  async open(mission,file) {
    if(this.destroyed)return this;
    let info;try{info=fileInfo(mission,file);}catch(error){++this.epoch;this.cleanup();this.current=null;if(!this.opened){this.returnFocus=document.activeElement;this.opened=true;this.dialog.showModal();}this.title.removeAttribute('data-no-translate');this.title.textContent='Fichier indisponible';this.path.textContent='';this.meta.textContent='';this.mode.textContent='Aperçu indisponible';this.showError(error.message);this.showStatus('');this.hint.hidden=true;this.retry.hidden=true;this.testButton.hidden=true;this.placeholder('Ce fichier ne peut pas être ouvert.','Revenez à la livraison pour choisir un fichier de cette mission.');this.download.removeAttribute('href');this.native.disabled=true;this.folder.disabled=true;this.closeButton.focus();return this;}
    if(!this.opened)this.returnFocus=document.activeElement;this.current={mission,info};this.title.setAttribute('data-no-translate','');this.title.textContent=info.name;this.path.textContent=info.path;
    this.download.href=info.url;this.download.download=info.name;this.native.disabled=this.nativeBusy||!NATIVE_TYPES.has(info.extension);this.native.title=NATIVE_TYPES.has(info.extension)?'Ouvrir avec l’application de cet ordinateur':'Ce type de fichier est consultable en texte ou par téléchargement.';this.folder.disabled=this.folderBusy;this.updateMeta();
    this.testButton.hidden=typeof this.onTest!=='function'||!['completed','needs_review','failed','cancelled'].includes(mission.status)||!deliveryHtmlEntries(mission).some(item=>item.path===info.path);this.testButton.disabled=false;
    if(!this.opened){this.opened=true;this.dialog.showModal();}this.closeButton.focus();await this.load();return this;
  }
  finishedClosing(){if(!this.opened)return;this.opened=false;this.epoch++;this.cleanup();this.current=null;if(this.returnFocus?.isConnected)this.returnFocus.focus({preventScroll:true});this.onClose();}
  close(){if(this.dialog.open)this.dialog.close();this.finishedClosing();return this;}
  destroy(){if(this.destroyed)return;this.close();this.destroyed=true;this.dialog.removeEventListener('close',this._onClose);this.dialog.removeEventListener('cancel',this._onCancel);this.dialog.removeEventListener('click',this._onBackdrop);document.removeEventListener('oscar:language',this._onLanguage);this.dialog.remove();}
}
