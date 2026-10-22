import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,realpath,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {findBinary,runAgent} from '../lib/providers.mjs';

const fakeSource=String.raw`
const fs=require('node:fs');
const args=process.argv.slice(2),provider=process.argv[1].endsWith('codex')?'codex':'claude';
const spec=JSON.parse(fs.readFileSync(process.env.OSCAR_SNAPSHOT_TEST_SPEC,'utf8'));
fs.appendFileSync(process.env.OSCAR_SNAPSHOT_TEST_PROBES,JSON.stringify({provider,args})+'\n');
const disabled=new Set(args.flatMap((arg,index)=>arg==='--disable'?[args[index+1]]:[]));
if(args.includes('--version'))console.log(provider==='codex'?'codex-cli 0.176.0':'2.1.303 (Claude Code)');
else if(args.includes('--help')){
 const flags=provider==='codex'?['--json','--sandbox','--color','--skip-git-repo-check','--output-schema','--disable','--ephemeral','--strict-config','--search']:['--restricted','--output-format','--verbose','--permission-mode','--tools','--allowedTools','--disallowedTools','--strict-mcp-config','--mcp-config','--no-session-persistence','--setting-sources','--settings','--no-chrome','--disable-slash-commands','--safe-mode','--permission-prompts'];
 console.log(flags.filter(flag=>flag!==spec.missingFlag).join(' ')+' "manual" "dontAsk"');
}else if(args.includes('features')){
 if(args.includes('--strict-config')){console.error('Error: strict-config is not supported for features');process.exitCode=1;}
 else if(spec.hang==='features')setInterval(()=>{},1000);
 else if(spec.featuresFailure){console.error('PRIVATE-CONFIG secret-example');process.exitCode=1;}
 else if(spec.featuresMalformed)console.log('not a feature inventory');
 else{
  const features=spec.features||{apps:true,plugins:true,shell_tool:true,unified_exec:true,browser_use:true,computer_use:true,image_generation:true,view_image:true,code_mode_host:true,multi_agent:true,goals:true,hooks:true,shell_snapshot:true,workspace_dependencies:true,memories:true,future_assistant_tools:true,'guardianv2.thread_context':false,transcript_v2:false,web_search_cached:false,web_search_request:false,item_ids:true,resize_all_images:true,tool_search_always_defer_mcp_tools:true,tui_app_server:true,personality:true,network_proxy:true,enable_request_compression:true};
  const removed=new Set(['guardianv2.thread_context','item_ids','resize_all_images','tool_search_always_defer_mcp_tools','tui_app_server']);
  const deprecated=new Set(['transcript_v2','web_search_cached','web_search_request']);
  for(const[name,enabled]of Object.entries(features))console.log(name+' '+(spec.featureStages?.[name]||(removed.has(name)?'removed':deprecated.has(name)?'deprecated':'stable'))+' '+(disabled.has(name)&&spec.featuresIgnoreDisable!==name&&!removed.has(name)?false:enabled));
 }
}else if(args.includes('mcp')){
 if(args.includes('--strict-config')){console.error('Error: strict-config is not supported for mcp');process.exitCode=1;}
 else if(spec.hang==='mcp')setInterval(()=>{},1000);
 else if(spec.mcpFailure){console.error('PRIVATE-ACCOUNT private@example.test');process.exitCode=1;}
 else if(spec.mcpMalformed)console.log('{incomplete PRIVATE-ACCOUNT');
 else{
  const override=args.find(arg=>arg.startsWith('mcp_servers={'))||'';
  let rows=spec.servers||[{name:'office.read',enabled:true,transport:{env:{TOKEN:'PRIVATE-CONFIG'}}},{name:'name "quoted"',enabled:true},{name:'two words',enabled:false}];
  rows=rows.map(row=>({...row,enabled:spec.mcpIgnoreDisable?row.enabled:override.includes(JSON.stringify(row.name)+'={enabled=false}')?false:row.enabled}));
  if(override&&spec.mcpNewServer)rows.push({name:'new-server',enabled:true});
  console.log(JSON.stringify(spec.mcpWrapped?{servers:rows}:rows));
 }
}else{
 let input='';process.stdin.setEncoding('utf8');process.stdin.on('data',chunk=>input+=chunk);process.stdin.on('end',()=>{
  fs.appendFileSync(process.env.OSCAR_SNAPSHOT_TEST_CALLS,JSON.stringify({provider,args,input,cwd:process.cwd(),home:process.env.HOME,codexHome:process.env.CODEX_HOME,model:process.env.ANTHROPIC_MODEL,apiKeysPresent:['OPENAI_API_KEY','CODEX_API_KEY','ANTHROPIC_API_KEY','ANTHROPIC_AUTH_TOKEN','CLAUDE_CODE_OAUTH_TOKEN'].some(key=>!!process.env[key])})+'\n');
  const emit=event=>console.log(JSON.stringify(event));
  if(provider==='codex'){
   emit({type:'thread.started',thread_id:'snapshot-test'});emit({type:'turn.started'});
   if(spec.tool)emit({type:'item.started',item:{type:spec.tool,command:'PRIVATE-TOOL-ARGUMENT'}});
   if(spec.errorItem)emit({type:'item.completed',item:{id:'passive-diagnostic',type:'error',message:spec.errorItem}});
   emit({type:'item.completed',item:{type:'agent_message',text:'Réponse sur l’instantané'}});if(!spec.missingTerminal)emit({type:'turn.completed',usage:{input_tokens:2,output_tokens:3}});if(spec.exitNonzero)process.exitCode=1;
  }else{
   if(!spec.noInit){
    const available=args.includes('--tools')?args[args.indexOf('--tools')+1].split(',').filter(Boolean):['Bash','Read'];
    emit({type:'system',subtype:'init',tools:spec.initTools||available,mcp_servers:spec.initServers||[],plugins:spec.initPlugins||[]});
   }
   if(spec.tool)emit({type:'assistant',message:{content:[{type:'tool_use',name:spec.tool,input:{path:'PRIVATE-TOOL-ARGUMENT'}}]}});
   emit({type:'assistant',message:{content:[{type:'text',text:'Réponse sur l’instantané'}]}});emit({type:'result',subtype:'success',result:'Réponse sur l’instantané'});
  }
 });
}
`;

