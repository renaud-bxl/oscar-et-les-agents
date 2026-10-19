import { LocalVoice } from './local-voice.mjs';
import { PocketVoice } from './pocket-voice.mjs';

const languages = new Set(['fr', 'en', 'nl']);
const previews = new Map([
  ['studio-oscar', 'oscar'], ['studio-zoe', 'zoe'],
  ['studio-oscar-2', 'oscar-2'], ['studio-zoe-2', 'zoe-2'],
]);
const invalid = message => Object.assign(new Error(message), { code: 'VOICE_INVALID' });

// Old lightweight voices remain available to people who selected them. The
// conversational pair uses its own runtime and never shares model identities.
export class VoiceService {
  constructor({ piper, studio, ...options } = {}) {
    this.piper = piper || new LocalVoice(options);
    this.studio = studio || new PocketVoice(options);
  }
  async state() {
    const [studio, piper] = await Promise.all([this.studio.state(), this.piper.state()]);
    const installing = [studio, piper].find(value => value.status === 'installing');
    const available = studio.available || piper.available;
    const failed = [studio, piper].find(value => value.status === 'failed');
    return {
      provider: 'oscar-local-voices',
      status: installing ? 'installing' : available ? 'ready' : failed ? 'failed' : studio.status,
      available: Boolean(available),
      message: installing?.message || failed?.message || studio.message,
      progress: installing?.progress || null,
      installationError: studio.installationError || null,
      voices: [
        ...(studio.voices || []).map(voice => ({ ...voice, recommended: true, quality: 'conversational', runtimeDownloadMB: voice.runtimeDownloadMB ?? studio.runtimeDownloadMB,
          previewUrls: previews.has(voice.id) ? Object.fromEntries([...languages].map(language => [language, `/voice-preview-${previews.get(voice.id)}-${language}.wav`])) : {},
        })),
        ...(piper.voices || []).map(voice => ({ ...voice, recommended: false, quality: 'lightweight', runtimeDownloadMB: voice.runtimeDownloadMB ?? piper.runtimeDownloadMB })),
      ],
      runtimeDownloadMB: studio.runtimeDownloadMB,
      localOnly: true,
      requiresConfirmation: true,
      languages: ['fr', 'en', 'nl'],
      speakers: ['oscar', 'zoe'],
      cacheMaxMB: (studio.cacheMaxMB || 0) + (piper.cacheMaxMB || 0),
      documentationUrl: studio.documentationUrl,
      licenseNotice: [studio.licenseNotice, piper.licenseNotice].filter(Boolean).join('\n'),
    };
  }
  async install(body = {}) {
    if (body.confirmed !== true || Object.keys(body).some(key => !['voiceId', 'confirmed'].includes(key))) throw invalid('Confirmez le téléchargement volontaire de cette voix avant de continuer.');
    if (typeof body.voiceId !== 'string') throw invalid('Choisissez une voix proposée par le bureau.');
    const state = await this.state();
    if (!state.voices.some(voice => voice.id === body.voiceId)) throw invalid('Choisissez une voix proposée par le bureau.');
    if (state.status === 'installing') throw invalid('Une installation vocale est déjà en cours.');
    await (body.voiceId.startsWith('studio-') ? this.studio : this.piper).install(body);
    return this.state();
  }
  async speak(body = {}, options = {}) {
    if (Object.keys(body).some(key => !['text', 'voiceId', 'speed', 'language'].includes(key)) || typeof body.voiceId !== 'string') throw invalid('Les options vocales sont invalides.');
    if (body.language !== undefined && !languages.has(body.language)) throw invalid('Cette langue vocale n’est pas proposée par le bureau.');
    if (body.voiceId.startsWith('studio-')) return this.studio.speak(body, options);
    const voice = this.piper.voice(body.voiceId);
    if (body.language !== undefined && body.language !== voice.lang) throw invalid('Cette voix légère ne correspond pas à la langue du bureau. Choisissez une voix multilingue.');
    const { language, ...legacy } = body;
    return this.piper.speak(legacy);
  }
  async audio(key) {
    if (!/^[a-f0-9]{64}$/.test(key)) throw invalid('Son introuvable.');
    try { return await this.studio.audio(key); }
    catch { return this.piper.audio(key); }
  }
  async close() { await Promise.allSettled([this.studio.close(), this.piper.close()]); }
}
