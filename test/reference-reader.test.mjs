import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile,mkdir,readdir,stat} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
import os from 'node:os';
import {DocumentLibrary,processRun} from '../lib/document-library.mjs';
import {createAtelierServer} from '../server.mjs';
const exec=promisify(execFile),python=process.env.OSCAR_TEST_DOCUMENT_PYTHON||'python3';
let available=false;try{await exec(python,['-I','-c','import docx,openpyxl,reportlab,pypdf; assert pypdf.__version__=="6.19.0"']);available=true;}catch{}
const real={skip:!available?'Set OSCAR_TEST_DOCUMENT_PYTHON to the prepared document runtime':false};
async function setup(t,options={}){const dataDir=await mkdtemp(path.join(os.tmpdir(),'oscar-reference-'));const library=new DocumentLibrary({dataDir,...options});await library.ready;t.after(async()=>{await library.close();await rm(dataDir,{recursive:true,force:true});});return{dataDir,library};}
async function fixtures(directory){await exec(python,['-I','-c',`
from docx import Document
from docx.shared import RGBColor
from openpyxl import Workbook
from reportlab.pdfgen.canvas import Canvas
from reportlab.lib.utils import ImageReader
from PIL import Image
from pypdf import PdfWriter
from pypdf.generic import DecodedStreamObject,NameObject
import os,sys
p=sys.argv[1];os.makedirs(p,exist_ok=True)
d=Document();d.sections[0].header.paragraphs[0].text='Commission des écoles';d.add_heading('Question parlementaire',1);r=d.add_paragraph('Quelles mesures à Bruxelles ?').runs[0];r.font.color.rgb=RGBColor.from_string('9B6B22');t=d.add_table(rows=1,cols=2);t.cell(0,0).text='Budget';t.cell(0,1).text='1200 €';d.save(p+'/exemple.docx')
w=Workbook();s=w.active;s.title='Budget';s['A1']='00123';s['B1']=42;s['C1']='=SUM(B1:B1)';s['D1']=123;s['D1'].number_format='00000';w.save(p+'/exemple.xlsx')
c=Canvas(p+'/exemple.pdf',invariant=1);c.drawString(30,750,'Public parliamentary source');c.showPage();c.drawString(30,750,'Second page');c.save()
c=Canvas(p+'/scan.pdf',invariant=1);c.drawImage(ImageReader(Image.new('RGB',(20,20),'white')),30,300,100,100);c.save()
c=Canvas(p+'/long.pdf',invariant=1)
for i in range(51):c.drawString(30,750,'Page '+str(i+1));c.showPage()
c.save()
d=Document();d.add_paragraph('A'*70000);d.save(p+'/long.docx')
d=Document();d.save(p+'/vide.docx');w=Workbook();w.save(p+'/vide.xlsx')
w=PdfWriter();page=w.add_blank_page(width=200,height=200);stream=DecodedStreamObject();stream.set_data(b'q Q '*800000);page[NameObject('/Contents')]=w._add_object(stream.flate_encode());w.write(p+'/compressed.pdf')
`,directory]);}

test('plain references prepare readable immutable sidecars without Python and honour the shared budget',async t=>{
 const{library,dataDir}=await setup(t);const selected=[];
 for(let i=0;i<5;i++)selected.push(await library.import({name:`Exemple${i}.txt`,base64:Buffer.from('É'.repeat(70000)).toString('base64')}));
 const preview=await library.preview(selected[0].id,{revision:selected[0].revision});assert.equal(preview.status,'partial');assert.equal(preview.characters,64000);assert.equal(preview.text.length,64000);
 const destination=path.join(dataDir,'missions','test','travail'),prepared=await library.prepareReferences(selected,destination);
 assert.equal(prepared.characters,256000);assert.equal(prepared.references[4].extraction.status,'partial');assert.equal(prepared.references[4].extraction.characters,0);
 for(const reference of prepared.references){assert.equal((await stat(path.join(destination,reference.textPath))).mode&0o777,0o444);assert.equal((await readFile(path.join(destination,reference.path),'utf8')).length,70000);}
 const manifest=JSON.parse(await readFile(path.join(destination,prepared.manifestPath),'utf8'));assert.equal(manifest.version,2);assert.equal(manifest.characterBudget,256000);
 await assert.rejects(library.preview(selected[0].id,{revision:'0'.repeat(64)}),/a changé/u);await assert.rejects(library.preview(selected[0].id,{revision:'bad'}),/version/u);
});

