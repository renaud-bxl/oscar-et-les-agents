import interfaceMessages, {patterns as interfacePatterns} from './translations-interface.js';
import catalogMessages, {patterns as catalogPatterns} from './translations-catalog.js';
import guideMessages from './translations-guide.js';
import calendarMessages from './translations-calendar.js';
import voiceMessages from './translations-voices.js';
import themeMessages from './translations-theme.js';
import performanceMessages, {patterns as performancePatterns} from './translations-performance.js';
import teamMessages from './translations-team.js';
import deliveryProgressMessages from './translations-delivery-progress.js';
import deliveryPreviewMessages from './translations-delivery-preview.js';
import deliveryLibraryMessages from './translations-delivery-library.js';

export const LANGUAGES=Object.freeze({fr:'Français',en:'English',nl:'Nederlands'});
const messages={...interfaceMessages,...catalogMessages,...guideMessages,...calendarMessages,...themeMessages,...performanceMessages,...voiceMessages,...teamMessages,...deliveryProgressMessages,...deliveryPreviewMessages,...deliveryLibraryMessages};
const patterns=[...interfacePatterns,...catalogPatterns,...performancePatterns].map(item=>({...item,regex:new RegExp(item.source,'u')}));
const STORE='oscar-language-v1';
let language='fr',started=false,observer;
const originals=new WeakMap(),attributes=new WeakMap();
try{const stored=typeof window==='undefined'?null:window.localStorage?.getItem(STORE);if(LANGUAGES[stored])language=stored;}catch{}

export function getLocale(){return language;}
export function translate(source,locale=language){
  if(typeof source!=='string'||locale==='fr'||!LANGUAGES[locale])return source;
  const core=source.trim();if(!core)return source;
  let translated=messages[core]?.[locale];
  if(!translated){for(const pattern of patterns){if(pattern.regex.test(core)){translated=core.replace(pattern.regex,pattern[locale]);break;}}}
  return translated?source.slice(0,source.indexOf(core))+translated+source.slice(source.indexOf(core)+core.length):source;
}
export function withLocaleInstruction(prompt){
  const instruction={fr:'français',en:'anglais (English)',nl:'néerlandais (Nederlands)'}[language];
  const result=`${prompt}\n\nLangue demandée pour cette mission : ${instruction}. Rédige le titre, le plan, les tâches, les comptes rendus, les retours d’Oscar, la livraison finale et les textes visibles des fichiers créés dans cette langue. Conserve les noms propres et les chemins techniques nécessaires.`;
  if(result.length>16000)throw new Error(translate('Le brief et la consigne de langue dépassent 16 000 caractères. Raccourcissez légèrement le brief : votre texte est conservé.'));
  return result;
}
function textNode(node){
  if(!node.parentElement||node.parentElement.closest('script,style,textarea,pre,[data-no-translate]'))return;
  let item=originals.get(node);
  if(!item||node.nodeValue!==item.last)item={source:node.nodeValue,last:node.nodeValue};
  const value=translate(item.source);item.last=value;originals.set(node,item);
  if(node.nodeValue!==value)node.nodeValue=value;
}
const TRANSLATED_ATTRIBUTES=['aria-label','title','placeholder','aria-valuetext','alt'];
function elementAttributes(element){
  if(element.closest('script,style,[data-no-translate]'))return;
  let entries=attributes.get(element);if(!entries){entries={};attributes.set(element,entries);}
  for(const key of TRANSLATED_ATTRIBUTES){
    const current=element.getAttribute(key);if(current===null){delete entries[key];continue;}
    let item=entries[key];if(!item||current!==item.last)item={source:current,last:current};
    const value=translate(item.source);item.last=value;entries[key]=item;
    if(current!==value)element.setAttribute(key,value);
  }
  // An option without an explicit value would otherwise change its form value with its label.
  if(element.tagName==='OPTION'&&!element.hasAttribute('value'))element.value=element.textContent;
  if(element.matches('[data-locale-select]'))element.value=language;
}
function walk(root){
  if(root.nodeType===3){textNode(root);return;}
  if(root.nodeType!==1&&root.nodeType!==9&&root.nodeType!==11)return;
  if(root.nodeType===1){elementAttributes(root);if(root.matches('script,style,textarea,pre,[data-no-translate]'))return;}
  for(const child of [...root.childNodes])walk(child);
}
export function setLocale(locale){
  if(!LANGUAGES[locale])throw new RangeError('Langue non prise en charge.');
  language=locale;try{if(typeof window!=='undefined')window.localStorage?.setItem(STORE,locale);}catch{}
  if(globalThis.document){document.documentElement.lang=locale;walk(document.body);document.dispatchEvent(new CustomEvent('oscar:language',{detail:{locale}}));}
  return locale;
}
export function startI18n(){
  if(started||!globalThis.document)return;started=true;
  document.documentElement.lang=language;walk(document.body);
  observer=new MutationObserver(records=>{for(const record of records){if(record.type==='characterData')textNode(record.target);else if(record.type==='attributes')elementAttributes(record.target);else{elementAttributes(record.target);for(const node of record.addedNodes)walk(node);}}});
  observer.observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:TRANSLATED_ATTRIBUTES});
  document.addEventListener('change',event=>{if(event.target.matches('[data-locale-select]'))setLocale(event.target.value);});
}
