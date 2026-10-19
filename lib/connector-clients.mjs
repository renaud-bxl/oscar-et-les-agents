import {spawn} from 'node:child_process';

// Canonical public IDs shipped in OpenAI's Gmail and Google Calendar plugins.
// Names alone cannot establish the identity or authorization of a connector.
export const INHERITED_APPS=Object.freeze({
  gmail:Object.freeze({id:'connector_2128aebfecb84f64a069897515042a44',name:'chatgpt-gmail',displayName:'Gmail',tools:Object.freeze(['search_emails','read_email','read_email_thread','list_labels','list_drafts'])}),
  calendar:Object.freeze({id:'connector_947e0d954944416db111db556030eea6',name:'chatgpt-calendar',displayName:'Google Agenda',tools:Object.freeze(['search_events','read_event','batch_read_event','list_calendars','get_availability'])}),
});
const probeError=()=>Object.assign(new Error('Le client n’a pas confirmé ses connexions héritées. Vérifiez sa connexion et réessayez.'),{code:'CONNECTOR_PROBE'});
export const isSafeInheritedAppId=value=>typeof value==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(value);
export const isSafeInheritedToolName=value=>typeof value==='string'&&/^[a-zA-Z0-9_./-]{1,120}$/.test(value);
const MAX_APP_TOOLS=200;

function uniqueRows(rows){
  const result=new Map();
  for(const row of rows)if(isSafeInheritedAppId(row?.id)){
    // A contradictory duplicate is not evidence of a usable authorization.
    if(result.has(row.id)){if(JSON.stringify(result.get(row.id))!==JSON.stringify(row))result.set(row.id,{id:row.id});}
    else result.set(row.id,row);
  }
  return result;
}

export function parseInheritedApps({installed,list,details}={}){
  if(!Array.isArray(installed?.apps)||list!==undefined&&!Array.isArray(list?.data)||!Array.isArray(details?.apps))throw probeError();
  const rows=[],runtimes=uniqueRows(installed.apps),catalogs=uniqueRows(list?.data||[]),metadatas=uniqueRows(details.apps);
  const known=new Map(Object.entries(INHERITED_APPS).map(([type,service])=>[service.id,{type,...service}]));
  // Uninstalled catalogue entries never introduce additional services. Keep the
  // two known identities visible so an unavailable account can be explained.
  const ids=new Set([...runtimes.keys(),...Object.values(INHERITED_APPS).filter(app=>catalogs.has(app.id)||metadatas.has(app.id)).map(app=>app.id)]);
  for(const id of ids){
    const service=known.get(id),type=service?.type||'app',runtime=runtimes.get(id),catalog=catalogs.get(id),metadata=metadatas.get(id);
    const canonical=metadata?.distributionChannel==='DEFAULT_OAI_CATALOG';
    const summaries=canonical&&Array.isArray(metadata.toolSummaries)&&metadata.toolSummaries.length<=MAX_APP_TOOLS?metadata.toolSummaries:[];
    const names=[...new Set(summaries.map(tool=>tool?.name).filter(isSafeInheritedToolName))];
    // Every declaration for a tool must agree; duplicate or unsafe metadata
    // cannot accidentally turn a write tool into an allowed read tool.
    const enabledTools=(service?service.tools:names).filter(name=>isSafeInheritedToolName(name)&&summaries.some(tool=>tool?.name===name)&&summaries.filter(tool=>tool?.name===name).every(tool=>tool.isReadOnly===true&&tool.isEnabled===true&&!tool.disabledReason));
    const authorized=canonical&&(!catalog||catalog.isAccessible===true&&catalog.isEnabled===true)&&runtime?.enabled===true&&runtime.callable===true;
    const displayName=service?.displayName||[runtime?.runtimeName,metadata?.name,catalog?.name].find(value=>typeof value==='string'&&value.trim())?.trim().slice(0,100)||id;
    rows.push({name:service?.name||`chatgpt-${id}`,displayName,runtimeName:displayName,source:'chatgpt',inherited:true,appId:id,type,
      status:authorized?'authorized':runtime?.enabled===false||catalog?.isEnabled===false?'disabled':runtime?.enabled===true?'unverified':'needs_auth',
      reason:authorized&&enabledTools.length?'Connexion existante confirmée par ChatGPT et Codex. Aucun nouvel accès au compte n’est demandé.':authorized?'Cette connexion existe, mais aucun outil de lecture actif n’a été confirmé. Utilisez votre client interactif pour vérifier les outils disponibles.':'La connexion existante n’est pas utilisable dans ce client. Vérifiez le compte et les autorisations de votre client officiel.',
      readOnlyAutomation:{available:Boolean(authorized&&enabledTools.length),service:authorized&&enabledTools.length?type:null},enabledTools,
      disabledTools:names.filter(name=>!enabledTools.includes(name)),disabledApps:[...runtimes.keys()].filter(other=>other!==id)});
  }
  return rows;
}

