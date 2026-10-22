import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,mkdir,readFile,writeFile,symlink,rm,realpath,readdir,access} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';

const execute=promisify(execFile);
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const quote=value=>`'${String(value).replaceAll("'","'\\''")}'`;
const commonOptions={timeout:20000,maxBuffer:1024*1024};
let python;
async function requirePty(t){
  if(process.platform==='win32'){t.skip('The shell installer requires POSIX.');return false;}
  if(python===undefined){
    try{const result=await execute('python3',['-c','import pty,select,subprocess,sys; print(sys.executable)'],commonOptions);python=result.stdout.trim();}
    catch{python=null;}
  }
  if(!python){t.skip('Python 3 with the standard-library pty module is unavailable.');return false;}
  return true;
}

// A copied installer gets a private mount namespace by rewriting filesystem
// roots only. No test can create or mount a disk under the real /Volumes or
// Linux mount roots. The wizard, shell parsing, archive copy and /dev/tty reads
// execute normally; only uname/stat and the source download are fixtures.
async function fixture(t,{platform='Darwin',disks=true}={}){
  const temporary=await mkdtemp(path.join(await realpath(os.tmpdir()),'oscar-location-wizard-'));
  t.after(()=>rm(temporary,{recursive:true,force:true}));
  const home=path.join(temporary,'person'),mocks=path.join(temporary,'mocks'),source=path.join(temporary,'source'),scratch=path.join(temporary,'scratch');
  for(const directory of[home,mocks,path.join(source,'scripts'),scratch])await mkdir(directory,{recursive:true});
  const mountRoots=Object.fromEntries(['/Volumes','/media','/run/media','/mnt'].map(value=>[value,path.join(temporary,'mounts',value.slice(1))]));
  for(const directory of Object.values(mountRoots))await mkdir(directory,{recursive:true});
  const mounted=platform==='Darwin'?[path.join(mountRoots['/Volumes'],'SSD principal')]:[
    path.join(mountRoots['/media'],'person','SSD mobile'),path.join(mountRoots['/run/media'],'person','SSD secours'),path.join(mountRoots['/mnt'],'SSD archive')];
  if(disks)for(const directory of mounted)await mkdir(directory,{recursive:true});
  const ordinary=path.join(mountRoots[platform==='Darwin'?'/Volumes':'/mnt'],'Dossier non monté');
  await mkdir(ordinary,{recursive:true});
  if(disks)await symlink(mounted[0],path.join(mountRoots[platform==='Darwin'?'/Volumes':'/mnt'],'Lien trompeur'),'dir');
  const original=await readFile(path.join(root,'install.sh'),'utf8');
  // Longest root first avoids partially rewriting /run/media as /media.
  const installer=original.replace(/\/run\/media(?=\/|[\s|;)'"]|$)|\/Volumes(?=\/|[\s|;)'"]|$)|\/media(?=\/|[\s|;)'"]|$)|\/mnt(?=\/|[\s|;)'"]|$)/gu,match=>mountRoots[match]);
  const shell=path.join(source,'install.sh');
  await writeFile(shell,installer);
  await writeFile(path.join(source,'package.json'),JSON.stringify({name:'oscar-et-les-agents'}));
  await writeFile(path.join(source,'server.mjs'),'// This fixture never starts a server.\n');
  const receipt=path.join(temporary,'onboarding.json'),network=path.join(temporary,'download.log');
  await writeFile(path.join(source,'scripts','install.mjs'),[
    "import {writeFileSync} from 'node:fs';",
    "writeFileSync(process.env.OSCAR_TEST_RECEIPT,JSON.stringify({argv:process.argv.slice(2),cwd:process.cwd()}));",
    "console.log('ONBOARDING_FIXTURE_OK');",
  ].join('\n'));
  const archive=path.join(temporary,'source.tar.gz');
  await execute('/usr/bin/tar',['-czf',archive,'-C',temporary,'source'],commonOptions);
  await writeFile(path.join(mocks,'node'),`#!/bin/sh\nexec ${quote(process.execPath)} "$@"\n`,{mode:0o755});
  await writeFile(path.join(mocks,'uname'),'#!/bin/sh\ncase "$1" in -s) printf "%s\\n" "$OSCAR_TEST_SYSTEM";; -m) echo x86_64;; *) exit 92;; esac\n',{mode:0o755});
  const statScript=[
    `#!${python}`,
    'import json,os,sys',
    "mounts=json.loads(os.environ['OSCAR_TEST_MOUNTS'])",
    'target=os.path.abspath(sys.argv[-1])',
    'if not os.path.exists(target):sys.exit(1)',
    "matching=[index for index,mount in enumerate(mounts) if target==mount or target.startswith(mount+os.sep)]",
    'print(1000+matching[-1]+1 if matching else 1000)',
    '',
  ].join('\n');
  await writeFile(path.join(mocks,'stat'),statScript,{mode:0o755});
  await writeFile(path.join(mocks,'curl'),`#!/bin/sh\nurl=''\nout=''\nwhile [ "$#" -gt 0 ]; do\n case "$1" in https://*) url=$1; shift;; -o) out=$2; shift 2;; *) shift;; esac\ndone\nprintf '%s\\n' "$url" >> "$OSCAR_TEST_NETWORK"\ncase "$url" in https://codeload.github.com/renaud-bxl/oscar-et-les-agents/tar.gz/refs/heads/main) cp "$OSCAR_TEST_ARCHIVE" "$out";; *) echo 'Unexpected download forbidden by test' >&2; exit 93;; esac\n`,{mode:0o755});
  const env={...process.env,HOME:home,TMPDIR:scratch,PATH:`${mocks}:/usr/bin:/bin`,OSCAR_TEST_SYSTEM:platform,OSCAR_TEST_MOUNTS:JSON.stringify(disks?mounted:[]),OSCAR_TEST_RECEIPT:receipt,OSCAR_TEST_NETWORK:network,OSCAR_TEST_ARCHIVE:archive};
  delete env.OSCAR_DATA_DIR;delete env.ATELIER_DATA_DIR;
  const command=(args=[],pipeline=true)=>pipeline?`cat ${quote(shell)} | /bin/sh -s -- ${args.map(quote).join(' ')}`:`/bin/sh ${quote(shell)} ${args.map(quote).join(' ')}`;
  return{temporary,home,mocks,source,shell,scratch,mountRoots,mounted:disks?mounted:[],ordinary,receipt,network,env,command,defaultDirectory:path.join(home,'.local','share','oscar-et-les-agents')};
}

// pty.fork supplies a real controlling terminal. The command is nevertheless
// a pipeline, so the installer's stdin is a pipe and prompts must use /dev/tty.
// Interactive replies are emitted only after the relevant prompt is observed.
const ptyProgram=String.raw`
import errno,json,os,pty,re,select,signal,subprocess,sys,time
spec=json.loads(sys.argv[1])
if not spec.get('terminal',True):
 result=subprocess.run(['/bin/sh','-c',spec['command']],stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,env=os.environ.copy(),start_new_session=True,timeout=12)
 print(json.dumps({'code':result.returncode,'output':result.stdout.decode('utf-8','replace'),'answered':0}));sys.exit(0)
pid,fd=pty.fork()
if pid==0:os.execvpe('/bin/sh',['/bin/sh','-c',spec['command']],os.environ.copy())
output=b'';decoded='';cursor=0;answered=0;status=None;deadline=time.monotonic()+12
try:
 while time.monotonic()<deadline:
  ready,_,_=select.select([fd],[],[],0.05)
  if ready:
   try:chunk=os.read(fd,65536)
   except OSError as error:
    if error.errno==errno.EIO:chunk=b''
    else:raise
   if chunk:output+=chunk;decoded=output.decode('utf-8','replace')
   else:
    found,status=os.waitpid(pid,0);break
  steps=spec.get('steps',[])
  if answered<len(steps):
   step=steps[answered];match=re.search(step['expect'],decoded[cursor:],re.IGNORECASE)
   if match:
    cursor+=match.end();answer=step.get('send','')
    if step.get('choiceFor'):
     candidates=re.findall(r'^\s*(\d+)\s*[.)-]\s*([^\r\n]+)',decoded,re.MULTILINE)
     choices=[number for number,label in candidates if step['choiceFor'] in label]
     if len(choices)!=1:raise RuntimeError('Disk label not uniquely selectable: '+str(candidates))
     answer=choices[0]
    for directory in step.get('removeBeforeReply',[]):os.rmdir(directory)
    os.write(fd,b'\x04' if step.get('eof') else (answer+'\n').encode());answered+=1
  found,current=os.waitpid(pid,os.WNOHANG)
  if found:status=current;break
 if status is None:raise TimeoutError('Installer did not finish within the test deadline.')
 # Drain final output after waitpid without waiting for another prompt.
 while select.select([fd],[],[],0)[0]:
  try:chunk=os.read(fd,65536)
  except OSError as error:
   if error.errno==errno.EIO:break
   raise
  if not chunk:break
  output+=chunk
 print(json.dumps({'code':os.waitstatus_to_exitcode(status),'output':output.decode('utf-8','replace'),'answered':answered}))
except BaseException as error:
 try:os.killpg(pid,signal.SIGKILL)
 except ProcessLookupError:pass
 try:os.waitpid(pid,0)
 except ChildProcessError:pass
 print(json.dumps({'code':None,'output':output.decode('utf-8','replace'),'answered':answered,'error':str(error)}))
finally:os.close(fd)
`;
async function run(state,{args=['--engine','codex','--skip-login','--no-open'],steps=[],terminal=true,pipeline=true}={}){
  const result=await execute(python,['-c',ptyProgram,JSON.stringify({command:state.command(args,pipeline),steps,terminal})],{...commonOptions,env:state.env,cwd:state.temporary});
  const response=JSON.parse(result.stdout.trim());
  assert.equal(response.error,undefined,`${response.error||''}\n${response.output}`);
  const required=steps.filter(step=>!step.optional).length;
  assert.ok(response.answered>=required&&response.answered<=steps.length,`Some wizard replies were never requested:\n${response.output}`);
  return response;
}
async function absent(file){await assert.rejects(access(file),{code:'ENOENT'});}
const choose=send=>({expect:String.raw`(?:votre )?choix[^\r\n]*:`,send});
const confirm=send=>({expect:String.raw`(?:confirm|installer|continuer)[^\r\n]*\[[^\]\r\n]*[oOnN][^\]\r\n]*\][^\r\n]*:`,send});

test('a piped unattended install without --dir refuses before creating files or downloading',async t=>{
  if(!await requirePty(t))return;
  const state=await fixture(t),result=await run(state,{terminal:false});
  assert.notEqual(result.code,0,result.output);
  assert.match(result.output,/terminal interactif|--dir/iu);
  await absent(state.defaultDirectory);await absent(state.receipt);await absent(state.network);
  assert.deepEqual(await readdir(state.scratch),[]);
});

test('dry-run without --dir remains noninteractive and never prepares a home or runtime',async t=>{
  if(!await requirePty(t))return;
  const state=await fixture(t),result=await run(state,{terminal:false,args:['--engine','both','--dry-run']});
  assert.equal(result.code,0,result.output);assert.match(result.output,/Aucun changement effectué/u);
  assert.match(result.output,/Simulation/u);await absent(state.defaultDirectory);await absent(state.receipt);await absent(state.network);
  assert.deepEqual(await readdir(state.scratch),[]);
});

test('an explicit --dir bypasses every wizard prompt and preserves existing mission files',async t=>{
  if(!await requirePty(t))return;
  const state=await fixture(t),destination=path.join(state.temporary,'Application avec espaces'),sentinel=path.join(destination,'data','mission.txt');
  await mkdir(path.dirname(sentinel),{recursive:true});await writeFile(sentinel,'Conserver exactement cette mission.\n');
  const result=await run(state,{terminal:false,pipeline:false,args:['--engine','codex','--dir',destination,'--skip-login','--no-open']});
  assert.equal(result.code,0,result.output);assert.match(result.output,/ONBOARDING_FIXTURE_OK/u);
  assert.equal(await readFile(sentinel,'utf8'),'Conserver exactement cette mission.\n');
  assert.deepEqual(JSON.parse(await readFile(state.receipt,'utf8')).argv,['--engine','codex','--skip-login','--no-open']);
  await absent(state.defaultDirectory);await absent(state.network);
});

test('canceling a terminal location recap leaves the disk, source and download untouched',async t=>{
  if(!await requirePty(t))return;
  const state=await fixture(t),result=await run(state,{steps:[choose('1'),confirm('n')]});
  assert.match(result.output,/annul|aucun changement/iu);
  await absent(state.defaultDirectory);await absent(state.receipt);await absent(state.network);
  assert.deepEqual(await readdir(state.scratch),[]);
  assert.equal((await readdir(state.source)).includes('server.mjs'),true);
});

test('a curl-style pipeline uses /dev/tty to choose internal storage and confirm before a local-fixture install',async t=>{
  if(!await requirePty(t))return;
  const state=await fixture(t),result=await run(state,{steps:[choose('1'),confirm('o')]});
  assert.equal(result.code,0,result.output);assert.match(result.output,/ONBOARDING_FIXTURE_OK/u);
  assert.ok(result.output.includes(state.defaultDirectory),result.output);
  assert.ok((await readFile(path.join(state.defaultDirectory,'server.mjs'),'utf8')).includes('never starts a server'));
  assert.deepEqual(JSON.parse(await readFile(state.receipt,'utf8')).argv,['--engine','codex','--data-dir',path.join(state.home,'Documents','Oscar et les agents'),'--skip-login','--no-open']);
  assert.equal((await readFile(state.network,'utf8')).trim(),'https://codeload.github.com/renaud-bxl/oscar-et-les-agents/tar.gz/refs/heads/main');
});

for(const platform of['Darwin','Linux'])test(`the ${platform} wizard offers only mounted disks and puts software and data on the chosen SSD`,async t=>{
  if(!await requirePty(t))return;
  const state=await fixture(t,{platform}),disk=state.mounted[0],result=await run(state,{steps:[{...choose(''),choiceFor:path.basename(disk)},confirm('o')]});
  assert.equal(result.code,0,result.output);assert.match(result.output,/ONBOARDING_FIXTURE_OK/u);
  assert.doesNotMatch(result.output,/Dossier non monté|Lien trompeur/u);
  for(const mounted of state.mounted)assert.ok(result.output.includes(path.basename(mounted)),`${mounted} was not offered:\n${result.output}`);
  const software=path.join(disk,'Oscar et les agents','Logiciel'),data=path.join(disk,'Oscar et les agents','Donnees');
  assert.ok(result.output.includes(software),result.output);assert.ok(result.output.includes(data),result.output);
  await access(path.join(software,'server.mjs'));
  assert.deepEqual(JSON.parse(await readFile(state.receipt,'utf8')).argv,['--engine','codex','--data-dir',data,'--skip-login','--no-open']);
  await absent(state.defaultDirectory);
});

test('a location recap never treats an empty confirmation as permission to install',async t=>{
  if(!await requirePty(t))return;
  const state=await fixture(t),result=await run(state,{steps:[choose('1'),confirm('')]});
  assert.match(result.output,/annul|aucun changement/iu);
  await absent(state.defaultDirectory);await absent(state.receipt);await absent(state.network);
});

test('the piped first-install flow keeps location selection separate from the subscription choice',async t=>{
  if(!await requirePty(t))return;
  const state=await fixture(t),result=await run(state,{args:['--skip-login','--no-open'],steps:[choose('1'),choose('2'),confirm('oui')]});
  assert.equal(result.code,0,result.output);
  assert.deepEqual(JSON.parse(await readFile(state.receipt,'utf8')).argv,['--engine','claude','--data-dir',path.join(state.home,'Documents','Oscar et les agents'),'--skip-login','--no-open']);
});

test('Linux custom parent paths preserve apostrophes, dollar expressions and backticks as literal bytes',async t=>{
  if(!await requirePty(t))return;
  const state=await fixture(t,{platform:'Linux',disks:false});
  const parent=path.join(state.temporary,"L'équipe $(touch wizard-must-not-execute) `touch wizard-must-not-execute`");
  const result=await run(state,{steps:[{...choose(''),choiceFor:'autre dossier'},
    {expect:String.raw`Chemin absolu[^\r\n]*:`,send:parent},confirm('yes')]});
  assert.equal(result.code,0,result.output);
  const software=path.join(parent,'Oscar et les agents','Logiciel'),data=path.join(parent,'Oscar et les agents','Donnees');
  await access(path.join(software,'server.mjs'));
  assert.deepEqual(JSON.parse(await readFile(state.receipt,'utf8')).argv,['--engine','codex','--data-dir',data,'--skip-login','--no-open']);
  await absent(path.join(state.temporary,'wizard-must-not-execute'));
});

test('end-of-file at confirmation is an interruption and cannot create an installation',async t=>{
  if(!await requirePty(t))return;
  const state=await fixture(t),result=await run(state,{steps:[choose('1'),{...confirm(''),eof:true}]});
  assert.notEqual(result.code,0,result.output);assert.match(result.output,/interrompu|aucun emplacement/iu);
  await absent(state.defaultDirectory);await absent(state.receipt);await absent(state.network);
  assert.deepEqual(await readdir(state.scratch),[]);
});

test('a manually entered unmounted Linux disk is refused before confirmation or any installation writes',async t=>{
  if(!await requirePty(t))return;
  const state=await fixture(t,{platform:'Linux',disks:false}),result=await run(state,{steps:[{...choose(''),choiceFor:'autre dossier'},
    {expect:String.raw`Chemin absolu[^\r\n]*:`,send:state.ordinary}]});
  assert.notEqual(result.code,0,result.output);assert.match(result.output,/disque externe.*pas monté/iu);
  assert.doesNotMatch(result.output,/Confirmer ces emplacements/u);
  await absent(path.join(state.ordinary,'Oscar et les agents'));await absent(state.defaultDirectory);await absent(state.receipt);await absent(state.network);
});

test('choosing an existing SSD installation preserves its saved data location instead of imposing a new data directory',async t=>{
  if(!await requirePty(t))return;
  const state=await fixture(t),software=path.join(state.mounted[0],'Oscar et les agents','Logiciel'),runtime=path.join(software,'.runtime');
  await mkdir(runtime,{recursive:true});
  const saved=JSON.stringify({version:1,dataDirectory:path.join(state.temporary,'Existing documents'),locationId:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'});
  await writeFile(path.join(runtime,'installation.json'),saved);
  const result=await run(state,{steps:[{...choose(''),choiceFor:path.basename(state.mounted[0])},confirm('o')]});
  assert.equal(result.code,0,result.output);assert.match(result.output,/emplacement déjà mémorisé/u);
  assert.deepEqual(JSON.parse(await readFile(state.receipt,'utf8')).argv,['--engine','codex','--skip-login','--no-open']);
  assert.equal(await readFile(path.join(runtime,'installation.json'),'utf8'),saved);
});

test('a disk removed after the menu was displayed cannot silently shift its number to another SSD',async t=>{
  if(!await requirePty(t))return;
  const state=await fixture(t,{platform:'Linux'}),selected=state.mounted[0];
  const result=await run(state,{steps:[{...choose(''),choiceFor:path.basename(selected),removeBeforeReply:[selected]},
    {...confirm('o'),optional:true}]});
  assert.notEqual(result.code,0,`The selected disk disappeared, but installation still succeeded:\n${result.output}`);
  assert.match(result.output,/disque.*(?:disponible|monté)|rebranchez/iu);
  await absent(state.receipt);await absent(state.network);await absent(state.defaultDirectory);
  for(const directory of state.mounted)await absent(path.join(directory,'Oscar et les agents'));
});

test('disconnecting the selected SSD during the recap is detected before creating its installation directory',async t=>{
  if(!await requirePty(t))return;
  const state=await fixture(t),selected=state.mounted[0];
  const result=await run(state,{steps:[{...choose(''),choiceFor:path.basename(selected)},
    {...confirm('o'),removeBeforeReply:[selected]}]});
  assert.notEqual(result.code,0,result.output);assert.match(result.output,/disque.*(?:disponible|monté)|rebranchez/iu);
  await absent(selected);await absent(state.receipt);await absent(state.network);await absent(state.defaultDirectory);
  assert.deepEqual(await readdir(state.scratch),[]);
});

test('an explicit system data directory is rejected before the software folder is created',async t=>{
  if(!await requirePty(t))return;
  const state=await fixture(t),destination=path.join(state.temporary,'software');
  const result=await run(state,{terminal:false,args:['--engine','codex','--dir',destination,'--data-dir','/usr/local/oscar-wizard-test-never-created','--skip-login','--no-open']});
  assert.notEqual(result.code,0,result.output);assert.match(result.output,/système|réservé|données/iu);
  await absent(destination);await absent(state.receipt);await absent(state.network);
  assert.deepEqual(await readdir(state.scratch),[]);
});
