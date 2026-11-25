import { SpeechSegmenter, type SpeechSegment } from './audio/segmenter';
import { EnergyVad } from './audio/vad';
import { buildContextPrompt, cleanTranscriptText, countWords } from './lib/format';
import { getAudio, requestPersistence, saveMeta, saveRecording } from './lib/storage';
import { computePeaks, decodeWav, encodeWav, float32ToPcm16 } from './lib/wav';
import type { TranscriptSession } from './session';
import type { Transcriber } from './transcription/client';
import type { RecordingMeta, TranscriptChunk } from './types';

const SAMPLE_RATE = 16000;
const MAX_CHUNK_SAMPLES = 30 * SAMPLE_RATE;
const MAX_MERGE_GAP_SAMPLES = Math.round(3 * SAMPLE_RATE);
const MAX_IMPORT_SECONDS = 20 * 60;
const MAX_FILE_BYTES = 80 * 1024 * 1024;
const SILENCE_RMS = 0.002;
const IMPORT_TAIL_SAMPLES = Math.round(0.4 * SAMPLE_RATE);
const HIGHPASS_HZ = 70;

interface ImportOptions {
  transcriber: Transcriber;
  samples: Float32Array;
  title: string;
}

interface ChunkRange {
  start: number;
  end: number;
}

export async function decodeAudioFile(file: File): Promise<{ samples: Float32Array; duration: number }> {
  if (file.size === 0) throw new Error('El archivo está vacío.');
  if (file.size > MAX_FILE_BYTES) {
    throw new Error('El archivo es demasiado grande (máximo 80 MB).');
  }

  const probed = await probeDuration(file);
  if (probed !== null) {
    if (probed < 0.5) throw new Error('El audio es demasiado corto.');
    if (probed > MAX_IMPORT_SECONDS) {
      throw new Error('El audio dura más de 20 minutos. Importa un archivo más corto.');
    }
  }

  const data = await file.arrayBuffer();
  let context: OfflineAudioContext;
  try {
    context = new OfflineAudioContext(1, 1, SAMPLE_RATE);
  } catch {
    throw new Error('Este dispositivo no puede procesar audio a 16 kHz.');
  }

  let buffer: AudioBuffer;
  try {
    buffer = await context.decodeAudioData(data);
  } catch {
    throw new Error('No se pudo decodificar el audio. Prueba con MP3, M4A o WAV.');
  }

  if (buffer.duration < 0.5) throw new Error('El audio es demasiado corto.');
  if (buffer.duration > MAX_IMPORT_SECONDS) {
    throw new Error('El audio dura más de 20 minutos. Importa un archivo más corto.');
  }

  let samples = downmixToMono(buffer);
  if (buffer.sampleRate !== SAMPLE_RATE) {
    samples = resampleLinear(samples, buffer.sampleRate, SAMPLE_RATE);
  }
  return { samples, duration: samples.length / SAMPLE_RATE };
}

export class ImportSession implements TranscriptSession {
  readonly id: string;
  readonly createdAt: number;

  private readonly transcriber: Transcriber;
  private samples: Float32Array;
  private readonly initialTitle: string;
  private readonly listeners = new Set<() => void>();

  private savedMeta: RecordingMeta | null = null;
  private audioBlobValue: Blob | null = null;
  private transcript: TranscriptChunk[] = [];
  private pendingJobs = 0;
  private speechDetected = false;
  private transcriptionError: string | null = null;
  private sequence = 0;
  private deleted = false;
  private started = false;

