import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,readdir} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import os from 'node:os';
import path from 'node:path';
import {DocumentLibrary} from '../lib/document-library.mjs';
const exec=promisify(execFile),python=process.env.OSCAR_TEST_DOCUMENT_PYTHON||'python3';
let available=false;try{await exec(python,['-I','-c','import docx,openpyxl,reportlab,pypdf; assert pypdf.__version__=="6.19.0"']);available=true;}catch{}
const real={skip:!available?'Set OSCAR_TEST_DOCUMENT_PYTHON to the prepared document runtime':false};
async function setup(t,options={}){const dataDir=await mkdtemp(path.join(os.tmpdir(),'oscar-document-boundary-')),library=new DocumentLibrary({dataDir,...options});await library.ready;t.after(async()=>{await library.close();await rm(dataDir,{recursive:true,force:true});});return{dataDir,library,destination:path.join(dataDir,'missions','boundaries','travail','Exports')};}

test('duplicate import names remain usable at the character and filesystem byte boundaries',async t=>{
 const{library}=await setup(t);
 for(const name of ['A'.repeat(176)+'.txt','é'.repeat(176)+'.txt']){
  const first=await library.import({name,base64:Buffer.from('Original').toString('base64')}),second=await library.import({name,base64:Buffer.from('Nouvelle version').toString('base64')});
  assert(first&&second);assert.notEqual(first.name,second.name);for(const item of [first,second]){assert(item.name.length<=180);assert(Buffer.byteLength(item.name)<=240);assert.equal((await library.item(item.id)).revision,item.revision);}
 }
 assert.deepEqual((await library.state()).ignored,[]);assert.equal((await library.state()).items.length,4);
});

test('closing documents aborts and waits for active exports, and rejects later exports',async t=>{
 let enter;const started=new Promise(resolve=>{enter=resolve;});let workerSignal,exited=false;
 const{library,destination}=await setup(t,{pythonBinary:'/mock/python',run:async(_binary,args,{signal}={})=>{if(args.includes('-c'))return'ok';workerSignal=signal;enter();return new Promise((resolve,reject)=>{signal.addEventListener('abort',()=>setTimeout(()=>{exited=true;reject(Object.assign(Error('Stopped'),{code:'ABORT_ERR'}));},20),{once:true});});}});
 const pending=library.export({sourceText:'Contenu local',destination,formats:['pdf']});const result=pending.catch(error=>error);await started;await library.close();
 assert(workerSignal.aborted);assert(exited);assert.equal((await result).code,'ABORT_ERR');assert.equal(library.exportControllers.size,0);assert.equal(library.exportTasks.size,0);assert.deepEqual(await readdir(destination),[]);
 await assert.rejects(library.export({sourceText:'Après fermeture',destination,formats:['pdf']}),{code:'ABORT_ERR'});
});

test('financial template colours survive without turning new numeric values into dates or percentages',real,async t=>{
 const{library,dataDir,destination}=await setup(t,{pythonBinary:python}),original=path.join(dataDir,'Modele.xlsx');
 await exec(python,['-I','-c',`from openpyxl import Workbook; from openpyxl.styles import PatternFill; import datetime,sys; w=Workbook();s=w.active;s.title='Original';s.append(['Date','Pourcentage']);s.append([datetime.datetime(2026,10,19),.2]);s['A2'].number_format='dd/mm/yyyy';s['A2'].fill=PatternFill('solid',fgColor='D9B35E');s['B2'].number_format='0%';s['B2'].fill=PatternFill('solid',fgColor='255C49');w.save(sys.argv[1])`,original]);
 const template=await library.import({name:'Modele.xlsx',base64:(await readFile(original)).toString('base64')});
 const result=await library.export({sourceText:'Projet,Budget\nBibliothèque,1200\nÉcoles,2400',sourceType:'csv',destination,formats:['xlsx'],templateId:template.id});
 const numeric=await library.export({sourceText:'Quantité,Budget\n1200,2400',sourceType:'csv',destination,formats:['xlsx'],templateId:template.id});
 await exec(python,['-I','-c',`import sys,zipfile;from openpyxl import load_workbook;from lxml import etree
a=zipfile.ZipFile(sys.argv[1]);
for file in sys.argv[2:]:
 b=zipfile.ZipFile(file);assert a.read('xl/worksheets/sheet1.xml')==b.read('xl/worksheets/sheet1.xml');ns={'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'};old=etree.fromstring(a.read('xl/styles.xml')).find('s:cellXfs',ns);new=etree.fromstring(b.read('xl/styles.xml')).find('s:cellXfs',ns);assert all(etree.tostring(x)==etree.tostring(new[i]) for i,x in enumerate(old));s=load_workbook(file)['Livraison Oscar'];assert s['B2'].value in (1200,2400) and s['B2'].data_type=='n';assert s['B2'].number_format=='General';assert s['B2'].fill.fgColor.rgb=='00255C49'
s=load_workbook(sys.argv[3])['Livraison Oscar'];assert s['A2'].value==1200 and s['A2'].data_type=='n';assert s['A2'].number_format=='General';assert s['A2'].fill.fgColor.rgb=='00D9B35E'`,original,path.join(destination,result.files[0].path),path.join(destination,numeric.files[0].path)]);
 assert(result.warnings.some(value=>value.includes('format général')));assert.equal((await library.item(template.id)).revision,template.revision);
});

