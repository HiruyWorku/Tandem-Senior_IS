/** Capture PCM without owning or stopping the call's MediaStream tracks. */
export class AudioCapture {
  constructor({ onAudio, onState, setupTimeoutMs = 10000, resumeTimeoutMs = 5000, closeTimeoutMs = 1000 }) {
    this.onAudio = onAudio;
    this.onState = onState;
    this.enabled = false;
    this.context = null;
    this.node = null;
    this.source = null;
    this.stream = null;
    this.generation = 0;
    Object.assign(this, { setupTimeoutMs, resumeTimeoutMs, closeTimeoutMs });
  }

  async deadline(operation, milliseconds) {
    let timer;
    try {
      return await Promise.race([operation, new Promise((_, reject) => {
        timer = setTimeout(() => {
          const error = new Error('Browser audio operation timed out'); error.code = 'timeout'; reject(error);
        }, milliseconds);
      })]);
    } finally { clearTimeout(timer); }
  }

  async start(stream) {
    const closing = this.close();
    const generation = this.generation;
    await closing;
    if (generation !== this.generation) return;
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context || !window.AudioWorkletNode) {
      const error = new Error('AudioWorklet unavailable');
      error.code = 'unsupported';
      throw error;
    }
    const context = new Context({ sampleRate: 16000, latencyHint: 'interactive' });
    this.context = context;
    this.stream = stream;
    context.onstatechange = () => {
      if (this.context === context) this.onState(context.state);
    };
    try {
      await this.deadline(context.audioWorklet.addModule('/pcm-worklet.js'), this.setupTimeoutMs);
      if (generation !== this.generation || this.context !== context) {
        if (context.state !== 'closed') await this.deadline(context.close(), this.closeTimeoutMs).catch(() => {});
        return;
      }
      this.source = context.createMediaStreamSource(stream);
      this.node = new AudioWorkletNode(context, 'tandem-pcm', {
        numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
        channelCount: 1, channelCountMode: 'explicit',
      });
      this.node.port.onmessage = ({ data }) => {
        if (this.enabled && this.context === context) this.onAudio(data);
      };
      this.node.onprocessorerror = () => {
        this.setEnabled(false);
        this.onState('failed');
        this.close().catch(() => {});
      };
      this.source.connect(this.node);
      this.node.connect(context.destination);
      // A browser may wait for a user gesture. Never block room admission on it.
      this.deadline(context.resume(), this.resumeTimeoutMs).catch(() => {
        if (this.context === context) this.onState(context.state);
      });
      this.onState(context.state);
    } catch (error) {
      if (this.context !== context || generation !== this.generation) return;
      await this.close();
      if (this.context) return;
      throw error;
    }
  }

  setEnabled(enabled) {
    // A context can become running while its worklet module is still loading.
    // Never remember an enable that could not be delivered to the new port:
    // a later sync must send it when the node actually exists.
    const next = Boolean(enabled && this.node);
    if (this.enabled === next) return;
    this.enabled = next;
    this.node?.port.postMessage({ type: 'enabled', value: next });
  }

  async resume() {
    if (!this.context || !this.node) throw new Error('Capture is unavailable');
    const context = this.context; const generation = this.generation;
    try { await this.deadline(context.resume(), this.resumeTimeoutMs); }
    catch (error) {
      if (this.context !== context || this.generation !== generation) return;
      throw error;
    }
    if (this.context === context && this.generation === generation) this.onState(context.state);
  }

  async close() {
    this.generation++;
    this.setEnabled(false);
    this.source?.disconnect();
    if (this.node) {
      this.node.port.onmessage = null;
      this.node.onprocessorerror = null;
      this.node.disconnect();
      this.node.port.close();
    }
    const context = this.context;
    this.context = null;
    this.node = null;
    this.source = null;
    this.stream = null;
    if (context) {
      context.onstatechange = null;
      // Disconnecting the graph and closing its port already stops PCM delivery.
      // A broken audio backend must not keep page cleanup or a new retry waiting forever.
      if (context.state !== 'closed') await this.deadline(context.close(), this.closeTimeoutMs).catch(() => {});
    }
  }
}
