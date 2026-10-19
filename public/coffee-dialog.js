const DEFAULT_RECIPIENT = 'renaud2005@gmail.com';
let coffeeDialogNumber = 0;

function donationUrl(recipient) {
  // PayPal Payments Standard: recipient, proposed amount and currency.
  // https://developer.paypal.com/archive/paypal-payments-standard/integration-guide/Appx-websitestandard-htmlvariables
  const url = new URL('https://www.paypal.com/cgi-bin/webscr');
  url.searchParams.set('cmd', '_donations');
  url.searchParams.set('business', recipient);
  url.searchParams.set('amount', '0.20');
  url.searchParams.set('currency_code', 'EUR');
  url.searchParams.set('item_name', 'Un café pour Renaud · Oscar et les Agents');
  url.searchParams.set('no_shipping', '1');
  return url.href;
}

class CoffeeDialogView {
  constructor({ recipient = DEFAULT_RECIPIENT, onClose } = {}) {
    if (typeof recipient !== 'string' || recipient.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) throw new TypeError('Une adresse e-mail PayPal valide est nécessaire.');
    if (!globalThis.document?.body) throw new Error('La fenêtre café doit être créée lorsque la page est prête.');
    this.recipient = recipient;
    this.onClose = typeof onClose === 'function' ? onClose : () => {};
    this.document = globalThis.document;
    this.number = ++coffeeDialogNumber;
    this.visible = false;
    this.destroyed = false;
    this.build();
  }

  element(tag, className, text) {
    const node = this.document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
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
    close.setAttribute('aria-label', 'Fermer la pause café');
    close.addEventListener('click', () => this.close());
    this.closeButton = close;

    const art = this.element('div', 'coffee-art');
    art.setAttribute('aria-hidden', 'true');
    for (let i = 1; i <= 3; i++) art.appendChild(this.element('span', `coffee-steam coffee-steam-${i}`));
    const cup = this.element('div', 'coffee-cup');
    cup.append(this.element('span', 'coffee-eyes'), this.element('span', 'coffee-smile'));
    art.append(cup, this.element('span', 'coffee-saucer'), this.element('span', 'coffee-heart'));

    const eyebrow = this.element('p', 'coffee-eyebrow', 'La petite pause du bureau');
    const heading = this.element('h2', 'coffee-title', 'Un café pour Renaud ?');
    heading.id = titleId;
    const intro = this.element('p', 'coffee-intro', 'Un petit coup de pouce pour le créateur d’Oscar et les Agents.');
    const price = this.element('p', 'coffee-price', '0,20 €');
    const recipient = this.element('div', 'coffee-recipient');
    recipient.append(this.element('span', 'coffee-recipient-label', 'Destinataire PayPal'), this.element('strong', 'coffee-recipient-email', this.recipient));

    const note = this.element('p', 'coffee-note', 'Ce café est volontaire. PayPal s’ouvrira dans un nouvel onglet : vous pourrez y vérifier le destinataire et confirmer le paiement de 0,20 €.');
    note.id = noteId;
    const continuity = this.element('p', 'coffee-continuity', 'Votre équipe continue de travailler, avec ou sans café.');

    const actions = this.element('div', 'coffee-actions');
    const paypal = this.element('a', 'coffee-paypal', 'Offrir 0,20 € sur PayPal');
    paypal.href = donationUrl(this.recipient);
    paypal.target = '_blank';
    paypal.rel = 'noopener noreferrer';
    paypal.referrerPolicy = 'no-referrer';
    paypal.setAttribute('aria-label', 'Offrir 0,20 € sur PayPal — ouvre un nouvel onglet, paiement à confirmer');
    this.paymentLink = paypal;
    const decline = this.element('button', 'coffee-decline', 'Pas cette fois');
    decline.type = 'button';
    decline.addEventListener('click', () => this.close());
    actions.append(paypal, decline);

    dialog.append(close, art, eyebrow, heading, intro, price, recipient, note, actions, continuity);
    dialog.addEventListener('cancel', event => { event.preventDefault(); this.close(); });
    dialog.addEventListener('close', () => { if (!dialog.open) this.finishedClosing(); });
    dialog.addEventListener('click', event => {
      if (event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) this.close();
    });
    this.document.body.appendChild(dialog);
  }

  open() {
    if (this.destroyed) throw new Error('La fenêtre café a été retirée de la page.');
    if (this.visible) { this.closeButton.focus(); return this; }
    this.previousFocus = this.document.activeElement;
    this.dialog.showModal();
    this.visible = true;
    // Opening the window never initiates navigation or a payment.
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

// Supports both CoffeeDialog(options) and new CoffeeDialog(options).
export function CoffeeDialog(options = {}) {
  return new CoffeeDialogView(options);
}
