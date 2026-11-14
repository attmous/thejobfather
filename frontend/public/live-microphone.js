class LiveMicrophone extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new ArrayBuffer(1024);
    this.view = new DataView(this.buffer);
    this.offset = 0;
    this.phase = 0;
    this.sum = 0;
    this.samples = 0;
    this.enabled = true;
    this.port.onmessage = event => {
      this.enabled = event.data;
      this.offset = this.phase = this.sum = this.samples = 0;
    };
  }

  process(inputs) {
    const channel = inputs[0]?.[0];
    if (!channel || !this.enabled) return true;
    for (const sample of channel) {
      this.phase += 16000;
      this.sum += sample;
      this.samples++;
      if (this.phase < sampleRate) continue;
      this.phase -= sampleRate;
      const value = Math.max(-1, Math.min(1, this.sum / this.samples));
      this.view.setInt16(this.offset, value * (value < 0 ? 32768 : 32767), true);
      this.offset += 2;
      this.sum = this.samples = 0;
      if (this.offset === this.buffer.byteLength) {
        this.port.postMessage(this.buffer, [this.buffer]);
        this.buffer = new ArrayBuffer(1024);
        this.view = new DataView(this.buffer);
        this.offset = 0;
      }
    }
    return true;
  }
}

registerProcessor("live-microphone", LiveMicrophone);
