import type { TranscriberState, TranscriberStatus } from '../types';
import type { WorkerRequest, WorkerResponse } from './protocol';

interface Job {
  id: number;
  audio: Float32Array;
  prompt?: string;
  resolve: (text: string) => void;
  reject: (error: Error) => void;
  timer: number;
}

export class WebTranscriber {
  private worker: Worker | null = null;
  private state: TranscriberState = { status: 'idle', pending: 0 };
  private readonly listeners = new Set<(state: TranscriberState) => void>();
  private queue: Job[] = [];
  private current: Job | null = null;
  private sequence = 0;
  private disposed = false;

  constructor() {
    this.spawn();
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
        timer: window.setTimeout(() => {
          this.failJob(job, new Error('La transcripción tardó demasiado.'));
        }, 5 * 60 * 1000),
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
    this.worker?.terminate();
    this.worker = null;
    this.setState({ status: 'idle', pending: 0 });
    this.spawn();
  }

  dispose(): void {
    this.disposed = true;
    this.worker?.terminate();
    this.worker = null;
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

  private spawn(): void {
    const worker = new Worker(new URL('./transcriber.worker.ts', import.meta.url), { type: 'module' });
    this.worker = worker;

    worker.onmessage = (event: MessageEvent<WorkerResponse>) => this.handleMessage(event.data);
    worker.onerror = (event) => {
      this.setState({ status: 'error', error: event.message || 'No se pudo cargar el motor de voz.', pending: this.pendingCount() });
      this.rejectAll(new Error(event.message || 'Error del motor de voz.'));
    };

    const base = new URL(import.meta.env.BASE_URL, window.location.origin).href;
    const message: WorkerRequest = {
      type: 'init',
      modelUrl: new URL('models/ggml-base.en-q5_1.bin', base).href,
      whisperBaseUrl: new URL('whisper/', base).href,
    };
    worker.postMessage(message);
    this.setState({ ...this.state, status: 'loading', error: undefined });
  }

  private handleMessage(message: WorkerResponse): void {
    if (message.type === 'ready') {
      this.setState({ status: 'ready', pending: this.pendingCount() });
      this.pump();
      return;
    }

    if (message.type === 'error') {
      if (typeof message.id === 'number') {
        const job = this.current?.id === message.id ? this.current : this.queue.find((item) => item.id === message.id);
        if (job) this.failJob(job, new Error(message.message));
        this.pump();
        return;
      }
      this.setState({ status: 'error', error: message.message, pending: this.pendingCount() });
      this.rejectAll(new Error(message.message));
      return;
    }

    if (message.type === 'result' && this.current?.id === message.id) {
      const job = this.current;
      this.current = null;
      clearTimeout(job.timer);
      job.resolve(message.text);
      this.emitPending();
      this.pump();
    }
  }

  private pump(): void {
    if (this.current || this.queue.length === 0 || this.state.status !== 'ready' || !this.worker) return;

    const job = this.queue.shift();
    if (!job) return;
    this.current = job;
    this.emitPending();
    const copy = new Float32Array(job.audio);
    const audio = copy.buffer as ArrayBuffer;
    const message: WorkerRequest = {
      type: 'transcribe',
      id: job.id,
      audio,
      prompt: job.prompt,
    };
    this.worker.postMessage(message, [audio]);
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
      merged.error === this.state.error
    ) {
      return;
    }
    this.state = merged;
    for (const listener of this.listeners) listener(this.state);
  }
}
