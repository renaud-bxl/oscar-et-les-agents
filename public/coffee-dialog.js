const DEFAULT_RECIPIENT = 'renaud2005@gmail.com';
let coffeeDialogNumber = 0;

export const SUPPORT_OPTIONS = Object.freeze([
  Object.freeze({ id: 'cafe', label: 'Café', amount: '1.00', displayAmount: '1 €' }),
  Object.freeze({ id: 'sandwich', label: 'Sandwich', amount: '5.00', displayAmount: '5 €' }),
  Object.freeze({ id: 'snack', label: 'Snack', amount: '20.00', displayAmount: '20 €' }),
  Object.freeze({ id: 'resto', label: 'Resto', amount: '50.00', displayAmount: '50 €' }),
]);

function validRecipient(recipient) {
  if (typeof recipient !== 'string' || recipient.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) throw new TypeError('Une adresse e-mail PayPal valide est nécessaire.');
  return recipient;
}

function supportOption(id) {
  const option = SUPPORT_OPTIONS.find(item => item.id === id);
  if (!option) throw new TypeError('Choisissez Café, Sandwich, Snack ou Resto.');
  return option;
}

export function buildDonationUrl({ recipient = DEFAULT_RECIPIENT, option = 'cafe' } = {}) {
  const selected = supportOption(option);
  // Existing PayPal Payments Standard route: no transaction is created here.
  const url = new URL('https://www.paypal.com/cgi-bin/webscr');
  url.searchParams.set('cmd', '_donations');
  url.searchParams.set('business', validRecipient(recipient));
  url.searchParams.set('amount', selected.amount);
  url.searchParams.set('currency_code', 'EUR');
  url.searchParams.set('item_name', `${selected.label} · soutien volontaire à Oscar et les Agents`);
  url.searchParams.set('no_shipping', '1');
  return url.href;
}

class CoffeeDialogView {
  constructor({ recipient = DEFAULT_RECIPIENT, onClose } = {}) {
    this.recipient = validRecipient(recipient);
    if (!globalThis.document?.body) throw new Error('La fenêtre de soutien doit être créée lorsque la page est prête.');
    this.onClose = typeof onClose === 'function' ? onClose : () => {};
    this.document = globalThis.document;
    this.number = ++coffeeDialogNumber;
    this.visible = false;
    this.destroyed = false;
    this.optionInputs = new Map();
    this.optionCards = new Map();
    this.build();
  }

