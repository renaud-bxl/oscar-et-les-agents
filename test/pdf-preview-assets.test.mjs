import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createAtelierServer} from '../server.mjs';

const vendor=new URL('../public/vendor/pdfjs/6.4.299/',import.meta.url),prefix='/vendor/pdfjs/6.4.299/';

test('vendored PDF.js retains official integrity, every file hash and its licenses without scripting assets',async()=>{
  const manifest=JSON.parse(await readFile(new URL('manifest.json',vendor),'utf8'));
  assert.equal(manifest.version,'6.4.299');assert.equal(manifest.license,'Apache-2.0');assert.equal(manifest.integrity,'sha512-AVl138zALtfaAPvADulE0PZThbYzCBS79nL4pOSL/6Sm/4AH5A21BD9VHt97OlCuzJuCpmeZtAtkinisF4Vb1g==');
  assert(manifest.files.some(file=>file.path==='LICENSE'));assert(manifest.files.some(file=>file.path==='standard_fonts/LICENSE_LIBERATION'));
  assert(manifest.files.some(file=>file.path==='cmaps/LICENSE'));assert(manifest.files.some(file=>file.path==='wasm/LICENSE_PDFJS_JBIG2'));
  assert(!manifest.files.some(file=>/sandbox|quickjs|\.wasm$/u.test(file.path)));
  for(const item of manifest.files){const bytes=await readFile(new URL(item.path,vendor));assert.equal(bytes.length,item.bytes,item.path);assert.equal(createHash('sha256').update(bytes).digest('hex'),item.sha256,item.path);}
});

test('server exposes only the pinned PDF rendering assets with same-origin worker policy',async t=>{
  const dataDir=await mkdtemp(path.join(os.tmpdir(),'oscar-pdf-assets-')),app=await createAtelierServer({port:0,dataDir,providers:[]});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));t.after(async()=>{await app.close();await rm(dataDir,{recursive:true,force:true});});const base=`http://127.0.0.1:${app.server.address().port}`;
  for(const file of ['build/pdf.min.mjs','build/pdf.worker.min.mjs','standard_fonts/LiberationSans-Regular.ttf','cmaps/Adobe-GB1-UCS2.bcmap','wasm/jbig2_nowasm_fallback.js']){
    const response=await fetch(base+prefix+file);assert.equal(response.status,200,file);assert(response.headers.get('content-security-policy').includes("worker-src 'self'"));assert(!response.headers.get('content-security-policy').includes("'unsafe-eval'"));
    const bytes=Buffer.from(await response.arrayBuffer()),local=await readFile(new URL(file,vendor));assert.deepEqual(bytes,local);if(file.endsWith('.mjs'))assert(response.headers.get('content-type').startsWith('text/javascript'));
  }
  const head=await fetch(base+prefix+'build/pdf.min.mjs',{method:'HEAD'});assert.equal(head.status,200);assert.equal((await head.arrayBuffer()).byteLength,0);
  for(const file of ['build/pdf.sandbox.min.mjs','wasm/quickjs-eval.js','wasm/quickjs-eval.wasm','manifest.json','LICENSE','../../../../package.json'])assert.equal((await fetch(base+prefix+file)).status,404,file);
  assert.equal((await fetch(base+'/pdf-preview.js')).status,200);
});
