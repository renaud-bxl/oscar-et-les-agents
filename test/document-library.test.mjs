import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {mkdtemp,readFile,writeFile,mkdir,rm,symlink,stat,readdir} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {deflateRawSync} from 'node:zlib';
import {DocumentLibrary,validateDocument,DOCUMENT_LIMITS} from '../lib/document-library.mjs';

const exec=promisify(execFile),python=process.env.OSCAR_TEST_DOCUMENT_PYTHON||'python3';
let pythonReady=false;try{await exec(python,['-I','-c','import docx, openpyxl, reportlab; print("ok")'],{timeout:15000});pythonReady=true;}catch{}
const table=Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
const crc=buffer=>{let value=0xffffffff;for(const byte of buffer)value=table[(value^byte)&255]^(value>>>8);return(value^0xffffffff)>>>0;};
function zip(entries){const locals=[],centrals=[];let offset=0;for(const entry of entries){const name=Buffer.from(entry.name),data=Buffer.from(entry.data||''),compressed=deflateRawSync(data),header=Buffer.alloc(30),central=Buffer.alloc(46);header.writeUInt32LE(0x04034b50);header.writeUInt16LE(20,4);header.writeUInt16LE(8,8);header.writeUInt32LE(crc(data),14);header.writeUInt32LE(compressed.length,18);header.writeUInt32LE(data.length,22);header.writeUInt16LE(name.length,26);central.writeUInt32LE(0x02014b50);central.writeUInt16LE(0x0314,4);central.writeUInt16LE(20,6);central.writeUInt16LE(8,10);central.writeUInt32LE(crc(data),16);central.writeUInt32LE(compressed.length,20);central.writeUInt32LE(entry.expanded??data.length,24);central.writeUInt16LE(name.length,28);central.writeUInt32LE(entry.symlink?(0o120777<<16)>>>0:0,38);central.writeUInt32LE(offset,42);locals.push(header,name,compressed);centrals.push(central,name);offset+=header.length+name.length+compressed.length;}const directory=Buffer.concat(centrals),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...locals,directory,end]);}
const tinyDocx=extra=>zip([{name:'[Content_Types].xml',data:'<Types/>'},{name:'word/document.xml',data:'<document/>'},...(extra||[])]);
const setup=async t=>{const directory=await mkdtemp(path.join(os.tmpdir(),'oscar-documents-test-'));t.after(()=>rm(directory,{recursive:true,force:true}));return directory;};

test('document imports validate paths, integrity, archive limits and active content',()=>{
 assert.doesNotThrow(()=>validateDocument(tinyDocx(),'docx'));
 assert.throws(()=>validateDocument(Buffer.from('bad'),'docx'),/archive/u);
 for(const entry of [{name:'../escape.xml',data:'x'},{name:'word/link.xml',data:'x',symlink:true},{name:'word/big.xml',data:'x',expanded:1024**3},{name:'word/vbaProject.bin',data:'x'},{name:'word/x.xml',data:'<!DOCTYPE x [<!ENTITY e SYSTEM "file:///tmp/x">]><x/>'}])assert.throws(()=>validateDocument(tinyDocx([entry]),'docx'));
 assert.throws(()=>validateDocument(tinyDocx([{name:'word/_rels/document.xml.rels',data:'<Relationships><Relationship Type="x/image" TargetMode="External" Target="https://example.com/x"/></Relationships>'}]),'docx'),/externe/u);
 assert.doesNotThrow(()=>validateDocument(Buffer.from('Titre français — café'),'txt'));
 assert.throws(()=>validateDocument(Buffer.from([0xff]),'txt'),/UTF-8/u);
 assert.throws(()=>validateDocument(Buffer.from('{bad'),'json'),/JSON/u);
});