async function fixture(fn){
 const directory=await mkdtemp(join(tmpdir(),'oscar-snapshot-provider-')),bin=join(directory,'bin'),cwd=join(directory,'question-service');
 await Promise.all([mkdir(bin),mkdir(cwd)]);
 await Promise.all(['codex','claude'].map(name=>writeFile(join(bin,name),`#!${process.execPath}\n${fakeSource}`,{mode:0o700})));
 const paths={spec:join(directory,'spec.json'),probes:join(directory,'probes.jsonl'),calls:join(directory,'calls.jsonl')};
 await writeFile(paths.spec,'{}');
 const keys=['PATH','OSCAR_SNAPSHOT_TEST_SPEC','OSCAR_SNAPSHOT_TEST_PROBES','OSCAR_SNAPSHOT_TEST_CALLS'];
 const original=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
 Object.assign(process.env,{PATH:bin,OSCAR_SNAPSHOT_TEST_SPEC:paths.spec,OSCAR_SNAPSHOT_TEST_PROBES:paths.probes,OSCAR_SNAPSHOT_TEST_CALLS:paths.calls});
 const rows=async file=>{try{return(await readFile(file,'utf8')).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));}catch(error){if(error.code==='ENOENT')return[];throw error;}};
 try{
  for(const provider of['codex','claude'])assert.equal(await findBinary(provider),join(bin,provider),'A test must never launch an installed account CLI.');
  await fn({cwd,directory,spec:value=>writeFile(paths.spec,JSON.stringify(value)),probes:()=>rows(paths.probes),calls:()=>rows(paths.calls)});
 }finally{
  for(const[key,value]of Object.entries(original)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
  await rm(directory,{recursive:true,force:true});
 }
}

const ask=(provider,cwd,options={})=>runAgent({provider,cwd,prompt:'Instantané fourni par le service : 2 tâches validées sur 3.',snapshotOnly:true,readOnly:true,...options});
const flag=(args,name)=>args[args.indexOf(name)+1];
const disabledFeatures=args=>args.flatMap((arg,index)=>arg==='--disable'?[args[index+1]]:[]);

