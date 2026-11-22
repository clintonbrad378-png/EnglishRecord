import * as ort from 'onnxruntime-web/wasm';

const HOP = 512;
const CONTEXT = 64;
const STATE_SHAPE = [2, 1, 128] as const;

export interface VadEngine {
  readonly label: string;
  process(window: Float32Array): Promise<number> | number;
  reset(): Promise<void> | void;
  dispose(): void;
}

let configured = false;

function configureRuntime(wasmBase: string): void {
  if (configured) return;
  configured = true;
  ort.env.wasm.wasmPaths = {
    wasm: new URL(`${wasmBase}ort-wasm-simd-threaded.wasm`, window.location.origin).href,
    mjs: new URL(`${wasmBase}ort-wasm-simd-threaded.mjs`, window.location.origin).href,
  };
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
  ort.env.logLevel = 'error';
}

export class SileroVad implements VadEngine {
  readonly label = 'silero';

  private state: ort.Tensor = new ort.Tensor('float32', new Float32Array(2 * 1 * 128), [...STATE_SHAPE]);
  private readonly sr = new ort.Tensor('int64', BigInt64Array.from([16000n]), []);
  private context = new Float32Array(CONTEXT);

  private constructor(
    private readonly session: ort.InferenceSession,
    private readonly inputName: string,
    private readonly stateInputName: string,
    private readonly stateOutputName: string,
    private readonly outputName: string,
  ) {}

  static async create(modelUrl: string, wasmBase: string): Promise<SileroVad> {
    configureRuntime(wasmBase);
    const session = await ort.InferenceSession.create(new URL(modelUrl, window.location.origin).href, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    });

    const stateInputName = session.inputNames.find((name) => name.toLowerCase().includes('state'));
    const stateOutputName = session.outputNames.find((name) => name.toLowerCase().includes('state'));
    const inputName = session.inputNames.find((name) => name === 'input') ?? session.inputNames[0];
    const outputName = session.outputNames.find((name) => name !== stateOutputName) ?? session.outputNames[0];

    if (!stateInputName || !stateOutputName || !inputName || !outputName) {
      throw new Error('El modelo VAD no tiene el formato esperado.');
    }

    return new SileroVad(session, inputName, stateInputName, stateOutputName, outputName);
  }

  async process(window: Float32Array): Promise<number> {
    const input = new Float32Array(CONTEXT + HOP);
    input.set(this.context, 0);
    input.set(window.subarray(0, HOP), CONTEXT);

    const feeds: Record<string, ort.Tensor> = {
      [this.inputName]: new ort.Tensor('float32', input, [1, input.length]),
      [this.stateInputName]: this.state,
      sr: this.sr,
    };

    const result = await this.session.run(feeds);
    const nextState = result[this.stateOutputName];
    if (nextState) this.state = nextState;
    this.context = input.slice(-CONTEXT);

    const probability = result[this.outputName]?.data?.[0];
    return typeof probability === 'number' ? probability : 0;
  }

  reset(): void {
    this.state = new ort.Tensor('float32', new Float32Array(2 * 1 * 128), [...STATE_SHAPE]);
    this.context = new Float32Array(CONTEXT);
  }

  dispose(): void {
    void this.session.release();
  }
}

export class EnergyVad implements VadEngine {
  readonly label = 'energy';
  private floor = 0.0035;

  constructor(private readonly minThreshold = 0.009) {}

  process(window: Float32Array): number {
    let sum = 0;
    for (let i = 0; i < window.length; i += 1) sum += window[i] * window[i];
    const rms = Math.sqrt(sum / Math.max(1, window.length));
    const threshold = Math.max(this.minThreshold, this.floor * 3.4);
    if (rms < threshold) {
      this.floor = this.floor * 0.985 + rms * 0.015;
    }
    return rms > threshold ? 1 : 0;
  }

  reset(): void {
    this.floor = 0.0035;
  }

  dispose(): void {
    // nada que liberar
  }
}