test('Office templates preserve ordinary links and reject encoded, local or executable targets',()=>{
 const relation=(target,type='hyperlink',prefix='')=>`<Relationships><${prefix}Relationship Type="https://schemas.example/${type}" TargetMode="External" Target="${target}"/></Relationships>`;
 const document=xml=>tinyDocx([{name:'word/_rels/document.xml.rels',data:xml}]);
 for(const url of ['https://www.parlement.brussels/documents/?q=ecoles&amp;annee=2026','http://www.lachambre.be/','mailto:secretariat@example.org','#Annexe_1'])assert.doesNotThrow(()=>validateDocument(document(relation(url)),'docx'));
 for(const url of ['file:///etc/passwd','javascript:alert(1)','j&#x61;vascript:alert(1)','data:text/html,active','\\\\server\\share','https://user:password@example.org/'])assert.throws(()=>validateDocument(document(relation(url)),'docx'),/liens/u);
 assert.throws(()=>validateDocument(document(relation('https://example.org/image.png','image','r:')),'docx'),/externe/u);
 assert.throws(()=>validateDocument(document('<Relationship Type="x/image" Target="https://example.org/image.png"/>'),'docx'),/externe/u);
 assert.throws(()=>validateDocument(document('<r:Relationship Type="x/hyperlink" TargetMode="Exter&#110;al" Target="file:///tmp/x"/>'),'docx'),/liens/u);
 assert.throws(()=>validateDocument(document(Buffer.from('\ufeff<?xml version="1.0" encoding="UTF-16"?>'+relation('file:///tmp/x'),'utf16le')),'docx'),/liens/u);
 assert.throws(()=>validateDocument(document(relation('custom.bin','vbaProject')),'docx'),/macros/u);
 assert.throws(()=>validateDocument(zip([{name:'[Content_Types].xml',data:'<Types><Override ContentType="application/vnd.ms-word.document.macroEnabled.main+xml"/></Types>'},{name:'word/document.xml',data:'<document/>'}]),'docx'),/macros/u);
 assert.doesNotThrow(()=>validateDocument(document(relation('https://example.org/?q=INCLUDETEXT')),'docx'));
 const field=instruction=>zip([{name:'[Content_Types].xml',data:'<Types/>'},{name:'word/document.xml',data:`<w:document xmlns:w="w"><w:instrText>${instruction}</w:instrText></w:document>`}]);
 for(const value of ['HYPERLINK "https://www.senate.be/"','HYPERLINK https://www.senate.be/','HYPERLINK \\l "Annexe_1"','HYPERLINK "https://example.org/?q=INCLUDETEXT"','QUOTE "DDEAUTO"'])assert.doesNotThrow(()=>validateDocument(field(value),'docx'));
 for(const value of ['DDEAUTO cmd /c test','INCLUDETEXT "file:///tmp/x"','HYPERLINK "javascript:alert(1)"','HYPERLINK file:///tmp/x'])assert.throws(()=>validateDocument(field(value),'docx'),/actif|liens/u);
 assert.throws(()=>validateDocument(field('DD</w:instrText><w:instrText>EAUTO cmd /c test'),'docx'),/actif/u);
 assert.throws(()=>validateDocument(field('<![CDATA[DDEAUTO cmd /c test]]>'),'docx'),/actif/u);
});

test('Excel templates keep local arithmetic and normal links while refusing external execution formulas',()=>{
 const spreadsheet=formula=>zip([{name:'[Content_Types].xml',data:'<Types/>'},{name:'xl/workbook.xml',data:'<workbook/>'},{name:'xl/worksheets/sheet1.xml',data:`<worksheet><f>${formula}</f></worksheet>`}]);
 for(const formula of ['SUM(B2:C4)','B2*C2','IF(B2&gt;0,"Oui","Non")','HYPERLINK("https://example.org/?a=1,b=2&amp;c=3";"Source")','HYPERLINK("mailto:team@example.org","Écrire")','SUM(Tableau[Budget])'])assert.doesNotThrow(()=>validateDocument(spreadsheet(formula),'xlsx'));
 for(const formula of ['WEBSERVICE("https://example.org")','_xlfn.RTD("server",,"data")','CALL("library","method","J")',"cmd|'/C test'!A0","'[external.xlsx]Sheet1'!A1",'HYPERLINK("file:///tmp/x","Ouvrir")','HYPERLINK(A1,"Ouvrir")','<![CDATA[WEBSERVICE("https://example.org")]]>'])assert.throws(()=>validateDocument(spreadsheet(formula),'xlsx'),/acti[fv]|liens/u);
 assert.throws(()=>validateDocument(zip([{name:'[Content_Types].xml',data:'<Types/>'},{name:'xl/workbook.xml',data:'<workbook/>'},{name:'xl/connections.xml',data:'<connections><webPr url="https://example.org/"/></connections>'}]),'xlsx'),/connexion externe/u);
});

