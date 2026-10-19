import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {BrowserLogin} from '../lib/auth.mjs';
const wait=()=>new Promise(r=>setTimeout(r,10));
function fake(){const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{};return child;}
test('la connexion navigateur utilise les CLI officiels sans capturer de jeton',async()=>{
 const child=fake(),calls=[],changes=[];
 const login=new BrowserLogin({find:async()=>'/fake/claude',spawnImpl:(...args)=>{calls.push(args);return child;},detect:async()=>[{id:'claude',auth:{loggedIn:true}}],onChange:(state)=>changes.push(structuredClone(state))});
 await login.start('claude');await login.start('claude');
 assert.equal(calls.length,1);assert.deepEqual(calls[0][1],['auth','login','--claudeai']);
 child.stdout.write('CONFIDENTIAL-LOGIN-OUTPUT');child.emit('close',0);await wait();
 assert.equal(login.logins.claude.status,'connected');assert(!JSON.stringify(changes).includes('CONFIDENTIAL'));
});
test('une connexion refusée ou annulée reste un échec explicite',async()=>{
 const child=fake();const login=new BrowserLogin({find:async()=>'/fake/codex',spawnImpl:()=>child,detect:async()=>[{id:'codex',auth:{loggedIn:false}}]});
 await login.start('codex');child.emit('close',1);await wait();assert.equal(login.logins.codex.status,'failed');
 await assert.rejects(login.start('autre'),/pas reconnu/);
});
