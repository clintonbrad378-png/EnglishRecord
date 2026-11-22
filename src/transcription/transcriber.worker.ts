/// <reference lib="webworker" />

import { configureWasm, initWhisper, type WhisperContext } from '@fugood/node-whisper-wasm';
import type { InitRequest, TranscribeRequest, WorkerRequest, WorkerResponse } from './protocol';

const scope = self as unknown as DedicatedWorkerGlobalScope;

let whisper: WhisperContext | null = null;
let ready = false;
let threads = 1;
let queue: Promise<void> = Promise.resolve();
let useThreads = false;
let whisperBaseUrl = '';

function post(message: WorkerResponse, transfer?: Transferable[]): void {
  scope.postMessage(message, transfer ?? []);
}

async function initialize(message: InitRequest): Promise<void> {
  whisperBaseUrl = message.whisperBaseUrl.endsWith('/') ? message.whisperBaseUrl : `${message.whisperBaseUrl}/`;
  useThreads = Boolean(scope.crossOriginIsolated && typeof SharedArrayBuffer !== 'undefined');
  threads = useThreads ? Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1 || 2)) : 1;

  configureWasm({
    worker: false,
    threads: useThreads,
    jsPath: `${whisperBaseUrl}${useThreads ? 'whisper-node.threads.js' : 'whisper-node.js'}`,
    wasmPath: `${whisperBaseUrl}${useThreads ? 'whisper-node.threads.wasm' : 'whisper-node.wasm'}`,
  });

  whisper = await initWhisper({
    filePath: message.modelUrl,
    worker: false,
    cacheModel: true,
  });
  ready = true;
  post({ type: 'ready', threads });
}

async function transcribe(message: TranscribeRequest): Promise<void> {
  if (!whisper || !ready) {
    post({ type: 'error', id: message.id, message: 'El modelo todavía no está listo.' });
    return;
  }

  const audio = new Float32Array(message.audio);
  if (audio.length < 1600) {
    post({ type: 'result', id: message.id, text: '', duration: 0 });
    return;
  }

  try {
    const job = whisper.transcribeData(audio, {
      language: 'en',
      translate: false,
      tokenTimestamps: false,
      temperature: 0,
      maxThreads: threads,
      maxLen: 80,
      prompt: message.prompt,
    });
    const result = await job.promise;
    const duration = audio.length / 16000;
    const text = sanitize(result.result, duration);
    post({ type: 'result', id: message.id, text, duration, language: result.language });
  } catch (error) {
    post({
      type: 'error',
      id: message.id,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

function sanitize(text: string, duration: number): string {
  const cleaned = text
    .replace(/\[(?:blank_?audio|silence|inaudible|music|applause|noise)\]/gi, ' ')
    .replace(/\((?:silence|inaudible|music|applause|noise)\)/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const bare = cleaned.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
  if (!bare) return '';

  if (duration < 2.2) {
    const hallucinations = new Set([
      'thankyou',
      'thanksforwatching',
      'pleasesubscribe',
      'subscribe',
      'you',
      'bye',
      'okay',
      'mmhmm',
      'uhhuh',
    ]);
    if (hallucinations.has(bare)) return '';
  }

  if (/^(please\s+)?subscribe/i.test(cleaned) && duration < 4) return '';
  return cleaned;
}

scope.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const message = event.data;
  if (message.type === 'init') {
    queue = queue.then(() => initialize(message)).catch((error) => {
      ready = false;
      post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
    });
    return;
  }

  if (message.type === 'transcribe') {
    queue = queue.then(() => transcribe(message)).catch(() => undefined);
  }
};
