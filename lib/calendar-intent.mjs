const DEFAULT_ZONE=Intl.DateTimeFormat().resolvedOptions().timeZone;
const FIELDS=new Set(['title','startLocal','endLocal','timeZone','location','description','durationSource']);
export const CALENDAR_EVENT_LIMITS=Object.freeze({minDurationMinutes:5,maxDurationMinutes:1440,title:200,location:500,description:4000,prompt:16000});
const fail=(message,field,reason='INVALID')=>Object.assign(new Error(message),{code:'CALENDAR_INVALID',field,reason});
const pad=value=>String(value).padStart(2,'0');
const fold=value=>value.normalize('NFD').replace(/[\u0300-\u036f]/gu,'').toLowerCase();
const nowValue=value=>{const result=value instanceof Date?value.getTime():typeof value==='function'?value():value;if(!Number.isFinite(result))throw fail('La date de référence de l’agenda est invalide.','now');return result;};

function zone(value){
  if(typeof value!=='string'||!value||value.length>100||!/^[A-Za-z][A-Za-z0-9_+.-]*(?:\/[A-Za-z0-9_+.-]+)*$/u.test(value))throw fail('Choisissez un fuseau horaire valide pour ce rendez-vous.','timeZone');
  try{return new Intl.DateTimeFormat('en-GB',{timeZone:value}).resolvedOptions().timeZone;}catch{throw fail('Choisissez un fuseau horaire valide pour ce rendez-vous.','timeZone');}
}
function formatter(timeZone){return new Intl.DateTimeFormat('en-GB',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});}
function localParts(instant,format){const values=Object.fromEntries(format.formatToParts(new Date(instant)).filter(item=>item.type!=='literal').map(item=>[item.type,Number(item.value)]));return{year:values.year,month:values.month,day:values.day,hour:values.hour,minute:values.minute,second:values.second};}
const dateString=parts=>`${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
const localString=parts=>`${dateString(parts)}T${pad(parts.hour)}:${pad(parts.minute)}`;
const wallTime=parts=>Date.UTC(parts.year,parts.month-1,parts.day,parts.hour||0,parts.minute||0,parts.second||0);
function checkedDate(year,month,day){const value=new Date(Date.UTC(year,month-1,day));return year>=2000&&year<=2199&&value.getUTCFullYear()===year&&value.getUTCMonth()===month-1&&value.getUTCDate()===day;}
function parseLocal(value,field){
  const match=typeof value==='string'&&/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::00)?$/u.exec(value);
  if(!match)throw fail('Indiquez une date et une heure absolues pour le début et la fin.','startLocal'===field?'startLocal':'endLocal');
  const [year,month,day,hour,minute]=match.slice(1).map(Number);
  if(!checkedDate(year,month,day)||hour>23||minute>59)throw fail('Cette date ou cette heure n’existe pas. Corrigez le rendez-vous.',field);
  return{year,month,day,hour,minute,second:0};
}
function resolveLocal(value,timeZone,field){
  const parts=parseLocal(value,field),target=wallTime(parts),format=formatter(timeZone),offsets=new Set();
  for(let hours=-48;hours<=48;hours+=6){const sample=target+hours*3600000;offsets.add(wallTime(localParts(sample,format))-sample);}
  const candidates=[...offsets].map(offset=>({instant:target-offset,offsetMinutes:offset/60000})).filter(candidate=>localString(localParts(candidate.instant,format))===localString(parts));
  if(!candidates.length)throw fail('Cette heure n’existe pas dans ce fuseau à cause du changement d’heure. Choisissez une autre heure.',field,'DST_GAP');
  if(candidates.length!==1)throw fail('Cette heure se produit deux fois lors du changement d’heure. Choisissez une heure non ambiguë.',field,'DST_AMBIGUOUS');
  return{...candidates[0],local:localString(parts)};
}
const offsetString=minutes=>`${minutes<0?'-':'+'}${pad(Math.floor(Math.abs(minutes)/60))}:${pad(Math.abs(minutes)%60)}`;
function text(value,field,limit,{optional=false,multiline=false}={}){
  if(value===undefined&&optional)return undefined;
  if(typeof value!=='string')throw fail('Précisez un titre et des informations de rendez-vous valides.',field);
  const result=value.normalize('NFC').replace(/\r\n?/gu,'\n').trim();
  if((!result&&!optional)||result.length>limit||(multiline?/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/u:/[\x00-\x1f\x7f]/u).test(result))throw fail(field==='title'?'Indiquez un titre de rendez-vous de 1 à 200 caractères.':'Les informations du rendez-vous sont trop longues ou contiennent des caractères invalides.',field);
  return result||undefined;
}

/** Validate only the data shown in the confirmation form; never grants an account permission. */
export function validateCalendarEvent(input,{now=Date.now(),timeZone}={}){
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!FIELDS.has(key)))throw fail('Utilisez uniquement les champs proposés pour ce rendez-vous. Aucun invité ni action supplémentaire n’est accepté.','event');
  const title=text(input.title,'title',CALENDAR_EVENT_LIMITS.title),resolvedZone=zone(input.timeZone??timeZone),start=resolveLocal(input.startLocal,resolvedZone,'startLocal'),end=resolveLocal(input.endLocal,resolvedZone,'endLocal');
  if(!['explicit','default'].includes(input.durationSource))throw fail('Vérifiez la durée du rendez-vous avant de continuer.','durationSource');
  const durationMinutes=(end.instant-start.instant)/60000;
  if(!Number.isInteger(durationMinutes)||durationMinutes<CALENDAR_EVENT_LIMITS.minDurationMinutes||durationMinutes>CALENDAR_EVENT_LIMITS.maxDurationMinutes)throw fail('La fin doit suivre le début, pour une durée comprise entre 5 minutes et 24 heures.','endLocal');
  if(start.instant<Math.floor(nowValue(now)/60000)*60000)throw fail('Le début du rendez-vous est déjà passé. Choisissez une date future.','startLocal','PAST');
  const location=text(input.location,'location',CALENDAR_EVENT_LIMITS.location,{optional:true}),description=text(input.description,'description',CALENDAR_EVENT_LIMITS.description,{optional:true,multiline:true});
  const timezoneOffset=offsetString(start.offsetMinutes),endTimezoneOffset=offsetString(end.offsetMinutes);
  return Object.freeze({title,startLocal:start.local,endLocal:end.local,timeZone:resolvedZone,start:`${start.local}:00${timezoneOffset}`,end:`${end.local}:00${endTimezoneOffset}`,startUtc:new Date(start.instant).toISOString(),endUtc:new Date(end.instant).toISOString(),timezoneOffset,endTimezoneOffset,durationMinutes,durationSource:input.durationSource,needsConfirmation:true,...(location?{location}:{}),...(description?{description}:{})});
}

const weekdays=new Map([
  ['dimanche',0],['sunday',0],['zondag',0],['lundi',1],['monday',1],['maandag',1],['mardi',2],['tuesday',2],['dinsdag',2],['mercredi',3],['wednesday',3],['woensdag',3],['jeudi',4],['thursday',4],['donderdag',4],['vendredi',5],['friday',5],['vrijdag',5],['samedi',6],['saturday',6],['zaterdag',6],
]);
function shiftedDate(parts,days){const value=new Date(Date.UTC(parts.year,parts.month-1,parts.day+days));return{year:value.getUTCFullYear(),month:value.getUTCMonth()+1,day:value.getUTCDate()};}
const overlaps=(span,ranges)=>ranges.some(range=>span.index<range.index+range.length&&range.index<span.index+span.length);
const blankRanges=(source,ranges)=>ranges.reduce((value,range)=>value.slice(0,range.index)+' '.repeat(range.length)+value.slice(range.index+range.length),source);

/** Deterministic suggestions only: missing or complex information remains editable. */
export function parseCalendarIntent(value,{now=Date.now(),timeZone=DEFAULT_ZONE,defaultDurationMinutes=60}={}){
  if(typeof value!=='string'||!value.trim()||value.length>CALENDAR_EVENT_LIMITS.prompt)throw fail('Décrivez le rendez-vous avec un texte de 1 à 16 000 caractères.','prompt');
  if(!Number.isInteger(defaultDurationMinutes)||defaultDurationMinutes<CALENDAR_EVENT_LIMITS.minDurationMinutes||defaultDurationMinutes>CALENDAR_EVENT_LIMITS.maxDurationMinutes)throw fail('Choisissez une durée comprise entre 5 minutes et 24 heures.','durationMinutes');
  const input=value.normalize('NFC'),source=fold(input),resolvedZone=zone(timeZone),format=formatter(resolvedZone),today=localParts(nowValue(now),format),ranges=[],issues=[],dates=[],times=[];
  const quoted=/[«“"]([^»”"]{1,200})[»”"]/u.exec(input);if(quoted)ranges.push({index:quoted.index,length:quoted[0].length});
  let remaining=blankRanges(source,ranges),durationMinutes=defaultDurationMinutes,durationSource='default';
  const duration=/\b(?:pendant|pour|duree(?: de)?|for|duration(?: of)?|gedurende|voor)\s+(\d{1,4})\s*(heures?|hours?|uur|uren|h|min(?:ute)?s?|minuten)(?:\s*(\d{1,2})\s*(?:min(?:ute)?s?|minuten)?)?\b/gu;
  const durationMatches=[...remaining.matchAll(duration)];
  for(const match of durationMatches)ranges.push({index:match.index,length:match[0].length});
  if(durationMatches.length===1){const match=durationMatches[0],hours=/^(?:h|heures?|hours?|uur|uren)$/u.test(match[2]);durationMinutes=Number(match[1])*(hours?60:1)+(hours?Number(match[3]||0):0);durationSource='explicit';}
  else if(durationMatches.length>1)issues.push('Plusieurs durées ont été reconnues. Vérifiez la durée dans le formulaire.');
  remaining=blankRanges(source,ranges);
  const addDate=(match,parts)=>{ranges.push({index:match.index,length:match[0].length});if(checkedDate(parts.year,parts.month,parts.day))dates.push(dateString(parts));else issues.push('Cette date ou cette heure n’existe pas. Corrigez le rendez-vous.');};
  for(const match of remaining.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/gu))addDate(match,{year:Number(match[1]),month:Number(match[2]),day:Number(match[3])});
  remaining=blankRanges(source,ranges);
  for(const match of remaining.matchAll(/\b(\d{1,2})[/.](\d{1,2})[/.](\d{4})\b/gu))addDate(match,{year:Number(match[3]),month:Number(match[2]),day:Number(match[1])});
  remaining=blankRanges(source,ranges);
  for(const match of remaining.matchAll(/\b(?:apres[- ]demain|day after tomorrow|overmorgen|demain|tomorrow|morgen|aujourd['’]hui|today|vandaag)\b/gu))addDate(match,shiftedDate(today,/^(?:apres|day after|overmorgen)/u.test(match[0])?2:/^(?:demain|tomorrow|morgen)$/u.test(match[0])?1:0));
  remaining=blankRanges(source,ranges);
  const weekdayPattern=new RegExp(`\\b(?:(?:prochain(?:e)?|next|volgende)\\s+)?(${[...weekdays.keys()].join('|')})(?:\\s+prochain(?:e)?)?\\b`,'gu');
  for(const match of remaining.matchAll(weekdayPattern)){const weekday=new Date(Date.UTC(today.year,today.month-1,today.day)).getUTCDay(),days=(weekdays.get(match[1])-weekday+7)%7||7;addDate(match,shiftedDate(today,days));}
  remaining=blankRanges(source,ranges);
  const addTime=(match,hour,minute)=>{const span={index:match.index,length:match[0].length};if(overlaps(span,ranges))return;ranges.push(span);if(hour>=0&&hour<=23&&minute>=0&&minute<=59)times.push({index:match.index,time:`${pad(hour)}:${pad(minute)}`});else issues.push('Cette date ou cette heure n’existe pas. Corrigez le rendez-vous.');};
  for(const match of remaining.matchAll(/\b(\d{1,2})(?::(\d{2}))?\s*([ap])\.?\s*m\.?\b/gu)){const hour=Number(match[1]);addTime(match,hour>=1&&hour<=12?hour%12+(match[3]==='p'?12:0):99,Number(match[2]||0));}
  remaining=blankRanges(source,ranges);
  for(const match of remaining.matchAll(/\b(\d{1,2})\s*(?:h(?:eures?)?|u(?:ur)?)\s*(\d{2})?\b/gu))addTime(match,Number(match[1]),Number(match[2]||0));
  remaining=blankRanges(source,ranges);
  for(const match of remaining.matchAll(/\b(\d{1,2}):(\d{2})\b/gu))addTime(match,Number(match[1]),Number(match[2]));
  remaining=blankRanges(source,ranges);
  for(const match of remaining.matchAll(/\b(?:a|at|om)\s+(\d{1,2})\b/gu))addTime(match,Number(match[1]),0);
  remaining=blankRanges(source,ranges);
  for(const match of remaining.matchAll(/\b(?:midi|noon|minuit|midnight|middernacht)\b/gu))addTime(match,/^(?:midi|noon)$/u.test(match[0])?12:0,0);
  times.sort((a,b)=>a.index-b.index);
  const uniqueDates=[...new Set(dates)],date=uniqueDates.length===1?uniqueDates[0]:'';if(uniqueDates.length>1)issues.push('Plusieurs dates ont été reconnues. Choisissez la date exacte dans le formulaire.');
  let title=quoted?quoted[1].trim():blankRanges(input,ranges).replace(/[?!.;,]+$/gu,'').trim();
  if(!quoted){
    for(let index=0;index<3;index++)title=title.replace(/^(?:peux[- ]tu|pourrais[- ]tu|can you|could you|kun je|wil je|s['’]il te plait|please|alsjeblieft)\s+/iu,'').replace(/^(?:ajoute(?:r)?|cr[ée]e(?:r)?|planifie(?:r)?|programme(?:r)?|mets|inscris|organise|add|create|schedule|book|plan|maak|voeg toe)\s+/iu,'');
    title=title.replace(/\b(?:dans mon|sur mon|a mon|à mon|to my|in my|aan mijn|in mijn)\s+(?:agenda|calendrier|calendar)\b/giu,'').replace(/^(?:un |une |a |an |een )?(?:rendez-vous|[ée]v[ée]nement|appointment|event|afspraak)(?:\s+(?:pour|avec|chez|for|with|about|voor|met|bij))?\s*/iu,'');
    title=title.replace(/\s+/gu,' ').replace(/^(?:(?:a|à|le|la|on|at|om|op|de|du|from|van|pour|for|voor)\s+)+/iu,'').replace(/(?:\s+(?:a|à|le|on|at|om|op|de|from|van|a|à|to|tot|until|jusqu['’]a|jusqu['’]à|pendant|pour|for|voor))+$/iu,'').trim();
  }
  if(/^(?:un |une |a |an |een )?(?:rendez-vous|[ée]v[ée]nement|appointment|event|afspraak)?$/iu.test(title))title='';
  if(/^(?:(?:a|le|la|on|at|om|op|de|du|from|van|pour|for|voor|to|tot|until)\s*)+$/u.test(fold(title)))title='';
  let startLocal=date&&times.length?`${date}T${times[0].time}`:'',endLocal='';
  if(startLocal){
    if(times.length===2){endLocal=`${date}T${times[1].time}`;durationSource='explicit';try{durationMinutes=(resolveLocal(endLocal,resolvedZone,'endLocal').instant-resolveLocal(startLocal,resolvedZone,'startLocal').instant)/60000;}catch(error){issues.push(error.message);}}
    else if(times.length>2){startLocal='';issues.push('Plusieurs horaires ont été reconnus. Choisissez les heures exactes dans le formulaire.');}
    else try{const start=resolveLocal(startLocal,resolvedZone,'startLocal');endLocal=localString(localParts(start.instant+durationMinutes*60000,format));resolveLocal(endLocal,resolvedZone,'endLocal');}catch(error){issues.push(error.message);}
  }
  if(durationMinutes<CALENDAR_EVENT_LIMITS.minDurationMinutes||durationMinutes>CALENDAR_EVENT_LIMITS.maxDurationMinutes)issues.push('Choisissez une durée comprise entre 5 minutes et 24 heures.');
  const missing=[...(!title?['title']:[]),...(!date?['date']:[]),...(!times.length||times.length>2?['time']:[])];
  return{title,startLocal,endLocal,timeZone:resolvedZone,durationMinutes,durationSource,missing,issues:[...new Set(issues)],needsConfirmation:true};
}
