import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {access,lstat,mkdir,open,readdir,realpath,rm,writeFile} from 'node:fs/promises';
import {constants} from 'node:fs';
import {inflateRawSync} from 'node:zlib';
import {VoiceStorage} from './local-voice.mjs';

export const DOCUMENT_LIMITS=Object.freeze({fileBytes:5*1024*1024,sourceBytes:512*1024,files:80,totalBytes:100*1024*1024,references:8,exports:3,zipEntries:2000,expandedBytes:40*1024*1024});
const IMPORTS=['docx','xlsx','pdf','txt','md','csv','json'],FORMATS=['docx','pdf','xlsx'];
const WORKER=fileURLToPath(new URL('./document-worker.py',import.meta.url));
const READER=fileURLToPath(new URL('./reference-reader.py',import.meta.url));
const PACKAGES=['python-docx==1.2.0','openpyxl==3.1.5','reportlab==4.4.9','pypdf==6.19.0'];
const RUNTIME_PROBE='import docx, openpyxl, reportlab, pypdf; assert pypdf.__version__ == "6.19.0"; print("ok")';
const fail=(message,code='DOCUMENT_INVALID')=>Object.assign(new Error(message),{code});
const sha=buffer=>createHash('sha256').update(buffer).digest('hex');
const inside=(root,file)=>{const relative=path.relative(root,file);return relative!==''&&relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative);};
const extension=name=>path.extname(name).slice(1).toLowerCase();
const idFor=name=>sha(Buffer.from(name)).slice(0,24);
function referenceName(item){const suffix=path.extname(item.name);let label=item.name.slice(0,-suffix.length);while(Buffer.byteLength(label)>180)label=[...label].slice(0,-1).join('');return`${item.id}-${label}${suffix}`;}
function fileName(value){if(typeof value!=='string'||!value.trim()||value.length>180||value!==path.basename(value)||/[\\/\x00-\x1f\x7f]/u.test(value)||/^\./u.test(value)||/[ .]$/u.test(value))throw fail('Choisissez un nom de fichier simple, sans chemin.');const name=value.normalize('NFC');if(!IMPORTS.includes(extension(name)))throw fail('Formats acceptés : Word, Excel, PDF, Markdown, texte, CSV et JSON.');return name;}
function importName(original,attempt){const ext=path.extname(original),suffix=attempt===1?'':` (${attempt})`;let base=original.slice(0,-ext.length);while(base.length&&((base+suffix+ext).length>180||Buffer.byteLength(base+suffix+ext)>240))base=[...base].slice(0,-1).join('');return fileName(base+suffix+ext);}
function decode(value){if(typeof value!=='string'||value.length>Math.ceil(DOCUMENT_LIMITS.fileBytes/3)*4+4||!value.length||value.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/u.test(value))throw fail('Le fichier importé n’est pas lisible.');const buffer=Buffer.from(value,'base64');if(buffer.length>DOCUMENT_LIMITS.fileBytes||buffer.toString('base64')!==value)throw fail('Chaque fichier doit faire au maximum 5 Mo.');return buffer;}
const crcTable=Array.from({length:256},(_,value)=>{for(let i=0;i<8;i++)value=value&1?0xedb88320^(value>>>1):value>>>1;return value>>>0;});
function crc32(buffer){let value=0xffffffff;for(const byte of buffer)value=crcTable[(value^byte)&255]^(value>>>8);return(value^0xffffffff)>>>0;}

