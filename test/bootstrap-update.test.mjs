import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

test('manual bootstrap leaves a live older installation untouched before copying code',async t=>{
  const root=await realpath(await mkdtemp(path.join(os.tmpdir(),'oscar-live-bootstrap-')));
  await mkdir(path.join(root,'scripts'));await mkdir(path.join(root,'data'));
  await writeFile(path.join(root,'package.json'),JSON.stringify({name:'oscar-et-les-agents',version:'0.6.6'}));
  await writeFile(path.join(root,'server.mjs'),'// Existing older server must be kept.');
  await writeFile(path.join(root,'scripts','install.mjs'),'throw new Error("Must not run");');
  await writeFile(path.join(root,'data','mission.txt'),'Mission à conserver.');
  const server=http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({app:'oscar-et-les-agents',version:'0.6.6',activeMissions:[]}));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));await rm(root,{recursive:true,force:true});});
  const run=promisify(execFile);
  await assert.rejects(run('sh',[fileURLToPath(new URL('../install.sh',import.meta.url)),'--engine','codex','--dir',root,'--skip-login','--no-open'],{env:{...process.env,PATH:path.dirname(process.execPath)+path.delimiter+process.env.PATH,PORT:String(server.address().port)},timeout:15000}),error=>error.code===1&&/encore ouvert/u.test(error.stderr));
  assert.equal(await readFile(path.join(root,'server.mjs'),'utf8'),'// Existing older server must be kept.');
  assert.equal(await readFile(path.join(root,'data','mission.txt'),'utf8'),'Mission à conserver.');
});