test('Codex snapshot : vérifie la fermeture effective des outils avant l’appel et préserve modèle et connexion',async()=>fixture(async({cwd,calls,probes})=>{
 const result=await ask('codex',cwd,{readOnly:false,reasoningEffort:'high'});
 assert.equal(result.text,'Réponse sur l’instantané');
 const [call]=await calls(),args=call.args;
 assert.equal((await calls()).length,1);assert.equal(call.cwd,await realpath(cwd));assert.equal(call.home,process.env.HOME);assert.equal(call.codexHome,process.env.CODEX_HOME);assert.equal(call.apiKeysPresent,false);
 assert.equal(flag(args,'--sandbox'),'read-only');assert.equal(flag(args,'-a'),'never');assert.ok(args.includes('--ephemeral'));assert.ok(args.includes('--strict-config'));
 assert.equal(args.includes('--search'),false);assert.ok(args.includes('web_search="disabled"'));assert.ok(args.includes('tools.web_search=false'));assert.equal(args.includes('tools.view_image=false'),false);assert.ok(args.includes('apps._default.enabled=false'));assert.ok(args.includes('project_doc_max_bytes=0'));assert.ok(args.includes('notify=[]'));
 for(const feature of['apps','plugins','shell_tool','unified_exec','browser_use','computer_use','image_generation','view_image','code_mode_host','multi_agent','goals','hooks','shell_snapshot','workspace_dependencies','memories','future_assistant_tools'])assert.ok(disabledFeatures(args).includes(feature),feature);
 for(const feature of['personality','network_proxy','enable_request_compression'])assert.equal(disabledFeatures(args).includes(feature),false,feature);
 assert.equal(args.some(arg=>arg==='--model'||/^model=/u.test(arg)),false);assert.ok(args.includes('model_reasoning_effort="high"'));assert.equal(args.includes('model_reasoning_effort="medium"'),false);
 assert.ok(args.includes(`mcp_servers={${['office.read','name "quoted"','two words'].map(name=>`${JSON.stringify(name)}={enabled=false}`).join(',')}}`));
 assert.doesNotMatch(JSON.stringify(call),/PRIVATE-CONFIG|PRIVATE-ACCOUNT|TOKEN/u);
 assert.match(call.input,/Aucun outil n’est nécessaire ni autorisé/);assert.match(call.input,/Instantané fourni par le service/);
 const checks=await probes();assert.equal(checks.filter(check=>check.args.includes('features')).length,2);assert.equal(checks.filter(check=>check.args.includes('mcp')).length,2);
 assert.equal(checks.filter(check=>check.args.includes('exec')&&!check.args.includes('--help')).length,1);
 assert.deepEqual(await readdir(cwd),[]);
}));

test('Codex snapshot : unified_exec figé reste accepté seulement si shell_tool est confirmé fermé',async()=>fixture(async({cwd,spec,calls})=>{
 await spec({featuresIgnoreDisable:'unified_exec'});await ask('codex',cwd);
 const [call]=await calls();assert.ok(disabledFeatures(call.args).includes('unified_exec'));assert.ok(disabledFeatures(call.args).includes('shell_tool'));
 for(const alias of['guardianv2.thread_context','transcript_v2','web_search_cached','web_search_request'])assert.equal(disabledFeatures(call.args).includes(alias),false);
}));

test('Codex snapshot : la fermeture des images utilise le champ ancien seulement sans feature view_image',async()=>fixture(async({cwd,spec,calls})=>{
 await spec({features:{apps:true,plugins:true,shell_tool:true,unified_exec:true}});await ask('codex',cwd);const[call]=await calls();assert.ok(call.args.includes('tools.view_image=false'));assert.ok(call.args.includes('--strict-config'));
}));

test('Codex snapshot : un inventaire MCP vide est confirmé sans modifier les réglages globaux',async()=>fixture(async({cwd,spec,calls,probes})=>{
 await spec({servers:[]});await ask('codex',cwd);const [call]=await calls();
 assert.equal(call.args.some(arg=>arg.startsWith('mcp_servers=')),false);assert.equal((await probes()).filter(check=>check.args.includes('mcp')).length,2);assert.deepEqual(await readdir(cwd),[]);
}));

