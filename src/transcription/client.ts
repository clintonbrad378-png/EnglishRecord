import { isTauri } from '../lib/tauri';
import type { TranscriberState } from '../types';
import { TauriTranscriber } from './tauri-transcriber';
import { WebTranscriber } from './web-transcriber';

export interface TranscriberLike {
  getState(): TranscriberState;
  onState(listener: (state: TranscriberState) => void): () => void;
  transcribe(audio: Float32Array, prompt?: string): Promise<string>;
  retry(): void;
  dispose(): void;
}

export class Transcriber implements TranscriberLike {
  private impl: TranscriberLike;

  private listeners = new Set<(state: TranscriberState) => void>();
  private unlisten: (() => void) | null = null;
  private fallback: TranscriberLike | null = null;

  constructor() {
    if (isTauri()) {
      const native = new TauriTranscriber();
      this.impl = native;
      this.unlisten = native.onState((state) => {
        if (state.status === 'error' && !this.fallback) {
          console.warn('Transcriptor nativo falló, usando WASM:', state.error);
          this.unlisten?.();
          native.dispose();
          this.fallback = new WebTranscriber();
          this.impl = this.fallback;
          this.unlisten = this.impl.onState((s) => this.emit(s));
          this.emit(this.impl.getState());
          return;
        }
        this.emit(state);
      });
    } else {
      this.impl = new WebTranscriber();
      this.unlisten = this.impl.onState((s) => this.emit(s));
    }
  }

  getState(): TranscriberState {
    return this.impl.getState();
  }

  onState(listener: (state: TranscriberState) => void): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => this.listeners.delete(listener);
  }

  transcribe(audio: Float32Array, prompt?: string): Promise<string> {
    return this.impl.transcribe(audio, prompt);
  }

  retry(): void {
    this.impl.retry();
  }

  dispose(): void {
    this.unlisten?.();
    this.impl.dispose();
  }

  private emit(state: TranscriberState): void {
    for (const l of this.listeners) l(state);
  }
}
