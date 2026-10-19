import { getLocale } from './i18n.js';

const MESSAGES = [
  ['UN BUREAU À VOTRE IMAGE', 'AN OFFICE THAT FEELS LIKE YOU', 'EEN BUREAU DAT BIJ JE PAST'],
  ['Comment vous accueillir ?', 'How should we welcome you?', 'Hoe mogen we je verwelkomen?'],
  ['Oscar et Zoé peuvent utiliser votre prénom et les prévisions de votre région.', 'Oscar and Zoé can use your first name and the forecast for your area.', 'Oscar en Zoé kunnen je voornaam en de weersverwachting voor je regio gebruiken.'],
  ['Fermer la personnalisation', 'Close personalisation', 'Personalisatie sluiten'],
  ['Votre prénom', 'Your first name', 'Je voornaam'], ['Prénom facultatif', 'Optional first name', 'Voornaam, niet verplicht'],
  ['Votre ville ou région', 'Your city or area', 'Je stad of regio'], ['Ex. : Bruxelles, Namur, Amsterdam', 'E.g. Brussels, Namur, Amsterdam', 'Bijv. Brussel, Namen, Amsterdam'],
  ['Rechercher une ville', 'Find a city', 'Een stad zoeken'], ['Recherche locale, sans transmettre votre saisie à un service.', 'Local search: your search text is not sent to an outside service.', 'Lokaal zoeken: je zoektekst wordt niet naar een externe dienst gestuurd.'],
  ['Villes proposées', 'Suggested cities', 'Voorgestelde steden'], ['Aucune ville trouvée. Essayez une ville proche ou choisissez votre position.', 'No city found. Try a nearby city or choose your location.', 'Geen stad gevonden. Probeer een stad in de buurt of kies je locatie.'],
  ['Choisissez une ville dans les résultats.', 'Choose a city from the results.', 'Kies een stad uit de resultaten.'],
  ['Utiliser ma position approximative', 'Use my approximate location', 'Mijn geschatte locatie gebruiken'],
  ['Le navigateur vous demandera votre accord. La position est arrondie à environ un kilomètre avant enregistrement.', 'Your browser will ask for permission. The location is rounded to roughly one kilometre before it is saved.', 'Je browser vraagt om toestemming. De locatie wordt vóór het opslaan afgerond op ongeveer één kilometer.'],
  ['Ma position approximative', 'My approximate location', 'Mijn geschatte locatie'], ['Position sélectionnée', 'Location selected', 'Locatie geselecteerd'],
  ['Recherche de votre position…', 'Finding your location…', 'Je locatie wordt gezocht…'],
  ['La position n’a pas été obtenue. Vous pouvez rechercher votre ville manuellement.', 'Your location could not be obtained. You can search for your city manually.', 'Je locatie kon niet worden bepaald. Je kunt je stad handmatig zoeken.'],
  ['La géolocalisation n’est pas disponible dans ce navigateur. Recherchez votre ville.', 'Geolocation is not available in this browser. Search for your city instead.', 'Locatiebepaling is niet beschikbaar in deze browser. Zoek je stad op.'],
  ['Autoriser les prévisions météo pour cette région', 'Allow weather forecasts for this area', 'Weersverwachtingen voor deze regio toestaan'],
  ['Après enregistrement, MET Norway reçoit votre position approximative et l’adresse réseau de cet ordinateur pour fournir les prévisions. Votre prénom n’est pas transmis. Aucune recherche par adresse réseau.', 'After saving, MET Norway receives your approximate location and this computer’s network address to provide forecasts. Your first name is not sent. No location lookup by network address.', 'Na het opslaan ontvangt MET Norway je geschatte locatie en het netwerkadres van deze computer om verwachtingen te leveren. Je voornaam wordt niet verstuurd. Geen locatiebepaling via het netwerkadres.'],
  ['Prévisions météo', 'Weather forecast', 'Weersverwachting'], ['Actualiser les prévisions', 'Refresh forecast', 'Verwachting vernieuwen'],
  ['La météo est désactivée. Aucune position n’est transmise au service météo.', 'Weather is off. No location is sent to the weather service.', 'Het weer staat uit. Er wordt geen locatie naar de weerdienst gestuurd.'],
  ['Enregistrez vos choix pour obtenir une prévision.', 'Save your choices to get a forecast.', 'Sla je keuzes op om een verwachting op te halen.'],
  ['Prévision indisponible pour le moment. Oscar et Zoé n’inventeront pas la météo.', 'The forecast is currently unavailable. Oscar and Zoé will not invent the weather.', 'De verwachting is momenteel niet beschikbaar. Oscar en Zoé zullen geen weer verzinnen.'],
  ['Cette prévision est ancienne et n’est pas utilisée dans les nouvelles répliques.', 'This forecast is old and is not used in new lines.', 'Deze verwachting is oud en wordt niet in nieuwe uitspraken gebruikt.'],
  ['Prévision pour', 'Forecast for', 'Verwachting voor'], ['Récupérée le', 'Retrieved on', 'Opgehaald op'],
  ['Sources : villes GeoNames, prévisions MET Norway. Données CC BY 4.0, résumées et coordonnées arrondies.', 'Sources: GeoNames cities, MET Norway forecasts. CC BY 4.0 data, summarised with rounded coordinates.', 'Bronnen: steden van GeoNames, verwachtingen van MET Norway. CC BY 4.0-gegevens, samengevat met afgeronde coördinaten.'],
  ['Votre profil reste dans les données locales du bureau. Vous pouvez effacer les champs et désactiver la météo.', 'Your profile stays in the office’s local data. You can clear the fields and turn weather off.', 'Je profiel blijft in de lokale gegevens van het bureau. Je kunt de velden wissen en het weer uitschakelen.'],
  ['Enregistrer', 'Save', 'Opslaan'], ['Enregistrement…', 'Saving…', 'Opslaan…'], ['Personnalisation enregistrée.', 'Personalisation saved.', 'Personalisatie opgeslagen.'],
  ['Chargement du profil…', 'Loading profile…', 'Profiel laden…'], ['Recherche des villes…', 'Finding cities…', 'Steden zoeken…'], ['Prévisions en cours de récupération…', 'Retrieving forecast…', 'Verwachting ophalen…'],
  ['Le profil n’a pas pu être chargé. Vos saisies sont conservées.', 'The profile could not be loaded. Your input is kept.', 'Het profiel kon niet worden geladen. Je invoer blijft bewaard.'],
  ['Le profil n’a pas pu être enregistré. Vos saisies sont conservées.', 'The profile could not be saved. Your input is kept.', 'Het profiel kon niet worden opgeslagen. Je invoer blijft bewaard.'],
  ['La recherche locale des villes n’est pas disponible.', 'Local city search is unavailable.', 'Lokaal zoeken naar steden is niet beschikbaar.'],
  ['Écrivez un nom de ville de 2 à 100 caractères.', 'Enter a city name between 2 and 100 characters.', 'Vul een stadsnaam van 2 tot 100 tekens in.'],
  ['Choisissez une ville ou votre position avant d’activer la météo.', 'Choose a city or your location before turning weather on.', 'Kies een stad of je locatie voordat je het weer inschakelt.'],
  ['Les options du profil ne sont pas valides.', 'The profile options are invalid.', 'De profielopties zijn ongeldig.'],
  ['Le prénom ou la région contient un texte trop long ou inattendu.', 'The first name or area contains text that is too long or unexpected.', 'De voornaam of regio bevat te lange of onverwachte tekst.'],
  ['Choisissez explicitement si vous souhaitez la météo.', 'Choose explicitly whether you want weather forecasts.', 'Kies uitdrukkelijk of je weersverwachtingen wilt.'],
  ['Choisissez une ville ou une position complète.', 'Choose a city or a complete location.', 'Kies een stad of een volledige locatie.'],
  ['La position choisie n’est pas valide.', 'The selected location is invalid.', 'De gekozen locatie is ongeldig.'],
  ['Le profil enregistré n’a pas pu être lu. Les données sont conservées ; aucun accès météo n’est lancé.', 'The saved profile could not be read. The data is kept; no weather access is started.', 'Het opgeslagen profiel kon niet worden gelezen. De gegevens blijven bewaard; er wordt geen weer opgevraagd.'],
  ['La prévision météo n’est pas disponible pour le moment.', 'The weather forecast is currently unavailable.', 'De weersverwachting is momenteel niet beschikbaar.'],
  ['Le catalogue local des villes n’est pas disponible.', 'The local city catalogue is unavailable.', 'De lokale stedencatalogus is niet beschikbaar.'],
];
const messages = new Map(MESSAGES.map(([fr, en, nl]) => [fr, { en, nl }]));
const t = source => messages.get(source)?.[getLocale()] || source;
const node = (tag, cls, text) => { const item = document.createElement(tag); if (cls) item.className = cls; if (text !== undefined) item.textContent = text; return item; };
const json = async (url, options = {}) => { const response = await fetch(url, { credentials: 'same-origin', ...options }); const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Le profil n’a pas pu être enregistré. Vos saisies sont conservées.'); return data; };

export class PersonalizationDialog {
  constructor({ request = json, onChange = () => {}, onClose = () => {}, host = globalThis } = {}) {
    Object.assign(this, { request, onChange, onClose, host }); this.epoch = 0; this.dirty = false; this.profile = null;
    this.dialog = node('dialog', 'personalization-dialog'); this.dialog.id = 'personalization-dialog'; this.dialog.setAttribute('data-no-translate', ''); this.dialog.setAttribute('aria-labelledby', 'personalization-title');
    this.dialog.addEventListener('close', () => { if (!this.dialog.open) this.closed(); }); this.dialog.addEventListener('cancel', event => { event.preventDefault(); this.close(); }); document.body.append(this.dialog);
    this.labels = []; this.build(); this.languageChanged = () => this.localize(); document.addEventListener('oscar:language', this.languageChanged);
  }
  text(tag, cls, source) { const item = node(tag, cls, t(source)); this.labels.push({ item, source }); return item; }
  button(source, cls, action) { const item = this.text('button', cls, source); item.type = 'button'; item.addEventListener('click', action); return item; }
  field(source, id) { const label = node('label', 'personalization-field'); label.append(this.text('span', '', source)); const input = node('input'); input.type = 'text'; input.id = id; label.htmlFor = id; label.append(input); return { label, input }; }
  build() {
    const header = node('header', 'personalization-header'), copy = node('div'); copy.append(this.text('span', 'personalization-eyebrow', 'UN BUREAU À VOTRE IMAGE'));
    const title = this.text('h2', '', 'Comment vous accueillir ?'); title.id = 'personalization-title'; title.tabIndex = -1;
    copy.append(title, this.text('p', '', 'Oscar et Zoé peuvent utiliser votre prénom et les prévisions de votre région.'));
    this.closeButton = this.button('×', 'personalization-close', () => this.close()); this.closeButton.setAttribute('aria-label', t('Fermer la personnalisation')); header.append(copy, this.closeButton);
    this.form = node('form', 'personalization-body'); this.form.addEventListener('submit', event => { event.preventDefault(); this.save(); });
    const name = this.field('Votre prénom', 'personalization-name'); this.name = name.input; this.name.maxLength = 60; this.name.autocomplete = 'given-name'; this.name.placeholder = t('Prénom facultatif');
    const region = this.field('Votre ville ou région', 'personalization-region'); this.region = region.input; this.region.maxLength = 160; this.region.autocomplete = 'off'; this.region.placeholder = t('Ex. : Bruxelles, Namur, Amsterdam');
    this.region.addEventListener('input', () => { this.selected = null; this.dirty = true; this.resultList.replaceChildren(); this.resultList.hidden = true; this.update(); });
    this.name.addEventListener('input', () => { this.dirty = true; this.update(); });
    this.searchButton = this.button('Rechercher une ville', 'personalization-secondary', () => this.search());
    const search = node('div', 'personalization-search'); search.append(region.label, this.searchButton);
    this.resultList = node('ul', 'personalization-results'); this.resultList.id='personalization-results';this.resultList.hidden = true; this.resultList.setAttribute('aria-label', t('Villes proposées'));this.region.setAttribute('aria-controls',this.resultList.id);
    this.region.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();this.search();}else if(event.key==='ArrowDown'&&!this.resultList.hidden){event.preventDefault();this.resultList.querySelector('button')?.focus();}});
    this.resultList.addEventListener('keydown',event=>{const buttons=[...this.resultList.querySelectorAll('button')],index=buttons.indexOf(document.activeElement);if(event.key==='Escape'){event.preventDefault();event.stopPropagation();this.resultList.hidden=true;this.region.focus();}else if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length;buttons[next]?.focus();}});
    this.selection = node('p', 'personalization-selection'); this.selection.setAttribute('role', 'status');
    this.geoButton = this.button('Utiliser ma position approximative', 'personalization-geolocate', () => this.geolocate());
    const weather = node('label', 'personalization-weather-toggle'); this.weatherToggle = node('input'); this.weatherToggle.type = 'checkbox'; weather.append(this.weatherToggle, this.text('span', '', 'Autoriser les prévisions météo pour cette région')); this.weatherToggle.addEventListener('change', () => { this.dirty = true; this.update(); });
    this.weatherPanel = node('section', 'personalization-weather'); this.weatherPanel.append(this.text('h3', '', 'Prévisions météo')); this.weatherText = node('p'); this.weatherText.setAttribute('role', 'status'); this.weatherDates = node('p', 'personalization-weather-dates');
    this.refreshButton = this.button('Actualiser les prévisions', 'personalization-secondary', () => this.refreshWeather()); this.weatherPanel.append(this.weatherText, this.weatherDates, this.refreshButton);
    const sources = this.text('p', 'personalization-attribution', 'Sources : villes GeoNames, prévisions MET Norway. Données CC BY 4.0, résumées et coordonnées arrondies.');
    const links = node('span', 'personalization-source-links'); for (const [label, href] of [['GeoNames', 'https://www.geonames.org/'], ['MET Norway', 'https://api.met.no/weatherapi/locationforecast/2.0/documentation'], ['CC BY 4.0', 'https://creativecommons.org/licenses/by/4.0/']]) { const link = node('a', '', label); link.href = href; link.target = '_blank'; link.rel = 'noopener noreferrer'; links.append(link); }
    this.error = node('p', 'personalization-error'); this.error.hidden = true; this.error.setAttribute('role', 'alert'); this.notice = node('p', 'personalization-notice'); this.notice.hidden = true; this.notice.setAttribute('role', 'status');
    this.submit = this.text('button', 'personalization-save', 'Enregistrer'); this.submit.type = 'submit'; const footer = node('div', 'personalization-actions'); footer.append(this.submit);
    this.form.append(name.label, search, this.text('p', 'personalization-note', 'Recherche locale, sans transmettre votre saisie à un service.'), this.resultList, this.selection, this.geoButton, this.text('p', 'personalization-note', 'Le navigateur vous demandera votre accord. La position est arrondie à environ un kilomètre avant enregistrement.'), weather, this.text('p', 'personalization-privacy', 'Après enregistrement, MET Norway reçoit votre position approximative et l’adresse réseau de cet ordinateur pour fournir les prévisions. Votre prénom n’est pas transmis. Aucune recherche par adresse réseau.'), this.weatherPanel, sources, links, this.text('p', 'personalization-note', 'Votre profil reste dans les données locales du bureau. Vous pouvez effacer les champs et désactiver la météo.'), this.error, this.notice, footer);
    this.dialog.append(header, this.form); this.update();
  }
  localize() { for (const { item, source } of this.labels) item.textContent = t(source); this.closeButton.setAttribute('aria-label', t('Fermer la personnalisation')); this.resultList.setAttribute('aria-label', t('Villes proposées')); this.name.placeholder = t('Prénom facultatif'); this.region.placeholder = t('Ex. : Bruxelles, Namur, Amsterdam'); if (this.errorSource) this.error.textContent = t(this.errorSource); if (this.noticeSource) this.notice.textContent = t(this.noticeSource); this.update(); }
  showError(source = '') { this.errorSource = source; this.error.textContent = t(source); this.error.hidden = !source; }
  showNotice(source = '') { this.noticeSource = source; this.notice.textContent = t(source); this.notice.hidden = !source; }
  update() {
    const busy = Boolean(this.saving || this.loading); this.submit.disabled = busy || this.locating; this.submit.textContent = t(this.saving ? 'Enregistrement…' : 'Enregistrer'); this.name.disabled = busy; this.region.disabled = busy;
    this.weatherToggle.disabled = busy; this.searchButton.disabled = busy || this.searching; this.geoButton.disabled = busy || this.locating; this.geoButton.textContent = t(this.locating ? 'Recherche de votre position…' : 'Utiliser ma position approximative');
    this.selection.textContent = this.selected ? `${t('Position sélectionnée')} · ${this.selected.label}` : '';
    const weather = this.data?.weather; this.weatherDates.textContent = '';
    if (!this.weatherToggle.checked) this.weatherText.textContent = t('La météo est désactivée. Aucune position n’est transmise au service météo.');
    else if (this.dirty) this.weatherText.textContent = t('Enregistrez vos choix pour obtenir une prévision.');
    else if (this.weatherLoading) this.weatherText.textContent = t('Prévisions en cours de récupération…');
    else if (weather?.status === 'ready' || weather?.status === 'stale') {
      const description = weather.description?.[getLocale()] || weather.description?.fr || ''; const temperature = Number.isFinite(weather.temperatureC) ? ` · ${new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 1 }).format(weather.temperatureC)} °C` : '';
      this.weatherText.textContent = weather.status === 'stale' ? t('Cette prévision est ancienne et n’est pas utilisée dans les nouvelles répliques.') : description + temperature;
      const dates = []; for (const [label, value] of [['Prévision pour', weather.validAt], ['Récupérée le', weather.fetchedAt]]) { const date = new Date(value); if (value !== undefined && Number.isFinite(date.getTime())) dates.push(`${t(label)} ${new Intl.DateTimeFormat(getLocale(), { dateStyle: 'short', timeStyle: 'short' }).format(date)}`); } this.weatherDates.textContent = dates.join(' · ');
    } else this.weatherText.textContent = t('Prévision indisponible pour le moment. Oscar et Zoé n’inventeront pas la météo.');
    this.refreshButton.disabled = busy || this.weatherLoading || this.dirty || !this.profile?.weatherEnabled;
  }
  accept(data, { fields = false } = {}) {
    if (!data?.profile) throw new Error('Le profil n’a pas pu être chargé. Vos saisies sont conservées.');
    this.data = data; this.profile = data.profile;
    if (fields) { this.name.value = data.profile.name || ''; this.region.value = data.profile.region || ''; this.weatherToggle.checked = data.profile.weatherEnabled === true; this.selected = Number.isFinite(data.profile.latitude) && Number.isFinite(data.profile.longitude) ? { label: this.region.value, latitude: data.profile.latitude, longitude: data.profile.longitude } : null; }
    if (data.message) this.showError(data.message); this.update(); this.onChange(data);
  }
  async search() {
    const q = this.region.value.trim(); if (q.length < 2 || q.length > 100) { this.showError('Écrivez un nom de ville de 2 à 100 caractères.'); this.region.focus(); return; }
    const epoch = this.epoch; this.searching = true; this.showError(''); this.showNotice('Recherche des villes…'); this.update();
    try { const data = await this.request(`/api/profile/regions?q=${encodeURIComponent(q)}&language=${getLocale()}`); if (epoch !== this.epoch || !this.dialog.open || this.region.value.trim() !== q) return; this.resultList.replaceChildren();
      for (const result of (Array.isArray(data.regions) ? data.regions : []).slice(0, 10)) { if (!Number.isFinite(result.latitude) || !Number.isFinite(result.longitude) || typeof result.label !== 'string') continue; const item = node('li'), button = node('button', '', result.label); button.type = 'button'; button.addEventListener('click', () => { this.selected = { label: result.label.slice(0, 160), latitude: Math.round(result.latitude * 100) / 100, longitude: Math.round(result.longitude * 100) / 100 }; this.region.value = this.selected.label; this.dirty = true; this.resultList.hidden = true; this.showNotice(''); this.update(); this.weatherToggle.focus(); }); item.append(button); this.resultList.append(item); }
      this.resultList.hidden = !this.resultList.children.length; this.showNotice(this.resultList.hidden ? 'Aucune ville trouvée. Essayez une ville proche ou choisissez votre position.' : 'Choisissez une ville dans les résultats.'); this.resultList.querySelector('button')?.focus();
    } catch { if (epoch === this.epoch) this.showError('La recherche locale des villes n’est pas disponible.'); }
    finally { this.searching = false; if (epoch === this.epoch) this.update(); }
  }
  geolocate() {
    if (this.locating) return; if (!this.host.navigator?.geolocation?.getCurrentPosition) { this.showError('La géolocalisation n’est pas disponible dans ce navigateur. Recherchez votre ville.'); return; }
    this.locating = true; const epoch = this.epoch; this.showError(''); this.update();
    const done = () => { this.locating = false; if (epoch === this.epoch) this.update(); };
    this.host.navigator.geolocation.getCurrentPosition(position => { if (epoch !== this.epoch || !this.dialog.open) { done(); return; } const latitude = position.coords.latitude, longitude = position.coords.longitude;
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) { this.showError('La position choisie n’est pas valide.'); done(); return; }
      this.selected = { label: t('Ma position approximative'), latitude: Math.round(latitude * 100) / 100, longitude: Math.round(longitude * 100) / 100 }; this.region.value = this.selected.label; this.dirty = true; this.resultList.hidden = true; done();
    }, () => { if (epoch === this.epoch) this.showError('La position n’a pas été obtenue. Vous pouvez rechercher votre ville manuellement.'); done(); }, { enableHighAccuracy: false, maximumAge: 300000, timeout: 15000 });
  }
  async save() {
    if (this.saving || this.loading || !this.form.reportValidity()) return;
    if (this.weatherToggle.checked && !this.selected) { this.showError('Choisissez une ville ou votre position avant d’activer la météo.'); this.region.focus(); return; }
    const body = { name: this.name.value.trim(), region: this.region.value.trim(), latitude: this.selected?.latitude ?? null, longitude: this.selected?.longitude ?? null, weatherEnabled: this.weatherToggle.checked };
    this.saving = true; const epoch = this.epoch; this.showError(''); this.showNotice(''); this.update();
    try { const data = await this.request('/api/profile', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Oscar-Client': '1' }, body: JSON.stringify(body) }); if (epoch !== this.epoch) return; this.dirty = false; this.accept(data, { fields: true }); this.showNotice('Personnalisation enregistrée.'); if (body.weatherEnabled) await this.refreshWeather(); }
    catch (failure) { if (epoch === this.epoch) this.showError(failure.message || 'Le profil n’a pas pu être enregistré. Vos saisies sont conservées.'); }
    finally { this.saving = false; if (epoch === this.epoch) this.update(); }
  }
  async refreshWeather() { if (this.weatherLoading || this.dirty || !this.profile?.weatherEnabled) return; this.weatherLoading = true; const epoch = this.epoch; this.update(); try { const data = await this.request('/api/profile/weather'); if (epoch === this.epoch) this.accept(data); } catch { if (epoch === this.epoch) this.showError('La prévision météo n’est pas disponible pour le moment.'); } finally { this.weatherLoading = false; if (epoch === this.epoch) this.update(); } }
  async open() { if (this.destroyed || this.dialog.open) return; this.returnFocus = document.activeElement; this.notified = false; this.epoch++; const epoch = this.epoch; this.dialog.showModal(); this.loading = true; this.showError(''); this.showNotice('Chargement du profil…'); this.localize(); this.dialog.querySelector('h2').focus(); try { const data = await this.request('/api/profile'); if (epoch !== this.epoch) return; this.accept(data, { fields: !this.dirty }); this.showNotice(''); } catch { if (epoch === this.epoch) this.showError('Le profil n’a pas pu être chargé. Vos saisies sont conservées.'); } finally { this.loading = false; if (epoch === this.epoch) this.update(); } }
  closed() { if (this.notified) return; this.notified = true; this.epoch++; if (this.returnFocus?.isConnected) this.returnFocus.focus({ preventScroll: true }); this.onClose(); }
  close() { if (this.dialog.open) this.dialog.close(); this.closed(); }
  destroy() { this.destroyed = true; this.close(); document.removeEventListener('oscar:language', this.languageChanged); this.dialog.remove(); }
}
export default PersonalizationDialog;
