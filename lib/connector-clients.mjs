import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {codexArguments} from './codex-compat.mjs';

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
const safeRuntimeToolName=value=>typeof value==='string'&&/^[a-zA-Z0-9_./-]{1,256}$/.test(value);
const calendarCreateProofs=new WeakMap();
export const verifiedCalendarCreateMetadata=row=>calendarCreateProofs.get(row)||null;
const permitsString=schema=>schema?.type==='string'||Array.isArray(schema?.type)&&schema.type.includes('string')||Array.isArray(schema?.anyOf)&&schema.anyOf.some(permitsString);
function calendarCreateBinding(appId,summaries,runtimeTools){
  if(appId!==INHERITED_APPS.calendar.id)return null;
  const declared=summaries.filter(tool=>tool?.name==='create_event');
  if(!declared.length||declared.some(tool=>tool.isReadOnly!==false||tool.isEnabled!==true||tool.disabledReason))return null;
  const matches=runtimeTools.filter(tool=>tool?._meta?.connector_id===appId&&safeRuntimeToolName(tool.name)&&(tool.title==='create_event'||tool.name==='create_event')&&tool.annotations?.readOnlyHint===false);
  if(matches.length!==1)return null;
  const tool=matches[0],schema=tool.inputSchema,properties=schema?.properties;
  if(schema?.type!=='object'||!properties||!Array.isArray(schema.required)||!['title','attendees'].every(key=>schema.required.includes(key))||!['title','start_time','end_time','timezone_str'].every(key=>permitsString(properties[key]))||properties.attendees?.type!=='array'||properties.attendees.items?.type!=='string')return null;
  return Object.freeze({tool:'create_event',name:tool.name,schemaDigest:createHash('sha256').update(JSON.stringify(schema)).digest('hex')});
}

function appReadBindings(appId,tools,runtimeTools){
  const byName=new Map();
  for(const tool of runtimeTools){
    if(!safeRuntimeToolName(tool?.name))continue;
    const metadata={name:tool.name,title:tool.title,connectorId:tool._meta?.connector_id,readOnly:tool.annotations?.readOnlyHint===true,destructive:tool.annotations?.destructiveHint===true};
    if(byName.has(tool.name)&&JSON.stringify(byName.get(tool.name))!==JSON.stringify(metadata))byName.set(tool.name,null);
    else if(!byName.has(tool.name))byName.set(tool.name,metadata);
  }
  const bindings=tools.flatMap(tool=>{
    // Titles are the official action names used by the app's tool policy.
    // Never guess a raw namespace from a display label or a suffix.
    const matches=[...byName.values()].filter(row=>row?.connectorId===appId&&row.readOnly&&!row.destructive&&(row.title===tool||row.name===tool));
    return matches.length===1?[Object.freeze({tool,name:matches[0].name})]:[];
  });
  return bindings.filter(binding=>bindings.filter(other=>other.name===binding.name).length===1);
}

function uniqueRows(rows){
  const result=new Map();
  for(const row of rows)if(isSafeInheritedAppId(row?.id)){
    // A contradictory duplicate is not evidence of a usable authorization.
    if(result.has(row.id)){if(JSON.stringify(result.get(row.id))!==JSON.stringify(row))result.set(row.id,{id:row.id});}
    else result.set(row.id,row);
  }
  return result;
}