test('Codex snapshot : inventaires incomplets ou non vérifiés interdisent tout appel modèle',async()=>{
 for(const settings of[{featuresFailure:true},{featuresMalformed:true},{features:{apps:true,plugins:true,shell_tool:true}},{featuresIgnoreDisable:'browser_use'},{featuresIgnoreDisable:'shell_tool'},{featureStages:{tui_app_server:'stable'}},{featureStages:{item_ids:'stable'}},{featureStages:{resize_all_images:'stable'}},{featureStages:{tool_search_always_defer_mcp_tools:'stable'}},{featureStages:{shell_tool:'removed'}},{features:{apps:true,plugins:true,shell_tool:true,unified_exec:true,'bad..name':false}},{features:{apps:true,plugins:true,shell_tool:true,unified_exec:true,'unsafe\nname':false}},{mcpFailure:true},{mcpMalformed:true},{mcpWrapped:true},{mcpIgnoreDisable:true},{mcpNewServer:true},{servers:[{name:'same',enabled:true},{name:'same',enabled:false}]},{servers:[{name:'broken\nname',enabled:true}]},{servers:[{name:'missing-enabled'}]}])await fixture(async({cwd,spec,calls})=>{
  await spec(settings);await assert.rejects(ask('codex',cwd),error=>error.code==='PROVIDER_UNSUPPORTED'&&error.recoverable===false&&!/PRIVATE|TOKEN/u.test(error.message));assert.equal((await calls()).length,0);
 });
});

test('Codex snapshot : absence de protections CLI obligatoires refuse la consultation sans modèle',async()=>{
 for(const missingFlag of['--disable','--ephemeral','--strict-config'])await fixture(async({cwd,spec,calls})=>{
  await spec({missingFlag});await assert.rejects(ask('codex',cwd),{code:'PROVIDER_UNSUPPORTED'});assert.equal((await calls()).length,0);
 });
});

test('Claude snapshot : aucun outil, MCP, session, personnalisation de projet ou navigateur hérité',async()=>fixture(async({cwd,spec,calls})=>{
 await spec({globalAllowedTools:['Read','Bash','mcp__gmail__send']});await ask('claude',cwd,{readOnly:false});
 const [call]=await calls(),args=call.args;
 assert.equal(flag(args,'--tools'),'');assert.equal(flag(args,'--allowedTools'),'');assert.equal(flag(args,'--disallowedTools'),'mcp__*');assert.equal(flag(args,'--permission-mode'),'dontAsk');assert.equal(flag(args,'--permission-prompts'),'none');
 assert.equal(flag(args,'--setting-sources'),'');assert.deepEqual(JSON.parse(flag(args,'--mcp-config')),{mcpServers:{}});
 for(const name of['--restricted','--strict-mcp-config','--no-session-persistence','--no-chrome','--disable-slash-commands','--safe-mode'])assert.ok(args.includes(name),name);
 const settings=JSON.parse(flag(args,'--settings'));assert.equal(settings.disableAllHooks,true);assert.equal(settings.autoMemoryEnabled,false);assert.deepEqual(settings.permissions,{defaultMode:'dontAsk',allow:[],deny:['mcp__*']});
 assert.equal(args.includes('--bare'),false);assert.equal(args.includes('--model'),false);assert.equal(call.home,process.env.HOME);assert.equal(call.codexHome,process.env.CODEX_HOME);assert.equal(call.model,process.env.ANTHROPIC_MODEL);assert.equal(call.apiKeysPresent,false);assert.deepEqual(await readdir(cwd),[]);
}));

test('Claude snapshot : toute protection manquante arrête avant l’appel modèle',async()=>{
 for(const missingFlag of['--tools','--allowedTools','--disallowedTools','--mcp-config','--strict-mcp-config','--no-session-persistence','--setting-sources','--settings','--no-chrome','--disable-slash-commands','--safe-mode','--permission-prompts'])await fixture(async({cwd,spec,calls})=>{
  await spec({missingFlag});await assert.rejects(ask('claude',cwd),{code:'PROVIDER_UNSUPPORTED'});assert.equal((await calls()).length,0);
 });
});

test('Claude snapshot : un outil ou service réintroduit dans le manifeste ne valide aucune réponse',async()=>{
 for(const settings of[{initTools:['Read']},{initServers:[{name:'gmail',status:'connected'}]},{initPlugins:[{name:'inherited'}]},{noInit:true}])await fixture(async({cwd,spec})=>{
  await spec(settings);await assert.rejects(ask('claude',cwd),error=>['PROVIDER_TOOL_UNAVAILABLE','PROVIDER_UNSUPPORTED'].includes(error.code)&&error.recoverable===false&&!/PRIVATE/u.test(error.message));
 });
});

