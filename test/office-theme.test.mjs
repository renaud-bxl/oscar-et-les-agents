import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {OfficeTheme,resolveOfficeTheme,savedOfficeTheme,OFFICE_THEME_STORE} from '../public/office-theme.js';
import messages from '../public/translations-theme.js';
import {translate} from '../public/i18n.js';

const at=hour=>new Date(2026,9,20,hour);
function fixture({mode='auto',hour=22,storageBlocked=false}={}){
  let now=at(hour),tick,cleared=false;const values=new Map([[OFFICE_THEME_STORE,mode]]),controls=['auto','light','dark','auto','light','dark'].map(mode=>({dataset:{officeThemeMode:mode},attributes:{},setAttribute(key,value){this.attributes[key]=value;}})),summary={attributes:{},setAttribute(key,value){this.attributes[key]=value;}},icon={},meta={setAttribute(key,value){this[key]=value;}},events=[];
  class Document extends EventTarget{constructor(){super();this.documentElement={dataset:{}};}querySelectorAll(selector){return selector==='[data-office-theme-mode]'?controls:selector==='[data-office-theme-summary]'?[summary]:selector==='[data-office-theme-icon]'?[icon]:[];}querySelector(){return meta;}}
  const document=new Document(),window=new EventTarget();window.CustomEvent=CustomEvent;document.addEventListener('oscar:theme',event=>events.push(event.detail));
  const storage={getItem:key=>{if(storageBlocked)throw new Error('blocked');return values.get(key);},setItem:(key,value)=>{if(storageBlocked)throw new Error('blocked');values.set(key,value);}};
  const theme=new OfficeTheme({document,window,storage,now:()=>now,setIntervalImpl:callback=>{tick=callback;return 1;},clearIntervalImpl:()=>{cleared=true;}});
  return{theme,document,window,controls,summary,icon,meta,events,values,get cleared(){return cleared;},tick:hour=>{now=at(hour);tick();}};
}

test('automatic appearance follows local clock boundaries while manual preferences remain independent',()=>{
  for(let hour=0;hour<24;hour++){assert.equal(resolveOfficeTheme('auto',at(hour)),hour<8||hour>=20?'dark':'light');assert.equal(resolveOfficeTheme('dark',at(hour)),'dark');assert.equal(resolveOfficeTheme('light',at(hour)),'light');}
  assert.equal(resolveOfficeTheme('auto',new Date(2026,9,20,7,59,59)),'dark');assert.equal(resolveOfficeTheme('auto',new Date(2026,9,20,19,59,59)),'light');assert.throws(()=>resolveOfficeTheme('auto',new Date('invalid')),TypeError);
});

test('both accessible control groups stay synchronized and automatic changes do not rewrite preference',()=>{
  const f=fixture();assert.equal(f.document.documentElement.dataset.officeTheme,'dark');assert.equal(f.events.length,1);assert.equal(f.meta.content,'#101a24');
  f.tick(9);assert.equal(f.theme.theme,'light');assert.equal(f.values.get(OFFICE_THEME_STORE),'auto');assert.equal(f.events.length,2);
  f.theme.setMode('dark');assert.equal(f.values.get(OFFICE_THEME_STORE),'dark');assert.equal(f.controls.filter(button=>button.attributes['aria-pressed']==='true').length,2);assert(f.controls.filter(button=>button.attributes['aria-pressed']==='true').every(button=>button.dataset.officeThemeMode==='dark'));
  const original=f.controls[0];f.tick(12);assert.equal(f.events.length,3);assert.strictEqual(f.controls[0],original);assert.equal(f.theme.theme,'dark');assert.equal(f.icon.textContent,'☾');f.theme.destroy();assert(f.cleared);
});

test('storage failures and corrupted saved preferences preserve a usable local-clock theme',()=>{
  assert.equal(savedOfficeTheme({getItem:()=>'{bad json'}),'auto');assert.equal(savedOfficeTheme({getItem:()=>{throw new Error('blocked');}}),'auto');
  const f=fixture({storageBlocked:true});assert.equal(f.theme.mode,'auto');assert.doesNotThrow(()=>f.theme.setMode('light'));assert.equal(f.theme.theme,'light');f.theme.destroy();
});

test('another office tab can update the preference without creating a write loop',()=>{
  const f=fixture({mode:'dark',hour:12});const event=Object.assign(new Event('storage'),{key:OFFICE_THEME_STORE,newValue:'light'});f.window.dispatchEvent(event);assert.equal(f.theme.theme,'light');assert.equal(f.theme.mode,'light');assert.equal(f.values.get(OFFICE_THEME_STORE),'dark');
  f.window.dispatchEvent(Object.assign(new Event('storage'),{key:OFFICE_THEME_STORE,newValue:null}));assert.equal(f.theme.mode,'auto');assert.equal(f.theme.theme,'light');f.theme.destroy();const count=f.events.length;f.window.dispatchEvent(event);assert.equal(f.events.length,count);
});

test('the first-paint bootstrap agrees with the live theme and never needs storage permission',async()=>{
  const script=await readFile(new URL('../public/office-theme-init.js',import.meta.url),'utf8');
  for(const mode of ['auto','light','dark','invalid'])for(const hour of [0,7,8,19,20,23]){
    const document={documentElement:{dataset:{}}};class Clock extends Date{constructor(){super(at(hour));}}
    vm.runInNewContext(script,{document,Date:Clock,localStorage:{getItem:()=>mode}});assert.equal(document.documentElement.dataset.officeTheme,resolveOfficeTheme(mode,at(hour)));
  }
  const document={documentElement:{dataset:{}}};assert.doesNotThrow(()=>vm.runInNewContext(script,{document,Date}));
});

test('theme controls and explanations are translated, dark surfaces stay readable, documents retain their own artwork',async()=>{
  for(const source of Object.keys(messages))for(const locale of ['en','nl'])assert.notEqual(translate(source,locale),source);
  const css=await readFile(new URL('../public/office-theme.css',import.meta.url),'utf8'),html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
  assert.equal((html.match(/data-office-theme-mode="auto"/gu)||[]).length,2);assert(html.indexOf('/office-theme-init.js')<html.indexOf('/style.css'));assert(css.includes('.artifact-pdf-canvas{background:#fff!important}'));assert(!/filter\s*:\s*(?:brightness|blur|grayscale)/u.test(css));
  const luminance=hex=>{const values=hex.match(/../gu).map(value=>parseInt(value,16)/255).map(value=>value<=.04045?value/12.92:((value+.055)/1.055)**2.4);return values[0]*.2126+values[1]*.7152+values[2]*.0722;};
  for(const [text,background]of[['e8f0f5','172531'],['b0c2ce','20323f'],['add7f4','172531'],['f0f8fc','31566c']])assert((luminance(text)+.05)/(luminance(background)+.05)>=4.5);
});