export function parseInheritedApps({installed,list,details,runtimeTools=[]}={}){
  if(!Array.isArray(installed?.apps)||list!==undefined&&!Array.isArray(list?.data)||!Array.isArray(details?.apps)||!Array.isArray(runtimeTools)||runtimeTools.length>10000)throw probeError();
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
    const declaredTools=(service?service.tools:names).filter(name=>isSafeInheritedToolName(name)&&summaries.some(tool=>tool?.name===name)&&summaries.filter(tool=>tool?.name===name).every(tool=>tool.isReadOnly===true&&tool.isEnabled===true&&!tool.disabledReason));
    const executionTools=appReadBindings(id,declaredTools,runtimeTools),enabledTools=executionTools.map(binding=>binding.tool);
    const authorized=canonical&&(!catalog||catalog.isAccessible===true&&catalog.isEnabled===true)&&runtime?.enabled===true&&runtime.callable===true;
    const displayName=service?.displayName||[runtime?.runtimeName,metadata?.name,catalog?.name].find(value=>typeof value==='string'&&value.trim())?.trim().slice(0,100)||id;
    const row={name:service?.name||`chatgpt-${id}`,displayName,runtimeName:displayName,source:'chatgpt',inherited:true,appId:id,type,
      status:authorized?'authorized':runtime?.enabled===false||catalog?.isEnabled===false?'disabled':runtime?.enabled===true?'unverified':'needs_auth',
      reason:authorized&&enabledTools.length?'Connexion existante confirmée par ChatGPT et Codex. Aucun nouvel accès au compte n’est demandé.':authorized?'Cette connexion existe, mais aucun outil de lecture actif n’a été confirmé. Utilisez votre client interactif pour vérifier les outils disponibles.':'La connexion existante n’est pas utilisable dans ce client. Vérifiez le compte et les autorisations de votre client officiel.',
      readOnlyAutomation:{available:Boolean(authorized&&enabledTools.length),service:authorized&&enabledTools.length?type:null},enabledTools,executionTools:Object.freeze(executionTools),
      disabledTools:names.filter(name=>!enabledTools.includes(name)),disabledApps:[...runtimes.keys()].filter(other=>other!==id)};
    if(type==='calendar'){
      const create=authorized?calendarCreateBinding(id,summaries,runtimeTools):null;
      row.calendarCreate={available:Boolean(create),reason:create?'L’outil de création est proposé par le client. Son autorisation sera vérifiée au moment de votre ajout confirmé.':'Le client ne confirme pas l’outil de création de rendez-vous.'};
      if(create)calendarCreateProofs.set(row,create);
    }
    rows.push(row);
  }
  return rows;
}

