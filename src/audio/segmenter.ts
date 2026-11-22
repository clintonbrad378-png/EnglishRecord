import { EnergyVad, type VadEngine } from './vad';

const SAMPLE_RATE = 16000;
const HOP = 512;
const RING_WINDOWS = 16; // 512 ms de contexto previo
const START_HITS = 2;
const SILENCE_HITS = 40; // ~1.28 s: evita trocear frases con pausas normales
const MIN_SPEECH_SAMPLES = Math.round(0.6 * SAMPLE_RATE);
const MAX_SEGMENT_SAMPLES = Math.round(14 * SAMPLE_RATE);
const TAIL_SAMPLES = Math.round(0.24 * SAMPLE_RATE);
const POSITIVE = 0.5;
const NEGATIVE = 0.35;

export interface SpeechSegment {
  audio: Float32Array;
  startSample: number;
  endSample: number;
}

interface SegmenterOptions {
  vad: VadEngine;
  onSegment: (segment: SpeechSegment) => void;
  onVadError?: (error: Error) => void;
}

export class SpeechSegmenter {
  private readonly vad: VadEngine;
  private readonly onSegment: (segment: SpeechSegment) => void;
  private readonly onVadError?: (error: Error) => void;

  private leftover = new Float32Array(0);
  private ringWindows: Float32Array[] = [];
  private activeWindows: Float32Array[] = [];
  private activeStart = 0;
  private activeSamples = 0;
  private totalSamples = 0;
  private state: 'idle' | 'speech' = 'idle';
  private speechHits = 0;
  private silenceHits = 0;
  private lastSpeechEnd = 0;
  private vadUsable = true;
  private readonly fallback = new EnergyVad();
  private chain: Promise<void> = Promise.resolve();
  private disposed = false;

  constructor(options: SegmenterOptions) {
    this.vad = options.vad;
    this.onSegment = options.onSegment;
    this.onVadError = options.onVadError;
  }

  get engine(): string {
    return this.vad.label;
  }

  get isCapturing(): boolean {
    return this.state === 'speech';
  }

  push(samples: Float32Array): Promise<void> {
    if (this.disposed) return this.chain;

    let data: Float32Array;
    if (this.leftover.length > 0) {
      data = new Float32Array(this.leftover.length + samples.length);
      data.set(this.leftover, 0);
      data.set(samples, this.leftover.length);
    } else {
      data = samples;
    }

    const usable = Math.floor(data.length / HOP) * HOP;
    const windows: Float32Array[] = [];
    for (let offset = 0; offset < usable; offset += HOP) {
      windows.push(data.slice(offset, offset + HOP));
    }
    this.leftover = data.slice(usable);

    this.chain = this.chain.then(async () => {
      for (const window of windows) {
        await this.processWindow(window);
      }
    });

    return this.chain;
  }

  async flush(): Promise<void> {
    await this.chain;
    if (this.state === 'speech') {
      this.finishSegment(this.totalSamples);
    }
    this.state = 'idle';
    this.speechHits = 0;
    this.silenceHits = 0;
    this.ringWindows = [];
    this.activeWindows = [];
    this.activeSamples = 0;
    this.leftover = new Float32Array(0);
    try {
      await this.vad.reset();
    } catch {
      // el motor puede haber fallado
    }
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    await this.chain.catch(() => undefined);
  }

  private async processWindow(window: Float32Array): Promise<void> {
    if (this.disposed) return;

    this.totalSamples += HOP;
    this.pushRing(window);

    let probability = 0;
    if (this.vadUsable) {
      try {
        probability = await this.vad.process(window);
      } catch (error) {
        this.vadUsable = false;
        this.onVadError?.(error instanceof Error ? error : new Error(String(error)));
      }
    }

    if (!this.vadUsable) {
      probability = this.fallback.process(window);
    }

    if (this.state === 'idle') {
      if (probability > POSITIVE) this.speechHits += 1;
      else this.speechHits = 0;

      if (this.speechHits >= START_HITS) {
        this.beginSegment(probability);
      }
      return;
    }

    this.activeWindows.push(window.slice());
    this.activeSamples += HOP;
    if (probability >= NEGATIVE) {
      this.lastSpeechEnd = this.totalSamples;
      this.silenceHits = 0;
    } else {
      this.silenceHits += 1;
    }

    if (this.activeSamples >= MAX_SEGMENT_SAMPLES) {
      this.finishSegment(this.totalSamples, true);
      return;
    }

    if (this.silenceHits >= SILENCE_HITS) {
      this.finishSegment(Math.min(this.totalSamples, this.lastSpeechEnd + TAIL_SAMPLES));
    }
  }

  private beginSegment(probability: number): void {
    const preRoll = flatten(this.ringWindows);
    this.activeWindows = [preRoll];
    this.activeSamples = preRoll.length;
    this.activeStart = this.totalSamples - preRoll.length;
    this.state = 'speech';
    this.silenceHits = 0;
    this.speechHits = 0;
    this.lastSpeechEnd = probability >= NEGATIVE ? this.totalSamples : this.totalSamples - HOP;
  }

  private finishSegment(endSample: number, forced = false): void {
    const all = flatten(this.activeWindows);
    const start = this.activeStart;
    const wanted = Math.max(0, Math.min(all.length, endSample - start));
    const keep = Math.max(0, Math.min(all.length, wanted));
    const audio = all.slice(0, keep);

    if (keep >= MIN_SPEECH_SAMPLES) {
      this.onSegment({
        audio,
        startSample: start,
        endSample: start + keep,
      });
    }

    this.state = 'idle';
    this.activeWindows = [];
    this.activeSamples = 0;
    this.silenceHits = 0;
    this.speechHits = forced ? START_HITS : 0;
    this.ringWindows = [];
  }

  private pushRing(window: Float32Array): void {
    this.ringWindows.push(window.slice());
    if (this.ringWindows.length > RING_WINDOWS) this.ringWindows.shift();
  }
}

function flatten(windows: Float32Array[]): Float32Array {
  let length = 0;
  for (const window of windows) length += window.length;
  const output = new Float32Array(length);
  let offset = 0;
  for (const window of windows) {
    output.set(window, offset);
    offset += window.length;
  }
  return output;
}
