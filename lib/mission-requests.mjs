const failure=(message,code)=>Object.assign(new Error(message),{code});
const validId=id=>typeof id==='string'&&/^[A-Za-z0-9_-]{8,100}$/u.test(id);
const validFingerprint=value=>typeof value==='string'&&/^[a-f0-9]{64}$/u.test(value);

// The receipt is saved by Atelier alongside the mission. This bounded cache
// accelerates lookup; evicting it never discards the durable duplicate check.
export class MissionRequests {
  constructor({engine,maxPending=128,maxCached=256}={}){this.engine=engine;this.maxPending=Number.isInteger(maxPending)&&maxPending>=1&&maxPending<=128?maxPending:128;this.maxCached=Number.isInteger(maxCached)&&maxCached>=1&&maxCached<=256?maxCached:256;this.pending=new Map();this.receipts=new Map();}
  find(id){
    if(this.receipts.has(id))return this.receipts.get(id);
    for(const mission of this.engine.missions.values())if(mission.assistant!==true&&mission.missionRequest?.id===id&&validFingerprint(mission.missionRequest.fingerprint))return{missionId:mission.id,fingerprint:mission.missionRequest.fingerprint};
    return null;
  }
  replay(id,fingerprint){
    const receipt=this.find(id);if(!receipt)return null;
    if(receipt.fingerprint!==fingerprint)throw failure('Cette mission a changé depuis sa première validation. Lancez une nouvelle mission pour poursuivre.','MISSION_REQUEST_CHANGED');
    const mission=this.engine.get(receipt.missionId);if(!mission)throw failure('La mission précédente ne peut plus être retrouvée. Vérifiez l’historique avant de la relancer.','MISSION_REQUEST_RETRY');
    this.remember(id,receipt);return mission;
  }
  remember(id,receipt){this.receipts.delete(id);this.receipts.set(id,receipt);while(this.receipts.size>this.maxCached)this.receipts.delete(this.receipts.keys().next().value);}
  begin(id,fingerprint){
    if(!validId(id)||!validFingerprint(fingerprint))throw failure('L’identifiant de reprise de cette mission n’est pas valide.','MISSION_REQUEST_INVALID');
    const mission=this.replay(id,fingerprint);if(mission)return{mission};
    const pending=this.pending.get(id);
    if(pending){if(pending.fingerprint!==fingerprint)throw failure('Une mission différente utilise déjà cet identifiant. Attendez sa confirmation avant de réessayer.','MISSION_REQUEST_CHANGED');return{wait:pending.promise};}
    if(this.pending.size>=this.maxPending)throw failure('Le bureau vérifie déjà plusieurs missions. Réessayez dans quelques instants.','MISSION_REQUEST_RETRY');
    let resolve;const entry={fingerprint,promise:new Promise(done=>{resolve=done;})};this.pending.set(id,entry);let finished=false;
    return{finish:()=>{if(finished)return;finished=true;if(this.pending.get(id)===entry)this.pending.delete(id);resolve();}};
  }
}