  constructor(options: ImportOptions) {
    this.id = `imp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    this.createdAt = Date.now();
    this.transcriber = options.transcriber;
    this.samples = options.samples;
    this.initialTitle = cleanTitle(options.title);
  }

  get meta(): RecordingMeta | null {
    return this.savedMeta;
  }

  get audioBlob(): Blob | null {
    return this.audioBlobValue;
  }

  get pending(): number {
    return this.pendingJobs;
  }

  get error(): string | null {
    return this.transcriptionError;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async start(): Promise<RecordingMeta> {
    if (this.started) {
      if (!this.savedMeta) throw new Error('La importación no está disponible.');
      return this.savedMeta;
    }
    this.started = true;

    const pcm = float32ToPcm16(this.samples);
    const blob = encodeWav([pcm], SAMPLE_RATE);
    const duration = this.samples.length / SAMPLE_RATE;
    const meta: RecordingMeta = {
      id: this.id,
      title: this.initialTitle,
      createdAt: this.createdAt,
      duration,
      sampleRate: SAMPLE_RATE,
      peaks: normalizePeaks(computePeaks(this.samples, 96)),
      transcript: [],
      wordCount: 0,
      starred: false,
      transcribed: false,
      hadSpeech: false,
    };

    await saveRecording(meta, blob);
    this.audioBlobValue = blob;
    this.savedMeta = meta;
    void requestPersistence();
    this.emit();
    void this.process();
    return meta;
  }

  async rename(title: string): Promise<void> {
    const trimmed = title.trim();
    if (!trimmed || !this.savedMeta) return;
    this.savedMeta = { ...this.savedMeta, title: trimmed };
    await saveMeta(this.savedMeta);
    this.emit();
  }

  async setStarred(starred: boolean): Promise<void> {
    if (!this.savedMeta) return;
    this.savedMeta = { ...this.savedMeta, starred };
    await saveMeta(this.savedMeta);
    this.emit();
  }

  async replaceTranscript(transcript: TranscriptChunk[]): Promise<RecordingMeta> {
    if (!this.savedMeta) throw new Error('La grabación todavía no está guardada.');
    this.transcript = transcript;
    this.transcriptionError = null;
    this.pendingJobs = 0;
    const text = transcript.map((chunk) => chunk.text).join(' ');
    this.savedMeta = {
      ...this.savedMeta,
      transcript: [...transcript],
      wordCount: countWords(text),
      transcribed: true,
      hadSpeech: this.savedMeta.hadSpeech || transcript.length > 0,
    };
    await saveMeta(this.savedMeta);
    this.emit();
    return this.savedMeta;
  }

  async retranscribe(): Promise<RecordingMeta> {
    if (!this.savedMeta) throw new Error('La grabación todavía no está guardada.');
    if (this.pendingJobs > 0) throw new Error('Espera a que termine la transcripción en curso.');

    if (this.samples.length === 0) {
      const blob = await getAudio(this.id);
      if (!blob) throw new Error('No se encontró el audio de la grabación.');
      const { samples, sampleRate } = decodeWav(await blob.arrayBuffer());
      this.samples = sampleRate === SAMPLE_RATE ? samples : resampleLinear(samples, sampleRate, SAMPLE_RATE);
    }

    this.transcript = [];
    this.transcriptionError = null;
    this.speechDetected = false;
    this.sequence = 0;
    this.savedMeta = { ...this.savedMeta, transcript: [], wordCount: 0, transcribed: false };
    await saveMeta(this.savedMeta);
    this.emit();
    await this.process();
    if (!this.savedMeta) throw new Error('La importación no está disponible.');
    return this.savedMeta;
  }

  markDeleted(): void {
    this.deleted = true;
  }

  private async process(): Promise<void> {
    this.pendingJobs = 1;
    this.emit();

    prepareAudioForAsr(this.samples);

    try {
      let chunks: ChunkRange[] = [];
      try {
        chunks = await findSpeechChunks(this.samples);
      } catch (error) {
        this.transcriptionError = error instanceof Error ? error.message : String(error);
        this.speechDetected = true;
      }

      if (this.deleted || !this.savedMeta) return;
      if (this.transcriptionError) {
        await this.persist();
        return;
      }

      this.speechDetected = chunks.length > 0;
      this.savedMeta = { ...this.savedMeta, hadSpeech: this.speechDetected };
      await this.persist();

      if (chunks.length === 0) {
        this.savedMeta = { ...this.savedMeta, hadSpeech: false };
        await this.persist();
        return;
      }

      this.pendingJobs = chunks.length;
      this.emit();

      for (const chunk of chunks) {
        if (this.deleted) break;
        const audio = this.samples.slice(chunk.start, chunk.end);
        const prompt = buildContextPrompt(this.transcript.map((item) => item.text));
        try {
          const raw = await this.transcriber.transcribe(audio, prompt, { quality: true });
          const text = cleanTranscriptText(raw);
          if (text) {
            this.transcript.push({
              id: `import-${++this.sequence}`,
              text,
              t0: chunk.start / SAMPLE_RATE,
              t1: chunk.end / SAMPLE_RATE,
              source: 'import',
            });
          }
        } catch (error) {
          this.transcriptionError = error instanceof Error ? error.message : String(error);
          break;
        } finally {
          this.pendingJobs = Math.max(0, this.pendingJobs - 1);
          await this.persist();
          this.emit();
        }
      }
    } finally {
      this.pendingJobs = 0;
      this.samples = new Float32Array(0);
      await this.persist();
      this.emit();
    }
  }

  private async persist(): Promise<void> {
    if (!this.savedMeta || this.deleted) return;
    const text = this.transcript.map((chunk) => chunk.text).join(' ');
    this.savedMeta = {
      ...this.savedMeta,
      transcript: [...this.transcript],
      wordCount: countWords(text),
      transcribed: this.transcript.length > 0 && this.pendingJobs === 0 && !this.transcriptionError,
      hadSpeech: this.speechDetected || this.transcript.length > 0,
    };
    await saveMeta(this.savedMeta).catch(() => undefined);
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

export async function findSpeechChunks(samples: Float32Array): Promise<ChunkRange[]> {
  const segments: Array<{ startSample: number; endSample: number }> = [];
  const segmenter = new SpeechSegmenter({
    vad: new EnergyVad(0.004),
    onSegment: (segment: SpeechSegment) => {
      segments.push({ startSample: segment.startSample, endSample: segment.endSample });
    },
    maxSegmentSamples: MAX_CHUNK_SAMPLES,
    tailSamples: IMPORT_TAIL_SAMPLES,
  });

  try {
    const block = SAMPLE_RATE * 10;
    for (let offset = 0; offset < samples.length; offset += block) {
      await segmenter.push(samples.subarray(offset, Math.min(samples.length, offset + block)));
    }
    await segmenter.flush();
  } finally {
    await segmenter.dispose();
  }

  const merged = mergeSegments(segments);
  if (merged.length > 0) return merged;

  if (rms(samples) < SILENCE_RMS) return [];

  const fallback: ChunkRange[] = [];
  for (let start = 0; start < samples.length; start += MAX_CHUNK_SAMPLES) {
    fallback.push({ start, end: Math.min(samples.length, start + MAX_CHUNK_SAMPLES) });
  }
  return fallback;
}

function mergeSegments(segments: Array<{ startSample: number; endSample: number }>): ChunkRange[] {
  const merged: ChunkRange[] = [];
  for (const segment of segments) {
    const last = merged[merged.length - 1];
    if (
      last &&
      segment.startSample - last.end <= MAX_MERGE_GAP_SAMPLES &&
      segment.endSample - last.start <= MAX_CHUNK_SAMPLES
    ) {
      last.end = Math.max(last.end, segment.endSample);
    } else {
      merged.push({ start: segment.startSample, end: segment.endSample });
    }
  }
  return merged;
}

function probeDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio();
    let settled = false;
    const finish = (value: number | null) => {
      if (settled) return;
      settled = true;
      audio.removeAttribute('src');
      audio.load();
      URL.revokeObjectURL(url);
      resolve(value);
    };

    audio.preload = 'metadata';
    audio.onloadedmetadata = () => finish(Number.isFinite(audio.duration) ? audio.duration : null);
    audio.onerror = () => finish(null);
    window.setTimeout(() => finish(null), 4000);
    audio.src = url;
  });
}

function downmixToMono(buffer: AudioBuffer): Float32Array {
  const first = buffer.getChannelData(0);
  const channels = buffer.numberOfChannels;
  if (channels === 1) return first;

  for (let channel = 1; channel < channels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < first.length; i += 1) first[i] += data[i];
  }
  const scale = 1 / channels;
  for (let i = 0; i < first.length; i += 1) first[i] *= scale;
  return first;
}

export function resampleLinear(input: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return input;
  const ratio = from / to;
  const length = Math.max(1, Math.floor(input.length / ratio));
  const output = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    const position = i * ratio;
    const index = Math.floor(position);
    const fraction = position - index;
    const a = input[index] ?? 0;
    const b = input[index + 1] ?? a;
    output[i] = a + (b - a) * fraction;
  }
  return output;
}

export function prepareAudioForAsr(samples: Float32Array, sampleRate = SAMPLE_RATE): void {
  if (samples.length === 0) return;

  highPass(samples, sampleRate, HIGHPASS_HZ);

  let peak = 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const value = samples[i];
    const magnitude = Math.abs(value);
    if (magnitude > peak) peak = magnitude;
    sum += value * value;
  }
  if (peak === 0) return;

  const rms = Math.sqrt(sum / samples.length);
  const peakGain = 0.95 / peak;
  let gain = 1;
  if (peakGain < 1) {
    gain = peakGain;
  } else if (rms > 0 && rms < 0.03) {
    gain = Math.min(0.08 / rms, peakGain, 8);
  }

  if (Math.abs(gain - 1) < 0.02) return;
  for (let i = 0; i < samples.length; i += 1) {
    const value = samples[i] * gain;
    samples[i] = value > 1 ? 1 : value < -1 ? -1 : value;
  }
}

function highPass(samples: Float32Array, sampleRate: number, cutoff: number): void {
  const w0 = (2 * Math.PI * cutoff) / sampleRate;
  const cos = Math.cos(w0);
  const alpha = Math.sin(w0) / Math.SQRT2;
  const a0 = 1 + alpha;
  const b0 = (1 + cos) / 2 / a0;
  const b1 = -(1 + cos) / a0;
  const b2 = b0;
  const a1 = (-2 * cos) / a0;
  const a2 = (1 - alpha) / a0;

  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const x = samples[i];
    const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
    samples[i] = y;
  }
}

function rms(samples: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i];
  return Math.sqrt(sum / Math.max(1, samples.length));
}

function normalizePeaks(peaks: number[]): number[] {
  const max = Math.max(...peaks, 0.02);
  return peaks.map((peak) => Math.min(1, peak / max));
}

function cleanTitle(name: string): string {
  const base = name
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return base ? base.charAt(0).toUpperCase() + base.slice(1) : 'Audio importado';
}
