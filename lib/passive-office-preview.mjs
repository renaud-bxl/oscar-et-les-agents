import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {validateDocument,DOCUMENT_LIMITS} from './document-library.mjs';

const WORKER=fileURLToPath(new URL('./passive-office-worker.py',import.meta.url));
export const OFFICE_PREVIEW_LIMITS=Object.freeze({fileBytes:DOCUMENT_LIMITS.fileBytes,text:64000,blocks:1000,sheets:20,rows:200,columns:40,cells:40000,responseBytes:2*1024*1024,timeout:15000,pending:8});
const fail=(message,code='DOCUMENT_INVALID')=>Object.assign(new Error(message),{code});
const plain=value=>value&&typeof value==='object'&&!Array.isArray(value);
const keys=(value,allowed)=>plain(value)&&Object.keys(value).every(key=>allowed.includes(key));
const hex=value=>value===undefined||typeof value==='string'&&/^[A-Fa-f0-9]{6}$/u.test(value);
/** Reject a forged worker result before any document-derived value reaches UI. */
export function validateOfficePreview(value){
  if(!keys(value,['kind','blocks','sheets','status','warnings'])||!['word','spreadsheet'].includes(value.kind)||!['ready','partial'].includes(value.status)||!Array.isArray(value.warnings)||value.warnings.length>12||value.warnings.some(text=>typeof text!=='string'||text.length>1000))throw fail('Le lecteur n’a pas confirmé le contenu de ce document.');
  let textBytes=0,cells=0;
  const text=(value,max=4000)=>{if(typeof value!=='string'||value.length>max||value.includes('\0'))throw fail('Le lecteur n’a pas confirmé le contenu de ce document.');textBytes+=value.length;if(textBytes>OFFICE_PREVIEW_LIMITS.text)throw fail('Le lecteur n’a pas confirmé le contenu de ce document.');};
  if(value.kind==='word'){
    if(value.sheets!==undefined||!Array.isArray(value.blocks)||value.blocks.length>1000)throw fail('Le lecteur n’a pas confirmé le contenu de ce document.');
    for(const block of value.blocks){
      if(!keys(block,['kind','section','rows','runs','heading','alignment'])||block.section!==undefined&&!['header','footer'].includes(block.section))throw fail('Le lecteur n’a pas confirmé le contenu de ce document.');
      if(block.kind==='paragraph'){
        if(block.rows!==undefined)throw fail('Le lecteur n’a pas confirmé le contenu de ce document.');
        if(!Number.isInteger(block.heading)||block.heading<0||block.heading>6||!['left','center','right','justify'].includes(block.alignment)||!Array.isArray(block.runs)||block.runs.length>10000)throw fail('Le lecteur n’a pas confirmé le contenu de ce document.');
        for(const run of block.runs){if(!keys(run,['text','bold','italic','underline','color','size'])||['bold','italic','underline'].some(key=>typeof run[key]!=='boolean')||!hex(run.color)||run.size!==undefined&&(!Number.isFinite(run.size)||run.size<8||run.size>40))throw fail('Le lecteur n’a pas confirmé le contenu de ce document.');text(run.text);}
      }else if(block.kind==='table'){
        if(block.runs!==undefined||block.heading!==undefined||block.alignment!==undefined)throw fail('Le lecteur n’a pas confirmé le contenu de ce document.');
        if(!Array.isArray(block.rows)||block.rows.length>200)throw fail('Le lecteur n’a pas confirmé le contenu de ce document.');
        for(const row of block.rows){if(!Array.isArray(row)||row.length>40)throw fail('Le lecteur n’a pas confirmé le contenu de ce document.');for(const cell of row){text(cell);if(++cells>40000)throw fail('Le lecteur n’a pas confirmé le contenu de ce document.');}}
      }else throw fail('Le lecteur n’a pas confirmé le contenu de ce document.');
    }
  }else{
    if(value.blocks!==undefined||!Array.isArray(value.sheets)||value.sheets.length>20)throw fail('Le lecteur n’a pas confirmé le contenu de ce document.');
    for(const sheet of value.sheets){
      if(!keys(sheet,['name','state','totalRows','totalColumns','rows'])||typeof sheet.name!=='string'||sheet.name.length>31||!['visible','hidden','veryHidden'].includes(sheet.state)||!Number.isInteger(sheet.totalRows)||sheet.totalRows<0||sheet.totalRows>1048576||!Number.isInteger(sheet.totalColumns)||sheet.totalColumns<0||sheet.totalColumns>16384||!Array.isArray(sheet.rows)||sheet.rows.length>200)throw fail('Le lecteur n’a pas confirmé le contenu de ce document.');
      let last=0;
      for(const row of sheet.rows){
        if(!keys(row,['number','cells'])||!Number.isInteger(row.number)||row.number<=last||row.number>200||!Array.isArray(row.cells)||row.cells.length>40)throw fail('Le lecteur n’a pas confirmé le contenu de ce document.');last=row.number;
        const columns=new Set();
        for(const cell of row.cells){
          if(!keys(cell,['column','address','text','formula','cachedValue','bold','italic','color','background','numberFormat'])||!Number.isInteger(cell.column)||cell.column<1||cell.column>40||columns.has(cell.column)||typeof cell.address!=='string'||!/^([A-Z]{1,2})([1-9]\d{0,2})$/u.test(cell.address)||Number(cell.address.match(/\d+$/u)[0])!==row.number||typeof cell.formula!=='boolean'||!hex(cell.color)||!hex(cell.background)||['bold','italic'].some(key=>cell[key]!==undefined&&typeof cell[key]!=='boolean')||cell.numberFormat!==undefined&&(typeof cell.numberFormat!=='string'||cell.numberFormat.length>120))throw fail('Le lecteur n’a pas confirmé le contenu de ce document.');
          const letters=cell.address.match(/^[A-Z]+/u)[0];const addressColumn=[...letters].reduce((value,letter)=>value*26+letter.charCodeAt(0)-64,0);if(addressColumn!==cell.column)throw fail('Le lecteur n’a pas confirmé le contenu de ce document.');
          columns.add(cell.column);text(cell.text);if(cell.cachedValue!==undefined){if(!cell.formula)throw fail('Le lecteur n’a pas confirmé le contenu de ce document.');text(cell.cachedValue);}if(++cells>40000)throw fail('Le lecteur n’a pas confirmé le contenu de ce document.');
        }
      }
    }
  }
  return structuredClone(value);
}

