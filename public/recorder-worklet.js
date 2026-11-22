/*
 * Captura PCM mono y lo remuestrea a 16 kHz en tiempo real.
 * Envía bloques de 1024 muestras (64 ms) con el nivel RMS incluido.
 */
class RecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.targetRate = 16000;
    this.ratio = sampleRate / this.targetRate;
    this.carry = new Float32Array(0);
    this.position = 0;
    this.frame = new Float32Array(1024);
    this.frameLength = 0;
    this.sumSquares = 0;
    this.sampleCount = 0;
    this.active = true;

    this.port.onmessage = (event) => {
      if (event.data && event.data.type === 'set-active') {
        this.active = Boolean(event.data.active);
      }
    };
  }

  process(inputs) {
    if (!this.active) return true;

    const input = inputs[0];
    if (!input || input.length === 0 || !input[0]) return true;

    const channels = input.length;
    let block;
    if (channels === 1) {
      block = input[0];
    } else {
      block = new Float32Array(input[0].length);
      for (let i = 0; i < block.length; i += 1) {
        let sum = 0;
        for (let c = 0; c < channels; c += 1) sum += input[c][i] || 0;
        block[i] = sum / channels;
      }
    }

    this.resample(block);
    return true;
  }

  resample(block) {
    let data;
    if (this.carry.length > 0) {
      data = new Float32Array(this.carry.length + block.length);
      data.set(this.carry, 0);
      data.set(block, this.carry.length);
    } else {
      data = block;
    }

    let position = this.position;
    while (position <= data.length - 2) {
      const index = Math.floor(position);
      const fraction = position - index;
      const sample = data[index] + (data[index + 1] - data[index]) * fraction;

      this.sumSquares += sample * sample;
      this.sampleCount += 1;
      this.frame[this.frameLength] = sample;
      this.frameLength += 1;

      if (this.frameLength === this.frame.length) {
        const rms = Math.sqrt(this.sumSquares / Math.max(1, this.sampleCount));
        this.port.postMessage(
          {
            type: 'audio',
            samples: this.frame,
            rms,
            sampleRate: this.targetRate,
          },
          [this.frame.buffer],
        );
        this.frame = new Float32Array(1024);
        this.frameLength = 0;
        this.sumSquares = 0;
        this.sampleCount = 0;
      }

      position += this.ratio;
    }

    const consumed = Math.floor(position);
    this.carry = data.slice(consumed);
    this.position = position - consumed;
  }
}

registerProcessor('english-record-recorder', RecorderProcessor);