test('snapshot : toute activité outil signalée arrête la réponse sans permission supplémentaire',async()=>{
 for(const[provider,tool]of[['codex','command_execution'],['codex','file_change'],['codex','web_search'],['codex','mcp_tool_call'],['codex','future_tool'],['claude','Read'],['claude','mcp__gmail__send']])await fixture(async({cwd,spec,calls})=>{
  await spec({tool});await assert.rejects(ask(provider,cwd),error=>error.code==='PROVIDER_TOOL_UNAVAILABLE'&&error.recoverable===false&&!/PRIVATE/u.test(error.message));assert.equal((await calls()).length,1);
 });
});

test('Codex snapshot : les diagnostics error restent des échecs classifiés, jamais des activités outil ni des succès',async()=>{
 for(const[message,code]of[['usage limit quota PRIVATE-DIAGNOSTIC','PROVIDER_USAGE_LIMIT'],['OAuth token expired PRIVATE-DIAGNOSTIC','PROVIDER_AUTH_REQUIRED'],['unknown option --new PRIVATE-DIAGNOSTIC','PROVIDER_UNSUPPORTED'],['upstream issue PRIVATE-DIAGNOSTIC','PROVIDER_UNAVAILABLE']])await fixture(async({cwd,spec,calls})=>{
  await spec({errorItem:message});await assert.rejects(ask('codex',cwd),error=>error.code===code&&!/PRIVATE|upstream|--new/u.test(error.message));assert.equal((await calls()).length,1);
 });
});

test('Codex snapshot : seul l’avertissement fixe du code mode fermé accompagne une fin réelle réussie',async()=>{
 const warning='Code Mode is unavailable because code-mode host is disabled. Code mode will fail closed; enable `features.code_mode_host` and install `codex-code-mode-host`.';
 await fixture(async({cwd,spec})=>{await spec({errorItem:warning});assert.equal((await ask('codex',cwd)).text,'Réponse sur l’instantané');});
 for(const settings of[{errorItem:warning+' PRIVATE-DIAGNOSTIC'},{errorItem:warning,features:{apps:true,plugins:true,shell_tool:true,unified_exec:true}},{errorItem:'Code Mode is unavailable PRIVATE-DIAGNOSTIC'}])await fixture(async({cwd,spec})=>{
  await spec(settings);await assert.rejects(ask('codex',cwd),error=>error.code==='PROVIDER_UNAVAILABLE'&&!/PRIVATE/u.test(error.message));
 });
 for(const[settings,code]of[[{errorItem:warning,missingTerminal:true},'PROVIDER_NO_RESULT'],[{errorItem:warning,exitNonzero:true},'PROVIDER_UNAVAILABLE'],[{errorItem:warning,tool:'command_execution'},'PROVIDER_TOOL_UNAVAILABLE']])await fixture(async({cwd,spec})=>{
  await spec(settings);await assert.rejects(ask('codex',cwd),{code});
 });
});

test('snapshot : connecteurs, schémas et modes mal formés sont refusés avant tout processus',async()=>fixture(async({cwd,calls,probes})=>{
 for(const provider of['codex','claude'])for(const options of[{connectorPlan:{}},{connectorPlan:false},{schema:{type:'object'}},{snapshotOnly:'true'},{snapshotOnly:1}])await assert.rejects(ask(provider,cwd,options),{code:'PROVIDER_REQUEST_INVALID'});
 assert.deepEqual(await probes(),[]);assert.deepEqual(await calls(),[]);assert.deepEqual(await readdir(cwd),[]);
}));

test('snapshot : annulation et échéance couvrent aussi les contrôles avant modèle',async()=>fixture(async({cwd,spec,calls,probes})=>{
 await assert.rejects(ask('codex',cwd,{signal:AbortSignal.abort()}),{code:'PROVIDER_CANCELLED'});assert.deepEqual(await probes(),[]);
 await spec({hang:'mcp'});await assert.rejects(ask('codex',cwd,{timeoutMs:600}),error=>error.code==='PROVIDER_TIMEOUT'&&error.provider==='codex'&&/600 ms/u.test(error.message));assert.deepEqual(await calls(),[]);
}));