export class PassiveOfficePreview{
  constructor({documents}={}){if(!documents?.missions||typeof documents.run!=='function')throw new TypeError('DocumentLibrary is required');this.documents=documents;this.controllers=new Set();this.jobs=new Set();this.closed=false;this.queue=Promise.resolve();}
  get activeJobs(){return this.controllers.size;}
  preview(file,{signal}={}){
    if(this.closed||this.documents.closed)return Promise.reject(fail('La lecture du document a été arrêtée.','ABORT_ERR'));
    if(this.documents.readerControllers.size>=OFFICE_PREVIEW_LIMITS.pending)return Promise.reject(fail('Plusieurs documents sont déjà en cours de lecture. Réessayez dans quelques instants.','DOCUMENT_BUSY'));
    const controller=new AbortController(),combined=signal?AbortSignal.any([signal,controller.signal]):controller.signal;this.controllers.add(controller);this.documents.readerControllers.add(controller);
    const job=this.documents.readerQueue.then(()=>this.read(file,combined)).finally(()=>{this.controllers.delete(controller);this.documents.readerControllers.delete(controller);this.jobs.delete(job);});this.jobs.add(job);this.queue=job.catch(()=>{});this.documents.readerQueue=this.queue;return job;
  }
  async read(file,signal){
    const check=()=>{if(signal.aborted||this.closed)throw fail('La lecture du document a été arrêtée.','ABORT_ERR');};check();await this.documents.ready;check();
    const type=typeof file==='string'?path.extname(file).slice(1).toLowerCase():null;
    if(!['docx','xlsx'].includes(type)||!path.isAbsolute(file))throw fail('Ce lecteur accepte uniquement les fichiers Word et Excel.');
    const root=this.documents.missions.root,canonicalRoot=await this.documents.missions.directory(root);check();
    const outside=relative=>!relative||relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative);
    let relative=path.relative(root,file);
    if(outside(relative))relative=path.relative(canonicalRoot,file);
    if(outside(relative))throw fail('Choisissez un livrable de cette mission.');
    // Native-file validation returns a canonical path. Map that exact trusted
    // root back to VoiceStorage's anchored spelling (/var may be /private/var).
    file=path.join(root,relative);
    if(!this.documents.runtime.available)throw fail('Préparez les outils locaux de documents pour lire Word et Excel dans le bureau.','DOCUMENT_RUNTIME');
    const buffer=await this.documents.missions.read(file,OFFICE_PREVIEW_LIMITS.fileBytes);validateDocument(buffer,type);check();
    const binary=await this.documents.python();if(!binary)throw fail('Les outils de documents ne sont pas disponibles.','DOCUMENT_RUNTIME');check();
    let parsed;try{parsed=JSON.parse(await this.documents.run(binary,['-I',WORKER],{input:JSON.stringify({type,base64:buffer.toString('base64')}),timeout:OFFICE_PREVIEW_LIMITS.timeout,maxBytes:OFFICE_PREVIEW_LIMITS.responseBytes,signal}));}catch(error){if(signal.aborted||error.code==='ABORT_ERR')throw fail('La lecture du document a été arrêtée.','ABORT_ERR');throw fail(error.message||'Ce document n’a pas pu être affiché. Ouvrez son fichier original pour le vérifier.');}check();
    const result=validateOfficePreview(parsed);if(result.kind!==(type==='docx'?'word':'spreadsheet'))throw fail('Le lecteur n’a pas confirmé le contenu de ce document.');
    // A file changed during parsing must not be presented as the current file.
    const current=await this.documents.missions.read(file,OFFICE_PREVIEW_LIMITS.fileBytes);check();if(!current.equals(buffer))throw fail('Ce fichier a changé pendant sa lecture. Ouvrez sa nouvelle version.','DOCUMENT_CHANGED');
    return{...result,type,name:path.basename(file),revision:createHash('sha256').update(buffer).digest('hex')};
  }
  async close(){if(this.closed)return;this.closed=true;for(const controller of this.controllers)controller.abort();await Promise.allSettled([...this.jobs]);}
}