test('library stores browser-selected bytes, retains duplicate names and refuses arbitrary paths',async t=>{
 const dataDir=await setup(t),library=new DocumentLibrary({dataDir});await library.ready;
 const first=await library.import({name:'Exemple.md',base64:Buffer.from('# Exemple public').toString('base64')});
 const second=await library.import({name:'Exemple.md',base64:Buffer.from('# Autre exemple').toString('base64')});
 assert.equal(first.name,'Exemple.md');assert.equal(second.name,'Exemple (2).md');assert.notEqual(first.id,second.id);assert.match(first.revision,/^[a-f0-9]{64}$/u);
 await assert.rejects(()=>library.import({name:'../secret.txt',base64:'YQ=='}),/sans chemin/u);
 await assert.rejects(()=>library.import({name:'x.txt',base64:'YQ==',path:'/tmp/secret'}),/sans chemin/u);
 await assert.rejects(()=>library.import({name:'x.txt',base64:'a!=='}));
 await assert.rejects(()=>library.import({name:'x.txt',base64:Buffer.alloc(DOCUMENT_LIMITS.fileBytes+1).toString('base64')}),/5 Mo|lisible/u);
 const outside=path.join(dataDir,'outside.txt');await writeFile(outside,'hidden');await symlink(outside,path.join(library.directory,'Link.txt'));
 assert.equal((await library.state()).items.length,2);assert.deepEqual((await library.state()).ignored,['Link.txt']);
 await library.remove(first.id);assert.equal((await library.state()).items.length,1);
});

test('reference copies carry revisions, stay immutable and never overwrite originals or prior copies',async t=>{
 const dataDir=await setup(t),library=new DocumentLibrary({dataDir});const item=await library.import({name:'Reference.md',base64:Buffer.from('Version originale').toString('base64')});const destination=path.join(dataDir,'missions','demo','travail');
 const copy=await library.prepareReferences([{id:item.id,revision:item.revision}],destination);assert.equal(copy.references.length,1);assert.equal(copy.references[0].revision,item.revision);assert.equal((await readFile(path.join(destination,copy.references[0].path))).toString(),'Version originale');assert.equal((await stat(path.join(destination,copy.references[0].path))).mode&0o777,0o444);
 const manifest=await readFile(path.join(destination,copy.manifestPath));await assert.rejects(()=>library.prepareReferences([item.id],destination),/existent déjà/u);assert.deepEqual(await readFile(path.join(destination,copy.manifestPath)),manifest);
 await writeFile(path.join(library.directory,item.name),'Version nouvelle');await assert.rejects(()=>library.prepareReferences([{id:item.id,revision:item.revision}],path.join(dataDir,'missions','other','travail')),/a changé/u);
 await assert.rejects(()=>library.prepareReferences([item.id],path.join(dataDir,'outside')),/cette mission/u);
});

test('library rejects a replaced storage folder and a symlink destination',async t=>{
 const dataDir=await setup(t),outside=await setup(t),library=new DocumentLibrary({dataDir});await library.ready;await rm(library.directory,{recursive:true});await symlink(outside,library.directory);await assert.rejects(()=>library.state());
 const safeDir=await setup(t),safe=new DocumentLibrary({dataDir:safeDir});await safe.ready;await mkdir(path.join(safeDir,'missions'));await symlink(outside,path.join(safeDir,'missions','linked'));await assert.rejects(()=>safe.prepareReferences([],path.join(safeDir,'missions','linked','travail')));
});

