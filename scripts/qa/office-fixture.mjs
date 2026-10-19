/** Isolated QA office. All providers and account connections are simulated. */
import {mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {createAtelierServer} from '../../server.mjs';
import {Automations} from '../../lib/automations.mjs';

export const providers=[{id:'codex',available:true,auth:{loggedIn:true,method:'chatgpt'}},{id:'claude',available:true,auth:{loggedIn:true,method:'subscription'}}];
const connections=['gmail','calendar'].map(type=>({client:'codex',name:`qa-${type}`,displayName:type==='gmail'?'Gmail · simulation':'Google Agenda · simulation',type,source:'chatgpt',inherited:true,status:'authorized',readOnlyAutomation:{available:true,service:type}}));
function fixturePdf(){
 const content='BT /F1 22 Tf 50 120 Td (Oscar - controle local) Tj ET';
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 240] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',`<< /Length ${content.length} >>\nstream\n${content}\nendstream`,'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
 let text='%PDF-1.4\n';const offsets=[0];for(let index=0;index<objects.length;index++){offsets.push(Buffer.byteLength(text));text+=`${index+1} 0 obj\n${objects[index]}\nendobj\n`;}
 const xref=Buffer.byteLength(text);text+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.slice(1).map(offset=>String(offset).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;return Buffer.from(text);
}
export async function startOfficeFixture({demoDelay=30,runnerDelay=30}={}){
 const dataDir=await mkdtemp(path.join(os.tmpdir(),'oscar-office-qa-'));
 const metrics={calls:0,openedFolders:[],openedFiles:[],dictationInstalls:0,transcriptions:0,connectorReads:0,sseOpened:0,sseActive:0};
 const eventStreams=new Set();
 let clock=Date.now();
 const runner=async input=>{
  metrics.calls++;
  await delay(/QA_HOLD/u.test(input.prompt)?600000:runnerDelay,null,{signal:input.signal});
  input.onActivity?.('Vérification simulée locale');
  const properties=input.schema?.properties;
  if(properties?.answer)return{text:JSON.stringify({title:'Réponse de contrôle',answer:'# Réponse de Zoé\n\n1. Votre demande a été traitée dans un moteur simulé.\n2. Aucun compte privé ni service externe n’a été contacté.\n\n[Documentation de contrôle](https://example.com/controle)'})};
  if(properties?.approved)return{text:JSON.stringify({approved:true,feedback:'Les fichiers du contrôle isolé existent et sont lisibles.'})};
  if(properties?.tasks)return{text:JSON.stringify({title:'Projet de contrôle',approach:'Créer une contribution, puis la contrôler.',tasks:[{role:'design',title:'Un dessin de contrôle',instruction:'Créer dessin.svg.',criteria:'Le SVG existe.',deliverables:['dessin.svg']}]})};
  if(/t\d+-design$/u.test(input.cwd))await writeFile(path.join(input.cwd,'dessin.svg'),'<svg xmlns="http://www.w3.org/2000/svg" width="400" height="240"><rect width="400" height="240" fill="#355d51"/><text x="30" y="100" fill="white">Bonjour Oscar</text></svg>');
  else{await mkdir(path.join(input.cwd,'Livraison'),{recursive:true});await writeFile(path.join(input.cwd,'Livraison','index.html'),'<!doctype html><html lang="fr"><title>Contrôle isolé</title><h1>Oscar et les Agents</h1><p>Fichier local de test.</p></html>');await writeFile(path.join(input.cwd,'Livraison','controle.pdf'),fixturePdf());}
  return{text:'# Livraison du contrôle\n\nUn fichier réel a été créé et contrôlé dans ce bureau isolé.'};
 };
 const app=await createAtelierServer({port:0,dataDir,providers:structuredClone(providers),detect:async()=>structuredClone(providers),runner,demoDelay,
  openFolder:async folder=>metrics.openedFolders.push(folder),openFile:async file=>metrics.openedFiles.push(file),
  connectorsFactory:()=>({ready:Promise.resolve(),active:new Set(),disabledNames:()=>[],state:async()=>({catalog:[],connections:structuredClone(connections),jobs:[],clients:{codex:{available:true,status:'ready'},claude:{available:true,status:'ready'}}}),readPlan:async({client,name})=>{metrics.connectorReads++;const match=connections.find(row=>row.client===client&&row.name===name);if(!match)throw new Error('Service simulé introuvable.');return Object.freeze({client,name,type:match.type,source:'chatgpt',enabledTools:['read']});},close:async()=>{}}),
  automationFactory:options=>new Automations({...options,now:()=>clock,pollMs:1000}),
  dictationFactory:()=>({ready:Promise.resolve(),state:async()=>({status:'ready',available:true,supported:true,maxSeconds:90,maxAudioBytes:8388608}),install:async()=>{metrics.dictationInstalls++;throw new Error('Aucun téléchargement pendant les contrôles.');},transcribe:async()=>{metrics.transcriptions++;return{text:'Créer un jeu de réflexion avec trois niveaux.'};},close:async()=>{}}),
 });
 app.server.on('request',(req,res)=>{if(req.url==='/api/events'){eventStreams.add(res);metrics.sseOpened++;metrics.sseActive=eventStreams.size;res.once('close',()=>{eventStreams.delete(res);metrics.sseActive=eventStreams.size;});}});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 const base=`http://127.0.0.1:${app.server.address().port}`;
 const post=async(route,body={})=>{const response=await fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json','X-Oscar-Client':'1'},body:JSON.stringify(body)});return{status:response.status,body:await response.json()};};
 return{app,base,dataDir,metrics,post,interruptEvents:()=>{for(const stream of eventStreams)stream.destroy();},advance:async ms=>{clock+=ms;await app.automations.tick();},close:async()=>{await app.close();await rm(dataDir,{recursive:true,force:true});}};
}

export async function launchBrowser(){
 const specifier=process.env.OSCAR_QA_PLAYWRIGHT||'playwright';
 let playwright;
 try{playwright=await import(specifier);}catch{throw new Error('Set OSCAR_QA_PLAYWRIGHT to the installed Playwright module, or install Playwright outside the application.');}
 return playwright.chromium.launch({headless:true,...(process.env.OSCAR_QA_CHROMIUM?{executablePath:process.env.OSCAR_QA_CHROMIUM}:{})});
}
export async function preparePage(browser,base,{width=1600,height=1050}={}){
 const context=await browser.newContext({viewport:{width,height}}),page=await context.newPage(),errors=[],external=[];
 page.on('pageerror',error=>errors.push(error.message));context.on('page',other=>{if(other!==page)other.on('pageerror',error=>errors.push(error.message));});
 await context.route('**/*',async route=>{const url=route.request().url();if(/^https?:/u.test(url)&&!url.startsWith(base+'/')){external.push(url);await route.abort();}else await route.continue();});
 await page.addInitScript(()=>{localStorage.setItem('oscar-guide-v1','seen');localStorage.setItem('oscar-voice-v1',JSON.stringify({version:2,engine:'captions',enabled:false,voice:'auto'}));sessionStorage.setItem('oscar-welcome-dismissed','1');});
 await page.goto(base+'/?new=1',{waitUntil:'networkidle'});
 await page.waitForFunction(()=>window.__oscarWorld);
 return{page,errors,external};
}
