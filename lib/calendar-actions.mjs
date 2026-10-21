import path from 'node:path';
import {constants} from 'node:fs';
import {mkdir,lstat,realpath,readdir,open,rename,unlink} from 'node:fs/promises';
import {randomUUID,createHash,timingSafeEqual} from 'node:crypto';
import {spawn} from 'node:child_process';
import {validateCalendarEvent} from './calendar-intent.mjs';
import {isTrustedCalendarCreatePlan} from './connectors.mjs';
import {parseInheritedApps,verifiedCalendarCreateMetadata,INHERITED_APPS} from './connector-clients.mjs';

const fail=(message,code='CALENDAR_INVALID',dispatched=false)=>Object.assign(new Error(message),{code,dispatched});
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const copy=value=>structuredClone(value);
const uuid=value=>typeof value==='string'&&/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/u.test(value);
const requestId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{8,100}$/u.test(value);
const exactObject=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(key=>keys.includes(key));
const equal=(left,right)=>typeof left==='string'&&typeof right==='string'&&left.length===right.length&&timingSafeEqual(Buffer.from(left),Buffer.from(right));
const unknown=()=>fail('La confirmation du service a été perdue. Vérifiez votre agenda avant toute nouvelle création.','CALENDAR_UNCERTAIN',true);
const unavailable=()=>fail('Le client ne confirme pas l’outil de création de rendez-vous.','CALENDAR_UNAVAILABLE');
const serviceFailure=value=>/missing permissions or scopes|required scopes|insufficient[_ ](?:scope|permissions)|permission[_ ]denied/iu.test(JSON.stringify(value).slice(0,32000))
  ?fail('La connexion Agenda ne possède pas les autorisations nécessaires pour créer ce rendez-vous. Aucun nouvel accès n’a été demandé.','CALENDAR_PERMISSIONS',true):unknown();
const validResultId=value=>typeof value==='string'&&value.length>0&&value.length<=1024&&!/[\x00-\x20\x7f]/u.test(value);
const eventInput=event=>Object.fromEntries(['title','startLocal','endLocal','timeZone','location','description','durationSource'].filter(key=>event?.[key]!==undefined).map(key=>[key,event[key]]));

function eventResult(result){
  const roots=[result?.structuredContent];
  for(const block of result?.content||[])if(block?.type==='text'&&typeof block.text==='string')try{roots.push(JSON.parse(block.text));}catch{/* Not every tool response is JSON. */}
  const candidates=[];
  const inspect=(node,depth=0)=>{
    if(!node||typeof node!=='object'||Array.isArray(node)||depth>3)return;
    const id=node.event_id??node.eventId??(node.summary||node.title||node.start||node.htmlLink||node.html_link?node.id:undefined);
    if(validResultId(id)){
      const candidate={eventId:id},link=node.htmlLink??node.html_link??node.url;
      try{const url=new URL(link);if(url.protocol==='https:'&&!url.username&&!url.password&&['calendar.google.com','www.google.com'].includes(url.hostname)&&/^\/calendar(?:\/|$)/u.test(url.pathname))candidate.url=url.href;}catch{}
      candidates.push(candidate);
    }
    for(const key of ['result','event','data'])inspect(node[key],depth+1);
  };
  for(const root of roots)inspect(root);
  const ids=[...new Set(candidates.map(row=>row.eventId))];
  if(ids.length!==1)throw unknown();
  return candidates.find(row=>row.eventId===ids[0]);
}

