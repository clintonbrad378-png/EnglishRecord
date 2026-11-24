import { invoke } from '@tauri-apps/api/core';
import type { TranscriberState, TranscriberStatus } from '../types';

const JOB_TIMEOUT_MS = 15 * 60 * 1000;

interface TranscriberInfo {
  engine: 'native' | 'wasm';
  threads: number;
  model: string;
  modelLoadMs: number;
}

interface Job {
  id: number;
  audio: Float32Array;
  prompt?: string;
  resolve: (text: string) => void;
  reject: (error: Error) => void;
  timer: number;
}

function toBase64(audio: Float32Array): string {
  const bytes = new Uint8Array(audio.buffer, audio.byteOffset, audio.byteLength);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export class TauriTranscriber {
  private state: TranscriberState = { status: 'idle', pending: 0 };
  private readonly listeners = new Set<(state: TranscriberState) => void>();
  private queue: Job[] = [];
  private current: Job | null = null;
  private sequence = 0;
  private disposed = false;

  constructor() {
    this.init();
  }

  getState(): TranscriberState {
    return this.state;
  }

  onState(listener: (state: TranscriberState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  transcribe(audio: Float32Array, prompt?: string): Promise<string> {
    if (this.state.status === 'error') {
      return Promise.reject(new Error(this.state.error ?? 'El transcriptor no está disponible.'));
    }
    return new Promise<string>((resolve, reject) => {
      const job: Job = {
        id: ++this.sequence,
        audio,
        prompt,
        resolve,
        reject,
        timer: 0,
      };
      this.queue.push(job);
      this.emitPending();
      this.pump();
    });
  }

  retry(): void {
    if (this.disposed) return;
    for (const job of this.queue.splice(0)) {
      clearTimeout(job.timer);
      job.reject(new Error('Transcriptor reiniciado.'));
    }
    if (this.current) {
      clearTimeout(this.current.timer);
      this.current.reject(new Error('Transcriptor reiniciado.'));
      this.current = null;
    }
    this.setState({ status: 'idle', pending: 0 });
    this.init();
  }

  dispose(): void {
    this.disposed = true;
    if (this.current) {
      clearTimeout(this.current.timer);
      this.current.reject(new Error('Transcriptor cerrado.'));
      this.current = null;
    }
    for (const job of this.queue.splice(0)) {
      clearTimeout(job.timer);
      job.reject(new Error('Transcriptor cerrado.'));
    }
  }

  private async init(): Promise<void> {
    this.setState({ ...this.state, status: 'loading', error: undefined });
    try {
      const info = await invoke<TranscriberInfo>('init_transcriber');
      if (this.disposed) return;
      this.setState({
        status: 'ready',
        pending: this.pendingCount(),
        engine: info.engine,
        threads: info.threads,
        model: info.model,
        modelLoadMs: info.modelLoadMs,
      });
      this.pump();
    } catch (error) {
      if (this.disposed) return;
      const message = error instanceof Error ? error.message : String(error);
      this.setState({ status: 'error', error: message, pending: this.pendingCount() });
      this.rejectAll(new Error(message));
    }
  }

  private pump(): void {
    if (this.current || this.queue.length === 0 || this.state.status !== 'ready') return;
    const job = this.queue.shift();
    if (!job) return;
    this.current = job;
    job.timer = window.setTimeout(() => {
      this.failJob(job, new Error('La transcripción tardó demasiado.'));
      this.pump();
    }, JOB_TIMEOUT_MS);
    this.emitPending();

    const started = performance.now();
    void invoke<string>('transcribe_audio', {
      audioBase64: toBase64(job.audio),
      prompt: job.prompt ?? null,
    })
      .then((text) => {
        if (this.current?.id !== job.id) return;
        this.current = null;
        clearTimeout(job.timer);
        this.setState({
          status: this.state.status,
          lastTranscriptionMs: Math.round(performance.now() - started),
          lastAudioSec: job.audio.length / 16000,
        });
        job.resolve(text);
        this.emitPending();
        this.pump();
      })
      .catch((error) => {
        const err = error instanceof Error ? error : new Error(String(error));
        this.failJob(job, err);
        this.pump();
      });
  }

  private failJob(job: Job, error: Error): void {
    clearTimeout(job.timer);
    if (this.current === job) this.current = null;
    else this.queue = this.queue.filter((item) => item !== job);
    job.reject(error);
    this.emitPending();
  }

  private rejectAll(error: Error): void {
    if (this.current) {
      clearTimeout(this.current.timer);
      this.current.reject(error);
      this.current = null;
    }
    for (const job of this.queue.splice(0)) {
      clearTimeout(job.timer);
      job.reject(error);
    }
    this.emitPending();
  }

  private pendingCount(): number {
    return this.queue.length + (this.current ? 1 : 0);
  }

  private emitPending(): void {
    this.setState({ ...this.state, pending: this.pendingCount() });
  }

  private setState(next: Partial<TranscriberState> & { status: TranscriberStatus }): void {
    const merged = { ...this.state, ...next };
    if (
      merged.status === this.state.status &&
      merged.pending === this.state.pending &&
      merged.error === this.state.error &&
      merged.engine === this.state.engine &&
      merged.threads === this.state.threads &&
      merged.model === this.state.model &&
      merged.modelLoadMs === this.state.modelLoadMs &&
      merged.lastTranscriptionMs === this.state.lastTranscriptionMs &&
      merged.lastAudioSec === this.state.lastAudioSec
    ) {
      return;
    }
    this.state = merged;
    for (const listener of this.listeners) listener(this.state);
  }
}
