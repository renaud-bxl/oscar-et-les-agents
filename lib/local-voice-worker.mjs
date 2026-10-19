import path from 'node:path';
import { createRequire } from 'node:module';
import { writeFile } from 'node:fs/promises';
import { validateVoiceModel } from './local-voice.mjs';

// Native inference runs outside the HTTP process. It receives a short line over
// local IPC; no request, secret, command or remote model path comes from the UI.
export async function generateLocalSpeech({ runtimeDir, modelDir, sid, text, speed, output }) {
  const require = createRequire(path.join(runtimeDir, 'package.json'));
  const sherpa = require('sherpa-onnx-node');
  const vits = await validateVoiceModel(modelDir);
  const tts = new sherpa.OfflineTts({ model: { vits, numThreads: 2, debug: false, provider: 'cpu' }, maxNumSentences: 1 });
  const audio = tts.generate({ text, sid, speed });
  if (!(audio.samples instanceof Float32Array) || !audio.samples.length || audio.samples.length > 4 * 1024 * 1024 || !Number.isInteger(audio.sampleRate) || audio.sampleRate < 8000 || audio.sampleRate > 48000) throw new Error('Invalid local audio');
  const buffer = Buffer.alloc(44 + audio.samples.length * 2);
  buffer.write('RIFF', 0); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22); buffer.writeUInt32LE(audio.sampleRate, 24); buffer.writeUInt32LE(audio.sampleRate * 2, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34); buffer.write('data', 36); buffer.writeUInt32LE(buffer.length - 44, 40);
  for (let i = 0; i < audio.samples.length; i++) buffer.writeInt16LE(Math.round(Math.max(-1, Math.min(1, Number.isFinite(audio.samples[i]) ? audio.samples[i] : 0)) * 32767), 44 + i * 2);
  await writeFile(output, buffer, { flag: 'wx', mode: 0o600 });
}

if (process.send) process.once('message', async task => {
  try { await generateLocalSpeech(task); process.send({ ok: true }, () => process.exit(0)); }
  catch { process.send({ ok: false }, () => process.exit(1)); }
});
