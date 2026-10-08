/** Recover a stalled video sink without changing the call's transports or tracks. */
export class RemotePlayback {
  constructor({ video, connection, now = performance.now.bind(performance),
    setTimer = (callback, delay) => globalThis.setTimeout(callback, delay),
    clearTimer = timer => globalThis.clearTimeout(timer), isVisible = () => !document.hidden,
    makeStream = tracks => new MediaStream(tracks), onRepair = () => {} }) {
    Object.assign(this, { video, connection, now, setTimer, clearTimer, isVisible, makeStream, onRepair });
    this.lastPresentedAt = now(); this.decoded = new Map(); this.received = new Map(); this.attempts = 0;
    this.lastRepairAt = -Infinity; this.disposed = false;
    if (typeof video.requestVideoFrameCallback !== 'function') return;
    const frame = () => {
      if (this.disposed) return;
      this.lastPresentedAt = this.now();
      if (!video.paused) this.attempts = 0;
      this.frameHandle = video.requestVideoFrameCallback(frame);
    };
    this.frameHandle = video.requestVideoFrameCallback(frame);
    this.timer = setTimer(() => this.check(), 1000);
  }

  async check() {
    if (this.disposed) return;
    this.clearTimer(this.timer); this.timer = null;
    try {
      if (!this.isVisible() || this.connection.connectionState !== 'connected' || !this.video.srcObject) {
        this.lastPresentedAt = this.now(); this.decoded.clear(); this.received.clear(); return;
      }
      const stats = await this.connection.getStats();
      if (this.disposed) return;
      const inbound = [...stats.values()].filter(item => item.type === 'inbound-rtp' &&
        (item.kind || item.mediaType) === 'video');
      const decoded = new Map(inbound.map(item => [item.id, item.framesDecoded || 0]));
      const received = new Map(inbound.map(item => [item.id, item.bytesReceived || 0]));
      const advancing = [...decoded].some(([id, frames]) => this.decoded.has(id) && frames > this.decoded.get(id));
      const receiving = [...received].some(([id, bytes]) => this.received.has(id) && bytes > this.received.get(id));
      this.decoded = decoded; this.received = received;
      // WebKit may suspend decoding when the element unexpectedly pauses.
      // Require continuing inbound video before resuming that sink.
      const pausedSink = this.video.paused && this.video.readyState >= 2 && receiving;
      if ((!pausedSink && (!advancing || this.now() - this.lastPresentedAt < 2000)) ||
        this.now() - this.lastRepairAt < 3000 || this.attempts >= 2) return;
      const tracks = this.video.srcObject.getTracks();
      if (!tracks.some(track => track.kind === 'video' && track.readyState === 'live')) return;
      this.attempts++; this.lastRepairAt = this.now();
      // Keep the same received tracks and the element's existing muted/volume
      // choice. A fresh MediaStream attachment resets the presentation sink.
      this.video.srcObject = this.makeStream(tracks);
      this.onRepair();
      this.video.play()?.catch(() => {});
    } catch {
      // A suspended page, closed receiver or denied playback must not interrupt
      // signaling or create an unbounded retry loop.
    } finally {
      if (!this.disposed) this.timer = this.setTimer(() => this.check(), 1000);
    }
  }

  dispose() {
    this.disposed = true; this.clearTimer(this.timer);
    if (this.frameHandle !== undefined) this.video.cancelVideoFrameCallback?.(this.frameHandle);
    this.decoded.clear(); this.received.clear();
  }
}
