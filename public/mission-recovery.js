import {translate} from './i18n.js';

// A lost response may hide an accepted repair. Never submit it a second time.
export async function requestMissionRecovery(request, mission) {
  const recheck=mission?.recovery?.canRecheck===true;
  if (!mission?.id || mission.recovery?.canResume !== true&&!recheck) throw new Error(translate('Cette mission ne peut pas être reprise automatiquement.'));
  const route=`/api/missions/${encodeURIComponent(mission.id)}`;
  try {
    return await request(route+(recheck?'/recheck':'/resume'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({confirmed:true})});
  } catch (error) {
    if (Number.isInteger(error.status)) throw error;
    let current;
    try { current=await request(route); } catch {}
    if (current?.id===mission.id && (Number(current.recovery?.[recheck?'rechecksUsed':'used'])>Number(mission.recovery?.[recheck?'rechecksUsed':'used']||0) || recheck&&Number(current.recovery?.packagePolicyRechecksUsed)>Number(mission.recovery?.packagePolicyRechecksUsed||0) || recheck&&Number(current.recovery?.externalCorrectionRechecksUsed)>Number(mission.recovery?.externalCorrectionRechecksUsed||0) || current.recovery?.reason==='active' && ['planning','running','reviewing'].includes(current.status))) return current;
    throw new Error(translate('La reprise n’a pas pu être confirmée. Actualisez ce dossier pour vérifier son état avant de réessayer.'));
  }
}
