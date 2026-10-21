import {translate} from './i18n.js';

export const OFFICE_THEME_STORE='oscar-office-theme-v1';
export const OFFICE_THEME_MODES=Object.freeze(['auto','light','dark']);
const browserStorage=()=>{try{return globalThis.localStorage;}catch{return undefined;}};
export function resolveOfficeTheme(mode,date=new Date()){
  if(!(date instanceof Date)||!Number.isFinite(date.getTime()))throw new TypeError('Une date locale valide est nécessaire.');
  if(mode==='light'||mode==='dark')return mode;
  return date.getHours()>=20||date.getHours()<8?'dark':'light';
}
export function savedOfficeTheme(storage){try{const value=storage?.getItem(OFFICE_THEME_STORE);return OFFICE_THEME_MODES.includes(value)?value:'auto';}catch{return'auto';}}

/** Only appearance changes: forms, missions and their DOM nodes stay intact. */
export class OfficeTheme{
  constructor({document=globalThis.document,window=globalThis.window,storage=browserStorage(),now=()=>new Date(),setIntervalImpl=(callback,delay)=>globalThis.setInterval(callback,delay),clearIntervalImpl=timer=>globalThis.clearInterval(timer)}={}){
    Object.assign(this,{document,window,storage,now,clearIntervalImpl});this.mode=savedOfficeTheme(storage);this.theme=null;this.destroyed=false;
    this.onClick=event=>{const button=event.target?.closest?.('[data-office-theme-mode]');if(button){this.setMode(button.dataset.officeThemeMode);const details=button.closest('details');if(details)details.open=false;}else for(const details of this.document.querySelectorAll('.hud-theme[open]'))if(!details.contains(event.target))details.open=false;};
    this.onKey=event=>{if(event.key==='Escape')for(const details of this.document.querySelectorAll('.hud-theme[open]')){details.open=false;details.querySelector('summary')?.focus();}};
    this.onStorage=event=>{if(event.key===OFFICE_THEME_STORE){this.mode=OFFICE_THEME_MODES.includes(event.newValue)?event.newValue:'auto';this.apply();}};
    this.onLanguage=()=>this.renderControls();this.onVisible=()=>this.apply();
    this.document?.addEventListener('click',this.onClick);this.document?.addEventListener('keydown',this.onKey);this.document?.addEventListener('oscar:language',this.onLanguage);this.document?.addEventListener('visibilitychange',this.onVisible);this.window?.addEventListener('storage',this.onStorage);
    this.apply();this.timer=setIntervalImpl(()=>this.apply(),60000);this.timer?.unref?.();
  }
  setMode(mode){if(!OFFICE_THEME_MODES.includes(mode))throw new RangeError('Thème non pris en charge.');this.mode=mode;try{this.storage?.setItem(OFFICE_THEME_STORE,mode);}catch{}return this.apply();}
  apply(){
    if(this.destroyed)return this.theme;const theme=resolveOfficeTheme(this.mode,this.now()),changed=theme!==this.theme||this.document?.documentElement?.dataset.officeThemeMode!==this.mode;this.theme=theme;
    const root=this.document?.documentElement;if(root){root.dataset.officeTheme=theme;root.dataset.officeThemeMode=this.mode;}
    const meta=this.document?.querySelector('meta[name="theme-color"]');meta?.setAttribute('content',theme==='dark'?'#101a24':'#e6e9dd');this.renderControls();
    if(changed&&this.document){const EventClass=this.window?.CustomEvent??globalThis.CustomEvent;if(EventClass)this.document.dispatchEvent(new EventClass('oscar:theme',{detail:{mode:this.mode,theme}}));}
    return theme;
  }
  renderControls(){
    if(!this.document)return;
    for(const button of this.document.querySelectorAll('[data-office-theme-mode]'))button.setAttribute('aria-pressed',String(button.dataset.officeThemeMode===this.mode));
    const label=translate('Thème du bureau')+' · '+translate({auto:'Automatique',light:'Clair',dark:'Sombre'}[this.mode])+(this.mode==='auto'?' · '+translate(this.theme==='dark'?'Sombre':'Clair'):'');
    for(const summary of this.document.querySelectorAll('[data-office-theme-summary]')){summary.setAttribute('aria-label',label);summary.setAttribute('title',label);}
    for(const icon of this.document.querySelectorAll('[data-office-theme-icon]'))icon.textContent=this.theme==='dark'?'☾':'☀';
  }
  destroy(){if(this.destroyed)return;this.destroyed=true;this.clearIntervalImpl(this.timer);this.timer=null;this.document?.removeEventListener('click',this.onClick);this.document?.removeEventListener('keydown',this.onKey);this.document?.removeEventListener('oscar:language',this.onLanguage);this.document?.removeEventListener('visibilitychange',this.onVisible);this.window?.removeEventListener('storage',this.onStorage);}
}