/** Metadata only: no thread, turn, tool call, credential read or configuration write. */
export async function inspectCodexApps({binary,cwd,env,spawnImpl=spawn,timeoutMs=30000,signal}={}){
  if(signal?.aborted)throw probeError();
  let child,buffer='',bytes=0,closed=false,nextId=0,killTimer;
  const pending=new Map();
  const terminate=kind=>{try{if(child?.pid&&process.platform!=='win32')process.kill(-child.pid,kind);else child?.kill(kind);}catch{try{child?.kill(kind);}catch{}}};
  const stop=()=>{if(closed)return;closed=true;terminate('SIGTERM');killTimer=setTimeout(()=>terminate('SIGKILL'),500);killTimer.unref();for(const job of pending.values())job.reject(probeError());pending.clear();};
  const timer=setTimeout(stop,timeoutMs);timer.unref();
  const send=value=>{if(closed||!child?.stdin?.writable)throw probeError();child.stdin.write(JSON.stringify(value)+'\n');};
  const call=(method,params)=>new Promise((resolve,reject)=>{const id=++nextId;pending.set(id,{resolve,reject});try{send({id,method,params});}catch(cause){pending.delete(id);reject(cause);}});
  try{
    child=spawnImpl(binary,['--enable','apps','app-server','--stdio'],{cwd,env,stdio:['pipe','pipe','pipe'],detached:process.platform!=='win32',windowsHide:true});
    signal?.addEventListener('abort',stop,{once:true});if(signal?.aborted)stop();
    child.stderr?.resume();child.stdout?.setEncoding('utf8');
    child.once('error',stop);child.once('close',()=>{clearTimeout(killTimer);stop();});child.stdin?.on('error',stop);
    child.stdout?.on('data',chunk=>{
      bytes+=Buffer.byteLength(chunk);buffer+=chunk;if(bytes>2*1024*1024||buffer.length>512*1024){stop();return;}
      let end;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);let value;try{value=JSON.parse(line);}catch{stop();return;}
        if(value?.method&&value.id!==undefined){try{send({id:value.id,error:{code:-32601,message:'Cette vérification ne lance aucune action.'}});}catch{}continue;}
        const job=pending.get(value?.id);if(!job)continue;pending.delete(value.id);value.error?job.reject(probeError()):job.resolve(value.result);
      }
    });
    await call('initialize',{clientInfo:{name:'oscar_agents',title:'Oscar et les Agents',version:'0.6.1'},capabilities:{experimentalApi:true}});send({method:'initialized',params:{}});
    const installed=await call('app/installed',{forceRefresh:true});
    if(!Array.isArray(installed?.apps))throw probeError();
    const ids=[...new Set(installed.apps.map(app=>app?.id).filter(isSafeInheritedAppId))],details={apps:[]};
    for(let offset=0;offset<ids.length;offset+=100){
      const response=await call('app/read',{appIds:ids.slice(offset,offset+100),includeTools:true});
      if(!Array.isArray(response?.apps))throw probeError();
      details.apps.push(...response.apps);
    }
    return parseInheritedApps({installed,details});
  }catch{throw probeError();}
  finally{clearTimeout(timer);signal?.removeEventListener('abort',stop);stop();}
}

export function inheritedClaudeIdentity(runtimeName,metadata){
  const service=runtimeName==='claude.ai Gmail'?'gmail':runtimeName==='claude.ai Google Calendar'?'calendar':null;
  if(!service||typeof metadata!=='string')return null;
  const source=metadata.match(/^\s*Source:\s*(.+)$/mi)?.[1]?.trim();
  const rawUrl=metadata.match(/^\s*(?:URL|Url|Server URL):\s*(https:\/\/\S+)\s*$/mi)?.[1];
  let url;try{url=new URL(rawUrl);}catch{return null;}
  // Anthropic-hosted connectors use their registered OAuth redirect. Custom
  // claude.ai servers with a familiar title must not be mistaken for Gmail.
  const expected=service==='gmail'?'https://gmailmcp.googleapis.com/mcp/v1':'https://calendarmcp.googleapis.com/mcp/v1';
  if(!/^claude\.ai$/i.test(source||'')||url.href!==expected)return null;
  return {service,url:url.href};
}
