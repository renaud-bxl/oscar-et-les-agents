import test from 'node:test';
import assert from 'node:assert/strict';
import {DocumentLibraryDialog,missionExportSelection} from '../public/document-library.js';

const file=path=>({path});

test('export choices belong to their mission, including when two missions use the same filename',()=>{
  const choices=new Map(),first={id:'first',result:'Final answer',files:[file('report.md')]},second={...first,id:'second'};
  assert.equal(missionExportSelection(first,choices).path,'');
  choices.set(first.id,'report.md');
  assert.equal(missionExportSelection(second,choices).path,'');
  assert.equal(missionExportSelection(first,choices).path,'report.md');
  choices.set(first.id,'');
  assert.equal(missionExportSelection(first,choices).path,'');
});

test('a missing export source falls back to a real eligible file when there is no final result',()=>{
  const choices=new Map([['first','removed.md']]),mission={id:'first',result:'',files:[file('../outside.md'),file('/absolute.txt'),file('photo.png'),file('Livraison/data.csv'),file('report.md')]};
  assert.deepEqual(missionExportSelection(mission,choices),{files:[file('Livraison/data.csv'),file('report.md')],path:'Livraison/data.csv'});
  mission.files=[file('updated.txt')];
  assert.equal(missionExportSelection(mission,choices).path,'updated.txt');
  mission.files=[];
  assert.equal(missionExportSelection(mission,choices).path,'');
  assert.deepEqual(missionExportSelection(null,choices),{files:[],path:''});
});

class Element{
  constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.listeners=new Map();this.value='';}
  append(...items){this.children.push(...items);}
  replaceChildren(...items){this.children=[...items];}
  setAttribute(){}
  addEventListener(name,action){this.listeners.set(name,action);}
}
const find=(root,tag)=>root.tagName===tag?root:root.children.map(child=>find(child,tag)).find(Boolean);

test('the rendered export form stays usable after changing missions and exports the displayed file',t=>{
  const original=globalThis.document;t.after(()=>{if(original===undefined)delete globalThis.document;else globalThis.document=original;});
  globalThis.document={createElement:tag=>new Element(tag)};
  let mission={id:'first',title:'First mission',status:'completed',result:'Summary',files:[file('first.md')]};
  const exported=[],dialog=Object.assign(Object.create(DocumentLibraryDialog.prototype),{exportSection:new Element('section'),getMission:()=>mission,exportSources:new Map(),formats:new Set(['pdf']),data:{runtime:{available:true}},exportDelivery:path=>exported.push(path)});
  dialog.renderExport();
  const firstSource=find(dialog.exportSection,'SELECT');firstSource.value='first.md';firstSource.listeners.get('change')();
  mission={id:'second',title:'Second mission',status:'cancelled',result:'',files:[file('second.md')]};dialog.renderExport();
  const secondSource=find(dialog.exportSection,'SELECT'),exportButton=find(dialog.exportSection,'BUTTON');
  assert.equal(secondSource.value,'second.md');assert.equal(exportButton.disabled,false);
  exportButton.listeners.get('click')();assert.deepEqual(exported,['second.md']);
  mission={id:'first',title:'First mission',status:'completed',result:'Summary',files:[file('first.md')]};dialog.renderExport();
  assert.equal(find(dialog.exportSection,'SELECT').value,'first.md');
  mission.files=[file('replacement.md')];mission.result='';dialog.renderExport();
  assert.equal(find(dialog.exportSection,'SELECT').value,'replacement.md');assert.equal(find(dialog.exportSection,'BUTTON').disabled,false);
});
