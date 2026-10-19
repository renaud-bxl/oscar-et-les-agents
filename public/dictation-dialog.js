import { getLocale } from './i18n.js';

const MESSAGES = [
  ['PARLEZ, OSCAR PREND NOTE', 'SPEAK, OSCAR IS TAKING NOTES', 'SPREEK, OSCAR NOTEERT'],
  ['Confiez votre idée à voix haute', 'Describe your idea out loud', 'Vertel je idee hardop'],
  ['Fermer la dictée', 'Close dictation', 'Dicteren sluiten'],
  ['Votre voix reste sur cet ordinateur. Relisez le texte avant de le transmettre à Oscar ou Zoé.', 'Your voice stays on this computer. Review the text before passing it to Oscar or Zoé.', 'Je stem blijft op deze computer. Lees de tekst na voordat je hem aan Oscar of Zoé doorgeeft.'],
  ['Langue parlée', 'Spoken language', 'Gesproken taal'],
  ['Français', 'French', 'Frans'], ['Anglais', 'English', 'Engels'], ['Néerlandais', 'Dutch', 'Nederlands'],
  ['Enregistrer mon idée', 'Record my idea', 'Mijn idee opnemen'], ['Arrêter l’enregistrement', 'Stop recording', 'Opname stoppen'],
  ['Annuler l’enregistrement', 'Discard recording', 'Opname verwijderen'], ['Transcrire sur cet ordinateur', 'Transcribe on this computer', 'Op deze computer uitschrijven'],
  ['Annuler la transcription', 'Cancel transcription', 'Uitschrijven annuleren'],
  ['Réécouter mon enregistrement', 'Listen to my recording', 'Mijn opname beluisteren'],
  ['Texte à relire et à corriger', 'Text to review and edit', 'Tekst om na te lezen en te bewerken'],
  ['Vous pouvez aussi saisir votre demande ici.', 'You can also type your request here.', 'Je kunt je verzoek ook hier typen.'],
  ['Utiliser ce texte', 'Use this text', 'Deze tekst gebruiken'], ['Retour au clavier', 'Back to typing', 'Terug naar typen'],
  ['Ce bouton insère le texte dans votre demande. La mission démarre seulement quand vous l’envoyez.', 'This button inserts the text into your request. The mission only starts when you send it.', 'Deze knop voegt de tekst in je verzoek in. De missie begint pas wanneer je het verstuurt.'],
  ['La dictée locale demande un téléchargement volontaire.', 'Local dictation requires an optional download.', 'Voor lokaal dicteren is een vrijwillige download nodig.'],
  ['Préparer la dictée locale', 'Set up local dictation', 'Lokaal dicteren instellen'], ['Télécharger le moteur de dictée ?', 'Download the dictation engine?', 'De dicteermotor downloaden?'],
  ['Whisper small multilingue · français, anglais, néerlandais. Aucune clé API. Aucun abonnement vocal supplémentaire.', 'Multilingual Whisper small · French, English, Dutch. No API key. No extra voice subscription.', 'Meertalige Whisper small · Frans, Engels, Nederlands. Geen API-sleutel. Geen extra spraakabonnement.'],
  ['Modèle', 'Model', 'Model'], ['Programme local', 'Local runtime', 'Lokaal programma'], ['Espace à prévoir', 'Disk space to allow', 'Benodigde schijfruimte'], ['Mo', 'MB', 'MB'],
  ['Les téléchargements proviennent des sources officielles. Le moteur sera vérifié avant son utilisation.', 'Downloads come from official sources. The engine will be checked before use.', 'Downloads komen van officiële bronnen. De motor wordt vóór gebruik gecontroleerd.'],
  ['Confirmer le téléchargement', 'Confirm download', 'Download bevestigen'], ['Annuler', 'Cancel', 'Annuleren'],
  ['Sources et licences ↗', 'Sources and licences ↗', 'Bronnen en licenties ↗'],
  ['Chargement de la dictée…', 'Loading dictation…', 'Dicteren wordt geladen…'], ['Préparation du programme local…', 'Setting up the local runtime…', 'Lokaal programma voorbereiden…'],
  ['Téléchargement du modèle…', 'Downloading the model…', 'Model downloaden…'], ['Vérification du moteur…', 'Checking the engine…', 'Motor controleren…'],
  ['Dictée prête. Cliquez pour autoriser le micro.', 'Dictation is ready. Click to allow the microphone.', 'Dicteren is klaar. Klik om de microfoon toe te staan.'],
  ['Le moteur local n’est pas installé. Vous pouvez écrire votre demande ci-dessous.', 'The local engine is not installed. You can type your request below.', 'De lokale motor is niet geïnstalleerd. Je kunt je verzoek hieronder typen.'],
  ['La dictée locale demande Python 3.10 à 3.13 sur macOS 13 ou Linux. La saisie au clavier reste disponible.', 'Local dictation requires Python 3.10–3.13 on macOS 13 or Linux. You can still type.', 'Lokaal dicteren vereist Python 3.10–3.13 op macOS 13 of Linux. Typen blijft mogelijk.'],
  ['Ce navigateur ne permet pas l’enregistrement du micro. Vous pouvez saisir votre demande ci-dessous.', 'This browser cannot record the microphone. You can type your request below.', 'Deze browser kan de microfoon niet opnemen. Je kunt je verzoek hieronder typen.'],
  ['Autorisez le micro dans la demande du navigateur…', 'Allow the microphone in your browser’s prompt…', 'Sta de microfoon toe in de vraag van je browser…'],
  ['Enregistrement en cours', 'Recording', 'Opname bezig'], ['secondes', 'seconds', 'seconden'],
  ['Enregistrement prêt. Vous pouvez le réécouter avant de le transcrire.', 'Recording ready. You can listen before transcribing it.', 'Opname klaar. Je kunt luisteren voordat je ze laat uitschrijven.'],
  ['Transcription locale en cours… Vous pouvez l’annuler.', 'Transcribing locally… You can cancel.', 'Lokaal uitschrijven… Je kunt annuleren.'],
  ['Transcription prête. Relisez et corrigez le texte avant de l’utiliser.', 'Transcription ready. Review and edit the text before using it.', 'Tekst klaar. Lees en bewerk de tekst voordat je hem gebruikt.'],
  ['Enregistrement effacé. Le micro est fermé.', 'Recording deleted. The microphone is off.', 'Opname verwijderd. De microfoon staat uit.'],
  ['Transcription annulée. Votre texte est conservé.', 'Transcription cancelled. Your text is kept.', 'Uitschrijven geannuleerd. Je tekst blijft bewaard.'],
  ['Le micro a été refusé. Autorisez-le dans les réglages du navigateur ou utilisez le clavier.', 'Microphone access was denied. Allow it in your browser settings or use the keyboard.', 'Toegang tot de microfoon is geweigerd. Sta dit toe in je browserinstellingen of gebruik het toetsenbord.'],
  ['Aucun micro disponible. Branchez-en un ou utilisez le clavier.', 'No microphone is available. Connect one or use the keyboard.', 'Er is geen microfoon beschikbaar. Sluit er een aan of gebruik het toetsenbord.'],
  ['Le micro n’a pas pu démarrer. Vérifiez qu’une autre application ne l’utilise pas.', 'The microphone could not start. Check whether another application is using it.', 'De microfoon kon niet starten. Controleer of een andere app hem gebruikt.'],
  ['L’enregistrement est trop volumineux. Essayez un message plus court.', 'The recording is too large. Try a shorter message.', 'De opname is te groot. Probeer een korter bericht.'],
  ['Aucune parole claire détectée. Rapprochez-vous du micro ou saisissez votre demande.', 'No clear speech detected. Move closer to the microphone or type your request.', 'Geen duidelijke spraak herkend. Kom dichter bij de microfoon of typ je verzoek.'],
  ['La transcription prend trop de temps. Essayez un message plus court.', 'Transcription is taking too long. Try a shorter message.', 'Uitschrijven duurt te lang. Probeer een korter bericht.'],
  ['Une autre dictée est déjà en cours. Réessayez dans un instant.', 'Another dictation is already running. Try again shortly.', 'Er is al een andere dictaatopdracht bezig. Probeer het zo nog eens.'],
  ['La dictée n’a pas pu être transcrite. Réessayez avec un enregistrement plus court et audible.', 'The recording could not be transcribed. Try a shorter, clearer recording.', 'De opname kon niet worden uitgeschreven. Probeer een kortere, duidelijkere opname.'],
  ['Le moteur de dictée n’a pas pu être installé et vérifié. Vérifiez Python, la connexion et l’espace disponible, puis réessayez.', 'The dictation engine could not be installed and checked. Check Python, the connection and available space, then try again.', 'De dicteermotor kon niet worden geïnstalleerd en gecontroleerd. Controleer Python, de verbinding en de beschikbare ruimte en probeer het opnieuw.'],
  ['Le service de dictée n’est pas disponible pour le moment. Votre texte est conservé.', 'Dictation is currently unavailable. Your text is kept.', 'Dicteren is momenteel niet beschikbaar. Je tekst blijft bewaard.'],
  ['Le texte n’a pas pu être inséré. Copiez-le ou réessayez : il est conservé ici.', 'The text could not be inserted. Copy it or try again: it is kept here.', 'De tekst kon niet worden ingevoegd. Kopieer hem of probeer het opnieuw: hij blijft hier bewaard.'],
  ['Le texte dépasse 16 000 caractères. Raccourcissez votre saisie avant d’ajouter la dictée.', 'The text exceeds 16,000 characters. Shorten your input before adding the dictation.', 'De tekst bevat meer dan 16.000 tekens. Verkort je tekst voordat je het dictaat toevoegt.'],
];
const messages = new Map(MESSAGES.map(([fr, en, nl]) => [fr, { en, nl }]));
export const dictationText = (source, locale = getLocale()) => messages.get(source)?.[locale] || source;
const t = source => dictationText(source);
const node = (tag, cls, text) => { const item = document.createElement(tag); if (cls) item.className = cls; if (text !== undefined) item.textContent = text; return item; };
const json = async (url, options = {}) => { const response = await fetch(url, { credentials: 'same-origin', ...options }); const data = await response.json(); if (!response.ok) throw Object.assign(new Error(data.error || 'Le service de dictée n’est pas disponible pour le moment. Votre texte est conservé.'), { code: data.code }); return data; };
export function recorderMimeType(Recorder = globalThis.MediaRecorder) { return ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4'].find(type => Recorder?.isTypeSupported?.(type)) || ''; }
export function microphoneError(error) { return error?.name === 'NotAllowedError' || error?.name === 'SecurityError' ? 'Le micro a été refusé. Autorisez-le dans les réglages du navigateur ou utilisez le clavier.' : error?.name === 'NotFoundError' ? 'Aucun micro disponible. Branchez-en un ou utilisez le clavier.' : 'Le micro n’a pas pu démarrer. Vérifiez qu’une autre application ne l’utilise pas.'; }
const base64 = blob => new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1] || ''); reader.onerror = reject; reader.readAsDataURL(blob); });

