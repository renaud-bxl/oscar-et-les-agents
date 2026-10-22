import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm,symlink} from 'node:fs/promises';
import {deflateRawSync} from 'node:zlib';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
import os from 'node:os';
import {DocumentLibrary} from '../lib/document-library.mjs';
import {PassiveOfficePreview,validateOfficePreview,OFFICE_PREVIEW_LIMITS} from '../lib/passive-office-preview.mjs';
const exec=promisify(execFile),python=process.env.OSCAR_TEST_DOCUMENT_PYTHON||'python3';let available=false;try{await exec(python,['-I','-c','import docx,openpyxl,reportlab,pypdf; assert pypdf.__version__=="6.19.0"']);available=true;}catch{}
const real={skip:available?false:'Set OSCAR_TEST_DOCUMENT_PYTHON to the prepared document runtime'};
const crcTable=Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function zip(entries){const local=[],central=[];let offset=0;for(const[name,value]of entries){const text=Buffer.from(name),data=Buffer.from(value),packed=deflateRawSync(data);let crc=0xffffffff;for(const byte of data)crc=crcTable[(crc^byte)&255]^(crc>>>8);crc=(crc^0xffffffff)>>>0;const a=Buffer.alloc(30),b=Buffer.alloc(46);a.writeUInt32LE(0x04034b50);a.writeUInt16LE(20,4);a.writeUInt16LE(8,8);a.writeUInt32LE(crc,14);a.writeUInt32LE(packed.length,18);a.writeUInt32LE(data.length,22);a.writeUInt16LE(text.length,26);b.writeUInt32LE(0x02014b50);b.writeUInt16LE(20,6);b.writeUInt16LE(8,10);b.writeUInt32LE(crc,16);b.writeUInt32LE(packed.length,20);b.writeUInt32LE(data.length,24);b.writeUInt16LE(text.length,28);b.writeUInt32LE(offset,42);local.push(a,text,packed);central.push(b,text);offset+=a.length+text.length+packed.length;}const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...local,directory,end]);}
const DOCX=zip([['[Content_Types].xml','<Types/>'],['word/document.xml','<document/>']]);
const word={kind:'word',status:'ready',warnings:[],blocks:[{kind:'paragraph',runs:[{text:'Bonjour',bold:true,italic:false,underline:false,color:'255C49'}],heading:1,alignment:'left'}]};
async function setup(t,options={}){const dataDir=await mkdtemp(path.join(os.tmpdir(),'oscar-office-preview-')),documents=new DocumentLibrary({dataDir,...options});await documents.ready;const preview=new PassiveOfficePreview({documents});t.after(async()=>{await preview.close();await documents.close();await rm(dataDir,{recursive:true,force:true});});const directory=path.join(dataDir,'missions','fake','travail');await mkdir(directory,{recursive:true});return{dataDir,documents,preview,directory};}

test('Office reader validates exact passive result shapes and bounds without executing markup or formulas',()=>{
 assert.deepEqual(validateOfficePreview(word),word);const result=validateOfficePreview(word);result.blocks[0].runs[0].text='Muté';assert.equal(word.blocks[0].runs[0].text,'Bonjour');
 for(const change of [x=>x.blocks[0].runs[0].color='red;background:url(x)',x=>x.blocks[0].runs[0].size=999,x=>x.blocks[0].runs[0].text='x'.repeat(4001),x=>x.html='<script>',x=>x.blocks[0].runs[0].href='javascript:alert(1)']){const value=structuredClone(word);change(value);assert.throws(()=>validateOfficePreview(value),/confirmé/u);}
 const workbook={kind:'spreadsheet',status:'ready',warnings:[],sheets:[{name:'Budget',state:'visible',totalRows:2,totalColumns:2,rows:[{number:2,cells:[{column:2,address:'B2',text:'=1+1',formula:true,cachedValue:'2'}]}]}]};assert.deepEqual(validateOfficePreview(workbook),workbook);
 for(const change of [x=>x.sheets[0].rows[0].cells[0].column=41,x=>x.sheets[0].rows[0].cells[0].address='B999',x=>x.sheets[0].rows[0].number=201,x=>x.sheets[0].rows[0].cells[0].formula=false]){const value=structuredClone(workbook);change(value);assert.throws(()=>validateOfficePreview(value),/confirmé/u);}
});

