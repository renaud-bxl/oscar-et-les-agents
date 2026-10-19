import test from 'node:test';import assert from 'node:assert/strict';import{missionLibrarySelection}from'../public/document-library.js';
const item=(n,extra={})=>({id:String(n).padStart(24,'0'),revision:'a'.repeat(64),...extra});
test('reusing a mission keeps only examples and template with unchanged pinned revisions',()=>{
 const examples=[item(1),item(2,{revision:'b'.repeat(64)}),item(3,{template:true})];
 const result=missionLibrarySelection({referenceRevisions:[{id:examples[0].id,revision:examples[0].revision},{id:examples[1].id,revision:'a'.repeat(64)},{id:item(4).id,revision:'a'.repeat(64)}],templateReference:{id:examples[2].id,revision:examples[2].revision},outputFormats:['pdf','pdf','exe','docx']},examples);
 assert.deepEqual(result,{ids:[examples[0].id],formats:['docx','pdf'],templateId:examples[2].id,skipped:2});
});
test('legacy unpinned references and changed template are never silently replaced',()=>{
 const examples=[item(1),item(2,{template:true})];assert.deepEqual(missionLibrarySelection({referenceIds:[examples[0].id],templateId:examples[1].id,templateRevision:'b'.repeat(64)},examples),{ids:[],formats:[],templateId:null,skipped:2});
});
test('reference reuse remains bounded and ignores unknown formats and malformed metadata',()=>{
 const examples=Array.from({length:12},(_,n)=>item(n+1));const result=missionLibrarySelection({references:examples.map(({id,revision})=>({id,revision})),outputFormats:'pdf'},[null,...examples]);assert.equal(result.ids.length,8);assert.equal(result.skipped,4);assert.deepEqual(result.formats,[]);assert.deepEqual(missionLibrarySelection(null),{ids:[],formats:[],templateId:null,skipped:0});
});
