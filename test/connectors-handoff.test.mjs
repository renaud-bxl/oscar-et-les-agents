import test from 'node:test';
import assert from 'node:assert/strict';
import {ConnectorsDialog,connectorHandoffChoices,connectorHandoffPreset,connectorHandoffSelection} from '../public/connectors-dialog.js';

const service=(client,name,kind='app')=>({client,name,displayName:name,inherited:true,status:'authorized',readOnlyAutomation:{available:true,service:kind}});
const gmail=service('codex','Gmail','gmail'),claudeMail=service('claude','Claude Gmail','gmail'),drive=service('codex','Drive'),higgsfield={...service('claude','Higgsfield'),readOnlyAutomation:{available:false}},technical={client:'codex',name:'cua_repl',status:'configured',inherited:false,managed:false,readOnlyAutomation:{available:false}};

test('brief choices exclude runtime helpers while preserving inherited and owner-added services',()=>{
  const managed={...technical,name:'oscar-mon-outil',managed:true},localReader={...technical,name:'gmail-local',status:'authorized',readOnlyAutomation:{available:true,service:'gmail'}},disabled={...gmail,name:'Disabled',status:'disabled'},stale={...drive,name:'Old Drive',stale:true};
  const rows=[technical,{...technical,name:'node_repl'},{...technical,name:'rea'},higgsfield,managed,gmail,drive,localReader,disabled,stale];
  const choices=connectorHandoffChoices(rows);
  assert.deepEqual(choices.map(row=>row.name),['Gmail','Drive','gmail-local','Higgsfield','oscar-mon-outil']);
  assert.deepEqual(rows.map(row=>row.name),['cua_repl','node_repl','rea','Higgsfield','oscar-mon-outil','Gmail','Drive','gmail-local','Disabled','Old Drive']);
  assert.deepEqual(connectorHandoffChoices(rows,{client:'claude'}),[higgsfield]);
  assert.deepEqual(connectorHandoffChoices([technical]),[]);
});

test('a chosen brief service survives refresh and a removed service is never silently replaced',()=>{
  assert.deepEqual(connectorHandoffSelection([gmail,drive],'codex:Drive'),{value:'codex:Drive',needsChoice:false});
  assert.deepEqual(connectorHandoffSelection([gmail],'codex:Drive'),{value:'',needsChoice:true});
  assert.deepEqual(connectorHandoffSelection([gmail],'',{needsChoice:true}),{value:'',needsChoice:true});
  assert.deepEqual(connectorHandoffSelection([gmail,drive]),{value:'codex:Gmail',needsChoice:false});
  assert.deepEqual(connectorHandoffSelection([claudeMail],'codex:Drive',{client:'claude'}),{value:'claude:Claude Gmail',needsChoice:false});
});

test('mail and creative presets select the matching service and prefer the current client',()=>{
  const choices=connectorHandoffChoices([technical,gmail,claudeMail,drive,higgsfield]);
  assert.equal(connectorHandoffPreset(choices,'mail','claude:Higgsfield'),claudeMail);
  assert.equal(connectorHandoffPreset(choices,'mail','codex:Drive'),gmail);
  assert.equal(connectorHandoffPreset(choices,'higgsfield','codex:Drive'),higgsfield);
  assert.equal(connectorHandoffPreset(connectorHandoffChoices([gmail,drive],{client:'codex'}),'higgsfield','codex:Drive'),null);
});

test('preparing a brief validates the same service list and retains the exact originating client',async()=>{
  const calls=[],dialog={data:{connections:[technical,gmail,claudeMail]},client:{value:'all'},selected:{value:'claude:Claude Gmail'},prompt:{value:'Ma demande'},ready:{focus(){}},instructions:{},output:{},run(action){this.pending=action();},request:async(url,options)=>{calls.push([url,JSON.parse(options.body)]);return{prompt:'Brief préparé',instructions:'Reprendre dans Claude'};}};
  ConnectorsDialog.prototype.handoff.call(dialog);await dialog.pending;
  assert.deepEqual(calls,[['/api/connectors/handoff',{client:'claude',name:'Claude Gmail',prompt:'Ma demande'}]]);
  assert.equal(dialog.ready.value,'Brief préparé');assert.equal(dialog.output.hidden,false);
  dialog.selected.value='codex:cua_repl';ConnectorsDialog.prototype.handoff.call(dialog);await assert.rejects(dialog.pending,/Choisissez une connexion/u);assert.equal(calls.length,1);
  dialog.client.value='codex';dialog.selected.value='claude:Claude Gmail';ConnectorsDialog.prototype.handoff.call(dialog);await assert.rejects(dialog.pending,/Choisissez une connexion/u);assert.equal(calls.length,1);
});

test('catalogue and guided buttons open Zoé with the exact service from the chosen client',()=>{
  class Element{
    constructor(tag){this.tagName=tag;this.children=[];this.dataset={};this.handlers={};}
    append(...items){this.children.push(...items);}
    replaceChildren(...items){this.children=items;}
    setAttribute(){}
    addEventListener(event,action){this.handlers[event]=action;}
    contains(){return false;}
    querySelectorAll(){return[];}
    descendants(){return this.children.flatMap(child=>[child,...child.descendants()]);}
  }
  const previous=globalThis.document;globalThis.document={createElement:tag=>new Element(tag),activeElement:null};
  try{
    const opened=[],dialog={data:{catalog:[{id:'gmail',name:'Gmail'}],connections:[gmail,claudeMail],clients:{}},client:{value:'claude'},selected:{value:'codex:Gmail'},catalog:new Element('div'),assistantSteps:new Element('ol'),goalButtons:[],goal:'mail',onSecretary:(mode,connection)=>opened.push([mode,connection]),close(){},link:()=>new Element('a')};
    ConnectorsDialog.prototype.renderCatalog.call(dialog);
    dialog.catalog.descendants().find(item=>item.dataset.connectorControl==='catalog-use:gmail').handlers.click();
    assert.deepEqual(opened,[['mail',claudeMail]]);
    ConnectorsDialog.prototype.renderAssistant.call(dialog);
    dialog.assistantSteps.descendants().find(item=>item.dataset.connectorControl==='assistant-open').handlers.click();
    assert.deepEqual(opened,[['mail',claudeMail],['mail',claudeMail]]);
  }finally{if(previous===undefined)delete globalThis.document;else globalThis.document=previous;}
});

test('opening the brief never imports a mission prompt and preserves text deliberately written by the user',async()=>{
  const previous=globalThis.document;globalThis.document={activeElement:null};
  try{
    let promptReads=0;const dialog={dialog:{open:false,showModal(){this.open=true;}},output:{},error:{},prompt:{value:''},clientStatus:{},epoch:0,getMission(){promptReads++;return{prompt:'Mon idée\n\nSERVICE AUTORISÉ : app://connector_xxx\nGUARDS et instructions techniques.'};},refresh:async()=>{},poll(){}};
    await ConnectorsDialog.prototype.open.call(dialog);assert.equal(dialog.prompt.value,'');assert.equal(promptReads,0);
    dialog.prompt.value='Ma demande volontaire, sans modifications [et avec mes références].';dialog.dialog.open=false;
    await ConnectorsDialog.prototype.open.call(dialog);assert.equal(dialog.prompt.value,'Ma demande volontaire, sans modifications [et avec mes références].');assert.equal(promptReads,0);
    dialog.prompt.value='';dialog.dialog.open=false;await ConnectorsDialog.prototype.open.call(dialog);assert.equal(dialog.prompt.value,'');assert.equal(promptReads,0);
  }finally{if(previous===undefined)delete globalThis.document;else globalThis.document=previous;}
});