test('preview is runtime-gated and constrained to safe mission files, with process limits and no writes',async t=>{
 let calls=0,last;const f=await setup(t,{pythonBinary:'/fake/python',run:async(_binary,args,options)=>{if(args.includes('-c'))return'ok';calls++;last=options;return JSON.stringify(word);}});const file=path.join(f.directory,'livraison.docx');await writeFile(file,DOCX);
 const result=await f.preview.preview(file);assert.equal(result.kind,'word');assert.match(result.revision,/^[a-f0-9]{64}$/u);assert.equal(last.timeout,15000);assert.equal(last.maxBytes,2*1024*1024);assert(last.signal instanceof AbortSignal);assert.deepEqual(await readFile(file),DOCX);
 const outside=path.join(f.dataDir,'outside.docx');await writeFile(outside,DOCX);await assert.rejects(f.preview.preview(outside),/cette mission/u);await assert.rejects(f.preview.preview('livraison.docx'));await symlink(outside,path.join(f.directory,'linked.docx'));await assert.rejects(f.preview.preview(path.join(f.directory,'linked.docx')));assert.equal(calls,1);
 f.documents.runtime.available=false;await assert.rejects(f.preview.preview(file),{code:'DOCUMENT_RUNTIME'});assert.equal(calls,1);
});

test('a changed file or forged reader reply never becomes a current preview',async t=>{
 let current=word,mutate=false,file;const f=await setup(t,{pythonBinary:'/fake/python',run:async(_binary,args)=>{if(args.includes('-c'))return'ok';if(mutate)await writeFile(file,Buffer.concat([DOCX,Buffer.from('changed')]));return JSON.stringify(current);}});file=path.join(f.directory,'version.docx');await writeFile(file,DOCX);
 current={...word,kind:'spreadsheet'};await assert.rejects(f.preview.preview(file),/confirmé/u);current=word;mutate=true;await assert.rejects(f.preview.preview(file),{code:'DOCUMENT_CHANGED'});assert.equal(f.preview.activeJobs,0);
});

test('closing cancels one running reader and its queued jobs, waits for cleanup, and blocks later work',async t=>{
 let enter,stopped=false;const started=new Promise(resolve=>{enter=resolve;});const f=await setup(t,{pythonBinary:'/fake/python',run:async(_binary,args,{signal}={})=>{if(args.includes('-c'))return'ok';enter();return new Promise((_,reject)=>signal.addEventListener('abort',()=>setTimeout(()=>{stopped=true;reject(Object.assign(new Error('Stopped'),{code:'ABORT_ERR'}));},10),{once:true}));}});const file=path.join(f.directory,'queue.docx');await writeFile(file,DOCX);const pending=Array.from({length:8},()=>f.preview.preview(file).catch(error=>error));await started;assert.equal(f.preview.activeJobs,8);await assert.rejects(f.preview.preview(file),{code:'DOCUMENT_BUSY'});await f.preview.close();assert(stopped);assert((await Promise.all(pending)).every(error=>error.code==='ABORT_ERR'));assert.equal(f.preview.activeJobs,0);await assert.rejects(f.preview.preview(file),{code:'ABORT_ERR'});
});

