import { MicrophoneRecorder } from './audio/recorder';
import { SpeechSegmenter, type SpeechSegment } from './audio/segmenter';
import { EnergyVad, type VadEngine } from './audio/vad';
import { requestPersistence, saveMeta, saveRecording } from './lib/storage';
import { cleanTranscriptText, countWords, makeTitle } from './lib/format';
import { encodeWav, float32ToPcm16 } from './lib/wav';
import type { Transcriber } from './transcription/client';
import type { RecordingMeta, TranscriptChunk } from './types';

export type SessionState = 'starting' | 'recording' | 'paused' | 'stopping' | 'saved' | 'discarded' | 'error';

interface SessionOptions {
  vad: VadEngine | null;
  transcriber: Transcriber;
  onUpdate?: () => void;
}

interface WakeLockSentinelLike {
  release: () => Promise<void>;
  addEventListener: (type: 'release', listener: () => void) => void;
}

export interface TranscriptSession {
  readonly id: string;
  readonly meta: RecordingMeta | null;
  readonly audioBlob: Blob | null;
  readonly pending: number;
  subscribe(listener: () => void): () => void;
  rename(title: string): Promise<void>;
  setStarred(starred: boolean): Promise<void>;
  replaceTranscript(transcript: TranscriptChunk[]): Promise<RecordingMeta>;
  retranscribe?(): Promise<RecordingMeta>;
  markDeleted(): void;
}

export class RecordingSession implements TranscriptSession {
  readonly id: string;
  readonly createdAt: number;

  private readonly transcriber: Transcriber;
  private readonly recorder: MicrophoneRecorder;
  private readonly segmenter: SpeechSegmenter;
  private readonly listeners = new Set<() => void>();

  private state: SessionState = 'starting';
  private errorMessage: string | null = null;
  private transcriptionError: string | null = null;
  private totalSamples = 0;
  private levelValue = 0;
  private pendingJobs = 0;
  private speechDetected = false;
  private pcmChunks: Int16Array[] = [];
  private rawPeaks: number[] = [];
  private peakValue = 0;
  private peakSamples = 0;
  private transcript: TranscriptChunk[] = [];
  private sequence = 0;
  private audioBlobValue: Blob | null = null;
  private savedMeta: RecordingMeta | null = null;
  private finalized = false;
  private deleted = false;
  private titleLocked = false;
  private wakeLock: WakeLockSentinelLike | null = null;
  private persistenceRequested = false;

