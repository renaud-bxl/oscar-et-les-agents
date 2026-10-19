import { DraftStorage } from './draft-storage.js';
const SVG_NS = 'http://www.w3.org/2000/svg';
const FORMATS = Object.freeze({ '1:1': [1080, 1080], '4:5': [1080, 1350], A4: [2480, 3508], '16:9': [1920, 1080] });
const PRESETS = Object.freeze({ affiche: 'Affiche', branding: 'Identité de marque', social: 'Publication pour les réseaux', illustration: 'Illustration' });
const FAMILIES = Object.freeze({ abstract: 'Graphique', cafe: 'Café et restauration', event: 'Événement', book: 'Livre et édition', botanical: 'Nature et bien-être' });
const DEFAULTS = Object.freeze({ preset: 'affiche', format: '4:5', family: 'abstract', brand: 'Votre marque', title: 'Une idée.\nDu caractère.', subtitle: 'Des créations pour raconter votre histoire.', primary: '#365B4B', secondary: '#D7A184', background: '#F6F3E9', variation: 0 });
const LIMIT = 20 * 1024 * 1024;
const escape = value => String(value).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]);
const node = (tag, className, text) => { const element = document.createElement(tag); if (className) element.className = className; if (text !== undefined) element.textContent = text; return element; };

function configuration(config = {}) {
  const value = { ...DEFAULTS, ...config };
  if (!Object.hasOwn(FORMATS, value.format) || !Object.hasOwn(PRESETS, value.preset)) throw new Error('Choisissez un format et un type de création proposés dans le studio.');
  if (!Object.hasOwn(FAMILIES, value.family)) throw new Error('Choisissez un univers proposé dans le studio.');
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

/** Small, explicit local templates; no model call or claim of understanding the entire brief. */
export function suggestStudioConfig(description, config = {}) {
  const text = String(description ?? '').slice(0, 4000), normalized = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  let family = 'abstract';
  if (/\b(cafe|coffee|koffie|restaurant|bistro|bakery|boulangerie|the|tea)\b/.test(normalized)) family = 'cafe';
  else if (/\b(livre|book|boek|roman|edition|auteur|author|lecture)\b/.test(normalized)) family = 'book';
  else if (/\b(concert|festival|evenement|event|evenementen|musique|music|feest|party|soiree|exposition)\b/.test(normalized)) family = 'event';
  else if (/\b(nature|plante|plant|jardin|garden|wellness|bien.être|yoga|fleur|flower|botanical)\b/.test(normalized)) family = 'botanical';
  const palettes = { cafe:['#4C3028','#D89B56','#FFF4DF'], event:['#222454','#F4A655','#F5EFDF'], book:['#293F59','#BD5841','#F5EBD4'], botanical:['#284D39','#B3BD74','#F7F3E5'], abstract:['#365B4B','#D7A184','#F6F3E9'] };
  const title = text.trim().split(/[\n,]/)[0].replace(/^(?:crée|créer|create|maak|je veux|j’aimerais|une affiche pour|affiche pour)\s+/i, '').slice(0, 75);
  const [primary, secondary, background] = palettes[family];
  return configuration({ ...config, family, primary, secondary, background, title: title || DEFAULTS.title, subtitle: 'Composition locale — à personnaliser', variation: 0 });
}

function contextualArt(value, h) {
  const p=value.primary,s=value.secondary,b=value.background,v=value.variation,wide=h<850;
  const cy=wide?165:Math.min(h*.32,460), scale=wide?.57:.95;
  let illustration='';
  if(value.family==='cafe') illustration=`<ellipse cx="540" cy="${cy+155*scale}" rx="290" ry="38" fill="${s}"/><g transform="translate(540 ${cy}) scale(${scale})"><path d="M-174 -76 H145 V67 Q145 150 -12 150 Q-174 150 -174 67Z" fill="${p}"/><path d="M145 -54 H199 Q272 -54 260 12 Q252 67 145 69" fill="none" stroke="${p}" stroke-width="35"/><ellipse cx="-15" cy="-76" rx="159" ry="32" fill="${s}"/><ellipse cx="-15" cy="-80" rx="139" ry="22" fill="${b}"/><path d="M-100 -135 C-150 -180 -45 -195 -95 -245 M0 -132 C-50 -180 55 -195 5 -245 M100 -135 C50 -180 155 -195 105 -245" fill="none" stroke="${p}" stroke-width="9" stroke-linecap="round"/><path d="M-250 112 Q-288 61 -322 110 Q-343 151 -296 168 Q-254 177 -250 112Z M251 142 Q285 94 316 138 Q341 177 291 193 Q250 197 251 142Z" fill="${p}"/><path d="M-310 110 L-270 153 M274 143 L305 178" stroke="${s}" stroke-width="5"/></g>`;
  else if(value.family==='book') illustration=`<g transform="translate(540 ${cy}) rotate(${[-8,7,-4,4][v]}) scale(${scale})"><path d="M-240 -178 Q-110 -207 0 -151 Q105 -207 240 -178 V170 Q107 143 0 201 Q-111 143 -240 170Z" fill="${s}"/><path d="M-216 -183 Q-105 -202 -10 -151 V174 Q-110 123 -216 149Z M10 -151 Q113 -202 216 -183 V149 Q105 123 10 174Z" fill="${b}"/><path d="M0 -151 V201 M-188 -98 Q-107 -110 -44 -81 M-188 -51 Q-107 -63 -44 -34 M-188 -4 Q-107 -16 -44 13 M44 -81 Q115 -110 187 -98 M44 -34 Q115 -63 187 -51 M44 13 Q115 -16 187 -4" fill="none" stroke="${p}" stroke-width="7"/><path d="M144 -188 V-59 L111 -81 L82 -61 V-174Z" fill="${p}"/></g>`;
  else if(value.family==='event') illustration=`<g transform="translate(540 ${cy}) scale(${scale})"><path d="M-325 189 H325 V231 H-325Z" fill="${p}"/><path d="M-274 183 L-174 -184 L-30 183 M40 183 L172 -184 L282 183Z" fill="${s}" opacity=".62"/><path d="M-170 -190 H170 M-170 -190 V190 M170 -190 V190" fill="none" stroke="${p}" stroke-width="16"/><rect x="-62" y="-80" width="124" height="195" rx="58" fill="${p}"/><path d="M-94 25 V56 Q-94 153 0 153 Q94 153 94 56 V25 M0 153 V197 M-60 197 H60" fill="none" stroke="${p}" stroke-width="13"/><path d="M-313 -143 L-283 -115 M294 -131 L269 -95 M-293 11 L-325 36 M301 14 L327 42 M-87 -247 L-65 -218 M75 -242 L55 -212" stroke="${s}" stroke-width="13" stroke-linecap="round"/></g>`;
  else illustration=`<g transform="translate(540 ${cy}) scale(${scale})"><path d="M0 213 V-200 M0 110 Q-183 71 -192 -71 Q-14 -68 0 110 M0 30 Q175 -12 188 -149 Q11 -151 0 30 M0 -71 Q-124 -120 -112 -224 Q-4 -210 0 -71" fill="${p}"/><path d="M0 199 Q169 144 211 38 Q72 25 0 199" fill="${s}"/><path d="M-188 231 H188" stroke="${p}" stroke-width="10" stroke-linecap="round"/></g>`;
  const headingY=wide?385:Math.min(h*.64,h-265), size=wide?46:h>1400?96:82;
  return `<path d="M${wide?86:70} 132 H${wide?994:1010}" stroke="${p}" stroke-width="2"/><g transform="rotate(${[0,-5,5,2][v]} 540 ${cy})">${illustration}</g>${textLines(value.title,{x:540,y:headingY,size,color:p,length:wide?36:23,max:wide?2:3,anchor:'middle'})}${textLines(value.subtitle,{x:540,y:h-101,size:24,color:p,length:60,max:2,weight:400,anchor:'middle'})}<path d="M70 ${h-53} H1010" stroke="${p}" stroke-width="2"/>`;
}

/** A deterministic, entirely local vector drawing. All user text and colours are constrained. */
export function buildStudioSvg(config = {}) {
  const value = configuration(config), [width, height] = FORMATS[value.format];
  const w = 1080, h = Math.round(height / width * w), p = value.primary, s = value.secondary, b = value.background;
  const variation = value.variation, wide = h < 850;
  const mark = escape((value.brand.trim().match(/[\p{L}\p{N}]/u)?.[0] || 'N').toUpperCase());
  const brand = `<text x="72" y="94" fill="${p}" font-family="Arial, Helvetica, sans-serif" font-size="26" font-weight="700" letter-spacing="4">${escape(value.brand.toUpperCase())}</text>`;
  let art = '';
  if (value.family !== 'abstract') {
    art = contextualArt(value,h);
  } else if (value.preset === 'affiche') {
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
const ATTRIBUTES = new Set('width height viewbox preserveaspectratio x y dx dy x1 y1 x2 y2 cx cy r rx ry d points fill stroke stroke-width stroke-linecap stroke-linejoin stroke-miterlimit stroke-dasharray stroke-dashoffset fill-rule clip-rule opacity fill-opacity stroke-opacity transform id clip-path mask font-family font-size font-weight font-style letter-spacing word-spacing text-anchor dominant-baseline alignment-baseline textlength lengthadjust vector-effect offset stop-color stop-opacity gradientunits gradienttransform spreadmethod patternunits patterncontentunits patterntransform href'.split(' '));
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
  if (document.getElementsByTagName('*').length > 5000) throw new Error('Ce SVG contient trop d’éléments pour être retouché dans le studio.');
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

/** Constrain edits before touching the detached SVG document. */
export function validateStudioEdit(patch = {}) {
  const result = {};
  for (const key of Object.keys(patch)) if (!['text','fill','stroke','dx','dy'].includes(key)) throw new Error('Cette modification n’est pas proposée dans le studio.');
  if (Object.hasOwn(patch,'text')) {
    if (typeof patch.text !== 'string' || patch.text.length > 500) throw new Error('Le texte d’un élément est limité à 500 caractères.');
    result.text = patch.text.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,'');
  }
  for (const key of ['fill','stroke']) if (Object.hasOwn(patch,key)) {
    if (typeof patch[key] !== 'string' || !/^#[a-f\d]{6}$/i.test(patch[key])) throw new Error('Choisissez une couleur au format #RRGGBB.');
    result[key]=patch[key];
  }
  for (const key of ['dx','dy']) if (Object.hasOwn(patch,key)) {
    if (typeof patch[key] !== 'number' || !Number.isFinite(patch[key]) || Math.abs(patch[key]) > 4096) throw new Error('Le déplacement doit rester compris entre −4096 et 4096.');
    result[key]=patch[key];
  }
  return result;
}

function vectorElements(svg) {
  return [...svg.querySelectorAll('text,path,rect,circle,ellipse,line,polyline,polygon,use')]
    .filter(element => !element.closest('defs,clipPath,mask,pattern,symbol'))
    .sort((a,b)=>Number(b.localName==='text')-Number(a.localName==='text')).slice(0,250);
}
function lineStart(element, first) {
  const dy=Number.parseFloat(element.getAttribute('dy')||'0');
  return first || element.hasAttribute('y') || Number.isFinite(dy)&&dy!==0;
}
function vectorText(element) {
  let text='', first=true;
  for(const child of element.childNodes){
    if(child.nodeType===3){if(!element.children.length||child.textContent.trim()){text+=child.textContent;first=false;}continue;}
    if(child.localName!=='tspan'){text+=child.textContent;continue;}
    if(!first&&lineStart(child,false))text+='\n';
    text+=child.textContent;first=false;
  }
  return text;
}
function replaceVectorText(element, value) {
  const spans=[...element.children].filter(child=>child.localName==='tspan');
  if(!spans.length&&!value.includes('\n')){element.textContent=value;return;}
  const originals=spans.filter((span,index)=>lineStart(span,index===0));
  const x=element.getAttribute('x')||originals[0]?.getAttribute('x')||'0';
  const step=originals.slice(1).find(span=>Number.parseFloat(span.getAttribute('dy'))>0)?.getAttribute('dy')||'1.15em';
  const lines=value.split('\n').map((text,index)=>{
    const original=originals[index]||originals.at(-1);
    const span=original?original.cloneNode(false):element.ownerDocument.createElementNS(SVG_NS,'tspan');
    if(!span.hasAttribute('x'))span.setAttribute('x',x);
    if(index>0&&!originals[index]){span.removeAttribute('y');span.setAttribute('dy',step);}
    else if(index>0&&!span.hasAttribute('y')&&!span.hasAttribute('dy'))span.setAttribute('dy',step);
    span.textContent=text;return span;
  });
  element.replaceChildren(...lines);
}
function patchVectorElement(element, patch, baseTransform = '', previous = {}) {
  const value=validateStudioEdit(patch), changes={...previous,...value};
  if (Object.hasOwn(value,'text')) {
    if (element.localName !== 'text') throw new Error('Choisissez un élément texte pour modifier son contenu.');
    replaceVectorText(element,value.text);
  }
  for (const key of ['fill','stroke']) if (Object.hasOwn(value,key)) {
    element.setAttribute(key,value[key]);
    // A text selection owns all its spans; explicit span paints must not hide
    // the colour chosen for that text in the inspector.
    if(element.localName==='text')for(const span of element.querySelectorAll('tspan'))if(span.hasAttribute(key))span.setAttribute(key,value[key]);
  }
  if (Object.hasOwn(value,'dx') || Object.hasOwn(value,'dy')) {
    const dx=changes.dx||0,dy=changes.dy||0,transform=`${dx||dy?`translate(${dx} ${dy}) `:''}${baseTransform}`.trim();
    if(transform)element.setAttribute('transform',transform);else element.removeAttribute('transform');
  }
  return changes;
}
/** Useful independently of the UI; returns inert, sanitized SVG after an explicit element edit. */
export function editStudioSvg(source, index, patch, options = {}) {
  const safe=sanitizeStudioSvg(source,options),Parser=options.DOMParserImpl||globalThis.DOMParser,Serializer=options.XMLSerializerImpl||globalThis.XMLSerializer;
  const doc=new Parser().parseFromString(safe,'image/svg+xml'), elements=vectorElements(doc.documentElement);
  if(!Number.isInteger(index)||index<0||index>=elements.length)throw new Error('Cet élément du dessin n’existe pas.');
  const element=elements[index];patchVectorElement(element,patch,element.getAttribute('transform')||'');
  return sanitizeStudioSvg(new Serializer().serializeToString(doc.documentElement),options);
}

export class CreativeStudio {
  constructor({ getMission = () => null, request = (...args) => fetch(...args), onCreate = async () => { throw new Error('La création avec Oscar n’est pas encore reliée à votre bureau.'); }, onClose = () => {}, draftStore = new DraftStorage() } = {}) {
    Object.assign(this,{getMission,request,onCreate,onClose,draftStore});
    this.config={...DEFAULTS};this.urls=new Set();this.epoch=0;this.destroyed=false;this.stage='brief';
    this.dialog=node('dialog','creative-studio');this.dialog.id='creative-studio';this.dialog.setAttribute('aria-labelledby','creative-studio-title');
    this.dialog.addEventListener('close',()=>{if(!this.dialog.open)this.closed();});
    document.body.append(this.dialog);this.build();
    const draft=this.draftStore.read('studio');if(typeof draft?.text==='string'){this.description.value=draft.text;this.draftNote.textContent='Brouillon retrouvé sur cet ordinateur. Il n’a pas été envoyé.';}
  }
  field(label,key,type='text',maxLength) {
    const wrapper=node('label','creative-field');wrapper.append(node('span','',label));
    const input=node(type==='textarea'?'textarea':'input');if(type!=='textarea')input.type=type;
    input.value=this.config[key];input.dataset.creativeField=key;input.dataset.noTranslate='';
    if(maxLength)input.maxLength=maxLength;
    input.addEventListener('input',()=>{this.config[key]=input.value;this.render();});wrapper.append(input);this.inputs.push(input);return wrapper;
  }
  select(label,values,value,change) {
    const wrapper=node('label','creative-field');wrapper.append(node('span','',label));const select=node('select');
    for(const [id,text] of Object.entries(values)){const option=node('option','',text);option.value=id;select.append(option);}
    select.value=value;select.addEventListener('change',()=>change(select.value));wrapper.append(select);return {wrapper,select};
  }
  build() {
    this.inputs=[];const header=node('header','creative-header'),group=node('div');group.append(node('span','creative-eyebrow','L’ATELIER DES IMAGES'));
    const title=node('h2','','De l’idée à votre création.');title.id='creative-studio-title';group.append(title,node('p','','Décrivez votre projet, puis ajustez le dessin réellement livré par Oscar et les agents.'));
    const close=node('button','creative-close','×');close.type='button';close.setAttribute('aria-label','Fermer le studio');close.addEventListener('click',()=>this.close());header.append(group,close);
    this.promptPanel=node('section','creative-brief-panel');const promptLabel=node('label','creative-prompt-label');promptLabel.append(node('span','','Que voulez-vous créer ?'));
    this.description=node('textarea','creative-description');this.description.maxLength=4000;this.description.rows=5;this.description.dataset.noTranslate='';this.description.setAttribute('aria-label','Décrivez votre idée');
    this.description.placeholder='Une affiche pour l’ouverture du café Lune, chaleureuse, avec une tasse dessinée, le nom du café et la date du 12 novembre.';
    promptLabel.append(this.description);this.promptPanel.append(promptLabel);
    const drafts=node('div','writing-draft');this.draftNote=node('p','','Votre texte est gardé 7 jours sur cet ordinateur, sans envoi automatique.');this.draftNote.setAttribute('role','status');this.clearDraft=node('button','creative-return','Effacer le brouillon');this.clearDraft.type='button';this.clearDraft.addEventListener('click',()=>{this.draftStore.remove('studio');this.description.value='';this.draftNote.textContent='Brouillon effacé.';this.description.focus();});drafts.append(this.draftNote,this.clearDraft);this.promptPanel.append(drafts);this.description.addEventListener('input',()=>this.saveDraft());
    const examples=node('div','creative-examples');examples.setAttribute('aria-label','Quelques idées pour commencer');
    for(const [label,text] of [['Un café','Une affiche pour l’ouverture du café Lune, avec une tasse dessinée, une ambiance chaleureuse et le nom du café.'],['Un événement','Une affiche pour un concert de jazz au jardin, avec un micro, une scène et une composition élégante.'],['Un livre','Une couverture de livre intitulé Les jours clairs, avec un livre ouvert et des couleurs douces.']]){
      const button=node('button','creative-example',label);button.type='button';button.addEventListener('click',()=>{this.description.value=text;this.saveDraft();this.description.focus();});examples.append(button);
    }
    const choices=node('div','creative-brief-options');const support=this.select('Votre support',PRESETS,this.config.preset,value=>{this.config.preset=value;});this.promptPreset=support.select;
    const formats={'1:1':'Carré · 1:1','4:5':'Portrait · 4:5',A4:'Affiche · A4','16:9':'Paysage · 16:9'};
    const format=this.select('Format',formats,this.config.format,value=>{this.config.format=value;});this.promptFormat=format.select;choices.append(support.wrapper,format.wrapper);
    const actions=node('div','creative-start-actions');this.oscar=node('button','creative-oscar','Créer avec Oscar et les agents');this.oscar.type='button';this.oscar.addEventListener('click',()=>this.createWithOscar());
    this.local=node('button','creative-local-button','Essayer une composition locale · sans IA');this.local.type='button';this.local.addEventListener('click',()=>this.createLocal());actions.append(this.oscar,this.local);
    this.promptPanel.append(examples,choices,actions,node('p','creative-start-note','La création avec Oscar lance une mission avec votre abonnement et produit un vrai fichier. La composition locale utilise des modèles dessinés dans le studio ; elle n’appelle aucune IA.'));
    this.message=node('p','creative-message');this.message.setAttribute('role','status');this.message.hidden=true;
    this.body=node('div','creative-body');this.body.hidden=true;this.controls=node('section','creative-controls');this.controls.setAttribute('aria-label','Personnaliser ma création');
    this.localSettings=node('div','creative-local-settings');this.localSettings.append(node('h3','','Personnaliser la composition locale'));
    const presets=node('div','creative-presets');this.presetButtons={};
    for(const [id,label] of Object.entries(PRESETS)){
      const button=node('button','creative-preset',label);button.type='button';button.dataset.creativePreset=id;button.addEventListener('click',()=>{this.config.preset=id;this.render();});presets.append(button);this.presetButtons[id]=button;
    }
    const family=this.select('Univers du dessin',FAMILIES,this.config.family,value=>{this.config.family=value;this.render();});this.family=family.select;
    const localFormat=this.select('Format',formats,this.config.format,value=>{this.config.format=value;this.render();});this.format=localFormat.select;
    this.localSettings.append(presets,family.wrapper,localFormat.wrapper,this.field('Nom de la marque','brand','text',80),this.field('Titre','title','textarea',180),this.field('Sous-titre','subtitle','textarea',240));
    const colors=node('div','creative-colors');colors.append(this.field('Couleur principale','primary','color'),this.field('Couleur secondaire','secondary','color'),this.field('Fond','background','color'));this.localSettings.append(colors);
    this.vary=node('button','creative-variation','↻ Explorer une autre composition');this.vary.type='button';this.vary.addEventListener('click',()=>{this.config.variation=(this.config.variation+1)%4;this.render();});
    const fine=node('button','creative-variation','Retoucher les éléments du SVG');fine.type='button';fine.addEventListener('click',()=>{this.imported={path:null};this.setupVectorEditor(this.source);this.mode.textContent='Composition locale · retouche des éléments';this.returnButton.hidden=false;});this.localSettings.append(this.vary,fine);
    this.vectorPanel=node('section','creative-vector-panel');this.vectorPanel.hidden=true;this.buildVectorControls();
    this.controls.append(this.localSettings,this.vectorPanel);
    this.canvas=node('section','creative-canvas');this.canvas.setAttribute('aria-label','Aperçu de la création');
    const bar=node('div','creative-preview-bar');this.mode=node('span','creative-mode');this.size=node('span','creative-size');bar.append(this.mode,this.size);
    this.preview=node('div','creative-preview');this.image=node('img','creative-artwork');this.image.alt='Aperçu de votre création';this.preview.append(this.image);
    this.returnButton=node('button','creative-return','Recréer la composition locale');this.returnButton.type='button';this.returnButton.hidden=true;this.returnButton.addEventListener('click',()=>{this.original();this.render();});
    const exports=node('div','creative-exports');this.svgButton=node('button','creative-export','Exporter SVG · modifiable');this.pngButton=node('button','creative-export creative-export-primary','Exporter PNG · image');
    for(const [button,kind] of [[this.svgButton,'svg'],[this.pngButton,'png']]){button.type='button';button.addEventListener('click',()=>this.export(kind));exports.append(button);}
    this.canvas.append(bar,this.preview,this.returnButton,exports,node('p','creative-local-note','Les retouches et les exports restent sur votre ordinateur, sans consommation de quota IA. Les SVG restent vectoriels ; une photo importée reste une image.'));
    this.assets=node('section','creative-assets');this.assets.append(node('h3','','Reprendre un visuel de la mission'));this.assetNote=node('p','creative-assets-note');this.assetList=node('div','creative-asset-list');this.assets.append(this.assetNote,this.assetList);
    this.controls.append(this.assets);this.body.append(this.controls,this.canvas);
    this.footer=node('footer','creative-footer');this.footer.hidden=true;this.back=node('button','creative-return','← Décrire une autre idée');this.back.type='button';this.back.addEventListener('click',()=>{this.stage='brief';this.promptPanel.hidden=false;this.body.hidden=true;this.back.hidden=true;this.resume.hidden=!this.source;this.description.focus();});
    this.resume=node('button','creative-return','Reprendre mon dessin');this.resume.type='button';this.resume.hidden=true;this.resume.addEventListener('click',()=>this.showEditor());this.footer.append(this.back,this.resume);
    this.dialog.append(header,this.promptPanel,this.message,this.body,this.footer);this.files();
  }
  buildVectorControls() {
    this.vectorPanel.append(node('h3','','Retoucher le SVG'),node('p','creative-edit-note','Choisissez un texte ou une forme, puis modifiez sa couleur ou sa position. Les changements seront conservés dans vos exports.'));
    const history=node('div','creative-history');history.setAttribute('aria-label','Historique des retouches');
    this.undoButton=node('button','creative-history-button','↶ Annuler la retouche');this.redoButton=node('button','creative-history-button','↷ Rétablir la retouche');
    for(const [button,forward]of [[this.undoButton,false],[this.redoButton,true]]){button.type='button';button.disabled=true;button.addEventListener('click',()=>this.stepHistory(forward));history.append(button);}
    this.vectorPanel.append(history);
    const choose=node('label','creative-field');choose.append(node('span','','Élément à modifier'));this.elementSelect=node('select');this.elementSelect.setAttribute('aria-label','Élément à modifier');this.elementSelect.addEventListener('change',()=>this.selectElement(Number(this.elementSelect.value)));choose.append(this.elementSelect);
    this.textField=node('label','creative-field');this.textField.append(node('span','','Texte de cet élément'));this.elementText=node('textarea');this.elementText.maxLength=500;this.elementText.dataset.noTranslate='';this.elementText.addEventListener('input',()=>this.applyElementEdit({text:this.elementText.value}));this.textField.append(this.elementText,node('small','creative-text-help','Appuyez sur Entrée pour passer à la ligne. Vérifiez les marges dans l’aperçu.'));
    const colors=node('div','creative-element-colors');
    for(const [key,label] of [['fill','Couleur de la forme'],['stroke','Couleur du contour']]){
      const wrapper=node('label','creative-field');wrapper.append(node('span','',label));const input=node('input');input.type='color';input.addEventListener('input',()=>this.applyElementEdit({[key]:input.value}));wrapper.append(input);colors.append(wrapper);this[key+'Input']=input;
    }
    const sliders=node('div','creative-position');this.positionInputs={};this.positionOutputs={};
    for(const [key,label] of [['dx','Déplacer horizontalement'],['dy','Déplacer verticalement']]){
      const wrapper=node('label','creative-field');wrapper.append(node('span','',label));const row=node('div','creative-range-row'),input=node('input'),output=node('output');input.type='range';input.min='-1080';input.max='1080';input.step='1';input.value='0';input.setAttribute('aria-label',label);input.addEventListener('input',()=>{output.value=input.value;this.applyElementEdit({[key]:Number(input.value)});});row.append(input,output);wrapper.append(row);sliders.append(wrapper);this.positionInputs[key]=input;this.positionOutputs[key]=output;
    }
    const reset=node('button','creative-variation','Réinitialiser cet élément');reset.type='button';reset.addEventListener('click',()=>this.resetElement());this.resetElementButton=reset;
    this.vectorPanel.append(choose,this.textField,colors,sliders,reset);
  }
  objectUrl(blob){const url=URL.createObjectURL(blob);this.urls.add(url);return url;}
  release(url){if(url){URL.revokeObjectURL(url);this.urls.delete(url);}}
  showMessage(text,failure=false){this.message.textContent=String(text||'').slice(0,1000);this.message.hidden=!text;this.message.classList.toggle('creative-error',failure);}
  showEditor(){this.stage='editor';this.promptPanel.hidden=true;this.body.hidden=false;this.footer.hidden=false;this.back.hidden=false;this.resume.hidden=true;}
  validDescription(){if(this.description.value.trim().length<12){this.showMessage('Décrivez votre idée en au moins 12 caractères pour commencer.',true);this.description.focus();return false;}return true;}
  saveDraft(){const saved=this.draftStore.write('studio',{text:this.description.value});this.draftNote.textContent=saved?'Votre texte est gardé 7 jours sur cet ordinateur, sans envoi automatique.':'Votre navigateur ne peut pas conserver ce brouillon. Gardez cette fenêtre ouverte.';}
  createLocal(){
    if(!this.validDescription())return;
    this.original();this.config=suggestStudioConfig(this.description.value,this.config);this.syncConfig();this.render();this.showEditor();
    this.showMessage('Composition locale créée avec un modèle du studio. Personnalisez ses textes et ses couleurs ; aucune IA n’a été appelée.');this.format.focus({preventScroll:true});
  }
  syncConfig(){for(const input of this.inputs)input.value=this.config[input.dataset.creativeField];this.format.value=this.config.format;this.family.value=this.config.family;this.promptPreset.value=this.config.preset;this.promptFormat.value=this.config.format;}
  original(){this.epoch++;this.abort?.abort();this.imported=null;this.vectorDocument=null;this.undoStack=[];this.redoStack=[];this.syncHistory();this.vectorPanel.hidden=true;this.localSettings.hidden=false;this.returnButton.hidden=true;}
  setPreview(blob,source){const old=this.previewUrl;this.blob=blob;this.source=source;this.previewUrl=this.objectUrl(blob);this.image.src=this.previewUrl;this.release(old);this.svgButton.disabled=!source;this.pngButton.disabled=false;}
  render(){
    if(this.destroyed||this.imported)return;
    for(const [id,button] of Object.entries(this.presetButtons))button.setAttribute('aria-pressed',String(this.config.preset===id));
    try{const source=buildStudioSvg(this.config);this.setPreview(new Blob([source],{type:'image/svg+xml'}),source);this.mode.textContent='Composition locale · sans IA';const [w,h]=FORMATS[this.config.format];this.size.textContent=`${w} × ${h}`;this.image.alt=`${PRESETS[this.config.preset]} — ${this.config.title}`;this.showMessage('');}catch(error){this.showMessage(error.message,true);}
  }
  setupVectorEditor(source){
    const safe=sanitizeStudioSvg(source);this.vectorDocument=new DOMParser().parseFromString(safe,'image/svg+xml');this.vectorNodes=vectorElements(this.vectorDocument.documentElement);this.vectorSnapshots=this.vectorNodes.map(element=>element.cloneNode(true));this.vectorChanges=new Map();this.undoStack=[];this.redoStack=[];this.syncHistory();this.elementSelect.replaceChildren();
    this.vectorNodes.forEach((element,index)=>{const option=node('option');option.value=String(index);this.elementSelect.append(option);});this.refreshElementLabels();
    const svg=this.vectorDocument.documentElement,box=(svg.getAttribute('viewBox')||'').trim().split(/[\s,]+/).map(Number),[w,h]=dimensions(svg);
    for(const [key,bound] of [['dx',box[2]||w],['dy',box[3]||h]]){const max=Math.min(4096,Math.max(100,Math.round(bound)));this.positionInputs[key].min=String(-max);this.positionInputs[key].max=String(max);}
    this.localSettings.hidden=true;this.vectorPanel.hidden=false;this.elementSelect.disabled=!this.vectorNodes.length;this.resetElementButton.disabled=!this.vectorNodes.length;this.selectElement(0);
  }
  refreshElementLabels(){for(let index=0;index<this.vectorNodes.length;index++){const element=this.vectorNodes[index],option=this.elementSelect.options[index];const text=element.localName==='text'?element.textContent.trim().slice(0,42):element.localName;option.textContent=`${index+1} · ${text||element.localName}`;option.dataset.noTranslate='';}}
  selectElement(index){
    const element=this.vectorNodes?.[index];this.selectedElement=index;this.textField.hidden=element?.localName!=='text';this.elementText.value=element?.localName==='text'?vectorText(element):'';
    for(const key of ['fill','stroke']){const color=element?.getAttribute(key)||'';this[key+'Input'].value=/^#[\da-f]{6}$/i.test(color)?color:'#365b4b';this[key+'Input'].disabled=!element;}
    const changes=this.vectorChanges?.get(index)||{};for(const key of ['dx','dy']){this.positionInputs[key].disabled=!element;this.positionInputs[key].value=String(changes[key]||0);this.positionOutputs[key].value=String(changes[key]||0);}
  }
  applyElementEdit(patch){
    const index=this.selectedElement,element=this.vectorNodes?.[index];if(!element)return;
    try{const before=element.cloneNode(true),beforeChanges=this.vectorChanges.get(index);this.vectorChanges.set(index,patchVectorElement(element,patch,this.vectorSnapshots[index].getAttribute('transform')||'',beforeChanges));this.recordHistory(index,before,beforeChanges,Object.keys(patch).sort().join(','));this.renderVector();this.refreshElementLabels();this.showMessage('Modification appliquée au dessin. Vos exports conserveront cette version.');}catch(error){this.showMessage(error.message,true);}
  }
  recordHistory(index,before,beforeChanges,group){
    const after=this.vectorNodes[index].cloneNode(true);if(before.isEqualNode(after))return;
    const now=Date.now(),previous=this.undoStack.at(-1),afterChanges={...this.vectorChanges.get(index)};
    if(!this.redoStack.length&&previous?.index===index&&previous.group===group&&now-previous.at<650){previous.after=after;previous.afterChanges=afterChanges;previous.at=now;}
    else this.undoStack.push({index,before,after,beforeChanges:beforeChanges?{...beforeChanges}:null,afterChanges,group,at:now});
    this.redoStack=[];
    let bytes=this.undoStack.reduce((total,item)=>total+item.before.outerHTML.length+item.after.outerHTML.length,0);
    while(this.undoStack.length>40||bytes>8*1024*1024&&this.undoStack.length>1){const oldest=this.undoStack.shift();bytes-=oldest.before.outerHTML.length+oldest.after.outerHTML.length;}
    this.syncHistory();
  }
  syncHistory(){if(this.undoButton)this.undoButton.disabled=!this.undoStack?.length;if(this.redoButton)this.redoButton.disabled=!this.redoStack?.length;}
  stepHistory(forward=false){
    const source=forward?this.redoStack:this.undoStack,target=forward?this.undoStack:this.redoStack,entry=source?.pop();if(!entry||!this.vectorDocument)return;
    const element=(forward?entry.after:entry.before).cloneNode(true),changes=forward?entry.afterChanges:entry.beforeChanges;
    this.vectorNodes[entry.index].replaceWith(element);this.vectorNodes[entry.index]=element;
    if(changes)this.vectorChanges.set(entry.index,{...changes});else this.vectorChanges.delete(entry.index);
    entry.at=0;target.push(entry);this.syncHistory();this.refreshElementLabels();this.selectElement(entry.index);this.renderVector();this.showMessage(forward?'Retouche rétablie.':'Retouche annulée.');
  }
  resetElement(){const index=this.selectedElement,element=this.vectorNodes?.[index];if(!element)return;const before=element.cloneNode(true),beforeChanges=this.vectorChanges.get(index),original=this.vectorSnapshots[index].cloneNode(true);element.replaceWith(original);this.vectorNodes[index]=original;this.vectorChanges.delete(index);this.recordHistory(index,before,beforeChanges,'reset');this.refreshElementLabels();this.selectElement(index);this.renderVector();this.showMessage('Cet élément a retrouvé son état initial.');}
  renderVector(){if(!this.vectorDocument)return;const source=sanitizeStudioSvg(new XMLSerializer().serializeToString(this.vectorDocument.documentElement));this.setPreview(new Blob([source],{type:'image/svg+xml'}),source);}
  files(){
    const mission=this.getMission();this.assetList.replaceChildren();const files=(mission?.files||[]).filter(file=>{try{validateStudioFilePath(file.path);return true;}catch{return false;}}).slice(0,60);
    this.assetNote.textContent=files.length?'Ouvrez un visuel livré : les textes, les couleurs et les positions d’un SVG pourront être modifiés.':'Les fichiers SVG, PNG, JPEG et WebP de la mission apparaîtront ici.';
    for(const file of files){const button=node('button','creative-asset',file.path);button.type='button';button.title=file.path;button.dataset.noTranslate='';button.addEventListener('click',()=>this.loadFile(mission.id,file.path));this.assetList.append(button);}
    // Assets are reachable from the first screen too, without creating a local drawing.
    if(!this.assetEntry){this.assetEntry=node('button','creative-import-entry','Ouvrir un visuel de la mission');this.assetEntry.type='button';this.assetEntry.addEventListener('click',()=>{this.showEditor();if(!this.source){this.localSettings.hidden=true;this.vectorPanel.hidden=true;this.svgButton.disabled=true;this.pngButton.disabled=true;this.mode.textContent='Choisissez un visuel de la mission';}this.assets.scrollIntoView({block:'nearest'});});this.promptPanel.append(this.assetEntry);}
    this.assetEntry.hidden=!files.length;
  }
  async openFile(id,filePath){this.open();return this.loadFile(id,filePath);}
  async loadFile(id,filePath){
    const epoch=++this.epoch;this.abort?.abort();this.abort=new AbortController();this.showMessage('Ouverture du visuel de la mission…');let candidateUrl;
    try{
      const response=await this.request(studioFileUrl(id,filePath),{method:'GET',credentials:'same-origin',cache:'no-store',signal:this.abort.signal});
      if(response?.ok===false)throw new Error('Ce fichier n’a pas pu être ouvert depuis la mission.');
      if(Number(response?.headers?.get('content-length'))>LIMIT)throw new Error('Ce visuel dépasse 20 Mo. Choisissez un fichier plus léger.');
      let blob;
      if(response instanceof Blob)blob=response;
      else if(response?.body?.getReader){const reader=response.body.getReader(),chunks=[];let size=0;try{while(true){const next=await reader.read();if(next.done)break;size+=next.value.byteLength;if(size>LIMIT){await reader.cancel();throw new Error('Ce visuel dépasse 20 Mo. Choisissez un fichier plus léger.');}chunks.push(next.value);}}finally{reader.releaseLock();}blob=new Blob(chunks);}
      else blob=await response.blob();
      if(blob.size>LIMIT)throw new Error('Ce visuel dépasse 20 Mo. Choisissez un fichier plus léger.');let safeBlob,source=null;
      if(/\.svg$/i.test(filePath)){source=sanitizeStudioSvg(await blob.text());safeBlob=new Blob([source],{type:'image/svg+xml'});}
      else{const bytes=new Uint8Array(await blob.slice(0,16).arrayBuffer());const png=bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71&&bytes[4]===13&&bytes[5]===10&&bytes[6]===26&&bytes[7]===10,jpeg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255,webp=String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP';if(!png&&!jpeg&&!webp)throw new Error('Le contenu de ce fichier n’est pas une image PNG, JPEG ou WebP reconnue.');safeBlob=new Blob([blob],{type:png?'image/png':jpeg?'image/jpeg':'image/webp'});}
      if(epoch!==this.epoch||!this.dialog.open)return;candidateUrl=this.objectUrl(safeBlob);await this.decode(candidateUrl);if(epoch!==this.epoch||!this.dialog.open){this.release(candidateUrl);return;}
      this.release(this.previewUrl);this.previewUrl=candidateUrl;candidateUrl=null;this.image.src=this.previewUrl;this.image.alt=`Visuel livré : ${filePath}`;this.imported={path:filePath};this.blob=safeBlob;this.source=source;this.returnButton.hidden=false;
      if(source)this.setupVectorEditor(source);else{this.vectorDocument=null;this.vectorPanel.hidden=true;this.localSettings.hidden=true;}
      this.mode.textContent=source?'SVG livré · modifiable':'Image livrée';this.size.textContent=filePath.split('/').at(-1);this.size.dataset.noTranslate='';this.svgButton.disabled=!source;this.pngButton.disabled=false;this.showEditor();
      this.showMessage(source?'SVG vérifié et prêt à retoucher. Choisissez un texte ou une forme dans la liste.':'Image prête à exporter en PNG. Les photographies ne sont pas transformées en formes modifiables.');
    }catch(error){this.release(candidateUrl);if(epoch===this.epoch&&error.name!=='AbortError')this.showMessage('Impossible d’ouvrir ce visuel. '+error.message,true);}
  }
  decode(url){return new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>image.naturalWidth&&image.naturalHeight&&image.naturalWidth*image.naturalHeight<=64*1024*1024?resolve(image):reject(new Error('Cette image ne contient pas de dimensions utilisables ou dépasse 64 millions de pixels.'));image.onerror=()=>reject(new Error('Le navigateur ne peut pas lire cette image.'));image.src=url;});}
  download(blob,name){const url=this.objectUrl(blob),anchor=node('a');anchor.href=url;anchor.download=name;document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>this.release(url),2000);}
  async export(kind){
    if(this.exporting||!this.blob)return;this.exporting=true;this.svgButton.disabled=true;this.pngButton.disabled=true;
    try{const filename=(this.imported?.path?.split('/').at(-1)?.replace(/\.[^.]+$/,'')||this.config.brand||'creation').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z\d-]+/gi,'-').replace(/^-|-$/g,'').slice(0,60)||'creation';
      if(kind==='svg'){if(!this.source)throw new Error('Ce visuel est une image. Choisissez PNG pour l’exporter.');this.download(new Blob([sanitizeStudioSvg(this.source)],{type:'image/svg+xml'}),filename+'.svg');}
      else{const image=await this.decode(this.previewUrl),scale=Math.min(1,4096/image.naturalWidth,4096/image.naturalHeight),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));const context=canvas.getContext('2d');if(!context)throw new Error('Le dessin PNG n’est pas disponible dans ce navigateur. Essayez le SVG.');context.drawImage(image,0,0,canvas.width,canvas.height);const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob)throw new Error('La création PNG a échoué. Essayez le SVG ou un format plus petit.');this.download(blob,filename+'.png');canvas.width=canvas.height=1;}
      this.showMessage('Votre export est prêt dans les téléchargements du navigateur.');
    }catch(error){this.showMessage('L’export n’a pas abouti. '+error.message,true);}finally{this.exporting=false;this.svgButton.disabled=!this.source;this.pngButton.disabled=false;}
  }
  brief(){
    const value=configuration(this.config),description=this.description.value.trim();
    return `Crée réellement le visuel décrit ci-dessous, en mobilisant les agents design et code utiles. Ne te contente pas d’un plan ou d’un brief.\n\nDESCRIPTION DE LA CRÉATION\n${description}\n\nSupport : ${PRESETS[value.preset]}\nFormat : ${value.format}${this.stage==='editor'?`\nRéglages de composition souhaités :\nMarque : ${value.brand}\nTitre : ${value.title}\nSous-titre : ${value.subtitle}\nCouleurs : ${value.primary}, ${value.secondary}, ${value.background}`:''}${this.imported?.path?`\nRéférence existante : ${this.imported.path}`:''}\n\nLivre au minimum un fichier SVG vectoriel original et entièrement modifiable dans Livraison/, avec une composition et une illustration adaptées au sujet, de vrais éléments texte, une typographie lisible et de bons contrastes. Évite les gabarits génériques sans rapport avec le sujet. Utilise des polices système et aucun script, image distante, ressource externe ou foreignObject : le fichier doit s’ouvrir seul et rester éditable dans le studio. Ajoute un aperçu PNG si les outils locaux le permettent. Vérifie les fichiers réels, les dimensions, l’orthographe et les marges. Pour une photo réaliste, explique les limites des outils disponibles sans prétendre avoir généré une photo. N’achète rien, ne publie rien et n’envoie rien.`;
  }
  async createWithOscar(){
    if(this.creating||!this.validDescription())return;this.creating=true;const controls=[...this.promptPanel.querySelectorAll('input,select,textarea,button')].map(input=>[input,input.disabled]);for(const[input]of controls)input.disabled=true;this.showMessage('Transmission de votre création à Oscar…');
    try{const result=await this.onCreate({template:'creation-visuelle',brief:this.brief(),description:this.description.value.trim()});if(!result?.id)throw new Error('Le lancement de la mission n’a pas été confirmé.');this.draftStore.remove('studio');this.lastMissionId=result.id;this.showMessage('');if(this.dialog.open)this.close();return result;}
    catch(error){if(!this.destroyed)this.showMessage('La création n’a pas pu être lancée. '+String(error?.message||'Réessayez en conservant votre description.').slice(0,400),true);}
    finally{this.creating=false;if(!this.destroyed)for(const[input,disabled]of controls)input.disabled=disabled;}
  }
  open(){if(this.destroyed)throw new Error('Ce studio a été fermé définitivement.');if(this.dialog.open)return;this.returnFocus=document.activeElement;this.notified=false;this.files();this.dialog.showModal();(this.stage==='brief'?this.description:this.elementSelect?.isConnected&&!this.vectorPanel.hidden?this.elementSelect:this.format).focus({preventScroll:true});}
  closed(){if(this.notified)return;this.notified=true;this.epoch++;this.abort?.abort();if(!this.destroyed){if(this.returnFocus?.isConnected)this.returnFocus.focus({preventScroll:true});this.onClose();}}
  close(){if(this.dialog.open){this.dialog.close();this.closed();}}
  destroy(){this.destroyed=true;this.abort?.abort();if(this.dialog.open)this.dialog.close();for(const url of this.urls)URL.revokeObjectURL(url);this.urls.clear();this.dialog.remove();}
}
