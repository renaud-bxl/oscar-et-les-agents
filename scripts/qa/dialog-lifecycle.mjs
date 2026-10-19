/** Reopening a dialog must survive the previous native close event. */
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {startOfficeFixture,launchBrowser} from './office-fixture.mjs';
const fixture=await startOfficeFixture(),browser=await launchBrowser(),output=process.env.OSCAR_QA_OUTPUT||path.join(os.tmpdir(),'oscar-dialog-lifecycle');await mkdir(output,{recursive:true});
try{
 const context=await browser.newContext(),page=await context.newPage(),errors=[],external=[];page.on('pageerror',error=>errors.push(error.message));
 await context.route('**/*',async route=>{const url=route.request().url();if(url===fixture.base+'/qa-dialogs'){await route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="fr"><title>Cycle de fenêtres isolé</title><body><button id="outside">Bureau de contrôle</button></body></html>'});}else if(/^https?:/u.test(url)&&!url.startsWith(fixture.base+'/')){external.push(url);await route.abort();}else await route.continue();});
 await page.goto(fixture.base+'/qa-dialogs');
 const results=await page.evaluate(async()=>{
  const [{DictationDialog},{PersonalizationDialog},{VoiceDialog},{ConnectorsDialog},{WelcomeGuide},{PublicationDialog}]=await Promise.all(['/dictation-dialog.js','/personalization-dialog.js','/voice-dialog.js','/connectors-dialog.js','/welcome-guide.js','/publication-dialog.js'].map(url=>import(url)));
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),results=[];
  const state={providers:[{id:'codex',available:true,auth:{loggedIn:true,method:'chatgpt'}}],missions:[],logins:{}};
  const request=async url=>url==='/api/dictation'?{status:'ready',available:true,supported:true}:url==='/api/profile'?{profile:{name:'',region:'',weatherEnabled:false},weather:{status:'disabled'}}:url==='/api/connectors'?{catalog:[],connections:[],jobs:[],clients:{}}:url==='/api/publishing'?{github:{available:false,connected:false},ftp:{available:false}}:url.includes('/publication')?{status:'idle'}:{};
  const cases=[
   ['dictation',onClose=>new DictationDialog({request,onClose}),async(dialog,reopen)=>{const target=()=>{};await dialog.open({initialText:reopen?'Deuxième demande':'Première demande',onText:target});return{target};},(dialog,marker)=>({notified:dialog.notified===false,target:dialog.targetOnText===marker.target,text:dialog.transcript.value==='Deuxième demande'})],
   ['personalization',onClose=>new PersonalizationDialog({request,onClose}),async(dialog,reopen)=>{await dialog.open();if(reopen){dialog.name.value='Profil factice';dialog.dirty=true;}return{};},dialog=>({notified:dialog.notified===false,text:dialog.name.value==='Profil factice'})],
   ['voice',onClose=>new VoiceDialog({onClose,getSpeech:()=>({getState:()=>({engine:'captions',enabled:false,available:false,characterVoices:{},voices:[],locale:'fr',local:{status:'not_installed',voices:[]}}),refreshLocal:async()=>{},stop:()=>{}})}),async(dialog,reopen)=>{await dialog.open();if(reopen)dialog.preview={key:'new-preview',role:'oscar',at:Date.now()};return{};},dialog=>({notified:dialog.notified===false,timer:dialog.timer!==null,preview:dialog.preview?.key==='new-preview'})],
   ['connectors',onClose=>new ConnectorsDialog({request,onClose}),async dialog=>{await dialog.open();return{};},dialog=>({timer:Boolean(dialog.timer)})],
   ['welcome',onClose=>new WelcomeGuide({getState:()=>state,onClose}),async dialog=>{dialog.open();return{};},dialog=>({focus:dialog.dialog.contains(document.activeElement)})],
   ['publication',onClose=>new PublicationDialog({request,onClose,getMission:()=>({id:'qa-mission',title:'Projet de contrôle',status:'completed'})}),async(dialog,reopen)=>{await dialog.open();const preview={digest:'qa-preview'};if(reopen){dialog.password.value='dummy-for-lifecycle-test';dialog.preview=preview;}return{preview};},(dialog,marker)=>({timer:Boolean(dialog.timer),password:dialog.password.value==='dummy-for-lifecycle-test',preview:dialog.preview===marker.preview})],
  ];
  for(const[name,make,open,inspect]of cases){
   let closes=0;const dialog=make(()=>closes++),close=()=>typeof dialog.close==='function'?dialog.close():dialog.dialog.close();
   for(let cycle=0;cycle<4;cycle++){
    await open(dialog,false);close();const before=closes,marker=await open(dialog,true),epoch=dialog.epoch;await wait(80);
    const details={open:dialog.dialog.open,epoch:dialog.epoch===epoch,callbacks:closes===before,...inspect(dialog,marker)};
    results.push({name,cycle,...details,ok:Object.values(details).every(Boolean)});
    close();await wait(30);
    const final={finalClose:!dialog.dialog.open,callbackCount:closes===before+1,...(name==='publication'?{passwordCleared:dialog.password.value==='',previewCleared:dialog.preview===null}:{}),...(name==='dictation'?{targetCleared:dialog.targetOnText===null}:{}),...(name==='voice'?{timerStopped:dialog.timer===null,previewStopped:dialog.preview===null}:{})};results.push({name,cycle,...final,ok:Object.values(final).every(Boolean)});
   }
   dialog.destroy();await wait(30);
  }
  return results;
 });
 await writeFile(path.join(output,'rapport.json'),JSON.stringify({ok:results.every(row=>row.ok)&&!errors.length&&!external.length,results,errors,external},null,2));
 console.log(JSON.stringify({checks:results.length,failed:results.filter(row=>!row.ok),errors,external},null,2));
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.ok(results.every(row=>row.ok),'A previous native close event invalidated a reopened dialog.');
}finally{await browser.close();await fixture.close();}