  constructor(options: SessionOptions) {
    this.id = `rec-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    this.createdAt = Date.now();
    this.transcriber = options.transcriber;

    const vad = options.vad ?? new EnergyVad();
    this.segmenter = new SpeechSegmenter({
      vad,
      onSegment: (segment) => this.enqueueSegment(segment),
      onVadError: () => {
        this.emit();
      },
    });

    this.recorder = new MicrophoneRecorder({
      onFrame: (frame) => this.handleFrame(frame.samples, frame.rms),
      onEnded: () => this.handleMicEnded(),
      onError: (error) => this.fail(error.message),
    });

    if (options.onUpdate) this.listeners.add(options.onUpdate);
    void this.requestWakeLock();
  }

  get status(): SessionState {
    return this.state;
  }

  get error(): string | null {
    return this.errorMessage;
  }

  get transcriptionFailure(): string | null {
    return this.transcriptionError;
  }

  get elapsed(): number {
    return this.totalSamples / 16000;
  }

  get level(): number {
    return this.levelValue;
  }

  get pending(): number {
    return this.pendingJobs;
  }

  get words(): number {
    return countWords(this.transcript.map((chunk) => chunk.text).join(' '));
  }

  get currentTranscript(): TranscriptChunk[] {
    return this.transcript;
  }

  get hasSpeech(): boolean {
    return this.speechDetected;
  }

  get isSaved(): boolean {
    return this.savedMeta !== null;
  }

  get meta(): RecordingMeta | null {
    return this.savedMeta;
  }

  get audioBlob(): Blob | null {
    return this.audioBlobValue;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async start(): Promise<boolean> {
    if (this.state !== 'starting') return this.state !== 'error';
    try {
      await this.recorder.start();
      if ((this.state as SessionState) === 'discarded' || this.finalized) {
        await this.recorder.stop();
        return false;
      }
      this.state = 'recording';
      document.addEventListener('visibilitychange', this.handleVisibility);
      await this.requestWakeLock();
      this.emit();
      return true;
    } catch (error) {
      this.fail(error instanceof Error ? error.message : 'No se pudo iniciar la grabación.');
      return false;
    }
  }

  async togglePause(): Promise<void> {
    if (this.state === 'recording') {
      await this.recorder.pause();
      await this.segmenter.flush();
      this.state = 'paused';
      this.levelValue = 0;
      await this.releaseWakeLock();
      this.emit();
      return;
    }

    if (this.state === 'paused') {
      await this.recorder.resume();
      this.state = 'recording';
      await this.requestWakeLock();
      this.emit();
    }
  }

  async stop(): Promise<RecordingMeta> {
    if (this.savedMeta && this.finalized) return this.savedMeta;
    if (this.state === 'saved' && this.savedMeta) return this.savedMeta;
    this.state = 'stopping';
    this.emit();

    await this.recorder.stop();
    await this.segmenter.flush();
    this.finalize();

    const blob = encodeWav(this.pcmChunks, 16000);
    this.audioBlobValue = blob;

    const text = this.transcript.map((chunk) => chunk.text).join(' ');
    const duration = this.totalSamples / 16000;
    const meta: RecordingMeta = {
      id: this.id,
      title: makeTitle(text, this.createdAt),
      createdAt: this.createdAt,
      duration,
      sampleRate: 16000,
      peaks: preparePeaks(this.rawPeaks, 96),
      transcript: [...this.transcript],
      wordCount: countWords(text),
      starred: false,
      transcribed: this.transcript.length > 0 && this.pendingJobs === 0 && !this.transcriptionError,
      hadSpeech: this.speechDetected,
    };

    await saveRecording(meta, blob);
    if (!this.persistenceRequested) {
      this.persistenceRequested = true;
      void requestPersistence();
    }

    this.savedMeta = meta;
    this.pcmChunks = [];
    this.rawPeaks = [];
    this.state = 'saved';
    document.removeEventListener('visibilitychange', this.handleVisibility);
    await this.releaseWakeLock();
    this.emit();
    return meta;
  }

  async discard(): Promise<void> {
    if (this.finalized) return;
    this.finalized = true;
    document.removeEventListener('visibilitychange', this.handleVisibility);
    await this.releaseWakeLock();
    await this.recorder.stop();
    await this.segmenter.dispose();
    this.pcmChunks = [];
    this.rawPeaks = [];
    this.state = 'discarded';
    this.emit();
  }

  async rename(title: string): Promise<void> {
    const trimmed = title.trim();
    if (!trimmed || !this.savedMeta) return;
    this.titleLocked = true;
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
    const text = transcript.map((chunk) => chunk.text).join(' ');
    const autoTitle = !this.titleLocked && this.savedMeta.title.startsWith('Grabación');
    this.savedMeta = {
      ...this.savedMeta,
      title: autoTitle ? makeTitle(text, this.createdAt) : this.savedMeta.title,
      transcript: [...transcript],
      wordCount: countWords(text),
      transcribed: true,
      hadSpeech: this.savedMeta.hadSpeech || transcript.length > 0,
    };
    await saveMeta(this.savedMeta);
    this.emit();
    return this.savedMeta;
  }

  markDeleted(): void {
    this.deleted = true;
  }

  private handleFrame(samples: Float32Array, rms: number): void {
    if (this.state !== 'recording') return;

    this.totalSamples += samples.length;
    this.levelValue = this.levelValue * 0.62 + Math.min(1, rms * 5.5) * 0.38;

    const pcm = float32ToPcm16(samples);
    this.pcmChunks.push(pcm);

    let blockPeak = 0;
    for (let i = 0; i < samples.length; i += 1) {
      const value = Math.abs(samples[i]);
      if (value > blockPeak) blockPeak = value;
    }
    if (blockPeak > this.peakValue) this.peakValue = blockPeak;
    this.peakSamples += samples.length;
    while (this.peakSamples >= 1600) {
      this.rawPeaks.push(this.peakValue);
      this.peakSamples -= 1600;
      this.peakValue = 0;
    }

    void this.segmenter.push(samples);
    this.emit();
  }

  private enqueueSegment(segment: SpeechSegment): void {
    this.speechDetected = true;
    this.pendingJobs += 1;
    this.emit();

    const start = segment.startSample / 16000;
    const end = segment.endSample / 16000;
    const prompt = this.transcript
      .map((chunk) => chunk.text)
      .join(' ')
      .slice(-180);

    this.transcriber
      .transcribe(segment.audio, prompt || undefined)
      .then((rawText) => {
        const text = cleanTranscriptText(rawText);
        if (!text) return;
        const chunk: TranscriptChunk = {
          id: `chunk-${++this.sequence}`,
          text,
          t0: start,
          t1: end,
          source: 'live',
        };
        this.transcript.push(chunk);
      })
      .catch((error: Error) => {
        this.transcriptionError = error.message;
      })
      .finally(() => {
        this.pendingJobs = Math.max(0, this.pendingJobs - 1);
        if (this.savedMeta) this.persistTranscript();
        else this.emit();
      });
  }

  private persistTranscript(): void {
    if (this.deleted) return;
    if (!this.savedMeta) {
      this.emit();
      return;
    }
    const text = this.transcript.map((chunk) => chunk.text).join(' ');
    const baseTitle = !this.titleLocked && this.savedMeta.title.startsWith('Grabación');
    const next: RecordingMeta = {
      ...this.savedMeta,
      transcript: [...this.transcript],
      wordCount: countWords(text),
      transcribed: this.transcript.length > 0 && this.pendingJobs === 0 && !this.transcriptionError,
      title: baseTitle ? makeTitle(text, this.createdAt) : this.savedMeta.title,
    };
    this.savedMeta = next;
    void saveMeta(next).catch(() => undefined);
    this.emit();
  }

  private finalize(): void {
    if (this.finalized) return;
    this.finalized = true;
    if (this.peakSamples > 0) {
      this.rawPeaks.push(this.peakValue);
      this.peakSamples = 0;
      this.peakValue = 0;
    }
  }

  private handleMicEnded(): void {
    if (this.state !== 'recording' && this.state !== 'paused') return;
    this.errorMessage = 'El micrófono se desconectó. Puedes guardar lo grabado.';
    this.state = 'paused';
    void this.releaseWakeLock();
    this.emit();
  }

  private fail(message: string): void {
    this.errorMessage = message;
    this.state = 'error';
    void this.releaseWakeLock();
    this.emit();
  }

  private readonly handleVisibility = (): void => {
    if (document.visibilityState === 'visible' && this.state === 'recording') {
      void this.requestWakeLock();
    }
  };

  private async requestWakeLock(): Promise<void> {
    if (this.wakeLock || document.visibilityState !== 'visible') return;
    const wakeLockApi = (navigator as Navigator & { wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinelLike> } }).wakeLock;
    if (!wakeLockApi) return;
    try {
      this.wakeLock = await wakeLockApi.request('screen');
      this.wakeLock.addEventListener('release', () => {
        this.wakeLock = null;
      });
    } catch {
      this.wakeLock = null;
    }
  }

  private async releaseWakeLock(): Promise<void> {
    const lock = this.wakeLock;
    this.wakeLock = null;
    try {
      await lock?.release();
    } catch {
      // ya liberado
    }
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

function preparePeaks(raw: number[], buckets: number): number[] {
  if (raw.length === 0) return new Array(buckets).fill(0.08);
  const loudest = Math.max(...raw, 0.02);
  return Array.from({ length: buckets }, (_, bucket) => {
    const start = Math.floor((bucket * raw.length) / buckets);
    const end = Math.max(start + 1, Math.floor(((bucket + 1) * raw.length) / buckets));
    let peak = 0;
    for (let i = start; i < end && i < raw.length; i += 1) peak = Math.max(peak, raw[i]);
    const normalized = Math.min(1, peak / loudest);
    return 0.07 + 0.93 * Math.pow(normalized, 0.72);
  });
}