/** A single deterministic official RPC. No model turn and no arbitrary tool input. */
export async function executeCalendarCreate({binary,cwd,env,plan,event,signal,spawnImpl=spawn,timeoutMs=60000,onDispatch=async()=>{},now=Date.now}={}){
  if(!binary||!isTrustedCalendarCreatePlan(plan)||plan.client!=='codex'||plan.appId!==INHERITED_APPS.calendar.id||plan.action!=='create_event')throw unavailable();
  if(signal?.aborted)throw fail('L’ajout a été annulé avant son envoi.','CALENDAR_CANCELLED');
  event=validateCalendarEvent(eventInput(event),{now:now()});
  const argumentsValue={calendar_id:'primary',title:event.title,attendees:[],start_time:event.start,end_time:event.end,timezone_str:event.timeZone,
    ...(event.location?{location:event.location}:{}),...(event.description?{description:event.description}:{}),add_google_meet:false,self_attendance:'omit',event_type:'default',guests_can_modify:false,reminders:{use_default:false,overrides:[]}};
  let child,buffer='',bytes=0,closed=false,nextId=0,dispatched=false,termination=Promise.resolve();const pending=new Map();
  const terminate=kind=>{try{if(child?.pid&&process.platform!=='win32')process.kill(-child.pid,kind);else child?.kill(kind);}catch{try{child?.kill(kind);}catch{}}};
  const stop=()=>{if(closed)return termination;closed=true;terminate('SIGTERM');termination=new Promise(resolve=>setTimeout(()=>{terminate('SIGKILL');resolve();},500));for(const job of pending.values())job.reject(dispatched?unknown():unavailable());pending.clear();return termination;};
  const timer=setTimeout(stop,timeoutMs);timer.unref?.();
  const send=value=>{if(closed||!child?.stdin?.writable)throw(dispatched?unknown():unavailable());child.stdin.write(JSON.stringify(value)+'\n');};
  const call=(method,params)=>new Promise((resolve,reject)=>{const id=++nextId;pending.set(id,{resolve,reject});try{send({id,method,params});}catch(cause){pending.delete(id);reject(cause);}});
  try{
    const key=`apps.${plan.appId}`;
    const args=['--disable','plugins','--enable','apps','-c','web_search="disabled"','-c','apps._default.enabled=false',
      ...(plan.disabledServers.length?['-c',`mcp_servers={${plan.disabledServers.map(name=>`${JSON.stringify(name)}={enabled=false}`).join(',')}}`]:[]),
      ...plan.disabledApps.flatMap(id=>['-c',`apps.${id}.enabled=false`]),'-c',`${key}.enabled=true`,'-c',`${key}.default_tools_enabled=false`,'-c',`${key}.destructive_enabled=false`,
      '-c',`${key}.tools={${[...plan.disabledTools.map(tool=>`${JSON.stringify(tool)}={enabled=false}`),'"create_event"={enabled=true,approval_mode="auto"}'].join(',')}}`,'app-server','--stdio'];
    child=spawnImpl(binary,args,{cwd,env,stdio:['pipe','pipe','pipe'],detached:process.platform!=='win32',windowsHide:true});
    signal?.addEventListener('abort',stop,{once:true});if(signal?.aborted)stop();
    child.stderr?.resume();child.stdout?.setEncoding('utf8');child.once('error',stop);child.once('close',stop);child.stdin?.on('error',stop);
    child.stdout?.on('data',chunk=>{
      bytes+=Buffer.byteLength(chunk);buffer+=chunk;if(bytes>16*1024*1024||buffer.length>8*1024*1024){stop();return;}
      let end;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);let frame;try{frame=JSON.parse(line);}catch{stop();return;}
        if(frame?.method&&frame.id!==undefined){try{send({id:frame.id,error:{code:-32601,message:'Aucune autorisation supplémentaire n’est accordée.'}});}catch{}stop();return;}
        const job=pending.get(frame?.id);if(!job)continue;pending.delete(frame.id);
        frame.error?job.reject(dispatched?serviceFailure(frame.error):unavailable()):job.resolve(frame.result);
      }
    });
    await call('initialize',{clientInfo:{name:'oscar_calendar',title:'Oscar et les Agents',version:'0.6.8'},capabilities:{experimentalApi:true}});send({method:'initialized',params:{}});
    const thread=await call('thread/start',{cwd,ephemeral:true,approvalPolicy:'never',sandbox:'read-only',environments:[]});
    if(typeof thread?.thread?.id!=='string'||!thread.thread.id)throw unavailable();
    const threadId=thread.thread.id,installed=await call('app/installed',{forceRefresh:true});
    const details=await call('app/read',{appIds:[plan.appId],includeTools:true,threadId});
    const runtimeTools=[],seen=new Set();let cursor;
    do{
      const status=await call('mcpServerStatus/list',{threadId,serverName:'codex_apps',detail:'toolsAndAuthOnly',...(cursor?{cursor}:{})});
      if(!Array.isArray(status?.data)||status.data.length>100||status.nextCursor!==null&&typeof status.nextCursor!=='string')throw unavailable();
      for(const server of status.data){if(server?.name!=='codex_apps'||server.toolsError||!server.tools||typeof server.tools!=='object'||Array.isArray(server.tools))throw unavailable();runtimeTools.push(...Object.values(server.tools));}
      if(runtimeTools.length>10000||status.nextCursor&&seen.has(status.nextCursor))throw unavailable();cursor=status.nextCursor;if(cursor)seen.add(cursor);if(seen.size>100)throw unavailable();
    }while(cursor);
    const row=parseInheritedApps({installed,details,runtimeTools}).find(row=>row.appId===plan.appId),binding=verifiedCalendarCreateMetadata(row);
    if(row?.status!=='authorized'||binding?.name!==plan.executionTool||binding.schemaDigest!==plan.schemaDigest)throw unavailable();
    if(signal?.aborted||closed)throw unavailable();
    await onDispatch();if(signal?.aborted||closed)throw unavailable();
    dispatched=true;
    const result=await call('mcpServer/tool/call',{threadId,server:'codex_apps',tool:binding.name,arguments:argumentsValue});
    if(result?.isError===true)throw serviceFailure(result);
    if(!result||!Array.isArray(result.content))throw unknown();
    return eventResult(result);
  }catch(cause){if(cause?.code?.startsWith('CALENDAR_'))throw cause;throw(dispatched?unknown():unavailable());}
  finally{clearTimeout(timer);signal?.removeEventListener('abort',stop);await stop();}
}

