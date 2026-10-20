import {translate} from './i18n.js';

/** Open the shared review-before-insertion dialog; this entry never records or submits. */
export function dictationEntry(target,{onDictate,onError=()=>{},isLocked=()=>false,className='text-button',document:owner=target?.ownerDocument||globalThis.document}={}){
  const button=owner.createElement('button');button.type='button';button.className=className;button.textContent='🎙 Dicter ma demande';button.dataset.dictationEntry='';button.hidden=typeof onDictate!=='function';
  button.addEventListener('click',async event=>{
    event.preventDefault();
    if(button.disabled||button.hidden||target?.disabled||target?.readOnly||isLocked()||typeof onDictate!=='function')return;
    try{await onDictate(target);}catch(error){onError(error?.message||translate('Cette demande n’a pas abouti. Votre formulaire est conservé.'));}
  });
  return button;
}