test('native Word and multipage PDF preserve complete clauses and every inline template marker',real,async t=>{
 const{library,dataDir,destination}=await setup(t,{pythonBinary:python}),original=path.join(dataDir,'Modele.docx');
 await exec(python,['-I','-c',`from docx import Document;import sys;d=Document();p=d.add_paragraph('Objet : ');p.add_run('{{CON');p.add_run('TENU}} — Copie : {{CONTENU}}');d.save(sys.argv[1])`,original]);
 const template=await library.import({name:'Modele.docx',base64:(await readFile(original)).toString('base64')}),word=await library.export({sourceText:'Premier paragraphe\n\nDeuxième paragraphe',destination,formats:['docx'],templateId:template.id});
 const clause='a'.repeat(14000)+' CONDITION_TERMINALE_A_CONSERVER',content='| Clause | Condition |\n| --- | --- |\n| 8 | '+clause+' |',result=await library.export({sourceText:content,destination,formats:['pdf','docx']});
 await exec(python,['-I','-c',`import sys,zipfile;from pypdf import PdfReader;from docx import Document;d=Document(sys.argv[1]);text='\\n'.join(p.text for p in d.paragraphs);assert '{{CONTENU}}' not in text;assert text.count('Premier paragraphe')==2 and text.count('Deuxième paragraphe')==2;assert zipfile.ZipFile(sys.argv[1]).read('word/document.xml').count(b'<w:br')==2;r=PdfReader(sys.argv[2]);assert len(r.pages)>1;assert 'CONDITION_TERMINALE_A_CONSERVER' in ''.join(p.extract_text() or '' for p in r.pages);w=Document(sys.argv[3]);assert 'CONDITION_TERMINALE_A_CONSERVER' in ''.join(c.text for t in w.tables for row in t.rows for c in row.cells)`,path.join(destination,word.files[0].path),...result.files.map(file=>path.join(destination,file.path))]);
});

test('Excel rejects content beyond one cell capacity without writing a truncated delivery',real,async t=>{
 const{library,destination}=await setup(t,{pythonBinary:python});
 await assert.rejects(library.export({sourceText:JSON.stringify([{Texte:'x'.repeat(33000)+' FIN_A_CONSERVER'}]),sourceType:'json',destination,formats:['xlsx']}),/32 767 caractères/u);
 assert.deepEqual(await readdir(destination),[]);
});

test('Word and PDF prose are not rejected by the unrelated Excel row limit',real,async t=>{
 const{library,destination}=await setup(t,{pythonBinary:python});
 const content=Array.from({length:2105},(_,i)=>`Paragraphe ${i+1} — texte public à conserver.`).join('\n');
 const result=await library.export({sourceText:content,destination,formats:['docx','pdf'],title:'Rapport complet'});
 await exec(python,['-I','-c',`import sys;from docx import Document;from pypdf import PdfReader;assert any('Paragraphe 2105' in p.text for p in Document(sys.argv[1]).paragraphs);assert 'Paragraphe 2105' in ''.join(p.extract_text() or '' for p in PdfReader(sys.argv[2]).pages)`,...result.files.map(file=>path.join(destination,file.path))]);
 await assert.rejects(library.export({sourceText:content,destination,formats:['xlsx'],title:'Trop de lignes Excel'}),/2 000 lignes/u);
});

test('a stale removal confirmation never deletes a replacement example under the same name',async t=>{
 const{library}=await setup(t),item=await library.import({name:'Exemple.txt',base64:Buffer.from('Version confirmée').toString('base64')});
 const {writeFile}=await import('node:fs/promises');await writeFile(path.join(library.directory,item.name),'Nouvelle version à préserver');
 await assert.rejects(library.remove(item.id,{revision:item.revision}),{code:'DOCUMENT_CHANGED'});assert.equal(await readFile(path.join(library.directory,item.name),'utf8'),'Nouvelle version à préserver');
 const current=await library.item(item.id);await assert.rejects(library.remove(item.id,{revision:'bad'}));await library.remove(item.id,{revision:current.revision});assert.equal((await library.state()).items.length,0);
});