test('runtime installation requires explicit confirmation and export paths remain under missions',async t=>{
 const dataDir=await setup(t),library=new DocumentLibrary({dataDir});await library.ready;await assert.rejects(()=>library.installRuntime({}),/Confirmez/u);await assert.rejects(()=>library.export({sourceText:'test',destination:path.join(dataDir,'missions','x')}),/Installez/u);
 const mockRun=async(binary,args)=>args.includes('-c')?'ok':JSON.stringify({files:[{format:'pdf',base64:Buffer.from('%PDF-1.4\n%%EOF').toString('base64')}],warnings:[]});
 const ready=new DocumentLibrary({dataDir,pythonBinary:'/mock/python',run:mockRun});await ready.ready;
 await assert.rejects(()=>ready.export({sourceText:'test',destination:path.join(dataDir,'outside'),formats:['pdf']}),/cette mission/u);
 await assert.rejects(()=>ready.export({sourceText:'test',destination:path.join(dataDir,'missions','x'),formats:['pdf','pdf']}),/Word, PDF ou Excel/u);
 await assert.rejects(()=>ready.export({sourceText:'test',destination:path.join(dataDir,'missions','x'),formats:['pdf'],signal:AbortSignal.abort()}),error=>error.code==='ABORT_ERR');
 const destination=path.join(dataDir,'missions','x','travail','Exports');const first=await ready.export({sourceText:'test',destination,formats:['pdf'],title:'Rapport'}),second=await ready.export({sourceText:'test',destination,formats:['pdf'],title:'Rapport'});assert.equal(first.files[0].path,'Rapport.pdf');assert.equal(second.files[0].path,'Rapport (2).pdf');assert.deepEqual(await readdir(destination),['Rapport (2).pdf','Rapport.pdf']);
});

test('closing the document service aborts an in-progress preparation',{timeout:2000},async t=>{
 const dataDir=await setup(t);let probes=0,aborted=false,started;const pending=new Promise(resolve=>{started=resolve;});
 const run=async(binary,args,{signal}={})=>{if(args.at(-1).includes('sys.version_info'))return'ok';if(++probes===1)throw Error('not prepared');return new Promise((resolve,reject)=>{const stop=()=>{aborted=true;reject(Object.assign(Error('aborted'),{code:'ABORT_ERR'}));};if(signal?.aborted)stop();else signal?.addEventListener('abort',stop,{once:true});started();});};
 const library=new DocumentLibrary({dataDir,pythonBinary:process.execPath,run});await library.ready;await library.installRuntime({confirmed:true});await pending;await library.close();assert.equal(library.runtime.available,false);assert.equal(library.runtime.status,'not_installed');assert.equal(aborted,true);
});

