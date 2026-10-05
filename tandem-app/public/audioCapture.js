/** Capture PCM without owning or stopping the call's MediaStream tracks. */
export class AudioCapture {
  constructor({ onAudio, onState }) {
    this.onAudio = onAudio;
    this.onState = onState;
    this.enabled = false;
    this.context = null;
    this.node = null;
    this.source = null;
    this.stream = null;
    this.generation = 0;
  }

  async start(stream) {
    await this.close();
    const generation = this.generation;
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
      await context.audioWorklet.addModule('/pcm-worklet.js');
      if (generation !== this.generation) {
        if (context.state !== 'closed') await context.close();
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
      context.resume().catch(() => this.onState('suspended'));
      this.onState(context.state);
    } catch (error) {
      if (this.context !== context || generation !== this.generation) return;
      await this.close();
      if (this.context) return;
      throw error;
    }
  }

  setEnabled(enabled) {
    const next = Boolean(enabled);
    if (this.enabled === next) return;
    this.enabled = next;
    this.node?.port.postMessage({ type: 'enabled', value: next });
  }

  async resume() {
    if (!this.context || !this.node) throw new Error('Capture is unavailable');
    await this.context.resume();
    this.onState(this.context.state);
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
      if (context.state !== 'closed') await context.close();
    }
  }
}