test('binary references require explicit prepared tools before any copy or model',async t=>{
 const{library,dataDir}=await setup(t);const pdf=await library.import({name:'Exemple.pdf',base64:Buffer.from('%PDF-1.4\n%%EOF').toString('base64')});
 await assert.rejects(library.preview(pdf.id),{code:'DOCUMENT_RUNTIME'});await assert.rejects(library.requireReferenceReader([pdf]),{code:'DOCUMENT_RUNTIME'});
 const destination=path.join(dataDir,'missions','test','travail');await assert.rejects(library.prepareReferences([pdf],destination),{code:'DOCUMENT_RUNTIME'});
 await assert.rejects(stat(destination));
});

test('actual Word Excel PDF extraction retains contents and style hints without altering originals',real,async t=>{
 const{library,dataDir}=await setup(t,{pythonBinary:python});const folder=path.join(dataDir,'fixtures');await fixtures(folder);
 const expected={docx:/Question parlementaire[\s\S]*Quelles mesures[\s\S]*Budget[\s\S]*Commission des écoles/u,xlsx:/00123[\s\S]*Formule non calculée[\s\S]*SUM\(B1:B1\)[\s\S]*00000/u,pdf:/Page 1[\s\S]*Public parliamentary source[\s\S]*Page 2[\s\S]*Second page/u};
 for(const type of ['docx','xlsx','pdf']){const bytes=await readFile(path.join(folder,`exemple.${type}`)),item=await library.import({name:`Exemple.${type}`,base64:bytes.toString('base64')}),preview=await library.preview(item.id,{revision:item.revision});assert.equal(preview.status,'ready');assert.match(preview.text,expected[type]);if(type==='docx')assert(preview.styleHints.colors.includes('9B6B22'));assert.deepEqual((await library.readItem(item.id)).buffer,bytes);const prepared=await library.prepareReferences([item],path.join(dataDir,'missions',type,'travail'));assert.equal(await readFile(path.join(dataDir,'missions',type,'travail',prepared.references[0].textPath),'utf8'),preview.text);}
});

test('scanned PDF remains empty, page and text limits are explicit and malformed PDFs fail safely',real,async t=>{
 const{library,dataDir}=await setup(t,{pythonBinary:python});const folder=path.join(dataDir,'fixtures');await fixtures(folder);
 for(const[name,status,warning]of[['scan.pdf','empty',/scan/u],['long.pdf','partial',/50 pages/u],['long.docx','partial',/première partie/u]]){const item=await library.import({name,base64:(await readFile(path.join(folder,name))).toString('base64')}),preview=await library.preview(item.id);assert.equal(preview.status,status);assert(preview.warnings.some(value=>warning.test(value)));assert(preview.text.length<=64000);if(name==='long.pdf')assert(!preview.text.includes('[Page 51]'));}
 for(const name of ['vide.docx','vide.xlsx']){const item=await library.import({name,base64:(await readFile(path.join(folder,name))).toString('base64')}),preview=await library.preview(item.id);assert.equal(preview.status,'empty');assert.equal(preview.text,'');}
 const bad=await library.import({name:'Mauvais.pdf',base64:Buffer.from('%PDF-1.4\nmalformed\n%%EOF').toString('base64')});await assert.rejects(library.preview(bad.id),error=>error.code==='DOCUMENT_INVALID'&&!/Traceback|site-packages/u.test(error.message));
 const compressed=await library.import({name:'Compresse.pdf',base64:(await readFile(path.join(folder,'compressed.pdf'))).toString('base64')});const started=Date.now();await assert.rejects(library.preview(compressed.id),{code:'DOCUMENT_INVALID'});assert(Date.now()-started<3000,'A compressed PDF must stop before large extraction');
});

test('reader contracts bound the worker, reject forged responses and roll back failed copies',async t=>{
 const calls=[];let response={text:'Texte lu',status:'ready',warnings:[],styleHints:{},characters:8};
 const{library,dataDir}=await setup(t,{pythonBinary:'/mock/python',run:async(_binary,args,options)=>{if(args.includes('-c'))return'ok';calls.push(options);return JSON.stringify(response);}});
 const pdf=await library.import({name:'Exemple.pdf',base64:Buffer.from('%PDF-1.4\n%%EOF').toString('base64')});await library.preview(pdf.id);assert.equal(calls[0].timeout,15000);assert.equal(calls[0].maxBytes,512*1024);assert(calls[0].signal instanceof AbortSignal);
 library.referenceCache.clear();response={...response,text:'x'.repeat(256001)};await assert.rejects(library.prepareReferences([pdf],path.join(dataDir,'missions','test','travail')),/confirmé/u);assert.deepEqual(await readdir(path.join(dataDir,'missions','test','travail','References')),[]);
});

