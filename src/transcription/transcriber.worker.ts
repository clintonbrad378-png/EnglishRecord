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
  post({ type: 'ready', threads, engine: 'wasm' });
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
      temperatureInc: 0.2,
      maxThreads: threads,
      prompt: message.prompt,
      ...(message.quality ? { beamSize: 5 } : {}),
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

const ANNOTATION = 'blank_?audio|silence|inaudible|music|musical|applause|laughter|laughing|sighs?|breathing|coughing|noise|static';

function sanitize(text: string, duration: number): string {
  const cleaned = text
    .replace(new RegExp(`\\[(?:${ANNOTATION})[^\\]]*\\]`, 'gi'), ' ')
    .replace(new RegExp(`\\((?:${ANNOTATION})[^)]*\\)`, 'gi'), ' ')
    .replace(/[♪♫♬♩]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const bare = cleaned.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
  if (!bare) return '';

  if (duration < 2.6) {
    const hallucinations = new Set([
      'thankyou',
      'thankyouverymuch',
      'thanksforwatching',
      'thanksforlistening',
      'pleasesubscribe',
      'subscribe',
      'goodbye',
      'goodnight',
      'music',
      'applause',
      'you',
      'bye',
      'okay',
      'oh',
      'mmhmm',
      'uhhuh',
    ]);
    if (hallucinations.has(bare)) return '';
  }

  if (
    duration < 6 &&
    /(?:thanks? for watching|please (?:like and )?subscribe|subscribe to (?:my|the) channel|subtitles? by|transcribed by|amara\.org)/i.test(cleaned)
  ) {
    return '';
  }
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
