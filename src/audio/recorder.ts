export interface AudioFrame {
  samples: Float32Array;
  rms: number;
  sampleRate: number;
}

interface RecorderOptions {
  onFrame: (frame: AudioFrame) => void;
  onEnded?: () => void;
  onError?: (error: Error) => void;
}

function workletUrl(): string {
  return new URL(`${import.meta.env.BASE_URL}recorder-worklet.js`, window.location.origin).href;
}

export class MicrophoneRecorder {
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private worklet: AudioWorkletNode | null = null;
  private sink: GainNode | null = null;
  private paused = false;
  private started = false;
  private readonly options: RecorderOptions;

  constructor(options: RecorderOptions) {
    this.options = options;
  }

  get isRecording(): boolean {
    return this.started && !this.paused;
  }

  get isPaused(): boolean {
    return this.started && this.paused;
  }

  async start(): Promise<void> {
    if (this.started) return;

    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Este navegador no permite acceder al micrófono.');
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
    } catch (error) {
      throw translateMediaError(error);
    }

    this.stream = stream;
    for (const track of stream.getAudioTracks()) {
      track.addEventListener('ended', () => {
        this.options.onEnded?.();
      });
    }

    let context: AudioContext;
    try {
      context = new AudioContext({ sampleRate: 16000, latencyHint: 'interactive' });
    } catch {
      context = new AudioContext({ latencyHint: 'interactive' });
    }
    this.context = context;

    if (context.state === 'suspended') await context.resume();

    await context.audioWorklet.addModule(workletUrl());

    const worklet = new AudioWorkletNode(context, 'english-record-recorder', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      channelCount: 1,
      channelCountMode: 'explicit',
    });
    worklet.port.onmessage = (event: MessageEvent<AudioFrame & { type: string }>) => {
      if (!event.data || event.data.type !== 'audio') return;
      if (this.paused) return;
      this.options.onFrame({
        samples: event.data.samples,
        rms: event.data.rms,
        sampleRate: event.data.sampleRate,
      });
    };

    const source = context.createMediaStreamSource(stream);
    const sink = context.createGain();
    sink.gain.value = 0;
    source.connect(worklet);
    worklet.connect(sink);
    sink.connect(context.destination);

    this.source = source;
    this.worklet = worklet;
    this.sink = sink;
    this.started = true;
    this.paused = false;
  }

  async pause(): Promise<void> {
    if (!this.started || this.paused) return;
    this.paused = true;
    this.worklet?.port.postMessage({ type: 'set-active', active: false });
    for (const track of this.stream?.getAudioTracks() ?? []) track.enabled = false;
    try {
      await this.context?.suspend();
    } catch (error) {
      this.options.onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  }

  async resume(): Promise<void> {
    if (!this.started || !this.paused) return;
    for (const track of this.stream?.getAudioTracks() ?? []) track.enabled = true;
    try {
      await this.context?.resume();
    } catch (error) {
      this.options.onError?.(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    this.paused = false;
    this.worklet?.port.postMessage({ type: 'set-active', active: true });
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    this.started = false;
    this.paused = false;

    this.worklet?.port.postMessage({ type: 'set-active', active: false });
    this.worklet?.port.close();
    try {
      this.source?.disconnect();
      this.worklet?.disconnect();
      this.sink?.disconnect();
    } catch {
      // los nodos ya pueden estar desconectados
    }
    for (const track of this.stream?.getTracks() ?? []) {
      track.stop();
    }
    this.stream = null;
    this.source = null;
    this.worklet = null;
    this.sink = null;

    if (this.context && this.context.state !== 'closed') {
      try {
        await this.context.close();
      } catch {
        // ignorar
      }
    }
    this.context = null;
  }
}

function translateMediaError(error: unknown): Error {
  if (!(error instanceof Error)) return new Error('No se pudo iniciar el micrófono.');
  if (error.name === 'NotAllowedError' || error.name === 'SecurityError') {
    return new Error('Permiso de micrófono denegado. Actívalo en los ajustes del navegador.');
  }
  if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
    return new Error('No se encontró un micrófono disponible.');
  }
  if (error.name === 'NotReadableError' || error.name === 'TrackStartError') {
    return new Error('El micrófono está siendo usado por otra aplicación.');
  }
  return error;
}