test('queued readers stay bounded and cancellation releases every reservation',async t=>{
 let entered;const started=new Promise(resolve=>{entered=resolve;});
 const{library}=await setup(t,{pythonBinary:'/mock/python',run:async(_binary,args,{signal}={})=>{if(args.includes('-c'))return'ok';entered();return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Object.assign(new Error('stop'),{code:'ABORT_ERR'})),{once:true}));}});
 const item=await library.import({name:'Exemple.pdf',base64:Buffer.from('%PDF-1.4\n%%EOF').toString('base64')}),controller=new AbortController();
 const pending=[library.preview(item.id,{signal:controller.signal}).catch(error=>error)];await started;
 for(let i=0;i<7;i++)pending.push(library.preview(item.id,{signal:controller.signal}).catch(error=>error));
 for(let i=0;i<100&&library.readerControllers.size<8;i++)await new Promise(resolve=>setTimeout(resolve,5));
 assert.equal(library.readerControllers.size,8);await assert.rejects(library.preview(item.id),{code:'DOCUMENT_BUSY'});controller.abort();
 assert((await Promise.all(pending)).every(error=>error.code==='ABORT_ERR'));assert.equal(library.readerControllers.size,0);
});

test('real worker cancellation and timeout wait for exit; output limits and shutdown stop work',async t=>{
 const start=Date.now();await assert.rejects(processRun(process.execPath,['-e','setTimeout(()=>{},10000)'],{timeout:40}),/délai/u);assert(Date.now()-start<2000);
 const controller=new AbortController(),pending=processRun(process.execPath,['-e','setTimeout(()=>{},10000)'],{signal:controller.signal,timeout:2000});setTimeout(()=>controller.abort(),40);await assert.rejects(pending,{code:'ABORT_ERR'});
 await assert.rejects(processRun(process.execPath,['-e','process.stdout.write("A".repeat(10000))'],{maxBytes:100}),/limites/u);
 let started;const entered=new Promise(resolve=>{started=resolve;});const{library}=await setup(t,{pythonBinary:'/mock/python',run:async(_binary,args,{signal}={})=>{if(args.includes('-c'))return'ok';started();return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Object.assign(new Error('stop'),{code:'ABORT_ERR'})),{once:true}));}});
 const pdf=await library.import({name:'Exemple.pdf',base64:Buffer.from('%PDF-1.4\n%%EOF').toString('base64')}),reading=library.preview(pdf.id);const outcome=reading.catch(error=>error);await entered;await library.close();assert.equal((await outcome).code,'ABORT_ERR');assert.equal(library.readerControllers.size,0);
});

test('preview HTTP exposes only a known revision, stays inert and preserves Origin guards',async t=>{
 const dataDir=await mkdtemp(path.join(os.tmpdir(),'oscar-reference-http-')),app=await createAtelierServer({port:0,dataDir,providers:[]});await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));t.after(async()=>{await app.close();await rm(dataDir,{recursive:true,force:true});});
 const item=await app.documents.import({name:'Exemple.txt',base64:Buffer.from('<script>Un texte non exécuté</script>').toString('base64')}),base=`http://127.0.0.1:${app.server.address().port}`,url=base+`/api/documents/${item.id}/preview?revision=${item.revision}`;
 const response=await fetch(url),preview=await response.json();assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/application\/json/u);assert.equal(preview.text,'<script>Un texte non exécuté</script>');assert.equal(preview.revision,item.revision);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal((await fetch(url,{headers:{Origin:'https://other.invalid'}})).status,403);
 assert.equal((await fetch(url+'&path=/etc/passwd')).status,400);assert.equal((await fetch(url.replace(item.revision,'0'.repeat(64)))).status,400);
 const pdf=await app.documents.import({name:'Exemple.pdf',base64:Buffer.from('%PDF-1.4\n%%EOF').toString('base64')});const missing=await fetch(base+`/api/documents/${pdf.id}/preview`);assert.equal(missing.status,400);assert.equal((await missing.json()).code,'DOCUMENT_RUNTIME');
});
