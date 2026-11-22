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
  private readonly impl: TranscriberLike;

  constructor() {
    const android = typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);
    this.impl = isTauri() && !android ? new TauriTranscriber() : new WebTranscriber();
  }

  getState(): TranscriberState {
    return this.impl.getState();
  }

  onState(listener: (state: TranscriberState) => void): () => void {
    return this.impl.onState(listener);
  }

  transcribe(audio: Float32Array, prompt?: string): Promise<string> {
    return this.impl.transcribe(audio, prompt);
  }

  retry(): void {
    this.impl.retry();
  }

  dispose(): void {
    this.impl.dispose();
  }
}