  element(tag, className, text) {
    const node = this.document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  illustration(id) {
    const namespace = 'http://www.w3.org/2000/svg';
    const svg = this.document.createElementNS(namespace, 'svg');
    svg.setAttribute('viewBox', '0 0 64 64');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    const shape = (tag, attributes) => {
      const node = this.document.createElementNS(namespace, tag);
      for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
      svg.append(node);
    };
    const face = (y = 34) => {
      shape('circle', { cx: 25, cy: y, r: 1.4, fill: '#635750' });
      shape('circle', { cx: 37, cy: y, r: 1.4, fill: '#635750' });
      shape('path', { d: `M28 ${y + 6}q3 3 6 0`, stroke: '#9C7463', 'stroke-width': 1.7, 'stroke-linecap': 'round' });
    };
    if (id === 'cafe') {
      shape('ellipse', { cx: 32, cy: 53, rx: 23, ry: 4, fill: '#DCC9AE', opacity: .65 });
      shape('path', { d: 'M46 27h4a8 8 0 0 1 0 16h-5', stroke: '#B79D7D', 'stroke-width': 4 });
      shape('path', { d: 'M15 23h32v15a15 15 0 0 1-15 15h-2a15 15 0 0 1-15-15Z', fill: '#FFFDFA', stroke: '#B79D7D', 'stroke-width': 2 });
      shape('ellipse', { cx: 31, cy: 23, rx: 16, ry: 5, fill: '#AB7956', stroke: '#B79D7D', 'stroke-width': 2 });
      shape('path', { d: 'M25 15q-5-4 0-9M36 15q-5-4 0-9', stroke: '#CBB8A0', 'stroke-width': 2, 'stroke-linecap': 'round' });
      face(35);
    } else if (id === 'sandwich') {
      shape('ellipse', { cx: 32, cy: 52, rx: 24, ry: 4, fill: '#D5C9A6', opacity: .6 });
      shape('path', { d: 'm10 43 20-28a3 3 0 0 1 5 0l20 28a5 5 0 0 1-4 8H14a5 5 0 0 1-4-8', fill: '#E8BD8C', stroke: '#C7996B', 'stroke-width': 2, 'stroke-linejoin': 'round' });
      shape('path', { d: 'm11 40 4 3 6-3 6 3 6-3 6 3 6-3 8 3', stroke: '#8DA97C', 'stroke-width': 5, 'stroke-linejoin': 'round' });
      shape('path', { d: 'M13 45h38', stroke: '#D89478', 'stroke-width': 3, 'stroke-linecap': 'round' });
      shape('path', { d: 'm13 38 18-24a2 2 0 0 1 3 0l18 24Z', fill: '#FFF4DA', stroke: '#C7996B', 'stroke-width': 2, 'stroke-linejoin': 'round' });
      face(29);
    } else if (id === 'snack') {
      shape('ellipse', { cx: 32, cy: 53, rx: 21, ry: 4, fill: '#DCC3AD', opacity: .6 });
      shape('circle', { cx: 32, cy: 31, r: 22, fill: '#E7BD86', stroke: '#C69B6E', 'stroke-width': 2 });
      for (const [cx, cy, r] of [[20,20,2.5],[39,16,2.8],[46,30,2.2],[19,39,2.5],[37,46,2.7]]) shape('circle', { cx, cy, r, fill: '#AA7856' });
      face(30);
    } else {
      shape('circle', { cx: 32, cy: 32, r: 22, fill: '#FFFEFB', stroke: '#ACBFC8', 'stroke-width': 2 });
      shape('circle', { cx: 32, cy: 32, r: 16, fill: '#F7F2E8', stroke: '#D9E0E0', 'stroke-width': 1.5 });
      shape('path', { d: 'M5 13v13q0 4 4 4v21M9 13v16M13 13v13q0 4-4 4M58 13v38M58 13q-8 6-6 17h6', stroke: '#91A8B4', 'stroke-width': 2.7, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
      face(29);
    }
    return svg;
  }

  build() {
    const dialog = this.element('dialog', 'coffee-dialog');
    dialog.id = `coffee-dialog-${this.number}`;
    const titleId = `coffee-title-${this.number}`;
    const noteId = `coffee-note-${this.number}`;
    dialog.setAttribute('aria-labelledby', titleId);
    dialog.setAttribute('aria-describedby', noteId);
    dialog.setAttribute('aria-modal', 'true');
    this.dialog = dialog;

    const close = this.element('button', 'coffee-close', '×');
    close.type = 'button';
    close.setAttribute('aria-label', 'Fermer la fenêtre de soutien');
    close.addEventListener('click', () => this.close());
    this.closeButton = close;

    const hero = this.element('div', 'coffee-hero');
    const heroArt = this.element('span', 'coffee-hero-art');
    heroArt.setAttribute('aria-hidden', 'true');
    heroArt.append(this.illustration('cafe'));
    const heroCopy = this.element('div', 'coffee-hero-copy');
    const heading = this.element('h2', 'coffee-title', 'Un coup de pouce à Renaud ?');
    heading.id = titleId;
    heroCopy.append(this.element('p', 'coffee-eyebrow', 'La petite pause du bureau'), heading);
    hero.append(heroArt, heroCopy);
    const intro = this.element('p', 'coffee-intro', 'Choisissez une attention pour le créateur d’Oscar et les Agents. Chaque soutien est volontaire.');

    const options = this.element('fieldset', 'coffee-options');
    options.append(this.element('legend', '', 'Choisissez votre soutien'));
    const grid = this.element('div', 'coffee-option-grid');
    for (const option of SUPPORT_OPTIONS) {
      const card = this.element('label', `coffee-option coffee-option-${option.id}`);
      const input = this.element('input', 'coffee-option-input');
      input.type = 'radio';
      input.name = `coffee-support-${this.number}`;
      input.value = option.id;
      input.id = `coffee-support-${this.number}-${option.id}`;
      input.setAttribute('aria-label', `${option.label}, ${option.displayAmount}, soutien volontaire`);
      input.addEventListener('change', () => { if (input.checked) this.selectOption(option.id); });
      const art = this.element('span', 'coffee-option-art');
      art.setAttribute('aria-hidden', 'true');
      art.append(this.illustration(option.id));
      const copy = this.element('span', 'coffee-option-copy');
      copy.append(this.element('strong', 'coffee-option-name', option.label), this.element('span', 'coffee-option-amount', option.displayAmount));
      card.append(art, copy, input);
      grid.append(card);
      this.optionInputs.set(option.id, input);
      this.optionCards.set(option.id, card);
    }
    options.append(grid);

    const summary = this.element('div', 'coffee-summary');
    summary.setAttribute('aria-live', 'polite');
    summary.setAttribute('aria-atomic', 'true');
    const selection = this.element('div', 'coffee-selection');
    selection.append(this.element('span', 'coffee-selection-label', 'Votre soutien'));
    this.selectionName = this.element('strong', 'coffee-selection-name');
    selection.append(this.selectionName);
    this.price = this.element('span', 'coffee-price');
    summary.append(selection, this.price);

    const recipient = this.element('div', 'coffee-recipient');
    recipient.append(this.element('span', 'coffee-recipient-label', 'Destinataire PayPal'), this.element('strong', 'coffee-recipient-email', this.recipient));
    const symbolic = this.element('p', 'coffee-symbolic', 'Ces noms sont symboliques : aucun repas ni produit n’est fourni. Ce soutien ne débloque aucune fonction.');
    this.note = this.element('p', 'coffee-note');
    this.note.id = noteId;

    const actions = this.element('div', 'coffee-actions');
    const paypal = this.element('a', 'coffee-paypal');
    paypal.target = '_blank';
    paypal.rel = 'noopener noreferrer';
    paypal.referrerPolicy = 'no-referrer';
    this.paymentLink = paypal;
    const decline = this.element('button', 'coffee-decline', 'Pas cette fois');
    decline.type = 'button';
    decline.addEventListener('click', () => this.close());
    actions.append(paypal, decline);
    const continuity = this.element('p', 'coffee-continuity', 'Votre équipe continue de travailler, avec ou sans soutien.');

    dialog.append(close, hero, intro, options, summary, recipient, symbolic, this.note, actions, continuity);
    dialog.addEventListener('cancel', event => { event.preventDefault(); this.close(); });
    dialog.addEventListener('close', () => { if (!dialog.open) this.finishedClosing(); });
    dialog.addEventListener('click', event => {
      if (event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) this.close();
    });
    this.selectOption('cafe');
    this.document.body.appendChild(dialog);
  }

  selectOption(id) {
    const option = supportOption(id);
    this.selectedOption = option;
    for (const item of SUPPORT_OPTIONS) {
      const selected = item.id === option.id;
      this.optionInputs.get(item.id).checked = selected;
      this.optionCards.get(item.id).dataset.selected = String(selected);
    }
    this.selectionName.textContent = option.label;
    this.price.textContent = option.displayAmount;
    this.paymentLink.href = buildDonationUrl({ recipient: this.recipient, option: option.id });
    this.paymentLink.textContent = `${option.label} · ${option.displayAmount} sur PayPal ↗`;
    this.paymentLink.setAttribute('aria-label', `Soutien ${option.label} de ${option.displayAmount} à ${this.recipient} sur PayPal. Ouvre un nouvel onglet ; paiement à confirmer.`);
    this.note.textContent = `PayPal s’ouvrira dans un nouvel onglet. Vous pourrez y vérifier le destinataire et confirmer le soutien de ${option.displayAmount}.`;
  }

  open() {
    if (this.destroyed) throw new Error('La fenêtre de soutien a été retirée de la page.');
    if (this.visible) { this.closeButton.focus(); return this; }
    this.previousFocus = this.document.activeElement;
    // Every new opening starts with the smallest amount, regardless of prior choices.
    this.selectOption('cafe');
    this.dialog.showModal();
    this.visible = true;
    this.closeButton.focus();
    return this;
  }

  finishedClosing() {
    if (!this.visible) return;
    this.visible = false;
    if (this.previousFocus?.isConnected && typeof this.previousFocus.focus === 'function') this.previousFocus.focus();
    this.onClose();
  }

  close() {
    if (this.dialog.open) this.dialog.close();
    this.finishedClosing();
    return this;
  }

  destroy() {
    if (this.destroyed) return;
    this.close();
    this.dialog.remove();
    this.destroyed = true;
    this.onClose = () => {};
  }
}

// Preserve both CoffeeDialog(options) and new CoffeeDialog(options).
export function CoffeeDialog(options = {}) {
  return new CoffeeDialogView(options);
}
