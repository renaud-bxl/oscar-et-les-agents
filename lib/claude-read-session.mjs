import {StringDecoder} from 'node:string_decoder';
import {isTrustedReadPlan} from './connectors.mjs';
import {inheritedClaudeIdentity} from './connector-clients.mjs';

const unavailable=()=>Object.assign(new Error('Le service n’a pas confirmé la lecture demandée. Les éventuels fichiers partiels sont conservés. Vérifiez la connexion du service dans votre client officiel avant de réessayer.'),{code:'CONNECTOR_UNAVAILABLE'});
const sameNames=(left,right)=>Array.isArray(left)&&Array.isArray(right)&&JSON.stringify([...left].sort())===JSON.stringify([...right].sort());
const MAX_LINE=8*1024*1024;

// One CLI process owns both the metadata check and the eventual model turn.
// No user frame is sent until that process confirms the exact selected account
// connector. A successful preflight is never itself a successful account read.
export function createClaudeReadSession({plan,input,preflightTimeoutMs=30000,pollIntervalMs=250}={}){
  if(!isTrustedReadPlan(plan)||plan.client!=='claude'||plan.source!=='claude.ai'||typeof input!=='string'||!input.trim())throw unavailable();
  const decoder=new StringDecoder('utf8');
  let stdin,onError,buffer='',metadataBytes=0,nextId=0,pending,ready=false,disposed=false,terminal=false,timer,pollTimer;
  const clearTimers=()=>{clearTimeout(timer);clearTimeout(pollTimer);};
  const send=frame=>{
    if(disposed||!stdin?.writable)throw unavailable();
    stdin.write(JSON.stringify(frame)+'\n');
  };
  const dispose=()=>{disposed=true;clearTimers();buffer='';pending=null;};
  const fail=()=>{if(disposed)return;dispose();onError?.(unavailable());};
  const request=subtype=>{
    const request_id=`oscar_read_${++nextId}`;pending={request_id,subtype};
    send({type:'control_request',request_id,request:{subtype,...(subtype==='initialize'?{hooks:null}:{})}});
  };
  const poll=()=>{
    pollTimer=setTimeout(()=>{if(disposed||ready)return;try{request('mcp_status');}catch{fail();}},pollIntervalMs);
    pollTimer.unref();
  };
  const confirm=status=>{
    const servers=status?.mcpServers;
    if(!Array.isArray(servers)||servers.length>200)throw unavailable();
    // A failed or pending extra server can reconnect later. Reject it too;
    // only an explicitly disabled extra server is safe to leave in the list.
    if(servers.some(server=>server?.name!==plan.runtimeName&&server?.status!=='disabled'))throw unavailable();
    const selected=servers.filter(server=>server?.name===plan.runtimeName);
    if(selected.length>1)throw unavailable();
    if(!selected.length||selected[0].status==='pending'){poll();return;}
    const identity=inheritedClaudeIdentity(selected[0]);
    if(!identity||identity.service!==plan.type||identity.url!==plan.url||identity.runtimeName!==plan.runtimeName||identity.identityHash!==plan.identityHash||!sameNames(identity.enabledTools,plan.enabledTools)||!sameNames(identity.disabledTools,plan.disabledTools))throw unavailable();
    ready=true;clearTimers();
    // Stream input stays open until the terminal result, as in the official
    // SDK. Metadata, permissions and the user turn use the same subprocess.
    send({type:'user',message:{role:'user',content:input},parent_tool_use_id:null,session_id:''});
  };
  const consume=(line,emit)=>{
    let event;try{event=JSON.parse(line);}catch{throw unavailable();}
    if(event?.type==='control_request'){
      send({type:'control_response',response:{subtype:'error',request_id:event.request_id,error:'Cette vérification ne lance aucune action.'}});
      throw unavailable();
    }
    if(event?.type==='control_response'){
      const response=event.response;
      if(!pending||response?.request_id!==pending.request_id)throw unavailable();
      const subtype=pending.subtype;pending=null;
      if(response.subtype!=='success')throw unavailable();
      if(subtype==='initialize')request('mcp_status');
      else confirm(response.response);
      return;
    }
    if(!ready){
      if(['user','assistant','result'].includes(event?.type))throw unavailable();
      // Startup notices and keep-alives carry no account authority.
      return;
    }
    emit?.(Buffer.from(line+'\n'));
    if(event?.type==='result'&&!terminal){terminal=true;stdin.end();}
  };
  const drain=emit=>{
    let end;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);if(line.length>MAX_LINE)throw unavailable();if(line.trim())consume(line,emit);}
    if(buffer.length>MAX_LINE)throw unavailable();
  };
  return {
    start(writable,failProcess){
      if(stdin||disposed)throw unavailable();stdin=writable;onError=failProcess;
      timer=setTimeout(fail,Math.min(30000,Math.max(1,preflightTimeoutMs)));timer.unref();
      request('initialize');
    },
    push(chunk,emit){
      if(disposed)return;
      try{
        if(!ready){metadataBytes+=Buffer.byteLength(chunk);if(metadataBytes>2*1024*1024)throw unavailable();}
        buffer+=decoder.write(chunk);drain(emit);
      }catch{dispose();throw unavailable();}
    },
    finish(emit){
      if(disposed)return;
      buffer+=decoder.end();drain(emit);
      if(buffer.trim()){consume(buffer,emit);buffer='';}
      if(!ready)throw unavailable();
    },
    dispose,
  };
}