export class DictationDialog {
  constructor({ request = json, onText = () => {}, onClose = () => {}, onRecord = () => {}, host = globalThis } = {}) {
    Object.assign(this, { request, onText, onClose, onRecord, host }); this.epoch = 0; this.labels = [];
    this.dialog = node('dialog', 'dictation-dialog'); this.dialog.id = 'dictation-dialog'; this.dialog.setAttribute('data-no-translate', ''); this.dialog.setAttribute('aria-labelledby', 'dictation-title');
    this.dialog.addEventListener('close', () => { if (!this.dialog.open) this.closed(); }); this.dialog.addEventListener('cancel', event => { event.preventDefault(); this.close(); }); document.body.append(this.dialog);
    this.build(); this.languageChanged = () => this.localize(); document.addEventListener('oscar:language', this.languageChanged);
  }
  text(tag, cls, source) { const item = node(tag, cls, t(source)); this.labels.push({ item, source }); return item; }
  button(source, cls, action) { const item = this.text('button', cls, source); item.type = 'button'; item.addEventListener('click', action); return item; }
  build() {
    const header = node('header', 'dictation-header'), copy = node('div'); copy.append(this.text('span', 'dictation-eyebrow', 'PARLEZ, OSCAR PREND NOTE'));
    const title = this.text('h2', '', 'Confiez votre idée à voix haute'); title.id = 'dictation-title'; title.tabIndex = -1; copy.append(title, this.text('p', '', 'Votre voix reste sur cet ordinateur. Relisez le texte avant de le transmettre à Oscar ou Zoé.'));
    const close = this.button('×', 'dictation-close', () => this.close()); close.setAttribute('aria-label', t('Fermer la dictée')); this.closeButton = close; header.append(copy, close);
    const body = node('div', 'dictation-body'); this.status = node('p', 'dictation-status'); this.status.setAttribute('role', 'status'); this.status.setAttribute('aria-live', 'polite');
    const language = node('label', 'dictation-field'); language.append(this.text('span', '', 'Langue parlée')); this.language = node('select'); this.language.id = 'dictation-language';
    for (const [value, label] of [['fr', 'Français'], ['en', 'Anglais'], ['nl', 'Néerlandais']]) { const option = this.text('option', '', label); option.value = value; this.language.append(option); } language.append(this.language);
    this.controls = node('div', 'dictation-controls'); this.record = this.button('Enregistrer mon idée', 'dictation-primary', () => this.startRecording()); this.stop = this.button('Arrêter l’enregistrement', 'dictation-stop', () => this.stopRecording()); this.discard = this.button('Annuler l’enregistrement', 'dictation-secondary', () => this.discardRecording()); this.transcribeButton = this.button('Transcrire sur cet ordinateur', 'dictation-primary', () => this.transcribe()); this.cancelTranscription = this.button('Annuler la transcription', 'dictation-secondary', () => this.cancel()); this.controls.append(this.record, this.stop, this.discard, this.transcribeButton, this.cancelTranscription);
    this.audio = node('audio', 'dictation-audio'); this.audio.controls = true; this.audio.preload = 'none'; this.audio.setAttribute('aria-label', t('Réécouter mon enregistrement')); this.audio.hidden = true;
    const edit = node('label', 'dictation-field'); edit.append(this.text('span', '', 'Texte à relire et à corriger')); this.transcript = node('textarea'); this.transcript.id = 'dictation-transcript'; this.transcript.rows = 6; this.transcript.maxLength = 16000; this.transcript.placeholder = t('Vous pouvez aussi saisir votre demande ici.'); this.transcript.addEventListener('input', () => this.updateControls()); edit.append(this.transcript);
    this.installSection = node('section', 'dictation-install'); this.installSection.append(this.text('h3', '', 'La dictée locale demande un téléchargement volontaire.')); this.installButton = this.button('Préparer la dictée locale', 'dictation-secondary', () => { this.confirm.hidden = false; this.confirm.querySelector('button')?.focus(); }); this.installSection.append(this.installButton);
    this.confirm = node('section', 'dictation-confirm'); this.confirm.hidden = true; this.confirm.append(this.text('h3', '', 'Télécharger le moteur de dictée ?'), this.text('p', '', 'Whisper small multilingue · français, anglais, néerlandais. Aucune clé API. Aucun abonnement vocal supplémentaire.')); this.sizes = node('p', 'dictation-sizes'); this.confirm.append(this.sizes, this.text('p', '', 'Les téléchargements proviennent des sources officielles. Le moteur sera vérifié avant son utilisation.'));
    const installActions = node('div', 'dictation-controls'); installActions.append(this.button('Confirmer le téléchargement', 'dictation-primary', () => this.install()), this.button('Annuler', 'dictation-secondary', () => { this.confirm.hidden = true; this.installButton.focus(); })); this.confirm.append(installActions);
    this.progress = node('progress', 'dictation-progress'); this.progress.max = 100; this.progress.hidden = true;
    this.source = this.text('a', 'dictation-source', 'Sources et licences ↗'); this.source.href = 'https://github.com/SYSTRAN/faster-whisper'; this.source.target = '_blank'; this.source.rel = 'noopener noreferrer';
    this.error = node('p', 'dictation-error'); this.error.setAttribute('role', 'alert'); this.error.hidden = true; body.append(this.status, language, this.controls, this.audio, edit, this.text('p', 'dictation-hint', 'Ce bouton insère le texte dans votre demande. La mission démarre seulement quand vous l’envoyez.'), this.installSection, this.confirm, this.progress, this.source, this.error);
    const footer = node('footer', 'dictation-footer'); this.use = this.button('Utiliser ce texte', 'dictation-primary', () => this.useText()); footer.append(this.button('Retour au clavier', 'dictation-secondary', () => this.close()), this.use); this.dialog.append(header, body, footer); this.localize(); this.updateControls();
  }
  localize() {
    for (const { item, source } of this.labels) item.textContent = t(source);
    this.closeButton.setAttribute('aria-label', t('Fermer la dictée')); this.audio.setAttribute('aria-label', t('Réécouter mon enregistrement')); this.transcript.placeholder = t('Vous pouvez aussi saisir votre demande ici.');
    if (this.statusSource) this.setStatus(this.statusSource); if (this.errorSource) this.showError(this.errorSource); this.updateSizes();
  }
  setStatus(source) { this.statusSource = source; this.status.textContent = t(source); }
  showError(source) { this.errorSource = source; this.error.textContent = t(source); this.error.hidden = !source; }
  supported() { return Boolean(this.host.navigator?.mediaDevices?.getUserMedia && this.host.MediaRecorder); }
  updateSizes() { const data = this.data || {}; this.sizes.textContent = `${t('Modèle')} : ${data.downloadMB || 487} ${t('Mo')} · ${t('Programme local')} : ≈ ${data.runtimeDownloadMB || 180} ${t('Mo')} · ${t('Espace à prévoir')} : ≈ ${data.diskMB || 1100} ${t('Mo')}`; }
  updateControls() {
    const recording = Boolean(this.recorder && this.recorder.state !== 'inactive'), processing = Boolean(this.controller), requesting = Boolean(this.requestingMicrophone);
    this.record.hidden = recording; this.record.disabled = processing || requesting || !this.data?.available || !this.supported(); this.stop.hidden = !recording; this.stop.disabled = requesting; this.discard.hidden = !recording && !this.blob; this.discard.disabled = processing; this.transcribeButton.hidden = !this.blob || processing || recording; this.transcribeButton.disabled = !this.data?.available; this.cancelTranscription.hidden = !processing; this.language.disabled = recording || processing || requesting; this.transcript.disabled = processing; this.use.disabled = this.using || processing || recording || requesting || !this.transcript.value.trim(); this.installButton.disabled = this.installing || this.data?.status === 'installing' || this.data?.supported === false; this.installSection.hidden = this.data?.available === true; this.progress.hidden = this.data?.status !== 'installing';
    const percent = this.data?.progress?.percent; if (Number.isFinite(percent)) this.progress.value = percent; else this.progress.removeAttribute('value');
  }
  async refresh() {
    const epoch = this.epoch;
    try { const data = await this.request('/api/dictation'); if (this.destroyed || epoch !== this.epoch || !this.dialog.open) return; this.data = data; this.updateSizes(); this.updateControls(); if (data.status === 'installing') this.setStatus(({ runtime: 'Préparation du programme local…', download: 'Téléchargement du modèle…', verify: 'Vérification du moteur…' })[data.progress?.phase] || 'Préparation du programme local…'); else if (!this.recorder && !this.blob && !this.controller) this.setStatus(data.available ? this.supported() ? 'Dictée prête. Cliquez pour autoriser le micro.' : 'Ce navigateur ne permet pas l’enregistrement du micro. Vous pouvez saisir votre demande ci-dessous.' : data.status === 'unsupported' ? 'La dictée locale demande Python 3.10 à 3.13 sur macOS 13 ou Linux. La saisie au clavier reste disponible.' : 'Le moteur local n’est pas installé. Vous pouvez écrire votre demande ci-dessous.'); if (data.status === 'failed') this.showError('Le moteur de dictée n’a pas pu être installé et vérifié. Vérifiez Python, la connexion et l’espace disponible, puis réessayez.'); this.poll(); }
    catch { if (epoch === this.epoch) this.showError('Le service de dictée n’est pas disponible pour le moment. Votre texte est conservé.'); }
  }
  poll() { clearTimeout(this.pollTimer); if (this.dialog.open && this.data?.status === 'installing') this.pollTimer = setTimeout(() => this.refresh(), 2000); }
  async install() { if (this.installing) return; this.installing = true; this.confirm.hidden = true; this.showError(''); this.updateControls(); try { await this.request('/api/dictation/install', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Oscar-Client': '1' }, body: '{"confirmed":true}' }); await this.refresh(); } catch { this.showError('Le moteur de dictée n’a pas pu être installé et vérifié. Vérifiez Python, la connexion et l’espace disponible, puis réessayez.'); } finally { this.installing = false; this.updateControls(); } }
  releaseStream(stream = this.stream) { for (const track of stream?.getTracks?.() || []) try { track.stop(); } catch { /* A disconnected microphone may already be stopped. */ } if (stream === this.stream) this.stream = null; }
  releaseAudio() { try { this.audio.pause(); this.audio.removeAttribute('src'); this.audio.load(); } catch { /* Unsupported audio controls. */ } this.audio.hidden = true; if (this.audioUrl) this.host.URL.revokeObjectURL(this.audioUrl); this.audioUrl = null; this.blob = null; }
  async startRecording() {
    if (!this.data?.available || !this.supported() || this.requestingMicrophone || this.recorder && this.recorder.state !== 'inactive' || this.controller) return;
    const epoch = this.epoch; this.showError(''); this.releaseAudio(); this.requestingMicrophone = true; this.discarded = false; this.chunks = []; this.recordedBytes = 0; this.setStatus('Autorisez le micro dans la demande du navigateur…'); this.updateControls();
    try {
      const stream = await this.host.navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
      if (epoch !== this.epoch || !this.dialog.open) { this.releaseStream(stream); return; } this.stream = stream; this.onRecord();
      const type = recorderMimeType(this.host.MediaRecorder), recorder = new this.host.MediaRecorder(stream, type ? { mimeType: type, audioBitsPerSecond: 64000 } : undefined); this.recorder = recorder; let recordTimer;
      recorder.addEventListener('dataavailable', event => { if (epoch !== this.epoch || this.recorder !== recorder || this.discarded || !event.data?.size) return; this.recordedBytes += event.data.size; if (this.recordedBytes > (this.data?.maxAudioBytes || 8388608)) { this.discarded = true; this.showError('L’enregistrement est trop volumineux. Essayez un message plus court.'); this.stopRecording(); } else this.chunks.push(event.data); });
      recorder.addEventListener('error', () => { if (epoch !== this.epoch || this.recorder !== recorder) return; this.discarded = true; this.showError('Le micro n’a pas pu démarrer. Vérifiez qu’une autre application ne l’utilise pas.'); this.stopRecording(); });
      recorder.addEventListener('stop', () => {
        clearInterval(recordTimer); this.releaseStream(stream); if (epoch !== this.epoch || !this.dialog.open || this.recorder !== recorder) return; this.recorder = null;
        if (!this.discarded && this.chunks.length) { this.blob = new Blob(this.chunks, { type: recorder.mimeType || type || 'audio/webm' }); this.audioUrl = this.host.URL.createObjectURL(this.blob); this.audio.src = this.audioUrl; this.audio.hidden = false; this.setStatus('Enregistrement prêt. Vous pouvez le réécouter avant de le transcrire.'); } this.chunks = []; this.updateControls();
      }, { once: true });
      recorder.start(250); this.recordingStarted = Date.now(); this.setStatus('Enregistrement en cours'); recordTimer = this.recordTimer = setInterval(() => { if (epoch !== this.epoch || this.recorder !== recorder) { clearInterval(recordTimer); return; } const elapsed = Date.now() - this.recordingStarted, limit = Math.min(this.data?.maxSeconds || 90, 90); this.status.textContent = `${t('Enregistrement en cours')} · ${Math.floor(elapsed / 1000)} / ${limit} ${t('secondes')}`; if (elapsed >= limit * 1000 - 500) this.stopRecording(); }, 250);
    } catch (error) { if (epoch === this.epoch) { this.releaseStream(); this.recorder = null; this.showError(microphoneError(error)); } }
    finally { if (epoch === this.epoch) { this.requestingMicrophone = false; this.updateControls(); } }
  }
  stopRecording() { clearInterval(this.recordTimer); if (this.recorder && this.recorder.state !== 'inactive') try { this.recorder.stop(); } catch { this.recorder = null; } this.releaseStream(); this.updateControls(); }
  discardRecording() { this.discarded = true; this.stopRecording(); this.releaseAudio(); this.chunks = []; this.setStatus('Enregistrement effacé. Le micro est fermé.'); this.updateControls(); }
  async transcribe() {
    if (!this.blob || this.controller || !this.data?.available) return; const epoch = this.epoch, previousText = this.transcript.value.trim(); this.controller = new AbortController(); const controller = this.controller; this.showError(''); this.setStatus('Transcription locale en cours… Vous pouvez l’annuler.'); this.audio.pause(); this.updateControls();
    try {
      const audio = await base64(this.blob); if (controller.signal.aborted || epoch !== this.epoch) return;
      const result = await this.request('/api/dictation/transcribe', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Oscar-Client': '1' }, body: JSON.stringify({ audio, mimeType: this.blob.type || 'audio/webm', language: this.language.value }), signal: controller.signal });
      if (controller.signal.aborted || epoch !== this.epoch || !this.dialog.open) return; if (typeof result.text !== 'string' || !result.text.trim() || result.text.length > 16000) throw Object.assign(new Error(), { code: 'DICTATION_NO_SPEECH' });
      const combined = [previousText, result.text.trim()].filter(Boolean).join('\n\n'); if (combined.length > 16000) throw Object.assign(new Error(), { code: 'DICTATION_TEXT_LIMIT' });
      this.transcript.value = combined; this.setStatus('Transcription prête. Relisez et corrigez le texte avant de l’utiliser.'); this.releaseAudio();
    } catch (error) { if (epoch === this.epoch && !controller.signal.aborted) this.showError(({ DICTATION_NO_SPEECH: 'Aucune parole claire détectée. Rapprochez-vous du micro ou saisissez votre demande.', DICTATION_BUSY: 'Une autre dictée est déjà en cours. Réessayez dans un instant.', DICTATION_TIMEOUT: 'La transcription prend trop de temps. Essayez un message plus court.', DICTATION_TEXT_LIMIT: 'Le texte dépasse 16 000 caractères. Raccourcissez votre saisie avant d’ajouter la dictée.' })[error.code] || 'La dictée n’a pas pu être transcrite. Réessayez avec un enregistrement plus court et audible.'); }
    finally { if (this.controller === controller) this.controller = null; if (epoch === this.epoch) { this.updateControls(); if (!controller.signal.aborted) this.transcript.focus(); } }
  }
  cancel() { this.controller?.abort(); this.controller = null; this.setStatus('Transcription annulée. Votre texte est conservé.'); this.updateControls(); }
  async useText() { if (this.use.disabled || this.using) return; const text = this.transcript.value.trim(); if (!text) return; this.using = true; this.updateControls(); try { await (this.targetOnText || this.onText)(text); this.close(); } catch { this.showError('Le texte n’a pas pu être inséré. Copiez-le ou réessayez : il est conservé ici.'); } finally { this.using = false; this.updateControls(); } }
  async open({ onText, initialText = '' } = {}) { if (this.destroyed || this.dialog.open) return; this.returnFocus = document.activeElement; this.notified = false; this.epoch++; this.targetOnText = typeof onText === 'function' ? onText : null; this.language.value = getLocale(); this.transcript.value = typeof initialText === 'string' ? initialText.slice(0, 16000) : ''; this.showError(''); this.setStatus('Chargement de la dictée…'); this.dialog.showModal(); this.updateControls(); this.dialog.querySelector('h2').focus({ preventScroll: true }); await this.refresh(); }
  closed() { if (this.notified) return; this.notified = true; this.epoch++; clearTimeout(this.pollTimer); this.discarded = true; this.stopRecording(); this.releaseStream(); this.releaseAudio(); this.controller?.abort(); this.controller = null; this.requestingMicrophone = false; this.chunks = []; this.recorder = null; this.confirm.hidden = true; this.targetOnText = null; if (this.returnFocus?.isConnected) this.returnFocus.focus({ preventScroll: true }); if (!this.destroyed) this.onClose(); }
  close() { if (this.dialog.open) { this.dialog.close(); this.closed(); } }
  destroy() { this.destroyed = true; this.close(); clearTimeout(this.pollTimer); document.removeEventListener('oscar:language', this.languageChanged); this.dialog.remove(); }
}