/** Metadata only: no thread, turn, tool call, credential read or configuration write. */
export async function inspectCodexApps({binary,cwd,env,spawnImpl=spawn,timeoutMs=30000,signal}={}){
  if(signal?.aborted)throw probeError();
  let child,buffer='',bytes=0,closed=false,nextId=0,termination=Promise.resolve();
  const pending=new Map();
  const terminate=kind=>{try{if(child?.pid&&process.platform!=='win32')process.kill(-child.pid,kind);else child?.kill(kind);}catch{try{child?.kill(kind);}catch{}}};
  const stop=()=>{if(closed)return termination;closed=true;terminate('SIGTERM');termination=new Promise(resolve=>setTimeout(()=>{terminate('SIGKILL');resolve();},500));for(const job of pending.values())job.reject(probeError());pending.clear();return termination;};
  const timer=setTimeout(stop,timeoutMs);timer.unref();
  const send=value=>{if(closed||!child?.stdin?.writable)throw probeError();child.stdin.write(JSON.stringify(value)+'\n');};
  const call=(method,params)=>new Promise((resolve,reject)=>{const id=++nextId;pending.set(id,{resolve,reject});try{send({id,method,params});}catch(cause){pending.delete(id);reject(cause);}});
  try{
    child=spawnImpl(binary,codexArguments(['--enable','apps','app-server','--stdio']),{cwd,env,stdio:['pipe','pipe','pipe'],detached:process.platform!=='win32',windowsHide:true});
    signal?.addEventListener('abort',stop,{once:true});if(signal?.aborted)stop();
    child.stderr?.resume();child.stdout?.setEncoding('utf8');
    // The CLI may exit before a child which ignores SIGTERM. Keep the group
    // escalation alive after its close event so no probe descendant survives.
    child.once('error',stop);child.once('close',stop);child.stdin?.on('error',stop);
    child.stdout?.on('data',chunk=>{
      // The official tools-only catalog includes schemas for all installed apps.
      // Keep it bounded while admitting a complete server snapshot in one line.
      bytes+=Buffer.byteLength(chunk);buffer+=chunk;if(bytes>16*1024*1024||buffer.length>8*1024*1024){stop();return;}
      let end;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);let value;try{value=JSON.parse(line);}catch{stop();return;}
        if(value?.method&&value.id!==undefined){try{send({id:value.id,error:{code:-32601,message:'Cette vérification ne lance aucune action.'}});}catch{}continue;}
        const job=pending.get(value?.id);if(!job)continue;pending.delete(value.id);value.error?job.reject(probeError()):job.resolve(value.result);
      }
    });
    await call('initialize',{clientInfo:{name:'oscar_agents',title:'Oscar et les Agents',version:'0.6.21'},capabilities:{experimentalApi:true}});send({method:'initialized',params:{}});
    const installed=await call('app/installed',{forceRefresh:true});
    if(!Array.isArray(installed?.apps))throw probeError();
    const ids=[...new Set(installed.apps.map(app=>app?.id).filter(isSafeInheritedAppId))],details={apps:[]};
    for(let offset=0;offset<ids.length;offset+=100){
      const response=await call('app/read',{appIds:ids.slice(offset,offset+100),includeTools:true});
      if(!Array.isArray(response?.apps))throw probeError();
      details.apps.push(...response.apps);
    }
    const runtimeTools=[],cursors=new Set();let cursor;
    do{
      const response=await call('mcpServerStatus/list',{serverName:'codex_apps',detail:'toolsAndAuthOnly',...(cursor?{cursor}:{})});
      if(!Array.isArray(response?.data)||response.data.length>100||response.nextCursor!==null&&typeof response.nextCursor!=='string')throw probeError();
      for(const server of response.data){
        if(server?.name!=='codex_apps'||server.toolsError||!server.tools||typeof server.tools!=='object'||Array.isArray(server.tools))throw probeError();
        for(const tool of Object.values(server.tools))runtimeTools.push({name:tool?.name,title:tool?.title,inputSchema:tool?.inputSchema,annotations:{readOnlyHint:tool?.annotations?.readOnlyHint,destructiveHint:tool?.annotations?.destructiveHint},_meta:{connector_id:tool?._meta?.connector_id}});
      }
      if(runtimeTools.length>10000||response.nextCursor&&cursors.has(response.nextCursor))throw probeError();
      cursor=response.nextCursor;if(cursor)cursors.add(cursor);if(cursors.size>100)throw probeError();
    }while(cursor);
    return parseInheritedApps({installed,details,runtimeTools});
  }catch{throw probeError();}
  finally{clearTimeout(timer);signal?.removeEventListener('abort',stop);await stop();}
}

// Canonical public endpoints and a reviewed, fixed subset of Google read tools.
// MCP annotations corroborate these tools; annotations or labels alone never
// admit a new service or grant permission to an unknown tool.
export const CLAUDE_READ_SERVICES=Object.freeze({
  gmail:Object.freeze({url:'https://gmailmcp.googleapis.com/mcp/v1',displayName:'Gmail',tools:Object.freeze(['get_message','get_thread','list_drafts','list_labels','search_threads'])}),
  calendar:Object.freeze({url:'https://calendarmcp.googleapis.com/mcp/v1',displayName:'Google Agenda',tools:Object.freeze(['get_event','list_calendars','list_events','search_events'])}),
  drive:Object.freeze({url:'https://drivemcp.googleapis.com/mcp/v1',displayName:'Google Drive',tools:Object.freeze(['get_file_metadata','list_recent_files','read_file_content','search_files'])}),
});
const safeClaudeName=value=>typeof value==='string'&&value.length>0&&value.length<=120&&value===value.trim()&&!/[\x00-\x1f\x7f]/.test(value);
const safeClaudeTool=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,128}$/.test(value);
const claudeProofs=new WeakMap();

