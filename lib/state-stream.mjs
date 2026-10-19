// State events are snapshots. A slow tab needs the newest snapshot, without
// queuing every intermediate version behind a socket that cannot drain.
export class StateStream {
  constructor({ snapshot = value => value, delay = 75, heartbeatMs = 20000 } = {}) {
    this.snapshot = snapshot;
    this.delay = delay;
    this.clients = new Map();
    this.latest = null;
    this.pending = null;
    this.timer = null;
    this.closed = false;
    this.heartbeat = setInterval(() => {
      for (const [response] of this.clients) {
        if (response.destroyed || response.writableEnded) this.remove(response);
        else if (!response.writableNeedDrain) response.write(': heartbeat\n\n');
      }
    }, heartbeatMs);
    this.heartbeat.unref?.();
  }
  encode(state) { return `event: state\ndata: ${JSON.stringify(this.snapshot(state))}\n\n`; }
  add(response, state) {
    if (this.closed) { response.end(); return; }
    this.flush();
    this.latest = this.encode(state);
    const client = { last: null, waiting: false };
    client.drain = () => { if (client.waiting) this.send(response, client); };
    client.close = () => this.remove(response);
    response.on('drain', client.drain);
    response.once('close', client.close);
    this.clients.set(response, client);
    this.send(response, client);
  }
  remove(response) {
    const client = this.clients.get(response);
    if (!client) return;
    response.off('drain', client.drain);
    response.off('close', client.close);
    this.clients.delete(response);
    if (!this.clients.size) {
      clearTimeout(this.timer); this.timer = null;
      this.pending = null; this.latest = null;
    }
  }
  publish(state) {
    if (this.closed || !this.clients.size) return;
    this.pending = state;
    if (!this.timer) {
      this.timer = setTimeout(() => this.flush(), this.delay);
      this.timer.unref?.();
    }
  }
  flush() {
    clearTimeout(this.timer); this.timer = null;
    if (!this.pending || this.closed) return;
    this.latest = this.encode(this.pending);
    this.pending = null;
    for (const [response, client] of this.clients) this.send(response, client);
  }
  send(response, client) {
    if (response.destroyed || response.writableEnded) { this.remove(response); return; }
    if (response.writableNeedDrain) { client.waiting = true; return; }
    client.waiting = false;
    if (client.last === this.latest) return;
    client.last = this.latest;
    response.write(this.latest);
  }
  close() {
    if (this.closed) return;
    this.flush(); this.closed = true;
    clearTimeout(this.timer); this.timer = null;
    clearInterval(this.heartbeat);
    for (const [response] of this.clients) { this.remove(response); response.end(); }
    this.pending = null; this.latest = null;
  }
}