test('real local Word PDF Excel exports preserve template parts and remain deterministic',{skip:!pythonReady?'Set OSCAR_TEST_DOCUMENT_PYTHON to Python with docx/openpyxl/reportlab':false},async t=>{
 const dataDir=await setup(t),fixtures=path.join(dataDir,'fixtures');await exec(python,['-I',fileURLToPath(new URL('./document-fixtures.py',import.meta.url)),fixtures]);const library=new DocumentLibrary({dataDir,pythonBinary:python});await library.ready;assert.equal((await library.state()).runtime.status,'ready');
 const word=await library.import({name:'Modele parlementaire.docx',base64:(await readFile(path.join(fixtures,'Modele parlementaire.docx'))).toString('base64')}),excel=await library.import({name:'Modele budget.xlsx',base64:(await readFile(path.join(fixtures,'Modele budget.xlsx'))).toString('base64')});
 const content='# Note publique\n\nUne proposition claire pour les écoles et la bibliothèque.\n\n## Priorités\n\n- Préserver les couleurs du modèle\n- Évaluer les besoins\n\n| Action | Budget |\n| --- | --- |\n| Bibliothèque | 1200 |\n| Écoles | 2400 |';
 const destination=path.join(dataDir,'missions','QA','travail','Exports');const plain=await library.export({sourceText:content,destination,formats:['docx','pdf','xlsx'],title:'Note publique'});assert.equal(plain.files.length,3);
 const nativeWord=await library.export({sourceText:content,destination,formats:['docx'],templateId:word.id,title:'Avec modèle Word'}),nativeExcel=await library.export({sourceText:'Nom,Valeur\nFormule,=1+1\nBudget,1200',sourceType:'csv',destination,formats:['xlsx'],templateId:excel.id,title:'Avec modèle Excel'});
 const repeat=await library.export({sourceText:content,destination,formats:['docx','pdf','xlsx'],title:'Note publique'});assert.deepEqual(repeat.files.map(file=>file.sha256),plain.files.map(file=>file.sha256));
 const audit=String.raw`import sys,zipfile,json; from docx import Document; from openpyxl import load_workbook; p=sys.argv[1:]; a=zipfile.ZipFile(p[0]); b=zipfile.ZipFile(p[1]); assert a.read('word/styles.xml')==b.read('word/styles.xml'); assert a.read('word/header1.xml')==b.read('word/header1.xml'); assert '{{CONTENU}}' not in b.read('word/document.xml').decode(); assert '255C49' in b.read('word/document.xml').decode(); d=Document(p[1]); assert any('bibliothèque' in x.text for x in d.paragraphs); a=zipfile.ZipFile(p[2]); b=zipfile.ZipFile(p[3]); assert a.read('xl/worksheets/sheet1.xml')==b.read('xl/worksheets/sheet1.xml'); assert a.read('xl/styles.xml')==b.read('xl/styles.xml'); w=load_workbook(p[3]); assert w['Budget original']['D2'].value=='=B2*C2'; assert w['Livraison Oscar']['B2'].value=='=1+1'; assert w['Livraison Oscar']['B2'].data_type=='s'; print(json.dumps({'word_preserved':True,'excel_preserved':True,'formula_injection_blocked':True}))`;
 await exec(python,['-I','-c',audit,path.join(fixtures,'Modele parlementaire.docx'),path.join(destination,nativeWord.files[0].path),path.join(fixtures,'Modele budget.xlsx'),path.join(destination,nativeExcel.files[0].path)]);
 assert.equal((await library.item(word.id)).revision,word.revision);assert.equal((await library.item(excel.id)).revision,excel.revision);assert.ok(nativeExcel.warnings.length>0);
 const pinned=await library.prepareReferences([{id:word.id,revision:word.revision}],path.join(dataDir,'missions','pinned','travail'));
 await writeFile(path.join(library.directory,word.name),Buffer.concat([await readFile(path.join(fixtures,'Modele parlementaire.docx')),Buffer.from('changed')]));
 await assert.rejects(()=>library.export({sourceText:content,destination,formats:['docx'],templateId:word.id,templateRevision:word.revision}),/a changé/u);
 const copied=await library.export({sourceText:content,destination,formats:['docx'],templatePath:path.join(dataDir,'missions','pinned','travail',pinned.references[0].path),templateType:'docx',templateRevision:word.revision,title:'Modèle épinglé'});assert.equal(copied.files.length,1);
});