export function inheritedClaudeIdentity(server){
  if(!server||server.source!=='claudeai'||server.scope!=='claudeai'||server.status!=='connected'||!safeClaudeName(server.name)||server.config?.type!=='claudeai-proxy'||typeof server.config.id!=='string'||!/^[a-zA-Z0-9_-]{1,150}$/.test(server.config.id))return null;
  // Exact strings deliberately reject credentials, query strings, fragments,
  // alternate ports and look-alike endpoints before anything is authorized.
  const service=Object.keys(CLAUDE_READ_SERVICES).find(type=>server.config.url===CLAUDE_READ_SERVICES[type].url);
  if(!service||Object.keys(server.config).some(key=>!['type','url','id'].includes(key))||!Array.isArray(server.tools)||!server.tools.length||server.tools.length>MAX_APP_TOOLS||server.tools.some(tool=>!safeClaudeTool(tool?.name)))return null;
  const tools=CLAUDE_READ_SERVICES[service].tools;
  if(!tools.every(name=>server.tools.some(tool=>tool.name===name)&&server.tools.filter(tool=>tool.name===name).every(tool=>tool.annotations?.readOnly===true&&tool.annotations?.destructive!==true)))return null;
  return Object.freeze({service,url:server.config.url,runtimeName:server.name,identityHash:createHash('sha256').update(server.config.id).digest('hex'),enabledTools:tools,disabledTools:Object.freeze([...new Set(server.tools.map(tool=>tool.name))].filter(name=>!tools.includes(name)))});
}

export function parseInheritedClaudeConnectors(servers){
  if(!Array.isArray(servers)||servers.length>200)throw probeError();
  const identities=servers.map(server=>inheritedClaudeIdentity(server));
  const counts=new Map();for(const identity of identities)if(identity)counts.set(identity.service,(counts.get(identity.service)||0)+1);
  const rows=[];
  for(let index=0;index<servers.length;index++){
    const server=servers[index];if(!safeClaudeName(server?.name)||server.source!=='claudeai'&&server.scope!=='claudeai')continue;
    const identity=identities[index],verified=identity&&counts.get(identity.service)===1;
    const label=server.name==='claude.ai Gmail'?'gmail':server.name==='claude.ai Google Calendar'?'calendar':server.name==='claude.ai Google Drive'?'drive':null;
    // Only safe, purpose-specific metadata leaves the probe. Never retain or
    // display raw configuration, headers, helper commands or server errors.
    const row={name:verified?`claudeai-${identity.service}`:label?`claudeai-${label}`:`claudeai-${createHash('sha256').update(server.name).digest('hex').slice(0,16)}`,runtimeName:server.name,displayName:verified?CLAUDE_READ_SERVICES[identity.service].displayName:server.name.replace(/^claude\.ai /,''),source:'claude.ai',inherited:true,
      status:label&&!verified&&server.status==='connected'?'unverified':['connected','failed','pending','disabled','needs-auth'].includes(server.status)?server.status==='needs-auth'?'needs_auth':server.status:'unverified',
      reason:verified?'Claude Code confirme une connexion disponible.':'La connexion Claude existe, mais son identité officielle et ses outils de lecture n’ont pas été confirmés. Aucun accès automatique n’est activé.',
      readOnlyAutomation:{available:Boolean(verified),service:verified?identity.service:null}};
    if(verified){row.type=identity.service;row.enabledTools=identity.enabledTools;row.disabledTools=identity.disabledTools;claudeProofs.set(row,identity);}
    rows.push(row);
  }
  return rows;
}

// The proof is attached to the exact in-memory row from the official probe.
// Serialized rows returned by HTTP cannot be submitted back as read authority.
export const verifiedClaudeReadMetadata=row=>claudeProofs.get(row)||null;

/**
 * Metadata-only subset of the official Agent SDK's CLI control protocol:
 * initialize and mcp_status (no user message, model turn or tools/call).
 * Reference: anthropics/claude-agent-sdk-python, _internal/query.py.
 * Claude Code 2.1.303 was verified; missing provenance fails closed.
 */
