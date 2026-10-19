import { spawn, execFile } from 'node:child_process';
import { openSync, closeSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
const root=path.dirname(fileURLToPath(import.meta.url));
process.env.PATH=[path.join(root,'.runtime','bin'),path.join(root,'.tools','node_modules','.bin'),process.env.PATH || ''].join(path.delimiter);
const port=Number(process.env.PORT ?? 4850);
const url=`http://127.0.0.1:${port}`;
async function ready() {
  try { const r=await fetch(url+'/api/state',{signal:AbortSignal.timeout(800)}); const data=await r.json();return r.ok && data.app==='oscar-et-les-agents'; } catch {return false;}
}
if(!await ready()) {
  const log=openSync(path.join(root,'atelier.log'),'a',0o600);
  const server=spawn(process.execPath,[path.join(root,'server.mjs')],{cwd:root,detached:true,stdio:['ignore',log,log]});
  server.on('error',()=>{console.error('Impossible de démarrer Oscar et les agents. Consultez atelier.log.');process.exitCode=1;});
  server.unref();closeSync(log);
  let started=false;
  for(let i=0;i<40;i++){if(await ready()){started=true;break;}await delay(250);}
  if(!started){console.error(`Oscar et les agents ne répond pas. Consultez atelier.log dans son dossier, ou vérifiez le port ${port}.`);process.exit(1);}
}
await new Promise(resolve=>execFile(process.platform==='darwin'?'open':process.platform==='win32'?'explorer':'xdg-open',[`http://localhost:${port}`],resolve));
console.log(`Oscar et les agents est ouvert : http://localhost:${port}`);