test('real Word retains headings, runs, tables and harmless link text; Excel has sheets, literal formulas and stored values',real,async t=>{
 const f=await setup(t,{pythonBinary:python});await exec(python,['-I','-c',`from docx import Document;from docx.shared import RGBColor;from docx.oxml import OxmlElement;from docx.oxml.ns import qn;from docx.opc.constants import RELATIONSHIP_TYPE;from openpyxl import Workbook;from openpyxl.styles import Font,PatternFill;import sys,zipfile,io,re
p=sys.argv[1];d=Document();d.add_heading('Note parlementaire',1);r=d.add_paragraph('Écoles de Bruxelles').runs[0];r.bold=True;r.font.color.rgb=RGBColor.from_string('255C49');t=d.add_table(rows=1,cols=2);t.cell(0,0).text='Budget';t.cell(0,1).text='1200 €';l=OxmlElement('w:hyperlink');l.set(qn('r:id'),d.part.relate_to('https://example.org/',RELATIONSHIP_TYPE.HYPERLINK,is_external=True));r=OxmlElement('w:r');v=OxmlElement('w:t');v.text='Source publique';r.append(v);l.append(r);d.add_paragraph()._p.append(l);d.save(p+'/note.docx')
w=Workbook();s=w.active;s.title='Budget';s['A1']='00123';s['B1']='=1+1';s['A1'].font=Font(bold=True,color='255C49');s['A1'].fill=PatternFill('solid',fgColor='D9B35E');s['B3']='=SUM(A2:A2)';s['A2']=42;s2=w.create_sheet('Archive');s2.sheet_state='hidden';s2['A1']='Texte masqué';w.save(p+'/budget.xlsx');a=zipfile.ZipFile(p+'/budget.xlsx');parts={n:a.read(n) for n in a.namelist()};a.close();parts['xl/worksheets/sheet1.xml']=re.sub(b'(<c r="B1"[^>]*><f>1\\+1</f><v>).*?(</v>)',rb'\\g<1>2\\g<2>',parts['xl/worksheets/sheet1.xml']);a=zipfile.ZipFile(p+'/budget.xlsx','w',zipfile.ZIP_DEFLATED)
for n,b in parts.items():a.writestr(n,b)
a.close()`,f.directory]);
 const docx=await readFile(path.join(f.directory,'note.docx')),xlsx=await readFile(path.join(f.directory,'budget.xlsx'));const document=await f.preview.preview(path.join(f.directory,'note.docx')),book=await f.preview.preview(path.join(f.directory,'budget.xlsx'));
 assert.equal(document.kind,'word');assert(document.blocks.some(block=>block.heading===1));assert(document.blocks.some(block=>block.kind==='table'&&block.rows[0][1]==='1200 €'));assert(document.blocks.some(block=>block.runs?.some(run=>run.text==='Source publique')));assert(document.blocks.some(block=>block.runs?.some(run=>run.color==='255C49'&&run.bold)));
 assert.equal(book.sheets.length,2);assert.equal(book.sheets[1].state,'hidden');const values=book.sheets[0].rows.flatMap(row=>row.cells);assert.equal(values.find(cell=>cell.address==='A1').text,'00123');assert.equal(values.find(cell=>cell.address==='B1').text,'=1+1');assert.equal(values.find(cell=>cell.address==='B1').cachedValue,'2');assert.equal(values.find(cell=>cell.address==='B3').cachedValue,undefined);assert(book.warnings.some(warning=>warning.includes('jamais calculées')));assert.deepEqual(await readFile(path.join(f.directory,'note.docx')),docx);assert.deepEqual(await readFile(path.join(f.directory,'budget.xlsx')),xlsx);
});

test('real workbook bounds are explicit and malformed containers stop without any external action',real,async t=>{
 const f=await setup(t,{pythonBinary:python});await exec(python,['-I','-c',`from openpyxl import Workbook;import sys;w=Workbook();s=w.active;s['A1']='Visible';s['A201']='Hors aperçu';s['AO1']='Colonne hors aperçu';w.save(sys.argv[1])`,path.join(f.directory,'grand.xlsx')]);const book=await f.preview.preview(path.join(f.directory,'grand.xlsx'));assert.equal(book.status,'partial');assert(book.warnings.some(w=>w.includes('200 lignes')));assert(!JSON.stringify(book).includes('Hors aperçu'));assert(!JSON.stringify(book).includes('Colonne hors aperçu'));await writeFile(path.join(f.directory,'faux.docx'),Buffer.from('Not a zip'));await assert.rejects(f.preview.preview(path.join(f.directory,'faux.docx')),/archive/u);assert.equal(OFFICE_PREVIEW_LIMITS.cells,40000);
});
