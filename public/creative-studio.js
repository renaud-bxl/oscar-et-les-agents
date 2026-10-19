const SVG_NS = 'http://www.w3.org/2000/svg';
const FORMATS = Object.freeze({ '1:1': [1080, 1080], '4:5': [1080, 1350], A4: [2480, 3508], '16:9': [1920, 1080] });
const PRESETS = Object.freeze({ affiche: 'Affiche', branding: 'Identité de marque', social: 'Publication pour les réseaux', illustration: 'Illustration' });
const DEFAULTS = Object.freeze({ preset: 'affiche', format: '4:5', brand: 'Atelier Nova', title: 'Une idée.\nDu caractère.', subtitle: 'Des créations pour raconter votre histoire.', primary: '#365B4B', secondary: '#D7A184', background: '#F6F3E9', variation: 0 });
const LIMIT = 20 * 1024 * 1024;
const escape = value => String(value).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]);
const node = (tag, className, text) => { const element = document.createElement(tag); if (className) element.className = className; if (text !== undefined) element.textContent = text; return element; };

function configuration(config = {}) {
  const value = { ...DEFAULTS, ...config };
  if (!Object.hasOwn(FORMATS, value.format) || !Object.hasOwn(PRESETS, value.preset)) throw new Error('Choisissez un format et un type de création proposés dans le studio.');
  for (const key of ['primary', 'secondary', 'background']) if (typeof value[key] !== 'string' || !/^#[a-f\d]{6}$/i.test(value[key])) throw new Error('Choisissez une couleur au format #RRGGBB.');
  for (const [key, max] of [['brand', 80], ['title', 180], ['subtitle', 240]]) value[key] = String(value[key] ?? '').slice(0, max);
  value.variation = Number.isInteger(value.variation) ? Math.abs(value.variation % 4) : 0;
  return value;
}

function lines(text, length = 21, max = 4) {
  const output = [];
  for (const paragraph of String(text).split(/\n/)) {
    let line = '';
    for (const word of paragraph.trim().split(/\s+/).filter(Boolean)) {
      const chunks = word.match(new RegExp(`.{1,${length}}`, 'gu')) || [];
      for (const chunk of chunks) {
        if (line && line.length + chunk.length + 1 > length) { output.push(line); line = ''; }
        line += (line ? ' ' : '') + chunk;
      }
    }
    if (line) output.push(line);
  }
  if (output.length > max) output[max - 1] = output[max - 1].replace(/.{0,2}$/u, '') + '…';
  return output.slice(0, max);
}
const textLines = (text, { x, y, size = 100, color, length = 20, max = 4, weight = 700, anchor = 'start' }) => `<text x="${x}" y="${y}" fill="${color}" font-family="Arial, Helvetica, sans-serif" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}" letter-spacing="${size >= 60 ? -2 : 0}">${lines(text, length, max).map((line, index) => `<tspan x="${x}" dy="${index ? size * 1.05 : 0}">${escape(line)}</tspan>`).join('')}</text>`;

/** A deterministic, entirely local vector drawing. All user text and colours are constrained. */
export function buildStudioSvg(config = {}) {
  const value = configuration(config), [width, height] = FORMATS[value.format];
  const w = 1080, h = Math.round(height / width * w), p = value.primary, s = value.secondary, b = value.background;
  const variation = value.variation, wide = h < 850;
  const mark = escape((value.brand.trim().match(/[\p{L}\p{N}]/u)?.[0] || 'N').toUpperCase());
  const brand = `<text x="72" y="94" fill="${p}" font-family="Arial, Helvetica, sans-serif" font-size="26" font-weight="700" letter-spacing="4">${escape(value.brand.toUpperCase())}</text>`;
  let art = '';
  if (value.preset === 'affiche') {
    const circleX = [820, 855, 765, 840][variation];
    art = `<circle cx="${circleX}" cy="${wide ? 105 : h * .28}" r="${wide ? 250 : 328}" fill="${s}"/><path d="M620 ${h * .18} C${860 + variation * 20} ${h * .12},1090 ${h * .30},920 ${h * .44} C730 ${h * .57},600 ${h * .39},620 ${h * .18}Z" fill="${p}"/><circle cx="850" cy="${h * .37}" r="72" fill="${b}"/><path d="M76 ${h - 170} H1004" fill="none" stroke="${p}" stroke-width="2"/>${textLines(value.title, { x: 70, y: wide ? 230 : h * .61, size: wide ? 68 : h < 1200 ? 100 : 110, color: p, length: wide ? 14 : 17, max: 3 })}${textLines(value.subtitle, { x: 74, y: h - 117, size: 26, color: p, length: 58, max: 2, weight: 400 })}<text x="1006" y="${h - 53}" text-anchor="end" fill="${p}" font-family="Arial, sans-serif" font-size="22">0${variation + 1} / ${escape(value.format)}</text>`;
  } else if (value.preset === 'branding') {
    const y = wide ? 140 : h * .27, square = wide ? 225 : 352;
    art = `<rect x="72" y="${y}" width="${square}" height="${square}" rx="${variation % 2 ? 70 : square / 2}" fill="${p}"/><circle cx="${72 + square * .78}" cy="${y + square * .21}" r="${square * .2}" fill="${s}"/><text x="${72 + square / 2}" y="${y + square * .72}" text-anchor="middle" fill="${b}" font-family="Georgia, serif" font-size="${square * .65}" font-weight="700">${mark}</text>${textLines(value.title, { x: wide ? 357 : 72, y: wide ? 211 : y + square + 130, size: wide ? 62 : 88, color: p, length: wide ? 18 : 21, max: h < 1200 && !wide ? 2 : 3 })}${textLines(value.subtitle, { x: 75, y: h - 170, size: 27, color: p, length: 57, max: 2, weight: 400 })}<g><circle cx="100" cy="${h - 69}" r="27" fill="${p}"/><circle cx="169" cy="${h - 69}" r="27" fill="${s}"/><circle cx="238" cy="${h - 69}" r="26" fill="${b}" stroke="${p}" stroke-width="2"/></g><text x="1006" y="${h - 59}" text-anchor="end" fill="${p}" font-family="Arial, sans-serif" font-size="20" letter-spacing="3">${escape(value.brand.toUpperCase())}</text>`;
  } else if (value.preset === 'social') {
    art = `<rect x="0" y="150" width="1080" height="${h - 150}" rx="${variation % 2 ? 180 : 0}" fill="${p}"/><circle cx="${[1020, 60, 970, 120][variation]}" cy="${h * .59}" r="315" fill="${s}"/><circle cx="${variation % 2 ? 965 : 100}" cy="${h - 75}" r="205" fill="${b}"/>${textLines(value.title, { x: 90, y: wide ? 265 : h * .42, size: wide ? 83 : 108, color: b, length: 17, max: wide ? 3 : 4 })}${textLines(value.subtitle, { x: 94, y: h - 122, size: 28, color: b, length: 49, max: 2, weight: 400 })}<path d="M907 218 H995 V306 M908 305 L992 221" fill="none" stroke="${b}" stroke-width="9" stroke-linecap="round"/>`;
  } else {
    const horizon = wide ? h * .7 : h * .62;
    art = `<circle cx="${[800, 760, 310, 725][variation]}" cy="${wide ? 185 : h * .28}" r="${wide ? 95 : 170}" fill="${s}"/><path d="M-80 ${horizon + 90} Q220 ${horizon - 400} 615 ${horizon + 30} T1170 ${horizon - 50} V${h} H-80Z" fill="${p}"/><path d="M-90 ${horizon + 180} Q360 ${horizon - 120} 720 ${horizon + 160} T1200 ${horizon + 20} V${h} H-90Z" fill="${s}"/><path d="M-50 ${h - 50} Q350 ${horizon - 45} 720 ${h} H-50Z" fill="${b}"/>${textLines(value.title, { x: 72, y: wide ? 182 : h * .27, size: wide ? 60 : 86, color: p, length: 17, max: 3 })}${textLines(value.subtitle, { x: 74, y: h - 78, size: 26, color: p, length: 59, max: 2, weight: 400 })}`;
  }
  return `<svg xmlns="${SVG_NS}" width="${width}" height="${height}" viewBox="0 0 ${w} ${h}" role="img" aria-labelledby="studio-title studio-description"><title id="studio-title">${escape(value.title || PRESETS[value.preset])}</title><desc id="studio-description">${escape(value.brand)} — ${escape(value.subtitle)}</desc><rect width="1080" height="${h}" fill="${b}"/>${brand}${art}</svg>`;
}

export function validateStudioFilePath(value) {
  if (typeof value !== 'string' || value.length > 512 || !value || /[\x00-\x1f\x7f\\:?*<>|]/.test(value) || value.split('/').some(part => !part || part.startsWith('.')) || !/\.(?:svg|png|jpe?g|webp)$/i.test(value)) throw new Error('Choisissez un fichier SVG, PNG, JPEG ou WebP dans la livraison de cette mission.');
  return value;
}
export function studioFileUrl(missionId, filePath) {
  if (typeof missionId !== 'string' || !/^[a-z\d-]{1,100}$/i.test(missionId)) throw new Error('Cette mission n’est pas reconnue.');
  return `/api/missions/${encodeURIComponent(missionId)}/files/${validateStudioFilePath(filePath).split('/').map(encodeURIComponent).join('/')}`;
}

const ELEMENTS = new Set('svg g defs path rect circle ellipse line polyline polygon text tspan title desc lineargradient radialgradient stop clippath mask pattern use symbol'.split(' '));
const ATTRIBUTES = new Set('width height viewbox preserveaspectratio x y x1 y1 x2 y2 cx cy r rx ry d points fill stroke stroke-width stroke-linecap stroke-linejoin stroke-miterlimit stroke-dasharray stroke-dashoffset fill-rule clip-rule opacity fill-opacity stroke-opacity transform id clip-path mask font-family font-size font-weight font-style letter-spacing word-spacing text-anchor dominant-baseline alignment-baseline textlength lengthadjust vector-effect offset stop-color stop-opacity gradientunits gradienttransform spreadmethod patternunits patterncontentunits patterntransform href'.split(' '));
const FONT = /^(?:(?:Arial|Helvetica|Verdana|Georgia|Times New Roman|Courier New|sans-serif|serif|monospace|system-ui)\s*,?\s*)+$/i;
const FRAGMENT = /^#[a-z_][\w:.-]{0,99}$/i;
const dimensions = svg => {
  const width = Number.parseFloat(svg.getAttribute('width')), height = Number.parseFloat(svg.getAttribute('height'));
  const viewBox = (svg.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
  const w = Number.isFinite(width) && width > 0 ? width : viewBox.length === 4 && Number.isFinite(viewBox[2]) && viewBox[2] > 0 ? viewBox[2] : 1080;
  const h = Number.isFinite(height) && height > 0 ? height : viewBox.length === 4 && Number.isFinite(viewBox[3]) && viewBox[3] > 0 ? viewBox[3] : 1080;
  const scale = Math.min(1, 4096 / w, 4096 / h);
  return [Math.max(1, Math.round(w * scale)), Math.max(1, Math.round(h * scale))];
};

/** Imported SVGs stay inert: static SVG elements, local paint references and system fonts only. */
export function sanitizeStudioSvg(source, { DOMParserImpl = globalThis.DOMParser, XMLSerializerImpl = globalThis.XMLSerializer } = {}) {
  if (typeof source !== 'string' || source.length > 2 * 1024 * 1024 || /<!\s*(?:DOCTYPE|ENTITY)\b/i.test(source)) throw new Error('Ce SVG est trop volumineux ou contient une déclaration externe interdite.');
  if (!DOMParserImpl || !XMLSerializerImpl) throw new Error('Ce navigateur ne permet pas de vérifier un fichier SVG.');
  const document = new DOMParserImpl().parseFromString(source, 'image/svg+xml');
  const svg = document.documentElement;
  if (document.getElementsByTagName('parsererror').length || svg?.localName !== 'svg' || svg.namespaceURI !== SVG_NS) throw new Error('Le fichier ne contient pas un SVG valide.');
  const sanitize = element => {
    if (element.namespaceURI !== SVG_NS || !ELEMENTS.has(element.localName.toLowerCase())) { element.remove(); return; }
    for (const attribute of [...element.attributes]) {
      const name = attribute.localName.toLowerCase(), value = attribute.value.trim();
      if (attribute.name === 'xmlns' && value === SVG_NS) continue;
      const localUrl = /^url\(\s*#[a-z_][\w:.-]{0,99}\s*\)$/i.test(value);
      if (!ATTRIBUTES.has(name) || /^on/i.test(name) || (attribute.namespaceURI && attribute.namespaceURI !== 'http://www.w3.org/1999/xlink') || /[<>\\]/.test(value) || (name === 'href' && !FRAGMENT.test(value)) || (/url\s*\(/i.test(value) && !localUrl) || /(?:javascript|data|https?|file):|@import|@font-face|expression\s*\(/i.test(value) || (name === 'font-family' && !FONT.test(value))) element.removeAttributeNode(attribute);
    }
    for (const child of [...element.children]) sanitize(child);
    for (const child of [...element.childNodes]) if (child.nodeType !== 1 && child.nodeType !== 3) child.remove();
  };
  sanitize(svg);
  const box = (svg.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
  if (box.length !== 4 || box.some(value => !Number.isFinite(value)) || box[2] <= 0 || box[3] <= 0) svg.removeAttribute('viewBox');
  const [width, height] = dimensions(svg);
  svg.setAttribute('xmlns', SVG_NS); svg.setAttribute('width', String(width)); svg.setAttribute('height', String(height));
  return new XMLSerializerImpl().serializeToString(svg);
}

export class CreativeStudio {
  constructor({ getMission = () => null, request = (...args) => fetch(...args), onCreate = () => {}, onClose = () => {} } = {}) {
    Object.assign(this, { getMission, request, onCreate, onClose });
    this.config = { ...DEFAULTS }; this.urls = new Set(); this.epoch = 0; this.destroyed = false;
    this.dialog = node('dialog', 'creative-studio'); this.dialog.id = 'creative-studio'; this.dialog.setAttribute('aria-labelledby', 'creative-studio-title');
    this.dialog.addEventListener('close', () => { if (!this.dialog.open) this.closed(); });
    document.body.append(this.dialog); this.build(); this.render();
  }

  field(label, key, type = 'text', maxLength) {
    const wrapper = node('label', 'creative-field'); wrapper.append(node('span', '', label));
    const input = node(type === 'textarea' ? 'textarea' : 'input'); if (type !== 'textarea') input.type = type;
    input.value = this.config[key]; input.dataset.creativeField = key;
    if (maxLength) input.maxLength = maxLength;
    input.addEventListener('input', () => { this.config[key] = input.value; this.render(); }); wrapper.append(input); this.inputs.push(input);
    return wrapper;
  }

  build() {
    this.inputs = [];
    const header = node('header', 'creative-header'), titleGroup = node('div');
    titleGroup.append(node('span', 'creative-eyebrow', 'L’ATELIER DES IMAGES'));
    const title = node('h2', '', 'Donnez une forme à votre idée.'); title.id = 'creative-studio-title'; titleGroup.append(title, node('p', '', 'Dessins vectoriels, affiches et identités : créez et exportez sur votre ordinateur.'));
    const close = node('button', 'creative-close', '×'); close.type = 'button'; close.setAttribute('aria-label', 'Fermer le studio'); close.addEventListener('click', () => this.close()); header.append(titleGroup, close);
    const body = node('div', 'creative-body'); this.controls = node('section', 'creative-controls'); this.controls.setAttribute('aria-label', 'Personnaliser ma création');
    this.controls.append(node('h3', '', 'Votre terrain de jeu'));
    const presets = node('div', 'creative-presets'); this.presetButtons = {};
    for (const [id, label] of Object.entries(PRESETS)) {
      const button = node('button', 'creative-preset', label); button.type = 'button'; button.dataset.creativePreset = id;
      button.addEventListener('click', () => { this.original(); this.config.preset = id; this.render(); }); presets.append(button); this.presetButtons[id] = button;
    }
    this.controls.append(presets);
    const formatLabel = node('label', 'creative-field'); formatLabel.append(node('span', '', 'Format')); this.format = node('select'); this.format.dataset.creativeField = 'format';
    for (const [id, text] of [['1:1', 'Carré · 1:1'], ['4:5', 'Portrait · 4:5'], ['A4', 'Affiche · A4'], ['16:9', 'Paysage · 16:9']]) { const option = node('option', '', text); option.value = id; this.format.append(option); }
    this.format.value = this.config.format; this.format.addEventListener('change', () => { this.config.format = this.format.value; this.render(); }); formatLabel.append(this.format); this.inputs.push(this.format);
    this.controls.append(formatLabel, this.field('Nom de la marque', 'brand', 'text', 80), this.field('Titre', 'title', 'textarea', 180), this.field('Sous-titre', 'subtitle', 'textarea', 240));
    const colors = node('div', 'creative-colors'); colors.append(this.field('Couleur principale', 'primary', 'color'), this.field('Couleur secondaire', 'secondary', 'color'), this.field('Fond', 'background', 'color')); this.controls.append(colors);
    this.vary = node('button', 'creative-variation', '↻ Explorer une autre composition'); this.vary.type = 'button'; this.vary.addEventListener('click', () => { this.config.variation = (this.config.variation + 1) % 4; this.render(); }); this.controls.append(this.vary);
    this.canvas = node('section', 'creative-canvas'); this.canvas.setAttribute('aria-label', 'Aperçu de la création');
    const bar = node('div', 'creative-preview-bar'); this.mode = node('span', 'creative-mode', 'Votre dessin original'); this.size = node('span', 'creative-size'); bar.append(this.mode, this.size);
    this.preview = node('div', 'creative-preview'); this.image = node('img', 'creative-artwork'); this.image.alt = 'Aperçu de votre création'; this.preview.append(this.image);
    this.returnButton = node('button', 'creative-return', '← Revenir à mon dessin'); this.returnButton.type = 'button'; this.returnButton.hidden = true; this.returnButton.addEventListener('click', () => { this.original(); this.render(); });
    this.message = node('p', 'creative-message'); this.message.setAttribute('role', 'status'); this.message.hidden = true;
    const exports = node('div', 'creative-exports'); this.svgButton = node('button', 'creative-export', 'Exporter SVG · modifiable'); this.pngButton = node('button', 'creative-export creative-export-primary', 'Exporter PNG · image');
    for (const [button, kind] of [[this.svgButton, 'svg'], [this.pngButton, 'png']]) { button.type = 'button'; button.addEventListener('click', () => this.export(kind)); exports.append(button); }
    this.canvas.append(bar, this.preview, this.returnButton, this.message, exports, node('p', 'creative-local-note', 'Le studio dessine des formes et du texte, puis exporte en SVG ou PNG. L’édition et l’export ne consomment aucun quota IA. Pour une photo ou une création IA, préparez une demande à Oscar ; le studio ne génère pas de photos.'));
    this.assets = node('section', 'creative-assets'); this.assets.append(node('h3', '', 'Reprendre un visuel de la mission')); this.assetNote = node('p', 'creative-assets-note'); this.assetList = node('div', 'creative-asset-list'); this.assets.append(this.assetNote, this.assetList); this.controls.append(this.assets);
    body.append(this.controls, this.canvas);
    const footer = node('footer', 'creative-footer'); const footerCopy = node('div'); footerCopy.append(node('strong', '', 'Envie d’aller plus loin ?'), node('span', '', 'Oscar peut préparer une création et ses déclinaisons avec l’équipe.'));
    this.oscar = node('button', 'creative-oscar', 'Confier une création à Oscar ↗'); this.oscar.type = 'button'; this.oscar.addEventListener('click', () => this.createWithOscar()); footer.append(footerCopy, this.oscar);
    this.dialog.append(header, body, footer);
  }

  objectUrl(blob) { const url = URL.createObjectURL(blob); this.urls.add(url); return url; }
  release(url) { if (url) { URL.revokeObjectURL(url); this.urls.delete(url); } }
  showMessage(text, failure = false) { this.message.textContent = text; this.message.hidden = !text; this.message.classList.toggle('creative-error', failure); }
  original() { this.epoch++; this.imported = null; this.abort?.abort(); this.returnButton.hidden = true; for (const input of this.inputs) input.disabled = false; this.vary.disabled = false; }

  render() {
    if (this.destroyed) return;
    for (const [id, button] of Object.entries(this.presetButtons)) button.setAttribute('aria-pressed', String(this.config.preset === id));
    if (this.imported) return;
    try {
      this.source = buildStudioSvg(this.config); this.blob = new Blob([this.source], { type: 'image/svg+xml' });
      const old = this.previewUrl; this.previewUrl = this.objectUrl(this.blob); this.image.src = this.previewUrl; this.release(old);
      this.mode.textContent = 'Votre dessin original'; const [w, h] = FORMATS[this.config.format]; this.size.textContent = `${w} × ${h}`;
      this.image.alt = `${PRESETS[this.config.preset]} — ${this.config.title}`; this.svgButton.disabled = false; this.pngButton.disabled = false;
      this.showMessage('');
    } catch (error) { this.showMessage(error.message, true); }
  }

  files() {
    const mission = this.getMission(); this.assetList.replaceChildren();
    const files = (mission?.files || []).filter(file => { try { validateStudioFilePath(file.path); return true; } catch { return false; } }).slice(0, 60);
    this.assetNote.textContent = files.length ? 'Ouvrez un SVG ou une image livrée. Les SVG sont vérifiés avant affichage ; leur texte et leurs formes restent exportables.' : 'Les fichiers SVG, PNG, JPEG et WebP de la mission apparaîtront ici.';
    for (const file of files) { const button = node('button', 'creative-asset', file.path); button.type = 'button'; button.title = file.path; button.addEventListener('click', () => this.loadFile(mission.id, file.path)); this.assetList.append(button); }
  }

  async loadFile(id, filePath) {
    const epoch = ++this.epoch; this.abort?.abort(); this.abort = new AbortController();
    this.showMessage('Ouverture du visuel de la mission…'); let candidateUrl;
    try {
      const response = await this.request(studioFileUrl(id, filePath), { method: 'GET', credentials: 'same-origin', cache: 'no-store', signal: this.abort.signal });
      if (response?.ok === false) throw new Error('Ce fichier n’a pas pu être ouvert depuis la mission.');
      if (Number(response?.headers?.get('content-length')) > LIMIT) throw new Error('Ce visuel dépasse 20 Mo. Choisissez un fichier plus léger.');
      let blob;
      if (response instanceof Blob) blob = response;
      else if (response?.body?.getReader) {
        const reader = response.body.getReader(), chunks = []; let size = 0;
        try {
          while (true) {
            const next = await reader.read(); if (next.done) break;
            size += next.value.byteLength;
            if (size > LIMIT) { await reader.cancel(); throw new Error('Ce visuel dépasse 20 Mo. Choisissez un fichier plus léger.'); }
            chunks.push(next.value);
          }
        } finally { reader.releaseLock(); }
        blob = new Blob(chunks);
      } else blob = await response.blob();
      if (blob.size > LIMIT) throw new Error('Ce visuel dépasse 20 Mo. Choisissez un fichier plus léger.');
      let safeBlob, source = null;
      if (/\.svg$/i.test(filePath)) { source = sanitizeStudioSvg(await blob.text()); safeBlob = new Blob([source], { type: 'image/svg+xml' }); }
      else {
        const bytes = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
        const png = bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71 && bytes[4] === 13 && bytes[5] === 10 && bytes[6] === 26 && bytes[7] === 10;
        const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
        const webp = String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
        if (!png && !jpeg && !webp) throw new Error('Le contenu de ce fichier n’est pas une image PNG, JPEG ou WebP reconnue.');
        safeBlob = new Blob([blob], { type: png ? 'image/png' : jpeg ? 'image/jpeg' : 'image/webp' });
      }
      if (epoch !== this.epoch || !this.dialog.open) return;
      const url = this.objectUrl(safeBlob); candidateUrl = url; await this.decode(url); if (epoch !== this.epoch || !this.dialog.open) { this.release(url); return; }
      this.release(this.previewUrl); this.previewUrl = url; this.image.src = url; this.image.alt = `Visuel livré : ${filePath}`;
      candidateUrl = null;
      this.imported = { path: filePath }; this.blob = safeBlob; this.source = source; this.returnButton.hidden = false;
      for (const input of this.inputs) input.disabled = true; this.vary.disabled = true;
      this.mode.textContent = 'Visuel de la mission'; this.size.textContent = filePath.split('/').at(-1); this.svgButton.disabled = !source;
      this.showMessage(source ? 'SVG vérifié : scripts, styles externes et éléments actifs retirés. Exportez-le, ou revenez à votre dessin pour le personnaliser.' : 'Image prête à exporter en PNG. Une image photographique ne devient pas automatiquement un dessin vectoriel.');
    } catch (error) { this.release(candidateUrl); if (epoch === this.epoch && error.name !== 'AbortError') this.showMessage('Impossible d’ouvrir ce visuel. ' + error.message, true); }
  }

  decode(url) { return new Promise((resolve, reject) => { const image = new Image(); image.onload = () => image.naturalWidth && image.naturalHeight ? resolve(image) : reject(new Error('Cette image ne contient pas de dimensions utilisables.')); image.onerror = () => reject(new Error('Le navigateur ne peut pas lire cette image.')); image.src = url; }); }
  download(blob, name) { const url = this.objectUrl(blob), anchor = node('a'); anchor.href = url; anchor.download = name; document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => this.release(url), 2000); }
  async export(kind) {
    if (this.exporting) return; this.exporting = true; this.svgButton.disabled = true; this.pngButton.disabled = true;
    try {
      const filename = (this.config.brand || 'creation').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z\d-]+/gi, '-').replace(/^-|-$/g, '').slice(0, 60) || 'creation';
      if (kind === 'svg') { if (!this.source) throw new Error('Ce visuel est une image. Choisissez PNG pour l’exporter.'); this.download(new Blob([sanitizeStudioSvg(this.source)], { type: 'image/svg+xml' }), filename + '.svg'); }
      else {
        const image = await this.decode(this.previewUrl), scale = Math.min(1, 4096 / image.naturalWidth, 4096 / image.naturalHeight);
        const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        const context = canvas.getContext('2d'); if (!context) throw new Error('Le dessin PNG n’est pas disponible dans ce navigateur. Essayez le SVG.'); context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png')); if (!blob) throw new Error('La création PNG a échoué. Essayez le SVG ou un format plus petit.');
        this.download(blob, filename + '.png'); canvas.width = canvas.height = 1;
      }
      this.showMessage('Votre export est prêt dans les téléchargements du navigateur.');
    } catch (error) { this.showMessage('L’export n’a pas abouti. ' + error.message, true); }
    finally { this.exporting = false; this.svgButton.disabled = !this.source; this.pngButton.disabled = false; }
  }

  brief() {
    const value = configuration(this.config);
    return `Prépare une création visuelle originale et ses déclinaisons.\n\nType : ${PRESETS[value.preset]}\nFormat : ${value.format}\nMarque : ${value.brand}\nTitre : ${value.title}\nSous-titre : ${value.subtitle}\nCouleurs : principale ${value.primary}, secondaire ${value.secondary}, fond ${value.background}\nPiste de composition : ${value.variation + 1}${this.imported ? `\nVisuel de référence dans la mission : ${this.imported.path}` : ''}\n\nLivre un SVG vectoriel modifiable et un aperçu PNG si les outils le permettent, dans Livraison/. Vérifie les contrastes, l’orthographe, la lisibilité et les dimensions ; explique les limites. N’annonce aucune photo générée ou image créée sans fichier réel et sans outil adapté. Ne publie, n’envoie et n’achète rien.`;
  }
  async createWithOscar() {
    const payload = { template: 'creation-visuelle', brief: this.brief() }; this.close();
    try { await this.onCreate(payload); } catch { this.open(); this.showMessage('La demande n’a pas pu être préparée pour Oscar. Votre dessin est conservé ; réessayez.', true); }
  }
  open() {
    if (this.destroyed) throw new Error('Ce studio a été fermé définitivement.');
    if (this.dialog.open) return;
    this.returnFocus = document.activeElement; this.notified = false; this.files(); this.dialog.showModal(); this.presetButtons[this.config.preset].focus({ preventScroll: true });
  }
  closed() {
    if (this.notified) return; this.notified = true; this.epoch++; this.abort?.abort();
    if (!this.destroyed) { if (this.returnFocus?.isConnected) this.returnFocus.focus({ preventScroll: true }); this.onClose(); }
  }
  close() { if (this.dialog.open) { this.dialog.close(); this.closed(); } }
  destroy() { this.destroyed = true; this.abort?.abort(); if (this.dialog.open) this.dialog.close(); for (const url of this.urls) URL.revokeObjectURL(url); this.urls.clear(); this.dialog.remove(); }
}
