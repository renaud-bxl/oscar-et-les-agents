import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,symlinkSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {assertUpdateStartup} from '../lib/update-startup.mjs';

test('normal launches cannot race a worker replacing code; only its exact child nonce can start',t=>{
  const dataDir=mkdtempSync(path.join(os.tmpdir(),'oscar-startup-lock-'));t.after(()=>rmSync(dataDir,{recursive:true,force:true}));
  assert.doesNotThrow(()=>assertUpdateStartup({dataDir,restartId:undefined}));
  const folder=path.join(dataDir,'app-updates'),lock=path.join(folder,'update.lock');mkdirSync(folder);
  const restartId='a'.repeat(64);writeFileSync(lock,JSON.stringify({jobId:'b'.repeat(64),restartId,parentPid:123,createdAt:1}));
  for(const value of [undefined,'','a'.repeat(63),'c'.repeat(64)])assert.throws(()=>assertUpdateStartup({dataDir,restartId:value}),error=>error.code==='UPDATE_BUSY');
  assert.doesNotThrow(()=>assertUpdateStartup({dataDir,restartId}));
  writeFileSync(lock,'broken');assert.throws(()=>assertUpdateStartup({dataDir,restartId}),error=>error.code==='UPDATE_BUSY');
});

test('linked update locks fail closed without reading their target',t=>{
  const dataDir=mkdtempSync(path.join(os.tmpdir(),'oscar-linked-lock-'));t.after(()=>rmSync(dataDir,{recursive:true,force:true}));
  mkdirSync(path.join(dataDir,'app-updates'));const target=path.join(dataDir,'sentinel');writeFileSync(target,'KEEP');symlinkSync(target,path.join(dataDir,'app-updates','update.lock'));
  assert.throws(()=>assertUpdateStartup({dataDir}),error=>error.code==='UPDATE_BUSY');
});
