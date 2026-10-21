function abortError(signal) {
  return signal?.reason instanceof Error ? signal.reason : new DOMException('Travail annulé.', 'AbortError');
}

// Shared by the missions of one office; Oscar's reviews do not occupy a specialist seat.
export class SpecialistPool {
  #limit;
  #active = 0;
  #queue = [];

  constructor({ limit = 20 } = {}) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new RangeError('Le bureau accepte de 1 à 20 spécialistes simultanés.');
    this.#limit = limit;
  }

  get limit() { return this.#limit; }
  get active() { return this.#active; }
  get pending() { return this.#queue.length; }

  acquire(signal) {
    if (signal?.aborted) return Promise.reject(abortError(signal));
    return new Promise((resolve, reject) => {
      const entry = { resolve, reject, signal, onAbort: null };
      entry.onAbort = () => {
        const index = this.#queue.indexOf(entry);
        if (index < 0) return;
        this.#queue.splice(index, 1);
        signal.removeEventListener('abort', entry.onAbort);
        reject(abortError(signal));
      };
      signal?.addEventListener('abort', entry.onAbort, { once: true });
      this.#queue.push(entry);
      this.#drain();
    });
  }

  #drain() {
    while (this.#active < this.#limit && this.#queue.length) {
      const entry = this.#queue.shift();
      entry.signal?.removeEventListener('abort', entry.onAbort);
      if (entry.signal?.aborted) { entry.reject(abortError(entry.signal)); continue; }
      this.#active++;
      let released = false;
      entry.resolve(() => {
        if (released) return;
        released = true;
        this.#active--;
        this.#drain();
      });
    }
  }
}
