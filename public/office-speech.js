import {getLocale,translate} from './i18n.js';

const PROFILE={oscar:{pitch:.9,rate:1},zoe:{pitch:1.02,rate:.98},secretaire:{pitch:1.02,rate:.98},recherche:{pitch:1.08,rate:1.03},redaction:{pitch:.98,rate:.97},code:{pitch:.91,rate:1.04},design:{pitch:1.13,rate:1},analyse:{pitch:.95,rate:.98}};
const STORE='oscar-voice-v1';
const ENGINES=new Set(['natural','system','captions']);
const language=voice=>String(voice?.lang||'').toLowerCase().split(/[-_]/)[0];

export class OfficeSpeech {
  constructor({host=globalThis,onChange=()=>{},onVoices=()=>{}}={}){
    Object.assign(this,{host,onChange,onVoices});this.synth=host.speechSynthesis;this.systemAvailable=!!this.synth&&typeof host.SpeechSynthesisUtterance==='function';
    this.enabled=true;this.engine='natural';this.voiceName='auto';this.characterVoices={};this.unlocked=false;this.current=null;this.generation=0;this.lastAutomatic=0;this.destroyed=false;
    this.local={status:'not_installed',available:false,voices:[],progress:null,message:''};this.nativeVoices=[];this.voices=[];this.available=false;
    try{const value=JSON.parse(host.localStorage?.getItem(STORE)||'null');if(value){this.enabled=value.enabled!==false;this.voiceName=typeof value.voice==='string'?value.voice:'auto';if(ENGINES.has(value.engine))this.engine=value.engine;if(value.characters&&typeof value.characters==='object')for(const role of Object.keys(PROFILE)){if(typeof value.characters[role]==='string')this.characterVoices[role]=value.characters[role];}}}catch{}
    this.refresh=()=>{try{this.nativeVoices=this.systemAvailable?this.synth.getVoices():[];}catch{this.nativeVoices=[];}this.publishVoices();};
    this.unlock=()=>{this.unlocked=true;};this.hide=()=>{if(host.document?.hidden)this.stop();};this.languageChanged=()=>{this.stop();this.publishVoices();};
    this.synth?.addEventListener?.('voiceschanged',this.refresh);
    host.document?.addEventListener('pointerdown',this.unlock,{passive:true});host.document?.addEventListener('keydown',this.unlock);host.document?.addEventListener('visibilitychange',this.hide);host.document?.addEventListener('oscar:language',this.languageChanged);
    this.refresh();this.ready=this.refreshLocal();
  }
  save(){try{this.host.localStorage?.setItem(STORE,JSON.stringify({enabled:this.enabled,voice:this.voiceName,engine:this.engine,characters:this.characterVoices}));}catch{}}
  getState(){return{engine:this.engine,enabled:this.enabled,available:this.available,voiceName:this.voiceName,characterVoices:{...this.characterVoices},local:this.local,voices:this.voices,locale:getLocale(),speaking:this.current?.phase==='speaking',preparing:this.current?.phase==='preparing',role:this.current?.role,text:this.current?.text};}
  message(){if(this.engine==='captions')return'Sous-titres uniquement. Les personnages gardent leurs répliques à l’écran.';if(this.engine==='system')return'Voix du système activées à votre demande. Leur qualité dépend de cet ordinateur.';if(this.available)return'Voix naturelles locales prêtes. Votre texte reste sur cet ordinateur.';if(this.local.status==='installing')return'Installation de la voix locale en cours. Les sous-titres restent disponibles.';if(this.local.voices.some(voice=>voice.installed))return'Aucune voix naturelle installée pour cette langue. Les répliques restent affichées.';return'Les répliques restent affichées. Installez une voix naturelle pour les entendre.';}
  notify(extra={}){if(this.destroyed)return;this.onChange({...this.getState(),status:this.local.status,message:this.message(),speaking:this.current?.phase==='speaking',preparing:this.current?.phase==='preparing',role:this.current?.role,text:this.current?.text,...extra});}
  publishVoices(){
    this.voices=this.engine==='system'?this.nativeVoices:[...(this.local.voices||[])];
    this.available=this.engine==='system'?this.systemAvailable&&this.nativeVoices.some(voice=>language(voice)===getLocale()):this.engine==='natural'&&this.local.status==='ready'&&this.local.voices.some(voice=>voice.installed&&language(voice)===getLocale());
    this.onVoices(this.voices);this.notify();
  }
  async json(url,options={}){if(typeof this.host.fetch!=='function')throw new Error('Le service de voix locales n’est pas disponible.');const response=await this.host.fetch(url,{credentials:'same-origin',...options});let value;try{value=await response.json();}catch{throw new Error('Le service de voix a renvoyé une réponse inattendue.');}if(!response.ok)throw new Error(value.error||'La voix locale n’a pas pu être préparée.');return value;}
  acceptLocal(value){if(!value||!Array.isArray(value.voices))throw new Error('Le service de voix a renvoyé une réponse inattendue.');this.local={...value,voices:value.voices.filter(voice=>voice&&typeof voice.id==='string'&&typeof voice.lang==='string')};this.publishVoices();return this.getState();}
  async refreshLocal(){
    if(this.destroyed)return this.getState();if(this.localRequest)return this.localRequest;
    this.localRequest=(async()=>{try{const value=await this.json('/api/voice');if(!this.destroyed)this.acceptLocal(value);}catch(error){if(!this.destroyed){this.local={...this.local,status:'unsupported',available:false,message:error.message};this.publishVoices();}}finally{this.localRequest=null;}return this.getState();})();return this.localRequest;
  }
  async installVoice(voiceId,{confirmed=false}={}){if(confirmed!==true)throw new Error('Confirmez le téléchargement de cette voix avant de l’installer.');const known=this.local.voices.find(voice=>voice.id===voiceId);if(!known)throw new Error('Cette voix n’est pas proposée par le bureau.');const value=await this.json('/api/voice/install',{method:'POST',headers:{'Content-Type':'application/json','X-Oscar-Client':'1'},body:JSON.stringify({voiceId,confirmed:true})});if(!this.destroyed)this.acceptLocal(value);return this.getState();}
  setEnabled(value){this.enabled=!!value;this.unlocked=true;if(!this.enabled)this.stop();this.save();this.notify();}
  setEngine(engine){if(!ENGINES.has(engine))return;this.stop();this.engine=engine;this.unlocked=true;this.save();this.publishVoices();}
  setVoice(name){this.voiceName=String(name||'auto');this.save();this.stop();}
  setCharacterVoice(role,id){if(!Object.hasOwn(PROFILE,role))return;this.characterVoices[role==='secretaire'?'zoe':role]=String(id||'auto');this.save();this.stop();}
  chooseVoice(role,requested){
    const all=this.engine==='system'?this.nativeVoices:this.local.voices,matching=all.filter(voice=>language(voice)===getLocale()&&(this.engine==='system'||voice.installed));
    const choice=requested||this.characterVoices[role==='secretaire'?'zoe':role]||this.voiceName;if(choice&&choice!=='auto')return matching.find(voice=>voice.id===choice||voice.name===choice)||null;
    if(this.engine==='system'){const local=matching.filter(voice=>voice.localService);return(local.length?local:matching)[0]||null;}
    if(!matching.length)return null;const desired=['oscar','code','analyse'].includes(role)?'male':'female',gendered=matching.filter(voice=>voice.gender===desired||voice.gender===(desired==='male'?'masculine':'feminine'));const pool=gendered.length?gendered:matching;
    return pool[Math.max(0,Object.keys(PROFILE).indexOf(role))%pool.length];
  }
  caption(role,text,error){this.notify({role,text,fallback:true,caption:true,...(error?{error}: {})});return false;}
  speak(role,text,{automatic=false,interrupt=true,voiceId}={}){
    if(this.destroyed||!this.enabled||this.host.document?.hidden)return false;
    if(automatic&&(!this.unlocked||!interrupt&&(this.current||Date.now()-this.lastAutomatic<15000)))return false;
    const spoken=translate(String(text)).replace(/https?:\/\/\S+/g,'').trim().slice(0,500);if(!spoken)return false;
    if(automatic)this.lastAutomatic=Date.now();
    if(this.engine==='captions')return this.caption(role,spoken);
    const voice=this.chooseVoice(role,voiceId);if(!voice||this.engine==='natural'&&(this.local.status!=='ready'||typeof this.host.Audio!=='function'))return this.caption(role,spoken);
    this.stop();const generation=++this.generation,profile=PROFILE[role]||PROFILE.oscar;
    if(this.engine==='natural'){
      const controller=new AbortController();this.current={role,text:spoken,phase:'preparing',controller};this.notify();
      this.playNatural({role,text:spoken,voice,profile,generation,controller});return true;
    }
    const utterance=new this.host.SpeechSynthesisUtterance(spoken);utterance.lang={fr:'fr-FR',en:'en-GB',nl:'nl-NL'}[getLocale()];utterance.rate=profile.rate;utterance.pitch=profile.pitch;utterance.volume=.85;utterance.voice=voice;
    const finish=()=>{if(generation===this.generation&&!this.destroyed){this.current=null;this.notify();}};
    utterance.onend=finish;utterance.onerror=event=>{if(generation===this.generation&&!this.destroyed){this.current=null;this.notify({text:spoken,role,fallback:!['canceled','interrupted'].includes(event.error)});}};
    this.current={role,text:spoken,utterance,phase:'speaking'};this.notify();try{this.synth.resume();this.synth.speak(utterance);return true;}catch(error){this.current=null;return this.caption(role,spoken,error.message);}
  }
  async playNatural({role,text,voice,profile,generation,controller}){
    const valid=()=>!this.destroyed&&generation===this.generation&&this.enabled&&!this.host.document?.hidden;
    try{
      const result=await this.json('/api/voice/synthesize',{method:'POST',headers:{'Content-Type':'application/json','X-Oscar-Client':'1'},body:JSON.stringify({text,voiceId:voice.id,speed:Math.max(.8,Math.min(1.2,profile.rate))}),signal:controller.signal});if(!valid())return;
      if(typeof result.url!=='string'||!/^\/api\/voice\/audio\/[a-z\d_-]+\.wav$/i.test(result.url))throw new Error('Le service de voix a renvoyé un fichier inattendu.');
      const audio=new this.host.Audio(result.url);audio.volume=.85;this.current={role,text,audio,controller,phase:'preparing'};
      const finish=()=>{if(valid()){this.current=null;this.notify();}};audio.onended=finish;audio.onerror=()=>{if(valid()){this.current=null;this.caption(role,text,'La lecture audio n’a pas démarré. Les sous-titres restent disponibles.');}};
      await audio.play();if(!valid()){audio.pause();return;}if(this.current?.audio===audio){this.current.phase='speaking';this.notify();}
    }catch(error){if(!valid()||error.name==='AbortError')return;this.current=null;this.caption(role,text,error.message);}
  }
  stop(){this.generation++;const previous=this.current;this.current=null;previous?.controller?.abort();if(previous?.audio){previous.audio.onended=null;previous.audio.onerror=null;try{previous.audio.pause();previous.audio.removeAttribute?.('src');previous.audio.load?.();}catch{}}try{this.synth?.cancel();}catch{}this.notify();}
  destroy(){if(this.destroyed)return;this.stop();this.destroyed=true;this.synth?.removeEventListener?.('voiceschanged',this.refresh);this.host.document?.removeEventListener('pointerdown',this.unlock);this.host.document?.removeEventListener('keydown',this.unlock);this.host.document?.removeEventListener('visibilitychange',this.hide);this.host.document?.removeEventListener('oscar:language',this.languageChanged);}
}
