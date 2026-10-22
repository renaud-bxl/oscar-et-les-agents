'use strict';

// Only copy a documented command. Never fetch or execute the installer here.
const INSTALLER='https://raw.githubusercontent.com/renaud-bxl/oscar-et-les-agents/main/install.sh';
const ENGINE_NAMES=Object.freeze({codex:'CHATGPT / CODEX',claude:'CLAUDE CODE',both:'CHATGPT / CODEX + CLAUDE CODE'});
const form=document.getElementById('install-form');
const command=document.getElementById('install-command');
const commandSection=document.getElementById('command-section');
const caption=document.getElementById('command-caption');
const terminalHelp=document.getElementById('terminal-help');
const windowsNote=document.getElementById('windows-note');
const copyButton=document.getElementById('copy-command');
const copyLabel=copyButton.querySelector('span');
const copyStatus=document.getElementById('copy-status');
const assistantPrompt=document.getElementById('assistant-prompt');
const assistantButton=document.getElementById('copy-assistant');
const assistantStatus=document.getElementById('assistant-copy-status');
let revision=0,copying=false;

function selections(){return{engine:form.querySelector('input[name="engine"]:checked')?.value,platform:form.querySelector('input[name="platform"]:checked')?.value};}
function refresh(){
  const{engine,platform}=selections();
  if(!Object.hasOwn(ENGINE_NAMES,engine)||!['macos','linux','windows'].includes(platform))return;
  revision++;
  const supported=platform!=='windows';
  commandSection.hidden=!supported;windowsNote.hidden=supported;
  copyButton.disabled=!supported||copying;
  command.textContent=`curl -fsSL ${INSTALLER} | sh -s -- --engine ${engine}`;
  caption.textContent=`TERMINAL · ${ENGINE_NAMES[engine]}`;
  terminalHelp.textContent=platform==='linux'?'Sur Linux, ouvrez votre application Terminal. Collez la commande ci-dessous et appuyez sur Entrée. Le choix du disque se fait ensuite dans le Terminal.':'Sur Mac, ouvrez l’application Terminal depuis Applications → Utilitaires. Collez la commande ci-dessous et appuyez sur Entrée. Le choix du disque se fait ensuite dans le Terminal.';
  copyLabel.textContent='Copier la commande';
  copyStatus.textContent='Cette page ne détecte pas vos disques et ne lance rien. Le Terminal vous proposera leurs noms avant l’installation.';
  delete copyStatus.dataset.state;
}

copyButton.addEventListener('click',async()=>{
  if(copying||copyButton.disabled||commandSection.hidden)return;
  const text=command.textContent,at=revision;
  copying=true;copyButton.disabled=true;
  try{
    if(!globalThis.isSecureContext||typeof navigator.clipboard?.writeText!=='function')throw new Error('Copie indisponible.');
    await navigator.clipboard.writeText(text);
    if(at!==revision)return;
    copyLabel.textContent='Commande copiée';copyStatus.textContent='Commande copiée. Collez-la dans le Terminal, choisissez votre disque dans la liste, puis confirmez les dossiers proposés.';copyStatus.dataset.state='success';
  }catch{
    if(at!==revision)return;
    copyStatus.textContent='La copie n’a pas été autorisée. Sélectionnez la commande ci-dessus, puis copiez-la manuellement.';copyStatus.dataset.state='error';command.focus({preventScroll:true});
  }finally{
    copying=false;copyButton.disabled=selections().platform==='windows';
  }
});
form.addEventListener('submit',event=>event.preventDefault());
form.addEventListener('change',refresh);
assistantButton.addEventListener('click',async()=>{
  if(assistantButton.disabled)return;
  assistantButton.disabled=true;
  try{
    if(!globalThis.isSecureContext||typeof navigator.clipboard?.writeText!=='function')throw new Error('Copie indisponible.');
    await navigator.clipboard.writeText(assistantPrompt.textContent);
    assistantButton.querySelector('span').textContent='Demande copiée';assistantStatus.textContent='Demande copiée. Collez-la dans Codex ou Claude Code avec accès à votre ordinateur.';assistantStatus.dataset.state='success';
  }catch{
    assistantStatus.textContent='La copie n’a pas été autorisée. Sélectionnez la demande ci-dessus, puis copiez-la manuellement.';assistantStatus.dataset.state='error';assistantPrompt.focus({preventScroll:true});
  }finally{assistantButton.disabled=false;}
});
document.getElementById('engine-picker').disabled=false;
document.getElementById('platform-picker').disabled=false;
copyButton.hidden=false;
assistantButton.hidden=false;
refresh();
