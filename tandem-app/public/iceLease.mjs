/** Renew relay credentials without replacing call-owned media tracks. */
export class IceLease {
  constructor({ fetchConfig, onRenewed = () => {}, onFailure = () => {}, now = Date.now,
    setTimer = (callback, delay) => setTimeout(callback, delay), clearTimer = timer => clearTimeout(timer) }) {
    Object.assign(this, { fetchConfig, onRenewed, onFailure, now, setTimer, clearTimer });
    this.generation = 0;
    this.servers = null;
    this.failures = 0;
  }
  async load() {
    if (this.servers && (!this.expiresAt || this.expiresAt > this.now() + 1000)) return this.servers;
    return this.refresh();
  }
  refresh() {
    if (this.pending) return this.pending;
    this.clearTimer(this.timer);
    this.timer = null;
    const generation = this.generation;
    const controller = new AbortController();
    this.controller = controller;
    const previousExpiry = this.expiresAt;
    const previous = this.servers;
    const task = Promise.resolve().then(async () => {
      try {
        const lease = await this.fetchConfig(controller.signal);
        if (generation !== this.generation) return this.servers;
        if (!Array.isArray(lease.servers) || !lease.servers.length ||
          (lease.expiresAt && (!Number.isFinite(lease.expiresAt) || lease.expiresAt <= this.now()))) throw new Error('Invalid ICE lease');
        this.servers = lease.servers;
        this.expiresAt = lease.expiresAt || null;
        this.failures = 0;
        if (previous) await this.onRenewed(this.servers);
        if (generation !== this.generation) return this.servers;
        if (this.expiresAt) {
          const remaining = this.expiresAt - this.now();
          // Near invitation expiry the server cannot extend the lease; do not spin.
          if (previousExpiry && this.expiresAt <= previousExpiry && remaining <= 60000) {
            this.timer = this.setTimer(() => this.onFailure({ terminal: true, expired: true }), Math.max(0, remaining));
          } else {
            this.timer = this.setTimer(() => { this.refresh().catch(() => {}); }, Math.max(1000, remaining - Math.min(60000, remaining * 0.2)));
          }
        }
        return this.servers;
      } catch (error) {
        if (generation !== this.generation) return this.servers;
        const terminal = error.status === 403 || ++this.failures >= 5;
        this.onFailure({ terminal, expired: Boolean(this.expiresAt && this.expiresAt <= this.now()) });
        if (!terminal) this.timer = this.setTimer(() => { this.refresh().catch(() => {}); }, Math.min(30000, 1000 * 2 ** (this.failures - 1)));
        throw error;
      } finally {
        if (generation === this.generation) { this.pending = null; this.controller = null; }
      }
    });
    this.pending = task;
    return task;
  }
  stop() {
    this.generation++;
    this.clearTimer(this.timer);
    this.controller?.abort();
    this.timer = null;
    this.pending = null;
    this.controller = null;
    this.servers = null;
    this.expiresAt = null;
  }
}
