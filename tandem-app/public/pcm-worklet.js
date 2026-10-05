// Runs on the audio rendering thread. Output stays silent to prevent mic feedback.
class TandemPCMProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.enabled = false;
    this.offset = 0;
    this.buffer = new ArrayBuffer(2048); // 1,024 mono PCM16 frames
    this.view = new DataView(this.buffer);
    this.port.onmessage = ({ data }) => {
      if (data?.type === 'enabled') {
        this.enabled = data.value === true;
        this.offset = 0; // discard partial audio on pause/resume
      }
    };
  }

  process(inputs) {
    const samples = inputs[0]?.[0];
    if (!this.enabled || !samples) return true;
    for (const value of samples) {
      const sample = Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
      this.view.setInt16(this.offset * 2, Math.round(sample * (sample < 0 ? 32768 : 32767)), true);
      if (++this.offset === 1024) {
        this.port.postMessage({ buffer: this.buffer, sampleRate }, [this.buffer]);
        this.buffer = new ArrayBuffer(2048);
        this.view = new DataView(this.buffer);
        this.offset = 0;
      }
    }
    return true;
  }
}
registerProcessor('tandem-pcm', TandemPCMProcessor);
