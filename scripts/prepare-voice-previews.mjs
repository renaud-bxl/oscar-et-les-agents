#!/usr/bin/env node
// Maintainer utility: publisher-provided states only, no user audio or encoder.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import { PocketVoice } from '../lib/pocket-voice.mjs';
import { validWave } from '../lib/local-voice.mjs';

const sentences = Object.freeze({
  oscar: {
    fr: 'Bonjour, je suis Oscar. Confiez-moi votre idée : je prépare l’équipe, je coordonne le travail et je vérifie le résultat.',
    en: 'Hello, I am Oscar. Tell me your idea: I will build the team, coordinate the work, and check the result.',
    nl: 'Hallo, ik ben Oscar. Vertel me je idee: ik stel het team samen, coördineer het werk en controleer het resultaat.',
  },
  zoe: {
    fr: 'Bonjour, je suis Zoé. Une question, votre agenda ou un peu d’organisation ? Je vous aide à préparer la suite, simplement.',
    en: 'Hello, I am Zoé. A question, your calendar, or a little help getting organised? Let us prepare your next steps together.',
    nl: 'Hallo, ik ben Zoé. Een vraag, je agenda of wat hulp bij de planning? Samen maken we de volgende stappen overzichtelijk.',
  },
});

export async function preparePreviews({dataDir,outputDir,confirmed=false,voiceFactory=options=>new PocketVoice(options),onProgress=()=>{}}={}) {
  if(confirmed!==true||!path.isAbsolute(dataDir||'')||!path.isAbsolute(outputDir||''))throw Error('Confirmez la préparation et précisez les dossiers absolus de données et de sortie.');
  const voice=voiceFactory({dataDir});
  try {
    await voice.ready;
    await voice.install({voiceId:'studio-oscar-paul-v2',confirmed:true});
    await voice.operation;
    const state=await voice.state();
    const replacements=state.voices?.filter(row=>row.replacement)||[];
    if(replacements.length!==2||!replacements.every(row=>row.installed)||state.installationError)throw Error('Le complément Paul et Vera n’a pas été vérifié.');
    await mkdir(outputDir,{recursive:true});
    const results=[];
    for(const [character,voiceId,file] of [['oscar','studio-oscar-paul-v2','oscar-paul-v2'],['zoe','studio-zoe-vera-v2','zoe-vera-v2']]){
      for(const language of ['fr','en','nl']){
        const result=await voice.speak({voiceId,language,text:sentences[character][language]});
        const match=/^\/api\/voice\/audio\/([a-f0-9]{64})\.wav$/.exec(result.url||'');
        if(!match)throw Error('La synthèse locale n’a pas fourni de fichier reconnu.');
        const audio=await voice.audio(match[1]);
        if(!validWave(audio))throw Error('La préécoute générée est invalide.');
        const filename=`voice-preview-${file}-${language}.wav`;
        await writeFile(path.join(outputDir,filename),audio,{flag:'wx',mode:0o644});
        const row={voiceId,language,filename,bytes:audio.length};results.push(row);onProgress(row);
      }
    }
    return results;
  } finally {await voice.close();}
}

if(import.meta.url===pathToFileURL(path.resolve(process.argv[1]||'')).href){
  const options={};
  for(let index=2;index<process.argv.length;index++){
    const key=process.argv[index];
    if(key==='--confirmed')options.confirmed=true;
    else if(key==='--data-dir')options.dataDir=process.argv[++index];
    else if(key==='--output-dir')options.outputDir=process.argv[++index];
    else throw Error('Option de préparation vocale inconnue.');
  }
  await preparePreviews({...options,onProgress:row=>process.stdout.write(JSON.stringify(row)+'\n')});
}
