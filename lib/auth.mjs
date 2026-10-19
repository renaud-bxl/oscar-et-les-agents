import { spawn } from 'node:child_process';
import { findBinary, detectProviders } from './providers.mjs';

function loginEnvironment() {
  const env={...process.env};
  for(const name of ['OPENAI_API_KEY','CODEX_API_KEY','ANTHROPIC_API_KEY','ANTHROPIC_AUTH_TOKEN','CLAUDE_CODE_OAUTH_TOKEN','CLAUDECODE']) delete env[name];
  return env;
}
export class BrowserLogin {
  constructor({onChange=()=>{},find=findBinary,detect=detectProviders,spawnImpl=spawn,timeoutMs=8*60000}={}) {
    this.onChange=onChange;this.find=find;this.detect=detect;this.spawn=spawnImpl;this.timeoutMs=timeoutMs;this.logins={};this.children=new Map();
  }
  async start(provider) {
    if(!['codex','claude'].includes(provider))throw new Error('Ce moteur n’est pas reconnu.');
    if(this.children.has(provider))return this.logins[provider];
    const binary=await this.find(provider);
    if(!binary)throw new Error('Installez ce moteur avec le programme d’installation d’Oscar et les agents.');
    const state={status:'connecting',message:'Confirmez la connexion dans le navigateur qui vient de s’ouvrir. Aucune clé API n’est demandée.'};
    this.logins[provider]=state;
    let child;
    try{child=this.spawn(binary,provider==='codex'?['login']:['auth','login','--claudeai'],{env:loginEnvironment(),stdio:['ignore','pipe','pipe'],windowsHide:true});}
    catch{state.status='failed';state.message='Impossible d’ouvrir la connexion. Relancez le programme d’installation.';this.onChange(this.logins);return state;}
    this.children.set(provider,child);
    // Les outils officiels gèrent le navigateur et leur stockage de connexion.
    // Leur sortie peut contenir des informations de connexion : ne jamais l’afficher ni la stocker.
    child.stdout?.resume();child.stderr?.resume();
    let settled=false;
    const finish=async code=>{
      if(settled)return;settled=true;clearTimeout(timer);this.children.delete(provider);
      let providers;
      try{providers=await this.detect();}catch{providers=undefined;}
      const info=providers?.find(p=>p.id===provider);
      state.status=code===0 && info?.auth?.loggedIn===true?'connected':'failed';
      state.message=state.status==='connected'?'Votre compte est connecté. Oscar peut maintenant utiliser ce moteur.':'La connexion n’a pas été terminée. Cliquez pour réessayer dans le navigateur.';
      this.onChange(this.logins,providers);
    };
    const timer=setTimeout(()=>{child.kill('SIGTERM');finish(1);},this.timeoutMs);timer.unref?.();
    child.once('error',()=>finish(1));child.once('close',code=>finish(code));
    this.onChange(this.logins);
    return state;
  }
  close(){for(const child of this.children.values())child.kill('SIGTERM');}
}
