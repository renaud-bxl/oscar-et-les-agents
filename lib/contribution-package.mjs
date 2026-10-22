import path from 'node:path';

export const CONTRIBUTION_PACKAGE_LIMITS=Object.freeze({files:200,bytes:50*1024*1024,textBytes:2*1024*1024,references:1000});
const ASSETS=new Set(['.html','.htm','.js','.mjs','.cjs','.css','.json','.webmanifest','.svg','.png','.jpg','.jpeg','.gif','.webp','.avif','.ico','.woff','.woff2','.ttf','.otf','.mp3','.ogg','.wav','.mp4','.webm','.wasm']);
const PRIVATE=new Set(['contributions','references','rapports','reports','node_modules','vendor','state.json','preferences.json','package-lock.json','npm-shrinkwrap.json']);
const normalize=value=>value.normalize('NFD').replace(/[\u0300-\u036f]/gu,'').toLowerCase();
const safe=value=>typeof value==='string'&&value.length>0&&value.length<=256&&!value.startsWith('/')&&!/[\\:\x00-\x1f\x7f%?#]/u.test(value)&&value.split('/').every(part=>part&&part!=='.'&&part!=='..'&&!part.startsWith('.')&&part===part.trim()&&!PRIVATE.has(normalize(part))&&!/(?:^|[._-])(?:credentials?|secrets?|tokens?|passwords?)(?:[._-]|$)/iu.test(part));

// A component's rendering bench is not the assembled application. Restrict
// this distinction to known bench names alongside an actual JS/CSS module;
// putting an application (including index.html) in tests/ is no exemption.
export function isComponentVerificationPackage(task){
  if(!task||!['code','design'].includes(task.role)||!Array.isArray(task.deliverables))return false;
  const html=task.deliverables.filter(file=>typeof file==='string'&&/\.html?$/iu.test(file));
  if(!html.length||!task.deliverables.some(file=>typeof file==='string'&&/\.(?:[cm]?js|css)$/iu.test(file)))return false;
  const intent=normalize(`${task.title||''}\n${task.instruction||''}`);
  if(/\b(?:integr(?:er|ation|ate|ating)|assembl(?:er|age|e|ing)|jeu complet|complete (?:game|application|website)|application complete|site complet|livraison finale|volledige (?:spel|applicatie|website)|integreren|samenvoegen)\b/u.test(intent))return false;
  return html.every(file=>/^(?:test|tests|verification)\/(?:rendu|render|renderer|rendering|demo|preview|apercu|verification|controle|test|tests|spec|specs)(?:[-_](?:rendu|render|renderer|component|composant))?\.html?$/u.test(normalize(file)));
}

function resolveResource(from,input){
  let value=input.replace(/&amp;/gu,'&').trim();
  if(!value||value.startsWith('#')||/^(?:data|blob):/iu.test(value)||/^(?:[a-z][a-z\d+.-]*:|\/\/)/iu.test(value))return null;
  value=value.split(/[?#]/u)[0];
  try{value=decodeURIComponent(value);}catch{return{invalid:true};}
  if(!value||/[\\:\x00-\x1f\x7f%?#]/u.test(value))return{invalid:true};
  const parts=value.startsWith('/')?[]:path.posix.dirname(from)==='.'?[]:path.posix.dirname(from).split('/');
  for(const part of value.split('/')){
    if(!part||part==='.')continue;
    if(part==='..'){if(!parts.length)return{invalid:true};parts.pop();}else parts.push(part);
  }
  const relative=parts.join('/');return safe(relative)?{relative}:{invalid:true};
}

// Parse only static resource references. This never evaluates JavaScript,
// follows a URL, runs a build or reads an arbitrary sibling directory.
function resources(file,source){
  const found=[];const add=(value,required=true)=>{if(found.length>=CONTRIBUTION_PACKAGE_LIMITS.references)return;found.push({value,required});};
  const extension=path.posix.extname(file).toLowerCase();
  if(['.html','.htm'].includes(extension)){
    const clean=source.replace(/<!--[\s\S]*?-->/gu,'');
    for(const match of clean.matchAll(/<(?:script|link|img|source|audio|video|input|iframe|embed|object)\b[^>]{0,12000}>/giu)){
      const tag=match[0];
      for(const attribute of tag.matchAll(/\b(?:src|href|poster|data)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/giu))add(attribute[1]??attribute[2]??attribute[3]);
      for(const attribute of tag.matchAll(/\bsrcset\s*=\s*(?:"([^"]*)"|'([^']*)')/giu))for(const candidate of(attribute[1]??attribute[2]).split(','))if(!candidate.trim().startsWith('data:'))add(candidate.trim().split(/\s/u)[0]);
    }
  }
  if(['.css','.html','.htm'].includes(extension)){
    for(const match of source.matchAll(/\burl\(\s*(?:"([^"]*)"|'([^']*)'|([^\s)]+))\s*\)/giu))add(match[1]??match[2]??match[3]);
    for(const match of source.matchAll(/@import\s+(?:"([^"]*)"|'([^']*)')/giu))add(match[1]??match[2]);
  }
  if(['.js','.mjs','.cjs','.html','.htm'].includes(extension)){
    for(const match of source.matchAll(/\b(?:import|export)\s+(?:[^;\r\n]{0,500}?\s+from\s*)?["']([^"'\r\n]+)["']/gu))add(match[1]);
    for(const match of source.matchAll(/\b(?:import|require|fetch)\s*\(\s*["']([^"'\r\n]+)["']/gu))add(match[1]);
    for(const match of source.matchAll(/\bnew\s+(?:URL|Audio|Worker)\s*\(\s*["']([^"'\r\n]+)["']/gu))add(match[1]);
    for(const match of source.matchAll(/\b(?:src|href|url|file|path|image|icon|texture|sprite|background|asset|sound|audio|music|poster)\s*[:=]\s*["']([^"'\r\n]+)["']/giu))add(match[1]);
    for(const match of source.matchAll(/\b(?:new\s+(?:URL|Audio|Worker)|import|fetch)\s*\(\s*`([^`$\r\n]{0,1000})\$\{[a-zA-Z_$][\w$]*\}([^`$\r\n]{0,1000})`/gu)){
      if(found.length<CONTRIBUTION_PACKAGE_LIMITS.references)found.push({template:{prefix:match[1],suffix:match[2]},required:true});
    }
  }
  // Literal file names in JSON manifests, asset arrays and local data may be
  // genuine resources; include existing ones without treating UI prose as a
  // missing-file error. Dynamic expressions still require a real game test.
  if(['.js','.mjs','.cjs','.json','.webmanifest','.html','.htm'].includes(extension))for(const match of source.matchAll(/(["'`])([^"'`\r\n]{1,1000})\1/gu)){
    const value=match[2];if(!value.includes('${')&&ASSETS.has(path.posix.extname(value.split(/[?#]/u)[0]).toLowerCase()))add(value,false);
  }
  return found;
}

export function captureContributionPackage({deliverables,readFile,listFiles,componentVerification=false}={}){
  if(!Array.isArray(deliverables)||typeof readFile!=='function')throw new TypeError('Un inventaire local et un lecteur vérifié sont nécessaires.');
  if(typeof componentVerification!=='boolean')throw new TypeError('Le type de contribution doit être vérifié.');
  const completeBundle=!componentVerification&&deliverables.some(file=>['.html','.htm'].includes(path.posix.extname(file).toLowerCase()));
  const snapshots=[],issues=new Set(),known=new Set(),missing=new Set(),pending=deliverables.map(relative=>({relative,required:true}));let bytes=0;
  while(pending.length){
    const {relative,required}=pending.shift();
    if(known.has(relative))continue;
    if(missing.has(relative)){if(required)issues.add(`Ressource locale absente ou invalide : ${relative}`);continue;}
    if(!safe(relative)){if(required)issues.add(`Référence locale non autorisée : ${String(relative).slice(0,256)}`);continue;}
    if(known.size+missing.size>=CONTRIBUTION_PACKAGE_LIMITS.files){issues.add('Le paquet de cette contribution dépasse 200 fichiers locaux.');break;}
    const file=readFile(relative);
    if(!file){missing.add(relative);if(required)issues.add(`Ressource locale absente ou invalide : ${relative}`);continue;}
    known.add(relative);
    bytes+=file.bytes.length;
    if(bytes>CONTRIBUTION_PACKAGE_LIMITS.bytes){issues.add('Le paquet de cette contribution dépasse 50 Mo.');break;}
    snapshots.push({path:relative,hash:file.hash,size:file.bytes.length});
    const extension=path.posix.extname(relative).toLowerCase();
    if(!['.html','.htm','.js','.mjs','.cjs','.css','.json','.webmanifest'].includes(extension))continue;
    if(file.bytes.length>CONTRIBUTION_PACKAGE_LIMITS.textBytes){issues.add(`La lecture des références dépasse 2 Mo pour ${relative}.`);continue;}
    const references=resources(relative,file.bytes.toString('utf8'));
    if(references.length>=CONTRIBUTION_PACKAGE_LIMITS.references){issues.add(`Trop de références locales dans ${relative}.`);continue;}
    for(const reference of references){
      if(reference.template){
        const {prefix,suffix}=reference.template;
        const resource=resolveResource(relative,`${prefix}OSCAR_DYNAMIC_RESOURCE${suffix}`);
        if(!resource?.relative||suffix.includes('/')||typeof listFiles!=='function'){
          if(completeBundle)issues.add(`Référence dynamique locale non résolue dans ${relative}.`);continue;
        }
        const directory=path.posix.dirname(resource.relative),base=path.posix.basename(resource.relative),marker='OSCAR_DYNAMIC_RESOURCE';
        const start=base.slice(0,base.indexOf(marker)),end=base.slice(base.indexOf(marker)+marker.length);
        const candidates=listFiles(directory);
        if(!Array.isArray(candidates)||candidates.length>CONTRIBUTION_PACKAGE_LIMITS.files){issues.add(`Inventaire local trop grand ou indisponible dans ${relative}.`);continue;}
        const matching=candidates.filter(candidate=>safe(candidate)&&path.posix.dirname(candidate)===directory&&path.posix.basename(candidate).startsWith(start)&&path.posix.basename(candidate).endsWith(end)&&ASSETS.has(path.posix.extname(candidate).toLowerCase()));
        if(!matching.length&&completeBundle)issues.add(`Ressources dynamiques locales absentes dans ${relative}.`);
        for(const candidate of matching)if(!known.has(candidate))pending.push({relative:candidate,required:completeBundle});
        continue;
      }
      const resource=resolveResource(relative,reference.value);if(!resource)continue;
      if(resource.invalid){if(reference.required&&completeBundle)issues.add(`Référence locale hors du paquet ou privée dans ${relative}.`);continue;}
      if(!ASSETS.has(path.posix.extname(resource.relative).toLowerCase())){if(reference.required&&completeBundle)issues.add(`Format de ressource locale non pris en charge : ${resource.relative}`);continue;}
      if(!known.has(resource.relative))pending.push({relative:resource.relative,required:reference.required&&completeBundle});
    }
    if(pending.length>CONTRIBUTION_PACKAGE_LIMITS.references){issues.add('Le paquet contient trop de références locales.');break;}
  }
  return{snapshots,issues:[...issues]};
}
