import http from 'node:http';
import path from 'node:path';
import {constants} from 'node:fs';
import {lstat,realpath,open} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';

export const BROWSER_PREVIEW_LIMITS=Object.freeze({files:200,fileBytes:15*1024*1024,totalBytes:50*1024*1024,snapshots:4,ttlMs:60*60*1000});
const TERMINAL=new Set(['completed','needs_review','failed','cancelled']);
const MIME=new Map(Object.entries({'.html':'text/html; charset=utf-8','.htm':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.webmanifest':'application/manifest+json; charset=utf-8','.txt':'text/plain; charset=utf-8','.csv':'text/csv; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.webp':'image/webp','.avif':'image/avif','.ico':'image/x-icon','.woff':'font/woff','.woff2':'font/woff2','.ttf':'font/ttf','.otf':'font/otf','.mp3':'audio/mpeg','.ogg':'audio/ogg','.wav':'audio/wav','.mp4':'video/mp4','.webm':'video/webm','.wasm':'application/wasm'}));
const PRIVATE=new Set(['node_modules','rapports','reports','references','reference','contributions','data','state.json','preferences.json','credentials.json','package-lock.json','npm-shrinkwrap.json','modele de mise en page']);
const error=(message,code='BROWSER_PREVIEW_INVALID',status=400)=>Object.assign(new Error(message),{code,status});
const plain=value=>String(value).normalize('NFD').replace(/[\u0300-\u036f]/gu,'').toLowerCase();
const inside=(root,file)=>file===root||file.startsWith(root+path.sep);
function safeRelative(value){
  return typeof value==='string'&&value.length>0&&value.length<=1000&&!path.isAbsolute(value)&&!/[\\\x00-\x1f\x7f:%?#]/u.test(value)&&value.split('/').every(part=>part&&part!=='.'&&part!=='..'&&!part.startsWith('.')&&!PRIVATE.has(plain(part))&&!/(?:^|[._-])(?:credentials?|secrets?|tokens?|passwords?)(?:[._-]|$)/iu.test(part));
}
function knownAssets(mission){
  if(!Array.isArray(mission.files)||mission.files.length>20000)throw error('La liste des fichiers de cette mission n’est pas disponible.');
  return [...new Set(mission.files.map(file=>file?.path).filter(relative=>safeRelative(relative)&&MIME.has(path.posix.extname(relative).toLowerCase())))].sort();
}
function chooseEntry(files,entry){
  const entries=files.filter(file=>path.posix.basename(file)==='index.html');
  if(entry!==undefined&&entry!==''){
    if(!safeRelative(entry)||path.posix.basename(entry)!=='index.html'||!entries.includes(entry))throw error('Choisissez un fichier index.html présent dans la livraison.');
    return entry;
  }
  for(const preferred of ['Livraison/dist/index.html','Livraison/build/index.html','Livraison/out/index.html','Livraison/index.html','livraison/dist/index.html','livraison/build/index.html','livraison/out/index.html','livraison/index.html','dist/index.html','build/index.html','out/index.html','index.html'])if(entries.includes(preferred))return preferred;
  if(entries.length===1)return entries[0];
  if(entries.length>1)throw Object.assign(error('Plusieurs sites sont présents. Choisissez le fichier index.html à essayer.','BROWSER_PREVIEW_AMBIGUOUS'),{entries});
  throw error('Aucun site ou jeu avec index.html n’a été trouvé dans cette mission.','BROWSER_PREVIEW_NO_ENTRY');
}
function htmlTags(source,visit){
  // Treat inline script/style bodies and comments as opaque. Resource paths
  // are adjusted only in real opening tags, never in JavaScript source text.
  return source.replace(/<!--[\s\S]*?-->|<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>|<(?:script|style|link|img|source|audio|video)\b[^>]*>/giu,block=>{
    if(block.startsWith('<!--'))return block;const opening=/^<[^>]+>/u.exec(block)?.[0];return opening?visit(opening)+block.slice(opening.length):block;
  });
}
function localReference(value){
  const source=value.replace(/&amp;/gu,'&');if(!source||source.startsWith('#')||/^(?:data|blob):/iu.test(source))return null;
  if(/^(?:[a-z][a-z\d+.-]*:|\/\/)/iu.test(source))return{external:true};
  let depth=0;for(const segment of source.split(/[?#]/u)[0].split('/')){if(segment==='..'){if(--depth<0)return{outside:true};}else if(segment&&segment!=='.')depth++;}
  try{const url=new URL(source,'http://preview.invalid/'),relative=decodeURIComponent(url.pathname.slice(1));return{relative,absolute:source.startsWith('/'),suffix:url.search+url.hash};}catch{return{outside:true};}
}
function inspectPage(bytes,assets){
  const source=bytes.toString('utf8'),warnings=new Set();let needsBuild=false,missing=false;
  htmlTags(source,tag=>{
    const name=/^<(\w+)/u.exec(tag)?.[1]?.toLowerCase();
    for(const match of tag.matchAll(/\b(src|href|poster)\s*=\s*(['"])(.*?)\2/giu)){
      if(match[1].toLowerCase()==='href'&&name!=='link')continue;const reference=localReference(match[3]);if(!reference)continue;
      if(reference.external){warnings.add('Certaines ressources externes ne sont pas chargées dans cet aperçu local.');continue;}
      const core=name==='script'||name==='link'&&/\brel\s*=\s*(['"])stylesheet\1/iu.test(tag);
      if(core&&/\.(?:tsx?|jsx|vue|svelte|scss|sass|less)(?:[?#]|$)/iu.test(match[3]))needsBuild=true;
      else if(reference.outside||!assets.has(reference.relative)){if(core)missing=true;else warnings.add('Certaines images ou ressources de cette page sont absentes du dossier d’aperçu.');}
    }
    return tag;
  });
  if(needsBuild)throw error('Ce projet contient des fichiers source à compiler. Une version statique dans dist/ ou build/ est nécessaire pour le tester ici.','BROWSER_PREVIEW_BUILD_REQUIRED');
  if(missing)throw error('Un script ou une feuille de style nécessaire à cette page manque dans le dossier d’aperçu. Les fichiers sont conservés.','BROWSER_PREVIEW_MISSING_ASSETS');
  return{source,warnings:[...warnings]};
}
const DIAGNOSTICS_SCRIPT=`<script data-oscar-preview-diagnostics>(function(){'use strict';var sent=0;function send(code,value){if(sent>=20)return;sent++;var message=String(value||'').replace(/http:\\/\\/127\\.0\\.0\\.1:\\d+\\/[a-f\\d]{64}\\//g,'/').replace(/[\\u0000-\\u001f\\u007f]/g,' ').slice(0,512);if(window.parent!==window)window.parent.postMessage({type:'oscar-preview',profile:'static-web-v1',kind:code==='ready'?'ready':'error',code:code,message:message},'*');}window.addEventListener('error',function(event){if(event.target&&event.target!==window){send('resource',(event.target.tagName||'Resource')+' could not be loaded.');}else send('runtime',event.message||'Runtime error.');},true);window.addEventListener('unhandledrejection',function(event){send('promise',event.reason&&event.reason.message||event.reason||'Unhandled promise rejection.');});var originalError=console.error;console.error=function(){try{send('console',Array.prototype.slice.call(arguments,0,3).map(String).join(' ').slice(0,512));}catch(ignored){}return originalError.apply(console,arguments);};window.addEventListener('securitypolicyviolation',function(){send('resource','A resource was blocked by the local preview policy.');});window.addEventListener('DOMContentLoaded',function(){send('ready','Preview page loaded.');},{once:true});})();</script>`;
function previewPage(source,prefix,assets){
  const rebased=htmlTags(source,tag=>tag.replace(/\b(src|href|poster)(\s*=\s*)(['"])(.*?)\3/giu,(whole,attribute,equals,quote,value)=>{
    if(attribute.toLowerCase()==='href'&&!/^<link\b/iu.test(tag))return whole;
    const reference=localReference(value);if(!reference?.absolute||!assets.has(reference.relative))return whole;
    return attribute+equals+quote+prefix+reference.relative.split('/').map(encodeURIComponent).join('/')+reference.suffix.replace(/&/gu,'&amp;')+quote;
  }));
  if(!/<(?:!doctype\s+html|html|head|body|script|main|canvas|div)\b/iu.test(rebased))return Buffer.from(rebased);
  const anchor=/<head\b[^>]*>/iu.exec(rebased)||/<html\b[^>]*>/iu.exec(rebased)||/<!doctype\s+html[^>]*>/iu.exec(rebased),at=anchor?anchor.index+anchor[0].length:0;
  return Buffer.from(rebased.slice(0,at)+DIAGNOSTICS_SCRIPT+rebased.slice(at));
}
async function safeFile(base,relative){
  let current=base;const parts=relative.split('/');
  for(const [index,part]of parts.entries()){
    current=path.join(current,part);const info=await lstat(current);
    if(info.isSymbolicLink()||index<parts.length-1&&!info.isDirectory()||index===parts.length-1&&!info.isFile())throw error('Un aperçu ne peut pas utiliser de lien ou de fichier spécial.');
  }
  if(!inside(base,await realpath(current)))throw error('Un fichier est sorti du dossier de la mission.');
  return {file:current,info:await lstat(current)};
}
const sameFile=(a,b)=>a.isFile()&&b.isFile()&&a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&a.mtimeMs===b.mtimeMs;
async function readAsset(base,relative,remaining){
  const checked=await safeFile(base,relative);
  if(checked.info.size>BROWSER_PREVIEW_LIMITS.fileBytes||checked.info.size>remaining)throw error('Aperçu limité à 200 fichiers, 15 Mo par fichier et 50 Mo au total.','BROWSER_PREVIEW_LIMIT');
  const handle=await open(checked.file,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
  try{
    const before=await handle.stat(),current=await safeFile(base,relative);
    if(!sameFile(before,checked.info)||!sameFile(before,current.info))throw error('Les fichiers ont changé pendant la préparation. Préparez un nouvel aperçu.');
    const chunks=[];let length=0;
    while(true){
      const chunk=Buffer.alloc(Math.min(64*1024,Math.max(1,remaining-length+1))),result=await handle.read(chunk,0,chunk.length,null);
      if(!result.bytesRead)break;length+=result.bytesRead;
      if(length>BROWSER_PREVIEW_LIMITS.fileBytes||length>remaining)throw error('Aperçu limité à 200 fichiers, 15 Mo par fichier et 50 Mo au total.','BROWSER_PREVIEW_LIMIT');
      chunks.push(chunk.subarray(0,result.bytesRead));
    }
    const after=await handle.stat(),last=await safeFile(base,relative);
    if(!sameFile(before,after)||!sameFile(after,last.info)||length!==before.size)throw error('Les fichiers ont changé pendant la préparation. Préparez un nouvel aperçu.');
    return Buffer.concat(chunks,length);
  }finally{await handle.close();}
}
function policy(prefix){
  return ["sandbox allow-scripts","default-src 'none'",`script-src 'unsafe-inline' ${prefix}`,`style-src 'unsafe-inline' ${prefix}`,`img-src ${prefix} data: blob:`,`media-src ${prefix} data: blob:`,`font-src ${prefix} data: blob:`,`connect-src ${prefix}`,"worker-src 'none'","frame-src 'none'","child-src 'none'","object-src 'none'","base-uri 'none'","form-action 'none'"].join('; ');
}

/** Serves immutable, known delivery assets on an isolated loopback port only. */
export class BrowserPreviews{
  constructor({getMission,workDir,isActive=()=>false,now=Date.now}={}){
    if(typeof getMission!=='function'||typeof workDir!=='function')throw new TypeError('La mission et son dossier sont nécessaires.');
    Object.assign(this,{getMission,workDir,isActive,now});this.snapshots=new Map();this.pending=Promise.resolve();this.closed=false;this.server=null;this.timer=null;
  }
  async mission(id){
    if(this.closed)throw error('Le bureau se ferme.','BROWSER_PREVIEW_CLOSED',503);
    const mission=await this.getMission(id);if(!mission)throw error('Mission inconnue.','BROWSER_PREVIEW_NOT_FOUND',404);
    if(await this.isActive(id)||!TERMINAL.has(mission.status))throw error('Attendez la fin de cette mission avant d’essayer ses fichiers.','BROWSER_PREVIEW_BUSY',409);
    return mission;
  }
  prepare(id,{entry}={}){
    // Serialise preparation to bound temporary memory as well as retained
    // snapshots, even if several buttons are clicked at the same time.
    const job=this.pending.then(()=>this._prepare(id,entry));this.pending=job.catch(()=>{});return job;
  }
  async _prepare(id,requestedEntry){
    const mission=await this.mission(id),known=knownAssets(mission),entry=chooseEntry(known,requestedEntry),root=path.posix.dirname(entry);
    const relativeRoot=root==='.'?'':root+'/',selected=known.filter(file=>file.startsWith(relativeRoot));
    if(selected.length>BROWSER_PREVIEW_LIMITS.files)throw error('Aperçu limité à 200 fichiers, 15 Mo par fichier et 50 Mo au total.','BROWSER_PREVIEW_LIMIT');
    const directory=this.workDir(id),baseInfo=await lstat(directory);
    if(baseInfo.isSymbolicLink()||!baseInfo.isDirectory())throw error('Le dossier de cette mission n’est pas accessible.');
    const base=await realpath(directory),assets=new Map();let total=0;
    for(const relative of selected){
      const bytes=await readAsset(base,relative,BROWSER_PREVIEW_LIMITS.totalBytes-total);total+=bytes.length;
      assets.set(relative.slice(relativeRoot.length),{bytes,type:MIME.get(path.posix.extname(relative).toLowerCase())});
    }
    const page=inspectPage(assets.get('index.html').bytes,assets),latest=knownAssets(await this.mission(id));
    if(path.resolve(this.workDir(id))!==path.resolve(directory)||selected.some(file=>!latest.includes(file))||(await realpath(directory))!==base)throw error('Les fichiers ont changé pendant la préparation. Préparez un nouvel aperçu.');
    await this.listen();if(this.closed)throw error('Le bureau se ferme.','BROWSER_PREVIEW_CLOSED',503);
    const token=randomBytes(32).toString('hex'),expiresAt=this.now()+BROWSER_PREVIEW_LIMITS.ttlMs,prefix=`${this.origin}/${token}/`;
    const html=previewPage(page.source,prefix,assets),original=assets.get('index.html');
    if(total-original.bytes.length+html.length>BROWSER_PREVIEW_LIMITS.totalBytes||html.length>BROWSER_PREVIEW_LIMITS.fileBytes)throw error('Aperçu limité à 200 fichiers, 15 Mo par fichier et 50 Mo au total.','BROWSER_PREVIEW_LIMIT');
    this.prune();while(this.snapshots.size>=BROWSER_PREVIEW_LIMITS.snapshots)this.snapshots.delete(this.snapshots.keys().next().value);
    assets.set('index.html',{...original,bytes:html});this.snapshots.set(token,{assets,expiresAt,prefix});this.armExpiry();
    return {url:prefix+'index.html',entry,root,files:[...assets].map(([asset,value])=>({path:asset,size:value.bytes.length})),count:assets.size,expiresAt,profile:'static-web-v1',warnings:page.warnings};
  }
  async listen(){
    if(this.server)return;
    const server=http.createServer({maxHeaderSize:8192},(req,res)=>this.serve(req,res));this.server=server;
    server.requestTimeout=10000;server.headersTimeout=10000;server.keepAliveTimeout=1000;server.maxRequestsPerSocket=100;
    try{await new Promise((resolve,reject)=>{const failed=err=>{server.off('listening',ready);reject(err);},ready=()=>{server.off('error',failed);resolve();};server.once('error',failed);server.once('listening',ready);server.listen(0,'127.0.0.1');});}
    catch(cause){this.server=null;throw cause;}
    this.origin=`http://127.0.0.1:${server.address().port}`;this.host=`127.0.0.1:${server.address().port}`;server.unref();
  }
  prune(){for(const[token,snapshot]of this.snapshots)if(snapshot.expiresAt<=this.now())this.snapshots.delete(token);}
  armExpiry(){
    clearTimeout(this.timer);this.timer=null;if(!this.snapshots.size||this.closed)return;
    const delay=Math.max(1,Math.min(...[...this.snapshots.values()].map(snapshot=>snapshot.expiresAt))-this.now());
    this.timer=setTimeout(()=>{this.prune();this.armExpiry();},delay);this.timer.unref?.();
  }
  serve(req,res){
    const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Cross-Origin-Opener-Policy':'same-origin','Permissions-Policy':'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), clipboard-read=(), clipboard-write=()'};
    const fail=status=>{res.writeHead(status,{...headers,'Content-Type':'text/plain; charset=utf-8',...(status===405?{Allow:'GET, HEAD'}:{})});res.end(req.method==='HEAD'?'':'Aperçu indisponible.');};
    if(req.headers.host!==this.host){fail(421);return;}
    if(!['GET','HEAD'].includes(req.method)){fail(405);return;}
    // Inspect the original request target, before URL dot-segment normalisation.
    const raw=req.url?.split('?')[0],match=typeof raw==='string'&&/^\/([a-f\d]{64})\/(.+)$/u.exec(raw);
    if(!match){fail(404);return;}
    let relative;try{relative=decodeURIComponent(match[2]);}catch{fail(404);return;}
    if(!safeRelative(relative)||relative.includes('%')){fail(404);return;}
    this.prune();const snapshot=this.snapshots.get(match[1]),asset=snapshot?.assets.get(relative);
    if(!asset){fail(404);return;}
    res.writeHead(200,{...headers,'Content-Type':asset.type,'Content-Length':asset.bytes.length,'Content-Security-Policy':policy(snapshot.prefix),'Access-Control-Allow-Origin':'*','Cross-Origin-Resource-Policy':'cross-origin'});res.end(req.method==='HEAD'?undefined:asset.bytes);
  }
  async close(){
    this.closed=true;clearTimeout(this.timer);this.timer=null;await this.pending;this.snapshots.clear();
    const server=this.server;this.server=null;if(server){await new Promise(resolve=>{server.close(resolve);server.closeAllConnections?.();});}
  }
}
