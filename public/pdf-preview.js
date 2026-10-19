import {translate} from './i18n.js';

export const PDF_PREVIEW_LIMITS=Object.freeze({pages:200,pixels:4_000_000,imagePixels:16_000_000,dimension:8192,timeoutMs:20_000});
const VENDOR='/vendor/pdfjs/6.4.299/';
const node=(tag,className,text)=>{const item=document.createElement(tag);if(className)item.className=className;if(text!==undefined)item.textContent=text;return item;};
const aborted=()=>new DOMException('Aperçu interrompu.','AbortError');
const message=(source,...values)=>values.reduce((text,value,index)=>text.replace(`$${index+1}`,String(value)),translate(source));
const friendlyError=error=>{
  if(error.name==='AbortError'||error.name==='RenderingCancelledException')return error;
  if(error.name==='PasswordException')return new Error('Ce PDF est protégé par un mot de passe. Ouvrez-le dans votre application pour le déverrouiller.');
  if(['Les dimensions de cette page ne permettent pas un aperçu. Ouvrez le PDF dans son application.','L’aperçu PDF a dépassé le délai de vingt secondes. Réessayez ou ouvrez le fichier dans son application.','Ce PDF ne contient aucune page affichable.','Le navigateur ne peut pas afficher cette page PDF. Téléchargez le fichier ou ouvrez-le dans son application.'].includes(error.message))return error;
  return new Error('Le PDF n’a pas pu être affiché ici. Réessayez, téléchargez-le ou ouvrez-le dans son application.',{cause:error});
};
let library;
const loadLibrary=()=>library??=import(`${VENDOR}build/pdf.min.mjs`).catch(error=>{library=null;throw error;});

export function pdfPreviewDimensions(width,height,availableWidth,pixelRatio=1){
  if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)throw new Error('Les dimensions de cette page ne permettent pas un aperçu. Ouvrez le PDF dans son application.');
  const cssScale=Math.min(Math.max(240,Math.min(1200,availableWidth||900))/width,1600/height,1.8),density=Math.max(1,Math.min(2,pixelRatio||1));
  const scale=Math.min(cssScale*density,PDF_PREVIEW_LIMITS.dimension/width,PDF_PREVIEW_LIMITS.dimension/height,Math.sqrt(PDF_PREVIEW_LIMITS.pixels/width/height));
  return{scale,width:Math.max(1,Math.floor(width*scale)),height:Math.max(1,Math.floor(height*scale)),cssWidth:width*cssScale,cssHeight:height*cssScale};
}