test('Word table models retain headers, source links and colours while content fits the cell',{skip:!pythonReady?'Set OSCAR_TEST_DOCUMENT_PYTHON to Python with docx/openpyxl/reportlab':false},async t=>{
 const dataDir=await setup(t),fixtures=path.join(dataDir,'fixtures');await exec(python,['-I',fileURLToPath(new URL('./document-fixtures.py',import.meta.url)),fixtures]);const library=new DocumentLibrary({dataDir,pythonBinary:python});
 const original=path.join(fixtures,'Modele parlementaire tableau.docx'),template=await library.import({name:'Exemple de question.docx',base64:(await readFile(original)).toString('base64')});
 const destination=path.join(dataDir,'missions','Tableau','travail','Exports'),result=await library.export({sourceText:'## Mes questions\n\nQuelles mesures pour les écoles ?\n\n| Action | Échéance |\n| --- | --- |\n| Publication | 2026 |\n| Évaluation | 2027 |',templateId:template.id,templateRevision:template.revision,destination,formats:['docx'],title:'Question écrite'});
 const audit=String.raw`import sys,zipfile,json; from lxml import etree; from docx import Document; a=zipfile.ZipFile(sys.argv[1]); b=zipfile.ZipFile(sys.argv[2]); ns={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}; root=etree.fromstring(b.read('word/document.xml')); assert a.read('word/header1.xml')==b.read('word/header1.xml'); assert a.read('word/footer1.xml')==b.read('word/footer1.xml'); assert a.read('word/styles.xml')==b.read('word/styles.xml'); assert a.read('word/_rels/document.xml.rels')==b.read('word/_rels/document.xml.rels'); assert '{{CONTENU}}' not in b.read('word/document.xml').decode(); cell=root.xpath('//w:tc[w:tbl]',namespaces=ns)[0]; width=int(cell.xpath('./w:tcPr/w:tcW/@w:w',namespaces=ns)[0]); table=int(cell.xpath('./w:tbl/w:tblPr/w:tblW/@w:w',namespaces=ns)[0]); assert table<=width; assert 'EAD7AC' in b.read('word/document.xml').decode(); d=Document(sys.argv[2]); assert len(d.tables[0].cell(1,1).tables)==1; assert any('écoles' in p.text for p in d.tables[0].cell(1,1).paragraphs); print(json.dumps({'cell_width':width,'table_width':table,'links_preserved':True}))`;
 await exec(python,['-I','-c',audit,original,path.join(destination,result.files[0].path)]);
});

test('CSV exports retain identifiers and precision and never turn untrusted strings into formulas',{skip:!pythonReady?'Set OSCAR_TEST_DOCUMENT_PYTHON to Python with docx/openpyxl/reportlab':false},async t=>{
 const dataDir=await setup(t),fixtures=path.join(dataDir,'fixtures');await exec(python,['-I',fileURLToPath(new URL('./document-fixtures.py',import.meta.url)),fixtures]);const library=new DocumentLibrary({dataDir,pythonBinary:python});
 const template=await library.import({name:'Budget.xlsx',base64:(await readFile(path.join(fixtures,'Modele budget.xlsx'))).toString('base64')});
 const text='Type,Valeur\nCode,00123\nLong,12345678901234567890\nPrécis,123456789012.12345678\nFormule,=1+1\nDDE,+cmd|test!A1\nFonction,@SUM(A1:A2)\nSoustraction,-1+1\nNombre,1200\nDécimal,12.5';
 const destination=path.join(dataDir,'missions','CSV','travail','Exports'),plain=await library.export({sourceText:text,sourceType:'csv',destination,formats:['xlsx'],title:'CSV simple'}),modeled=await library.export({sourceText:text,sourceType:'csv',destination,formats:['xlsx'],title:'CSV avec modèle',templateId:template.id});
 const audit=String.raw`import sys,json; from openpyxl import load_workbook; expected=['00123','12345678901234567890','123456789012.12345678','=1+1','+cmd|test!A1','@SUM(A1:A2)','-1+1'];
for file in sys.argv[1:]:
 s=load_workbook(file)['Livraison Oscar']; assert [s.cell(row,2).value for row in range(2,9)]==expected; assert all(s.cell(row,2).data_type=='s' for row in range(2,9)); assert s['B9'].value==1200 and s['B10'].value==12.5
print(json.dumps({'identifiers_preserved':True,'precision_preserved':True,'formulas_inert':True}))`;
 await exec(python,['-I','-c',audit,path.join(destination,plain.files[0].path),path.join(destination,modeled.files[0].path)]);
});
