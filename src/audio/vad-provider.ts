import { EnergyVad, SileroVad, type VadEngine } from './vad';

class ProgressiveVad implements VadEngine {
  private readonly fallback = new EnergyVad();
  private engine: VadEngine | null = null;
  private primaryActive = false;

  constructor(ready: Promise<SileroVad | null>) {
    void ready.then((engine) => {
      this.engine = engine;
    });
  }

  get label(): string {
    return this.engine?.label ?? this.fallback.label;
  }

  async process(window: Float32Array): Promise<number> {
    if (!this.engine) return this.fallback.process(window);
    if (!this.primaryActive) {
      this.primaryActive = true;
      try {
        await this.engine.reset();
      } catch {
        this.engine = null;
        return this.fallback.process(window);
      }
    }
    try {
      return await this.engine.process(window);
    } catch {
      this.engine = null;
      this.primaryActive = false;
      return this.fallback.process(window);
    }
  }

  reset(): void {
    this.fallback.reset();
    if (this.engine) void this.engine.reset();
  }

  dispose(): void {
    this.fallback.dispose();
  }
}

export class VadProvider {
  private ready: Promise<SileroVad | null> | null = null;

  constructor(
    private readonly modelUrl: string,
    private readonly wasmBase: string,
  ) {}

  create(): VadEngine {
    return new ProgressiveVad(this.load());
  }

  private load(): Promise<SileroVad | null> {
    if (!this.ready) {
      this.ready = SileroVad.create(this.modelUrl, this.wasmBase).catch((error) => {
        console.warn('Silero VAD no disponible, se usará detección por energía.', error);
        return null;
      });
    }
    return this.ready;
  }
}