/** Durable one-shot confirmations. An interrupted dispatch can never be retried. */
export class CalendarActions{
  constructor({dataDir,connectors,execute=executeCalendarCreate,now=Date.now,onChange=()=>{},assertProvider=async()=>{}}={}){
    if(!dataDir||!connectors)throw fail('Le dossier de l’agenda et ses connecteurs sont nécessaires.');
    Object.assign(this,{dataDir:path.resolve(dataDir),connectors,execute,now,onChange,assertProvider});this.directory=path.join(this.dataDir,'calendar-actions');this.previews=new Map();this.receipts=new Map();this.requests=new Map();this.confirmed=new Map();this.jobs=new Map();this.closed=false;this.ready=this.load();
  }
  async safeDirectory(){
    const base=await lstat(this.dataDir);if(base.isSymbolicLink()||!base.isDirectory())throw fail('Le dossier de l’agenda est inaccessible.');
    await mkdir(this.directory,{recursive:true,mode:0o700});const info=await lstat(this.directory);if(info.isSymbolicLink()||!info.isDirectory()||await realpath(this.directory)!==path.join(await realpath(this.dataDir),'calendar-actions'))throw fail('Le dossier de l’agenda est inaccessible.');
  }
  async load(){
    await this.safeDirectory();const files=await readdir(this.directory);if(files.length>1000)throw fail('Le registre des confirmations de l’agenda est plein.');
    for(const name of files){if(!/^[a-f\d-]{36}\.json$/u.test(name))continue;const file=path.join(this.directory,name),info=await lstat(file);if(info.isSymbolicLink()||!info.isFile()||info.size>32000)throw fail('Un reçu de l’agenda est invalide.');const handle=await open(file,constants.O_RDONLY|(constants.O_NOFOLLOW??0));let row;try{row=JSON.parse(await handle.readFile('utf8'));}finally{await handle.close();}
      if(!uuid(row.id)||name!==row.id+'.json'||!uuid(row.previewId)||!requestId(row.requestId)||!/^[a-f\d]{64}$/u.test(row.confirmationHash)||!['pending','creating','completed','failed','uncertain'].includes(row.status))throw fail('Un reçu de l’agenda est invalide.');
      if(this.requests.has(row.requestId)||this.confirmed.has(row.previewId))throw fail('Le registre des confirmations de l’agenda est ambigu.');
      if(['pending','creating'].includes(row.status)){row.status='uncertain';row.message=unknown().message;row.updatedAt=this.now();await this.save(row);}
      this.receipts.set(row.id,row);this.requests.set(row.requestId,row.id);this.confirmed.set(row.previewId,row.id);
    }
  }
  async save(row){
    await this.safeDirectory();const target=path.join(this.directory,row.id+'.json'),temporary=path.join(this.directory,'.'+randomUUID()+'.tmp');
    const existing=await lstat(target).catch(cause=>{if(cause.code!=='ENOENT')throw cause;return null;});if(existing?.isSymbolicLink())throw fail('Un reçu de l’agenda est inaccessible.');
    const handle=await open(temporary,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|(constants.O_NOFOLLOW??0),0o600);
    try{try{await handle.writeFile(JSON.stringify(row)+'\n');await handle.sync();}finally{await handle.close();}await rename(temporary,target);}finally{await unlink(temporary).catch(()=>{});}
  }
  changed(){try{this.onChange();}catch{/* A UI refresh cannot alter a confirmed action. */}}
  get activeJobs(){return [...new Set([...this.jobs.keys(),...[...this.receipts.values()].filter(row=>['pending','creating'].includes(row.status)).map(row=>row.id)])].map(id=>({id,client:this.receipts.get(id).client,status:this.receipts.get(id).status}));}
  state(){return{activeJobs:this.activeJobs};}
  async preview(body={}){
    if(!exactObject(body,['client','name','event']))throw fail('Précisez uniquement le service et le rendez-vous à préparer.');
    const {client,name,event}=body;
    await this.ready;if(this.closed)throw fail('Le bureau se ferme.','CALENDAR_CLOSED');
    const normalized=validateCalendarEvent(event,{now:this.now()});await this.assertProvider(client);const plan=await this.connectors.calendarCreatePlan({client,name});
    if(this.previews.size>=100)this.previews.delete(this.previews.keys().next().value);
    const previewId=randomUUID(),confirmationToken=hash({nonce:randomUUID(),event:normalized,client:plan.client,name:plan.name,appId:plan.appId,executionTool:plan.executionTool,schemaDigest:plan.schemaDigest}),expiresAt=this.now()+10*60000;
    const row={previewId,confirmationToken,client:plan.client,name:plan.name,event:normalized,expiresAt,requiresConfirmation:true};
    this.previews.set(previewId,{...row,plan});return copy(row);
  }
  get(id){if(!requestId(id))throw fail('Le reçu de l’agenda est introuvable.','CALENDAR_NOT_FOUND');const row=this.receipts.get(id)||this.receipts.get(this.requests.get(id));if(!row)throw fail('Le reçu de l’agenda est introuvable.','CALENDAR_NOT_FOUND');const {confirmationHash,requestId:originalRequestId,...publicRow}=row;return copy(publicRow);}
  async confirm(body={}){
    if(!exactObject(body,['previewId','confirmationToken','requestId']))throw fail('Confirmez uniquement l’aperçu exact du rendez-vous.','CALENDAR_CONFIRMATION');
    const {previewId,confirmationToken,requestId:request}=body;
    await this.ready;if(this.closed)throw fail('Le bureau se ferme.','CALENDAR_CLOSED');
    if(!uuid(previewId)||typeof confirmationToken!=='string'||!/^[a-f\d]{64}$/u.test(confirmationToken)||!requestId(request))throw fail('Confirmez l’aperçu exact du rendez-vous.','CALENDAR_CONFIRMATION');
    const oldId=this.requests.get(request)||this.confirmed.get(previewId),confirmationHash=hash(confirmationToken);
    if(oldId){const row=this.receipts.get(oldId);if(row.previewId!==previewId||!equal(row.confirmationHash,confirmationHash))throw fail('Cette confirmation correspond à un autre rendez-vous.','CALENDAR_CHANGED');return this.get(oldId);}
    const preview=this.previews.get(previewId);if(!preview||preview.expiresAt<this.now()||!equal(preview.confirmationToken,confirmationToken))throw fail('L’aperçu du rendez-vous a expiré ou changé. Préparez un nouvel aperçu.','CALENDAR_CHANGED');
    await this.assertProvider(preview.client);
    // Provider checks may yield; another confirmed click can have reserved the
    // preview meanwhile. Re-enter the duplicate path before any new receipt.
    if(this.requests.has(request)||this.confirmed.has(previewId))return this.confirm({previewId,confirmationToken,requestId:request});
    if(this.closed)throw fail('Le bureau se ferme.','CALENDAR_CLOSED');
    if(this.receipts.size>=1000)throw fail('Le registre des confirmations de l’agenda est plein.');
    // Reserve synchronously before the first await to make concurrent clicks
    // converge on this one durable receipt.
    const row={id:randomUUID(),previewId,requestId:request,confirmationHash,client:preview.client,name:preview.name,event:preview.event,status:'pending',createdAt:this.now(),updatedAt:this.now(),message:'L’ajout confirmé attend la vérification du service.'};
    this.receipts.set(row.id,row);this.requests.set(request,row.id);this.confirmed.set(previewId,row.id);
    try{await this.save(row);}catch(cause){this.receipts.delete(row.id);this.requests.delete(request);this.confirmed.delete(previewId);throw cause;}
    if(this.closed){row.status='failed';row.message='Le rendez-vous n’a pas été envoyé. Vérifiez la disponibilité du service.';row.updatedAt=this.now();await this.save(row);return this.get(row.id);}
    const controller=new AbortController(),job={controller};this.jobs.set(row.id,job);this.previews.delete(previewId);
    job.completion=(async()=>{
      try{
        await this.assertProvider(row.client);
        const plan=await this.connectors.calendarCreatePlan({client:row.client,name:row.name});
        if(plan.appId!==preview.plan.appId||plan.executionTool!==preview.plan.executionTool||plan.schemaDigest!==preview.plan.schemaDigest)throw unavailable();
        const binary=await this.connectors.find('codex');
        const result=await this.execute({binary,cwd:this.dataDir,env:this.connectors.env,plan,event:row.event,signal:controller.signal,now:this.now,onDispatch:async()=>{await this.assertProvider(row.client);if(this.closed||controller.signal.aborted)throw unavailable();validateCalendarEvent(eventInput(row.event),{now:this.now()});row.status='creating';row.updatedAt=this.now();row.message='Création du rendez-vous confirmé en cours.';await this.save(row);this.changed();}});
        if(!validResultId(result?.eventId))throw unknown();
        row.status='completed';row.result={eventId:result.eventId,...(result.url?{url:result.url}:{})};row.message='Le service a confirmé la création du rendez-vous.';
      }catch(cause){row.status=cause?.code==='CALENDAR_PERMISSIONS'?'failed':cause?.dispatched||row.status==='creating'?'uncertain':'failed';row.message=cause?.code==='CALENDAR_PERMISSIONS'?cause.message:row.status==='uncertain'?unknown().message:'Le rendez-vous n’a pas été envoyé. Vérifiez la disponibilité du service.';row.errorCode=typeof cause?.code==='string'&&/^CALENDAR_[A-Z_]+$/u.test(cause.code)?cause.code:'CALENDAR_UNAVAILABLE';}
      row.updatedAt=this.now();try{await this.save(row);}catch{row.status='uncertain';row.message=unknown().message;}finally{this.jobs.delete(row.id);this.changed();}
    })();
    this.changed();return this.get(row.id);
  }
  async close(){this.closed=true;for(const job of this.jobs.values())job.controller.abort();await Promise.allSettled([...this.jobs.values()].map(job=>job.completion));this.previews.clear();}
}
