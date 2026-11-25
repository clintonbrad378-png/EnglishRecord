export interface InitRequest {
  type: 'init';
  modelUrl: string;
  whisperBaseUrl: string;
}

export interface TranscribeRequest {
  type: 'transcribe';
  id: number;
  audio: ArrayBuffer;
  prompt?: string;
  quality?: boolean;
}

export type WorkerRequest = InitRequest | TranscribeRequest;

export interface ReadyMessage {
  type: 'ready';
  threads: number;
  engine?: 'wasm';
}

export interface ResultMessage {
  type: 'result';
  id: number;
  text: string;
  duration: number;
  language?: string;
}

export interface ErrorMessage {
  type: 'error';
  id?: number;
  message: string;
}

export type WorkerResponse = ReadyMessage | ResultMessage | ErrorMessage;