// Office relationships are preserved with the template. Keep normal, explicit
// Web/mail links, but never carry an executable or local-file target forward.
function xmlValue(value){
  return value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/giu,(match,entity)=>{
    if(entity[0]==='#'){
      const number=entity[1].toLowerCase()==='x'?Number.parseInt(entity.slice(2),16):Number.parseInt(entity.slice(1),10);
      if(!Number.isInteger(number)||number<1||number>0x10ffff||number>=0xd800&&number<=0xdfff)throw fail('Le document contient une référence XML non valide.');
      return String.fromCodePoint(number);
    }
    return{amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"}[entity.toLowerCase()];
  });
}
function safeHyperlink(value){
  const target=value.trim();
  if(!target||/[\x00-\x1f\x7f]/u.test(target))return false;
  if(/^#[^\s]+$/u.test(target))return true;
  try{const url=new URL(target);return['https:','http:','mailto:'].includes(url.protocol)&&!url.username&&!url.password;}catch{return false;}
}
function officeXmlText(data){
  let encoding='utf-8';
  if(data[0]===0xff&&data[1]===0xfe||data[0]===0x3c&&data[1]===0)encoding='utf-16le';
  else if(data[0]===0xfe&&data[1]===0xff||data[0]===0&&data[1]===0x3c)encoding='utf-16be';
  let xml;try{xml=new TextDecoder(encoding,{fatal:true}).decode(data);}catch{throw fail('Le document contient une référence XML non valide.');}
  const declared=xml.match(/^\s*<\?xml\s[^?]*\bencoding\s*=\s*["']([^"']+)["']/iu)?.[1];
  if(declared&&!/^utf-?(?:8|16(?:le|be)?)$/iu.test(declared))throw fail('Le document contient une référence XML non valide.');
  return xml;
}
function officeXmlValue(fragment){
  const escaped=fragment.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gu,(_,value)=>value.replace(/&/gu,'&amp;').replace(/</gu,'&lt;').replace(/>/gu,'&gt;'));
  return xmlValue(escaped.replace(/<[^>]*>/gu,''));
}
function validateOfficeXml(xml,name,type){
  if(/<!DOCTYPE|<!ENTITY/iu.test(xml))throw fail('Les déclarations XML externes ne sont pas acceptées.');
  const content=xml.replace(/<!--[\s\S]*?-->/gu,'');
  if(/\.rels$/iu.test(name)){
    for(const relation of content.match(/<(?:[\w.-]+:)?Relationship\b[^>]*>/giu)||[]){
      const attributes={};
      for(const match of relation.matchAll(/\s(?:[\w.-]+:)?([\w.-]+)\s*=\s*(["'])([\s\S]*?)\2/gu))attributes[match[1].toLowerCase()]=xmlValue(match[3]);
      if(/\/(?:vbaProject|control|oleObject|package|customUI)$/iu.test(attributes.type||''))throw fail('Les macros et objets intégrés exécutables ne sont pas acceptés.');
      const external=attributes.targetmode?.trim().toLowerCase()==='external'||/^[a-z][a-z\d+.-]*:|^\/\/|^\\\\/iu.test(attributes.target||'');
      if(!external)continue;
      if(!/\/hyperlink$/u.test(attributes.type||''))throw fail('Ce document charge une ressource externe non prise en charge.');
      if(!safeHyperlink(attributes.target||''))throw fail('Les liens des modèles doivent utiliser une adresse Web, e-mail ou un repère dans le document.');
    }
  }
  if(name==='[Content_Types].xml')for(const attribute of content.matchAll(/\bContentType\s*=\s*(["'])([\s\S]*?)\1/gu))if(/macroEnabled|vbaProject|activeX|oleObject|macrosheet|dialogsheet/iu.test(xmlValue(attribute[2])))throw fail('Les macros et objets intégrés exécutables ne sont pas acceptés.');
  if(type==='docx'){
    const fieldParts=[...content.matchAll(/<(?:[\w.-]+:)?instrText\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?instrText\s*>/giu)].map(match=>officeXmlValue(match[1])),fields=fieldParts.join(' ')+' '+fieldParts.join('');
    const simple=[...content.matchAll(/<(?:[\w.-]+:)?fldSimple\b[^>]*>/giu)].map(match=>[...match[0].matchAll(/\b(?:[\w.-]+:)?instr\s*=\s*(["'])([\s\S]*?)\1/gu)].map(attribute=>xmlValue(attribute[2])).join(' ')).join(' ');
    const instructions=(fields+' '+simple).replace(/"(?:[^"]|"")*"/gu,'');
    if(/(?:^|\s)(?:DDEAUTO|DDE|INCLUDETEXT|INCLUDEPICTURE|LINK|DATABASE|MACROBUTTON)(?=\s|$)/iu.test(instructions))throw fail('Ce modèle Word contient un champ actif ou une ressource liée non prise en charge.');
    for(const field of (fields+' '+simple).matchAll(/\bHYPERLINK\s+("[^"]+"|\\l\s+"[^"]+"|[^\s\\]+)/giu)){
      const target=field[1].startsWith('\\l')?'#'+field[1].match(/"([^"]+)"/u)[1]:field[1].replace(/^"|"$/gu,'');
      if(!safeHyperlink(target))throw fail('Les liens des modèles doivent utiliser une adresse Web, e-mail ou un repère dans le document.');
    }
  }
  if(type==='xlsx')for(const match of content.matchAll(/<(?:[\w.-]+:)?f\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?f\s*>/giu)){
    const formula=officeXmlValue(match[1]),withoutStrings=formula.replace(/"(?:[^"]|"")*"/gu,'');
    if(/(?:^|[^\w.])(?:_xlfn\.)?(?:WEBSERVICE|RTD|CALL|EXEC|REGISTER(?:\.ID)?|RUN|EVALUATE|GET\.WORKSPACE|FORMULA|SET\.VALUE)\s*\(/iu.test(withoutStrings)||/\||\[[^\]]+\][^!]*!/u.test(withoutStrings))throw fail('Ce modèle Excel contient une formule active ou une connexion externe non prise en charge.');
    for(const link of formula.matchAll(/(?:^|[^\w.])(?:_xlfn\.)?HYPERLINK\s*\(\s*("(?:[^"]|"")*"|[^,;]*)/giu)){
      const literal=link[1].trim();if(!/^"(?:[^"]|"")*"$/u.test(literal)||!safeHyperlink(literal.slice(1,-1).replace(/""/gu,'"')))throw fail('Les liens des modèles doivent utiliser une adresse Web, e-mail ou un repère dans le document.');
    }
  }
}

export function validateDocument(buffer,type){
  if(!Buffer.isBuffer(buffer)||!buffer.length||buffer.length>DOCUMENT_LIMITS.fileBytes)throw fail('Chaque fichier doit faire au maximum 5 Mo.');
  if(['txt','md','csv','json'].includes(type)){let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(buffer);}catch{throw fail('Le texte doit être enregistré en UTF-8.');}if(text.includes('\0'))throw fail('Ce fichier ne contient pas un texte lisible.');if(type==='json')try{JSON.parse(text);}catch{throw fail('Le fichier JSON n’est pas valide.');}return;}
  if(type==='pdf'){if(buffer.subarray(0,8).toString('ascii').replace(/^\uFEFF/u,'').indexOf('%PDF-')!==0||!buffer.subarray(-2048).includes(Buffer.from('%%EOF')))throw fail('Ce fichier PDF n’est pas valide.');return;}
  if(!['docx','xlsx'].includes(type))throw fail('Ce format n’est pas proposé.');
  let eocd=-1;for(let i=buffer.length-22;i>=Math.max(0,buffer.length-65557);i--)if(buffer.readUInt32LE(i)===0x06054b50){eocd=i;break;}
  if(eocd<0)throw fail('Le document Word ou Excel n’est pas une archive valide.');
  const count=buffer.readUInt16LE(eocd+10),directory=buffer.readUInt32LE(eocd+16),directoryBytes=buffer.readUInt32LE(eocd+12);
  if(buffer.readUInt16LE(eocd+4)||buffer.readUInt16LE(eocd+6)||count!==buffer.readUInt16LE(eocd+8)||count<1||count>DOCUMENT_LIMITS.zipEntries||directory+directoryBytes>eocd)throw fail('Cette archive est trop volumineuse ou utilise un format non pris en charge.');
  let offset=directory,total=0;const names=new Set();
  for(let i=0;i<count;i++){
    if(offset+46>eocd||buffer.readUInt32LE(offset)!==0x02014b50)throw fail('L’archive du document est endommagée.');
    const flags=buffer.readUInt16LE(offset+8),method=buffer.readUInt16LE(offset+10),crc=buffer.readUInt32LE(offset+16),compressed=buffer.readUInt32LE(offset+20),expanded=buffer.readUInt32LE(offset+24),nameBytes=buffer.readUInt16LE(offset+28),extraBytes=buffer.readUInt16LE(offset+30),commentBytes=buffer.readUInt16LE(offset+32),attributes=buffer.readUInt32LE(offset+38),local=buffer.readUInt32LE(offset+42);
    if(offset+46+nameBytes+extraBytes+commentBytes>eocd)throw fail('L’archive du document est endommagée.');
    const name=buffer.subarray(offset+46,offset+46+nameBytes).toString('utf8');offset+=46+nameBytes+extraBytes+commentBytes;
    if(!name||name.startsWith('/')||name.includes('\\')||name.split('/').includes('..')||/^[A-Za-z]:|[\x00-\x1f]/u.test(name)||names.has(name)||((attributes>>>16)&0xf000)===0xa000)throw fail('Les chemins dangereux et les liens ne sont pas acceptés dans un document.');
    names.add(name);total+=expanded;
    if(flags&1||![0,8].includes(method)||expanded>10*1024*1024||total>DOCUMENT_LIMITS.expandedBytes||expanded>Math.max(1024*1024,compressed*200))throw fail('Le document compressé dépasse les limites de sécurité.');
    if(/(?:vbaProject|activeX|embeddings|macrosheets|dialogsheets)\//iu.test(name)||/vbaProject\.bin$/iu.test(name))throw fail('Les macros et objets intégrés exécutables ne sont pas acceptés.');
    if(type==='xlsx'&&/^xl\/(?:connections\.xml|externalLinks\/|queryTables\/)/iu.test(name))throw fail('Ce modèle Excel contient une formule active ou une connexion externe non prise en charge.');
    if(local+30>directory||buffer.readUInt32LE(local)!==0x04034b50)throw fail('L’archive du document est endommagée.');
    const start=local+30+buffer.readUInt16LE(local+26)+buffer.readUInt16LE(local+28);if(start+compressed>directory)throw fail('L’archive du document est endommagée.');
    let data;try{data=method===0?buffer.subarray(start,start+compressed):inflateRawSync(buffer.subarray(start,start+compressed),{maxOutputLength:10*1024*1024});}catch{throw fail('Le document compressé dépasse les limites de sécurité.');}
    if(data.length!==expanded||crc32(data)!==crc)throw fail('L’intégrité du document n’a pas pu être vérifiée.');
    if(/\.(xml|rels)$/iu.test(name))validateOfficeXml(officeXmlText(data),name,type);
  }
  if(offset!==directory+directoryBytes||!names.has('[Content_Types].xml')||!names.has(type==='docx'?'word/document.xml':'xl/workbook.xml'))throw fail('Le fichier ne correspond pas au format Word ou Excel annoncé.');
}

function environment(){const env={...process.env,PIP_DISABLE_PIP_VERSION_CHECK:'1',PYTHONNOUSERSITE:'1'};for(const key of Object.keys(env))if(/(?:API_KEY|AUTH_TOKEN|OAUTH_TOKEN|CLIENT_SECRET|PASSWORD|PASSWD)$/iu.test(key)||/^PYTHON(?:PATH|HOME)$/u.test(key))delete env[key];return env;}
export function processRun(binary,args,{input='',signal,timeout=60000,maxBytes=24*1024*1024}={}){return new Promise((resolve,reject)=>{
  const child=spawn(binary,args,{env:environment(),stdio:['pipe','pipe','pipe'],signal});let output=[],size=0,done=false,failure=null;
  const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);error?reject(error):resolve(value);};
  const stop=error=>{failure||=error;child.kill('SIGKILL');};
  const timer=setTimeout(()=>stop(fail('La préparation des documents a dépassé le délai prévu.')),timeout);timer.unref?.();
  child.stdout.on('data',chunk=>{if(failure)return;size+=chunk.length;if(size>maxBytes)stop(fail('Le document généré dépasse les limites prévues.'));else output.push(chunk);});child.stderr.on('data',()=>{});
  child.once('error',error=>{const safe=fail(error.name==='AbortError'?'La préparation des documents a été arrêtée.':'Le programme de documents n’a pas pu démarrer.',error.name==='AbortError'?'ABORT_ERR':'DOCUMENT_INVALID');if(error.name==='AbortError'&&child.pid)stop(safe);else finish(safe);});child.once('close',code=>{if(failure){finish(failure);return;}const value=Buffer.concat(output).toString('utf8');if(code!==0){let detail;try{detail=JSON.parse(value).error;}catch{}finish(fail(detail||'La génération du document n’a pas abouti.'));}else finish(null,value);});child.stdin.on('error',()=>{});child.stdin.end(input);
});}

export class DocumentLibrary{
  constructor({dataDir,pythonBinary=null,run=processRun,onChange=()=>{}}={}){
    if(typeof dataDir!=='string'||!dataDir)throw fail('Le dossier du bureau est nécessaire.');this.dataDir=path.resolve(dataDir);this.directory=path.join(this.dataDir,'Modeles et exemples');this.storage=new VoiceStorage(this.dataDir,'Modeles et exemples');this.runtimeStorage=new VoiceStorage(this.dataDir,'.documents-runtime');this.missions=new VoiceStorage(this.dataDir,'missions');this.run=run;this.pythonOverride=pythonBinary;this.onChange=onChange;this.runtime={status:'not_installed',available:false,message:'Installez les outils locaux pour produire des fichiers Word, PDF et Excel.'};this.ready=this.load();this.ready.catch(()=>{});this.mutations=Promise.resolve();this.readerQueue=Promise.resolve();this.readerControllers=new Set();this.exportControllers=new Set();this.exportTasks=new Set();this.referenceCache=new Map();
  }
  serialize(work){const result=this.mutations.then(work);this.mutations=result.catch(()=>{});return result;}
  async python(){if(this.pythonOverride)return this.pythonOverride;const binary=path.join(this.runtimeStorage.root,process.platform==='win32'?'Scripts/python.exe':'bin/python');try{await this.runtimeStorage.directory(path.dirname(binary));await access(binary,constants.X_OK);return binary;}catch{return null;}}
  async load(){await this.storage.directory(this.directory,{create:true});const binary=await this.python();if(!binary)return;try{await this.run(binary,['-I','-c',RUNTIME_PROBE],{timeout:15000,maxBytes:1000});this.runtime={status:'ready',available:true,message:'Les exports sont produits sur cet ordinateur, sans appel à un modèle.'};}catch{this.runtime={status:'not_installed',available:false,message:'Les outils de documents doivent être préparés ou réparés.'};}}
  async entries(){await this.ready;await this.storage.directory(this.directory);const names=await readdir(this.directory),items=[],warnings=[];let total=0;for(const name of names.sort((a,b)=>a.localeCompare(b,'fr'))){if(!IMPORTS.includes(extension(name)))continue;try{fileName(name);const file=path.join(this.directory,name),info=await this.storage.file(file);if(info.size>DOCUMENT_LIMITS.fileBytes||items.length>=DOCUMENT_LIMITS.files||total+info.size>DOCUMENT_LIMITS.totalBytes){warnings.push(name);continue;}const buffer=await this.storage.read(file,DOCUMENT_LIMITS.fileBytes);validateDocument(buffer,extension(name));total+=buffer.length;items.push({id:idFor(name),name,type:extension(name),size:buffer.length,revision:sha(buffer),sha256:sha(buffer),updatedAt:info.mtimeMs,template:['docx','xlsx'].includes(extension(name))});}catch{warnings.push(name);}}return{items,totalBytes:total,ignored:warnings};}
  async state(){const listing=await this.entries();return{...listing,directory:this.directory,runtime:{...this.runtime},supportedImports:[...IMPORTS],supportedExports:[...FORMATS],limits:{...DOCUMENT_LIMITS}};}
  async import(body={}){return this.serialize(async()=>{await this.ready;if(Object.keys(body).some(key=>!['name','base64'].includes(key)))throw fail('Importez un fichier choisi dans votre navigateur, sans chemin supplémentaire.');const original=fileName(body.name),buffer=decode(body.base64);validateDocument(buffer,extension(original));const listing=await this.entries();if(listing.items.length>=DOCUMENT_LIMITS.files||listing.totalBytes+buffer.length>DOCUMENT_LIMITS.totalBytes)throw fail('La bibliothèque est pleine. Retirez un exemple avant d’en ajouter un autre.');for(let attempt=1;attempt<=100;attempt++){const name=importName(original,attempt),target=path.join(this.directory,name);await this.storage.directory(this.directory);let handle;try{handle=await open(target,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);await handle.writeFile(buffer);}catch(error){if(error.code==='EEXIST')continue;throw error;}finally{await handle?.close();}await this.storage.file(target);this.onChange();return(await this.entries()).items.find(item=>item.name===name);}throw fail('Trop d’exemples portent déjà ce nom.');});}
  async item(id){if(typeof id!=='string'||!/^[a-f0-9]{24}$/u.test(id))throw fail('Choisissez un exemple de la bibliothèque.');const item=(await this.entries()).items.find(item=>item.id===id);if(!item)throw fail('Cet exemple n’est plus disponible.');return item;}
  async remove(id){return this.serialize(async()=>{const item=await this.item(id);await this.storage.remove(path.join(this.directory,item.name));this.onChange();return{ok:true};});}
  async readItem(id,revision){const item=await this.item(id),buffer=await this.storage.read(path.join(this.directory,item.name),DOCUMENT_LIMITS.fileBytes);if(sha(buffer)!==item.revision||revision&&revision!==item.revision)throw fail('Cet exemple a changé. Sélectionnez sa nouvelle version avant de continuer.');validateDocument(buffer,item.type);return{item,buffer};}
  async requireReferenceReader(ids=[]){
    await this.ready;
    for(const selected of ids){const{item}=await this.readItem(typeof selected==='string'?selected:selected?.id,typeof selected==='object'?selected.revision:undefined);if(['docx','xlsx','pdf'].includes(item.type)&&!this.runtime.available)throw fail('Préparez les outils de documents pour lire vos exemples Word, Excel et PDF avant de lancer la mission.','DOCUMENT_RUNTIME');}
  }
  async extractReference(item,buffer,{signal}={}){
    if(signal?.aborted||this.closed)throw fail('La lecture des exemples a été arrêtée.','ABORT_ERR');
    const key=`${item.type}:${item.revision}`;
    if(this.referenceCache.has(key))return structuredClone(this.referenceCache.get(key));
    let result;
    if(['txt','md','csv','json'].includes(item.type)){
      const original=buffer.toString('utf8'),text=original.slice(0,64000).replace(/[\uD800-\uDBFF]$/u,'');
      result={text,status:text.length<original.length?'partial':text.trim()?'ready':'empty',warnings:text.length<original.length?['Le texte dépasse la limite de lecture ; seule la première partie est préparée.']:[],characters:text.length,styleHints:{}};
    }else{
      if(!this.runtime.available)throw fail('Préparez les outils de documents pour lire vos exemples Word, Excel et PDF avant de lancer la mission.','DOCUMENT_RUNTIME');
      if(this.readerControllers.size>=8)throw fail('Plusieurs exemples sont déjà en cours de lecture. Réessayez dans quelques instants.','DOCUMENT_BUSY');
      const controller=new AbortController(),readerSignal=signal?AbortSignal.any([signal,controller.signal]):controller.signal;this.readerControllers.add(controller);
      const work=async()=>{
        if(readerSignal.aborted||this.closed)throw fail('La lecture des exemples a été arrêtée.','ABORT_ERR');
        const binary=await this.python();if(!binary)throw fail('Les outils de documents ne sont pas disponibles.','DOCUMENT_RUNTIME');
        let parsed;
        try{parsed=JSON.parse(await this.run(binary,['-I',READER],{input:JSON.stringify({type:item.type,base64:buffer.toString('base64'),maxCharacters:64000}),timeout:15000,maxBytes:512*1024,signal:readerSignal}));}
        catch(error){throw fail(error.code==='ABORT_ERR'?'La lecture des exemples a été arrêtée.':error.message||'La lecture du document n’a pas abouti. Vérifiez le fichier ou fournissez un exemple texte.',error.code||'DOCUMENT_INVALID');}
        if(readerSignal.aborted)throw fail('La lecture des exemples a été arrêtée.','ABORT_ERR');
        if(!parsed||typeof parsed.text!=='string'||!['ready','partial','empty'].includes(parsed.status)||!Array.isArray(parsed.warnings)||parsed.warnings.length>12||parsed.warnings.some(value=>typeof value!=='string'||value.length>1000)||Buffer.byteLength(parsed.text)>256000)throw fail('Le programme n’a pas confirmé le texte de cet exemple.');
        const text=parsed.text.slice(0,64000).replace(/[\uD800-\uDBFF]$/u,'');
        return{text,status:text.length<parsed.text.length?'partial':parsed.status,warnings:[...parsed.warnings,...(text.length<parsed.text.length?['Le texte dépasse la limite de lecture ; seule la première partie est préparée.']:[])].slice(0,12),characters:text.length,styleHints:parsed.styleHints&&typeof parsed.styleHints==='object'&&!Array.isArray(parsed.styleHints)&&Buffer.byteLength(JSON.stringify(parsed.styleHints))<=8000?parsed.styleHints:{}};
      };
      const operation=this.readerQueue.then(work);this.readerQueue=operation.catch(()=>{});
      try{result=await operation;}finally{this.readerControllers.delete(controller);}
    }
    this.referenceCache.set(key,structuredClone(result));while(this.referenceCache.size>16)this.referenceCache.delete(this.referenceCache.keys().next().value);
    return result;
  }
  async preview(id,{revision,signal}={}){
    if(revision!==undefined&&(typeof revision!=='string'||!/^[a-f0-9]{64}$/u.test(revision)))throw fail('La version de cet exemple n’est pas valide.');
    const{item,buffer}=await this.readItem(id,revision),result=await this.extractReference(item,buffer,{signal});
    return{id:item.id,name:item.name,type:item.type,revision:item.revision,...result};
  }
  async prepareReferences(ids,destination,{signal,characterBudget=256000}={}){
    await this.ready;if(!Array.isArray(ids)||ids.length>DOCUMENT_LIMITS.references||new Set(ids.map(row=>typeof row==='string'?row:row?.id)).size!==ids.length)throw fail('Choisissez au maximum huit exemples distincts.');
    if(!Number.isSafeInteger(characterBudget)||characterBudget<0||characterBudget>256000)throw fail('La limite de lecture du document est invalide.');
    await this.requireReferenceReader(ids);
    const directory=path.resolve(destination);if(!inside(this.missions.root,directory))throw fail('Les exemples doivent être copiés dans le dossier de cette mission.');await this.missions.directory(directory,{create:true});
    const folder=path.join(directory,'References'),references=[],written=[];let remaining=characterBudget;
    await this.missions.directory(folder,{create:true});
    const writeCopy=async(target,bytes)=>{await this.missions.directory(folder);const handle=await open(target,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o444);written.push(target);try{await handle.writeFile(bytes);}finally{await handle.close();}};
    try{
      for(const selected of ids){
        if(signal?.aborted)throw fail('La lecture des exemples a été arrêtée.','ABORT_ERR');
        const{item,buffer}=await this.readItem(typeof selected==='string'?selected:selected?.id,typeof selected==='object'?selected.revision:undefined),name=referenceName(item),target=path.join(folder,name);
        const extraction=await this.extractReference(item,buffer,{signal});
        const text=extraction.text.slice(0,remaining).replace(/[\uD800-\uDBFF]$/u,'');remaining-=text.length;
        if(text.length<extraction.text.length){extraction.status='partial';extraction.warnings=[...extraction.warnings,'Le budget de lecture de la mission est atteint ; cet extrait est partiel.'].slice(0,12);}
        const textTarget=path.join(folder,`${name}.extrait.txt`);
        await this.missions.directory(folder);if(signal?.aborted)throw fail('La lecture des exemples a été arrêtée.','ABORT_ERR');
        await writeCopy(target,buffer);
        await writeCopy(textTarget,text);
        references.push({...item,path:path.relative(directory,target),textPath:path.relative(directory,textTarget),readonly:true,extraction:{status:extraction.status,characters:text.length,warnings:extraction.warnings,styleHints:extraction.styleHints}});
      }
      if(signal?.aborted)throw fail('La lecture des exemples a été arrêtée.','ABORT_ERR');
      const manifestPath=path.join(folder,'manifest.json');await writeCopy(manifestPath,JSON.stringify({version:2,readerVersion:1,characterBudget,references},null,2)+'\n');
      return{references,manifestPath:path.relative(directory,manifestPath),characters:characterBudget-remaining};
    }catch(error){for(const file of written)await this.missions.remove(file).catch(()=>{});throw error.code==='EEXIST'?fail('Les références de cette mission existent déjà ; elles n’ont pas été remplacées.'):error;}
  }
  async installRuntime({confirmed=false,signal}={}){
    if(confirmed!==true)throw fail('Confirmez l’installation des outils locaux de documents.');
    await this.ready;
    if(this.closed)throw fail('Le bureau se ferme.');
    if(this.runtime.status==='installing'||this.runtime.available)return this.state();
    this.installController=new AbortController();
    const installSignal=signal?AbortSignal.any([signal,this.installController.signal]):this.installController.signal;
    const notify=()=>{try{this.onChange();}catch{}};
    this.runtime={status:'installing',available:false,message:'Préparation des outils de documents sur cet ordinateur…'};notify();
    this.installation=(async()=>{
      try{
        await this.runtimeStorage.directory(this.runtimeStorage.root,{create:true});
        let python=null;
        for(const candidate of [this.pythonOverride,process.env.OSCAR_DOCUMENT_PYTHON,...(process.env.PATH||'').split(path.delimiter).map(folder=>path.join(folder,'python3'))].filter(Boolean)){
          if(installSignal.aborted)throw fail('La préparation des outils de documents a été arrêtée.','ABORT_ERR');
          try{await access(candidate,constants.X_OK);await this.run(candidate,['-I','-c','import sys; assert sys.version_info >= (3,10); print("ok")'],{timeout:10000,maxBytes:1000,signal:installSignal});python=candidate;break;}catch{}
        }
        if(!python)throw fail('Python 3.10 ou plus est nécessaire pour préparer les documents.');
        if(!this.pythonOverride){
          await this.run(python,['-I','-m','venv',this.runtimeStorage.root],{timeout:120000,maxBytes:10000,signal:installSignal});
          await this.runtimeStorage.directory(this.runtimeStorage.root);python=await this.python();
          await this.run(python,['-I','-m','pip','install','--isolated','--only-binary=:all:','--disable-pip-version-check','--index-url','https://pypi.org/simple',...PACKAGES],{timeout:5*60000,maxBytes:1024*1024,signal:installSignal});
        }
        await this.run(python,['-I','-c',RUNTIME_PROBE],{timeout:15000,maxBytes:1000,signal:installSignal});
        if(installSignal.aborted)throw fail('La préparation des outils de documents a été arrêtée.','ABORT_ERR');
        this.runtime={status:'ready',available:true,message:'Les exports sont produits sur cet ordinateur, sans appel à un modèle.'};
      }catch(error){this.runtime={status:installSignal.aborted?'not_installed':'failed',available:false,message:installSignal.aborted?'La préparation des outils de documents a été arrêtée.':error.message||'Les outils de documents n’ont pas pu être installés. Vous pouvez réessayer.'};}
      finally{notify();}
    })();
    return this.state();
  }
  async close(){this.closed=true;this.installController?.abort();for(const controller of this.readerControllers)controller.abort();for(const controller of this.exportControllers)controller.abort();await Promise.allSettled([...this.exportTasks]);await this.readerQueue.catch(()=>{});await this.installation?.catch(()=>{});this.referenceCache.clear();}
  export(options={}){
    if(this.closed)return Promise.reject(fail('La préparation des documents a été arrêtée.','ABORT_ERR'));
    const controller=new AbortController(),signal=options.signal?AbortSignal.any([options.signal,controller.signal]):controller.signal;this.exportControllers.add(controller);
    const task=this.exportDocuments({...options,signal}).finally(()=>{this.exportControllers.delete(controller);this.exportTasks.delete(task);});this.exportTasks.add(task);return task;
  }
  async exportDocuments({sourcePath,sourceText,sourceType='md',destination,formats=['docx','pdf'],templateId,templatePath,templateType,templateRevision,title='Livraison',locale='fr',signal}={}){
    await this.ready;if(signal?.aborted)throw fail('La préparation des documents a été arrêtée.','ABORT_ERR');if(!this.runtime.available)throw fail('Installez les outils locaux de documents avant de lancer un export.','DOCUMENT_RUNTIME');if(!Array.isArray(formats)||!formats.length||formats.length>3||new Set(formats).size!==formats.length||formats.some(type=>!FORMATS.includes(type)))throw fail('Choisissez Word, PDF ou Excel.');
    let text=sourceText;if(sourcePath!==undefined){const file=path.resolve(sourcePath);if(!inside(this.missions.root,file))throw fail('Choisissez un livrable de cette mission.');sourceType=extension(file);if(!['md','txt','csv','json'].includes(sourceType))throw fail('L’export part d’un texte, Markdown, CSV ou JSON.');text=(await this.missions.read(file,DOCUMENT_LIMITS.sourceBytes)).toString('utf8');}
    if(typeof text!=='string'||!text.trim()||Buffer.byteLength(text)>DOCUMENT_LIMITS.sourceBytes||text.includes('\0'))throw fail('Le texte à exporter est vide ou dépasse 512 Ko.');if(!['md','txt','csv','json'].includes(sourceType))throw fail('L’export part d’un texte, Markdown, CSV ou JSON.');const directory=path.resolve(destination);if(!inside(this.missions.root,directory))throw fail('Les exports doivent rester dans le dossier de cette mission.');await this.missions.directory(directory,{create:true});
    let template=null;if(templatePath){const file=path.resolve(templatePath),type=templateType||extension(file);if(!inside(this.missions.root,file)||!['docx','xlsx'].includes(type)||extension(file)!==type)throw fail('Choisissez un modèle Word ou Excel copié dans cette mission.');const buffer=await this.missions.read(file,DOCUMENT_LIMITS.fileBytes);validateDocument(buffer,type);if(templateRevision&&sha(buffer)!==templateRevision)throw fail('La copie du modèle a changé. Relancez la mission avec une référence vérifiée.');template={type,name:path.basename(file),base64:buffer.toString('base64')};}else if(templateId){const{item,buffer}=await this.readItem(templateId,templateRevision);template={type:item.type,name:item.name,base64:buffer.toString('base64')};}
    const binary=await this.python();if(!binary)throw fail('Les outils de documents ne sont pas disponibles.');const job={text,sourceType,formats,template,title:String(title).slice(0,180),locale:['fr','en','nl'].includes(locale)?locale:'fr'};let result;try{result=JSON.parse(await this.run(binary,['-I',WORKER],{input:JSON.stringify(job),timeout:60000,signal}));}catch(error){throw fail(error.message||'La génération des documents n’a pas abouti.',error.code||'DOCUMENT_INVALID');}if(signal?.aborted)throw fail('La préparation des documents a été arrêtée.','ABORT_ERR');
    if(!Array.isArray(result.files)||result.files.length!==formats.length)throw fail('Le programme n’a pas confirmé les documents attendus.');const generated=result.files.map(file=>{if(!formats.includes(file.format)||typeof file.base64!=='string')throw fail('Le programme a renvoyé un document inattendu.');const buffer=decode(file.base64);validateDocument(buffer,file.format);return{format:file.format,buffer};});if(new Set(generated.map(file=>file.format)).size!==formats.length)throw fail('Le programme a renvoyé un document inattendu.');
    const base=(String(title).normalize('NFC').replace(/[\\/\x00-\x1f<>:"|?*]/gu,' ').replace(/\s+/gu,' ').trim().replace(/^[. ]+|[. ]+$/gu,'').slice(0,100)||'Livraison'),written=[],files=[];
    try{for(const file of generated){let target;for(let version=1;version<1000;version++){const name=`${base}${version===1?'':` (${version})`}.${file.format}`;target=path.join(directory,name);await this.missions.directory(directory);if(signal?.aborted)throw fail('La préparation des documents a été arrêtée.','ABORT_ERR');try{await writeFile(target,file.buffer,{flag:'wx',mode:0o600});break;}catch(error){if(error.code==='EEXIST'){target=null;continue;}throw error;}}if(!target)throw fail('Trop de livraisons portent déjà ce nom.');written.push(target);files.push({path:path.basename(target),size:file.buffer.length,type:file.format,sha256:sha(file.buffer)});}if(signal?.aborted)throw fail('La préparation des documents a été arrêtée.','ABORT_ERR');return{files,warnings:Array.isArray(result.warnings)?result.warnings.filter(item=>typeof item==='string').slice(0,8):[]};}catch(error){for(const file of written)await this.missions.remove(file).catch(()=>{});throw error;}
  }
}