export async function inspectClaudeConnectors({binary,cwd,env,spawnImpl=spawn,timeoutMs=30000,signal,expectedRuntimeNames=[],pollIntervalMs=250}={}){
  if(signal?.aborted)throw probeError();
  let child,buffer='',bytes=0,closed=false,nextId=0,termination=Promise.resolve();
  const pending=new Map();
  const terminate=kind=>{try{if(child?.pid&&process.platform!=='win32')process.kill(-child.pid,kind);else child?.kill(kind);}catch{try{child?.kill(kind);}catch{}}};
  const stop=()=>{if(closed)return termination;closed=true;terminate('SIGTERM');termination=new Promise(resolve=>setTimeout(()=>{terminate('SIGKILL');resolve();},500));for(const job of pending.values())job.reject(probeError());pending.clear();return termination;};
  const timer=setTimeout(stop,timeoutMs);timer.unref();
  const send=value=>{if(closed||!child?.stdin?.writable)throw probeError();child.stdin.write(JSON.stringify(value)+'\n');};
  const call=subtype=>new Promise((resolve,reject)=>{const request_id=`oscar_${++nextId}`;pending.set(request_id,{resolve,reject});try{send({type:'control_request',request_id,request:{subtype,...(subtype==='initialize'?{hooks:null}: {})}});}catch(cause){pending.delete(request_id);reject(cause);}});
  try{
    const settings={allowedMcpServers:Object.values(CLAUDE_READ_SERVICES).map(service=>({serverUrl:service.url}))};
    child=spawnImpl(binary,['--restricted','--print','--input-format','stream-json','--output-format','stream-json','--verbose','--no-session-persistence','--permission-mode','dontAsk','--tools','','--disable-slash-commands','--no-chrome','--setting-sources','','--settings',JSON.stringify(settings)],{cwd,env,stdio:['pipe','pipe','pipe'],detached:process.platform!=='win32',windowsHide:true});
    signal?.addEventListener('abort',stop,{once:true});if(signal?.aborted)stop();
    child.stderr?.resume();child.stdout?.setEncoding('utf8');
    child.once('error',stop);child.once('close',stop);child.stdin?.on('error',stop);
    child.stdout?.on('data',chunk=>{
      bytes+=Buffer.byteLength(chunk);buffer+=chunk;if(bytes>2*1024*1024||buffer.length>512*1024){stop();return;}
      let end;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);let value;try{value=JSON.parse(line);}catch{stop();return;}
        if(value?.type==='control_request'){
          try{send({type:'control_response',response:{subtype:'error',request_id:value.request_id,error:'Cette vérification ne lance aucune action.'}});}catch{}continue;
        }
        // A prompt/result during a metadata-only run is a protocol violation.
        if(['user','assistant','result'].includes(value?.type)){stop();return;}
        if(value?.type!=='control_response')continue;
        const response=value.response,job=pending.get(response?.request_id);if(!job)continue;pending.delete(response.request_id);response.subtype==='success'?job.resolve(response.response):job.reject(probeError());
      }
    });
    await call('initialize');
    let servers;
    for(let attempt=0;!closed;attempt++){
      const status=await call('mcp_status');servers=status?.mcpServers;
      if(!Array.isArray(servers)||servers.length>200)throw probeError();
      const expected=expectedRuntimeNames.filter(name=>typeof name==='string');
      if(attempt>=2&&servers.every(server=>server.status!=='pending')&&expected.every(name=>servers.some(server=>server.name===name)))break;
      await new Promise(resolve=>setTimeout(resolve,pollIntervalMs));
    }
    if(closed)throw probeError();
    return parseInheritedClaudeConnectors(servers);
  }catch{throw probeError();}
  finally{clearTimeout(timer);signal?.removeEventListener('abort',stop);await stop();}
}
