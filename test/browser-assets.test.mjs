import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAtelierServer } from '../server.mjs';

test('the browser can load the complete local application import graph while backend files stay private', async t => {
  const dataDir=mkdtempSync(path.join(os.tmpdir(),'oscar-browser-assets-'));
  const app=await createAtelierServer({port:0,dataDir,providers:[],runner:()=>assert.fail('No model is needed to load interface assets.')});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await app.close();rmSync(dataDir,{recursive:true,force:true});});
  const base=`http://127.0.0.1:${app.server.address().port}`;
  const html=await (await fetch(base+'/')).text();
  const queue=[...html.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)=["']([^"']+)["']/gu)].map(match=>new URL(match[1],base));
  const visited=new Set();
  for(let i=0;i<queue.length;i++){
    const url=queue[i];if(visited.has(url.href))continue;visited.add(url.href);
    assert.equal(url.origin,base,'The application must load its scripts and styles locally.');
    const response=await fetch(url);assert.equal(response.status,200,`Missing browser asset ${url.pathname}`);
    if(!url.pathname.endsWith('.js'))continue;
    assert.match(response.headers.get('content-type'),/javascript/u,url.pathname);
    const source=await response.text();
    for(const match of source.matchAll(/(?:\bimport\s+(?:[^'";\n]+?\s+from\s*)?|\bexport\s+[^'";\n]+?\s+from\s*)['"]([^'"]+)['"]/gu))queue.push(new URL(match[1],url));
  }
  assert.ok(visited.size>35,'The test must traverse the imported dialogs and translation dictionaries.');
  for(const privatePath of ['/server.mjs','/lib/orchestrator.mjs','/AGENTS.md'])assert.equal((await fetch(base+privatePath)).status,404,privatePath);
});