export class PdfCanvasPreview{
  constructor({onError=()=>{},load=loadLibrary,workerFactory=url=>new Worker(url,{type:'module'})}={}){Object.assign(this,{onError,load,workerFactory});this.session=null;}
  active(session){return this.session===session&&!session.controller.signal.aborted;}
  async wait(session,promise){
    if(!this.active(session))throw aborted();
    let timer,abort;
    const interrupted=new Promise((_,reject)=>{abort=()=>reject(aborted());session.controller.signal.addEventListener('abort',abort,{once:true});});
    const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{reject(new Error('L’aperçu PDF a dépassé le délai de vingt secondes. Réessayez ou ouvrez le fichier dans son application.'));this.close();},PDF_PREVIEW_LIMITS.timeoutMs);});
    try{return await Promise.race([promise,interrupted,timeout]);}
    finally{clearTimeout(timer);session.controller.signal.removeEventListener('abort',abort);}
  }
  async open(bytes,host){
    this.close();const session={controller:new AbortController(),host,pageNumber:1,busy:false};this.session=session;
    try{
      const pdfjs=await this.wait(session,this.load());if(!this.active(session))throw aborted();
      session.worker=this.workerFactory(`${VENDOR}build/pdf.worker.min.mjs`);
      session.worker.addEventListener?.('error',event=>{event.preventDefault?.();if(this.active(session))this.failed(session,new Error('Le PDF n’a pas pu être affiché ici. Réessayez, téléchargez-le ou ouvrez-le dans son application.'));});
      session.pdfWorker=new pdfjs.PDFWorker({port:session.worker});
      session.loadingTask=pdfjs.getDocument({data:bytes,worker:session.pdfWorker,cMapUrl:`${VENDOR}cmaps/`,cMapPacked:true,standardFontDataUrl:`${VENDOR}standard_fonts/`,wasmUrl:`${VENDOR}wasm/`,useWasm:false,useWorkerFetch:true,useSystemFonts:false,isEvalSupported:false,enableXfa:false,enableWebGPU:false,disableWorkerRendering:true,maxImageSize:PDF_PREVIEW_LIMITS.imagePixels,canvasMaxAreaInBytes:PDF_PREVIEW_LIMITS.pixels*4,disableAutoFetch:true,disableStream:true,disableRange:true,verbosity:0});
      session.document=await this.wait(session,session.loadingTask.promise);if(!this.active(session))throw aborted();
      if(!Number.isSafeInteger(session.document.numPages)||session.document.numPages<1)throw new Error('Ce PDF ne contient aucune page affichable.');
      session.pageCount=session.document.numPages;session.limit=Math.min(session.pageCount,PDF_PREVIEW_LIMITS.pages);
      this.build(session);await this.goToPage(1);return this;
    }catch(error){if(this.session===session)this.close();throw friendlyError(error);}
  }
  build(session){
    const reader=node('div','artifact-pdf-reader'),toolbar=node('div','artifact-pdf-navigation');
    session.previous=node('button','artifact-pdf-page-button','Page précédente');session.previous.type='button';session.next=node('button','artifact-pdf-page-button','Page suivante');session.next.type='button';
    session.label=node('span','artifact-pdf-page-label');session.label.setAttribute('data-no-translate','');session.label.setAttribute('role','status');
    session.previous.addEventListener('click',()=>this.goToPage(session.pageNumber-1).catch(error=>this.failed(session,error)));
    session.next.addEventListener('click',()=>this.goToPage(session.pageNumber+1).catch(error=>this.failed(session,error)));
    toolbar.append(session.previous,session.label,session.next);
    const sheet=node('div','artifact-pdf-sheet');session.canvas=node('canvas','artifact-pdf-canvas');session.canvas.setAttribute('role','img');sheet.append(session.canvas);
    session.limitNote=node('p','artifact-pdf-limit');session.limitNote.setAttribute('data-no-translate','');session.limitNote.hidden=session.pageCount<=PDF_PREVIEW_LIMITS.pages;
    reader.append(toolbar,sheet,session.limitNote);session.host.replaceChildren(reader);this.updateLabels();
  }
  updateLabels(){
    const session=this.session;if(!session?.document||!session.canvas)return;
    const label=message('Page $1 sur $2',session.pageNumber,session.pageCount);session.label.textContent=label;session.canvas.setAttribute('aria-label',label);
    session.previous.textContent=translate('Page précédente');session.next.textContent=translate('Page suivante');
    session.previous.disabled=session.busy||session.pageNumber<=1;session.next.disabled=session.busy||session.pageNumber>=session.limit;
    session.limitNote.textContent=message('PDF de $1 pages : l’aperçu donne accès aux 200 premières. Téléchargez le document pour consulter la suite.',session.pageCount);
  }
  async goToPage(number){
    const session=this.session;if(!session?.document||!this.active(session)||session.busy||!Number.isInteger(number)||number<1||number>session.limit)return;
    session.busy=true;session.pageNumber=number;this.updateLabels();
    try{
      session.page?.cleanup();session.page=await this.wait(session,session.document.getPage(number));if(!this.active(session))throw aborted();
      const original=session.page.getViewport({scale:1}),dimensions=pdfPreviewDimensions(original.width,original.height,session.host.clientWidth-48,globalThis.devicePixelRatio);
      session.canvas.width=dimensions.width;session.canvas.height=dimensions.height;session.canvas.style.width=`${dimensions.cssWidth}px`;session.canvas.style.height=`${dimensions.cssHeight}px`;
      const context=session.canvas.getContext('2d',{alpha:false});if(!context)throw new Error('Le navigateur ne peut pas afficher cette page PDF. Téléchargez le fichier ou ouvrez-le dans son application.');
      session.renderTask=session.page.render({canvasContext:context,viewport:session.page.getViewport({scale:dimensions.scale}),background:'rgb(255,255,255)'});
      await this.wait(session,session.renderTask.promise);if(!this.active(session))throw aborted();session.renderTask=null;session.page.cleanup();
    }finally{session.busy=false;if(this.active(session))this.updateLabels();}
  }
  failed(session,error){if(error.name==='AbortError'||error.name==='RenderingCancelledException')return;if(this.session===session)this.close();this.onError(friendlyError(error));}
  close(){
    const session=this.session;if(!session)return Promise.resolve();this.session=null;session.controller.abort();
    try{session.renderTask?.cancel();}catch{}
    if(session.canvas){session.canvas.width=0;session.canvas.height=0;}
    const terminate=()=>{try{session.pdfWorker?.destroy();}catch{}try{session.worker?.terminate();}catch{}};
    // PDF.js removes its font faces after the worker acknowledges termination.
    // Give that cleanup one short turn; a stuck decoder is still forcibly stopped.
    let destruction;try{destruction=Promise.resolve(session.loadingTask?.destroy());}catch{terminate();return Promise.resolve();}
    return new Promise(resolve=>{let finished=false;const finish=()=>{if(finished)return;finished=true;clearTimeout(timer);terminate();resolve();},timer=setTimeout(finish,250);destruction.then(finish,finish);});
  }
}
