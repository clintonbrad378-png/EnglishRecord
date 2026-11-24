import { formatBytes } from '../lib/format';
import { q } from '../lib/dom';
import { brandMark, icon } from '../lib/icons';
import { isTauri } from '../lib/tauri';
import { requestPersistence, storageUsage } from '../lib/storage';
import type { TranscriberState } from '../types';
import { toast } from './dialog';
import type { ThemeMode } from './theme';

interface SettingsCallbacks {
  onBack: () => void;
  onTheme: (mode: ThemeMode) => void;
  onRetryTranscriber: () => void;
  onInstall: () => Promise<void>;
}

interface StorageInfo {
  usage: number;
  quota: number;
  persisted: boolean;
}

export class SettingsView {
  readonly element: HTMLElement;
  private readonly callbacks: SettingsCallbacks;
  private readonly themeButtons: HTMLButtonElement[];
  private readonly modelCard: HTMLElement;
  private readonly storageCard: HTMLElement;
  private readonly installButton: HTMLButtonElement;
  private readonly installHint: HTMLElement;
  private transcriber: TranscriberState = { status: 'idle', pending: 0 };
  private installAvailable = false;
  private readonly standalone: boolean;
  private disposed = false;

  constructor(themeMode: ThemeMode, callbacks: SettingsCallbacks) {
    this.callbacks = callbacks;
    this.standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      Boolean((navigator as Navigator & { standalone?: boolean }).standalone);

    const element = document.createElement('section');
    element.className = 'screen settings-screen';
    element.innerHTML = `
      <header class="plain-header">
        <button class="icon-button" data-action="back" aria-label="Volver">${icon('back', 22)}</button>
        <h1>Ajustes</h1>
        <span class="header-spacer"></span>
      </header>

      <div class="settings-scroll">
        <section class="settings-intro">
          <span class="settings-brand">${brandMark(52)}</span>
          <div>
            <h2>English Record</h2>
            <p>Tu voz, tu texto. Todo privado y en tu dispositivo.</p>
          </div>
        </section>

        <section class="settings-group">
          <h3>Apariencia</h3>
          <div class="settings-card">
            <div class="setting-row stacked">
              <div class="setting-copy">
                <strong>Tema</strong>
                <p>Elige cómo se ve la aplicación.</p>
              </div>
              <div class="segmented" role="group" aria-label="Tema de la aplicación">
                <button data-theme="system" aria-pressed="false">${icon('monitor', 16)}<span>Sistema</span></button>
                <button data-theme="light" aria-pressed="false">${icon('sun', 16)}<span>Claro</span></button>
                <button data-theme="dark" aria-pressed="false">${icon('moon', 16)}<span>Oscuro</span></button>
              </div>
            </div>
          </div>
        </section>

        <section class="settings-group">
          <h3>Transcripción</h3>
          <div class="settings-card">
            <div class="model-card" data-role="model"></div>
            <div class="setting-list">
              <div class="setting-line" data-role="model-line"><span>Modelo</span><strong>Whisper base.en · q5_1</strong></div>
              <div class="setting-line"><span>Idioma</span><strong>Inglés</strong></div>
              <div class="setting-line"><span>Detección de voz</span><strong>Silero VAD</strong></div>
              <div class="setting-line" data-role="engine-line"><span>Procesamiento</span><strong>En el dispositivo</strong></div>
              <div class="setting-line" data-role="perf-line"><span>Rendimiento</span><strong>Detectando…</strong></div>
              <div class="setting-line" data-role="last-line"><span>Última transcripción</span><strong>—</strong></div>
            </div>
          </div>
        </section>

        <section class="settings-group">
          <h3>Almacenamiento</h3>
          <div class="settings-card storage-card" data-role="storage">
            <div class="storage-head">
              <div>
                <strong>Grabaciones y audio</strong>
                <p data-role="storage-label">Calculando espacio…</p>
              </div>
              <span data-role="storage-percent">—</span>
            </div>
            <div class="storage-track"><span data-role="storage-fill"></span></div>
            <div class="storage-foot">
              <span>Guardado en este dispositivo</span>
              <button class="btn btn-quiet small" data-action="persist">${icon('install', 15)} Proteger datos</button>
            </div>
          </div>
        </section>

        <section class="settings-group">
          <h3>Aplicación</h3>
          <div class="settings-card">
            <button class="setting-action" data-action="install">
              <span class="setting-action-icon">${icon('install', 21)}</span>
              <span class="setting-action-copy">
                <strong>Añadir a pantalla de inicio</strong>
                <small data-role="install-hint">Accede más rápido y úsala sin conexión.</small>
              </span>
              ${icon('arrow-right', 18)}
            </button>
            <div class="setting-list">
              <div class="setting-line"><span>Versión</span><strong>1.0 · ${__APP_BUILD__}</strong></div>
              <div class="setting-line"><span>Funciona sin conexión</span><strong>Sí</strong></div>
            </div>
          </div>
        </section>

        <section class="privacy-card">
          <div class="privacy-icon">${icon('sparkle', 21)}</div>
          <div>
            <h3>Privacidad por diseño</h3>
            <p>El audio se procesa con modelos locales en tu dispositivo. Ninguna grabación, transcripción o dato se envía a un servidor.</p>
          </div>
        </section>

        <p class="settings-foot">Hecho para practicar inglés en voz alta.<br />English Record · Whisper + Silero VAD</p>
      </div>
    `;
    this.element = element;
    this.themeButtons = Array.from(element.querySelectorAll<HTMLButtonElement>('[data-theme]'));
    this.modelCard = q(element, '[data-role="model"]');
    this.storageCard = q(element, '[data-role="storage"]');
    this.installButton = q(element, '[data-action="install"]');
    this.installHint = q(element, '[data-role="install-hint"]');

    element.addEventListener('click', (event) => {
      const target = event.target as HTMLElement;
      const theme = target.closest<HTMLElement>('[data-theme]')?.dataset.theme as ThemeMode | undefined;
      if (theme) {
        this.callbacks.onTheme(theme);
        return;
      }
      const action = target.closest<HTMLElement>('[data-action]')?.dataset.action;
      if (action === 'back') this.callbacks.onBack();
      else if (action === 'install') void this.install();
      else if (action === 'persist') void this.persist();
      else if (action === 'retry-model') this.callbacks.onRetryTranscriber();
    });

    this.setTheme(themeMode);
    this.renderModel();
    this.updateInstall();
    void this.refreshStorage();
  }

  setTheme(mode: ThemeMode): void {
    for (const button of this.themeButtons) {
      const active = button.dataset.theme === mode;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    }
  }

  setTranscriber(state: TranscriberState): void {
    this.transcriber = state;
    this.renderModel();
  }

  setInstallAvailable(available: boolean): void {
    this.installAvailable = available;
    this.updateInstall();
  }

  dispose(): void {
    this.disposed = true;
    this.element.remove();
  }

  private renderModel(): void {
    const state = this.transcriber;
    const className =
      state.status === 'ready'
        ? 'is-ready'
        : state.status === 'error'
          ? 'is-error'
          : state.status === 'loading'
            ? 'is-loading'
            : 'is-idle';

    this.modelCard.className = `model-card ${className}`;
    const engineLine = this.element.querySelector('[data-role="engine-line"] strong');
    const perfLine = this.element.querySelector('[data-role="perf-line"] strong');
    const lastLine = this.element.querySelector('[data-role="last-line"] strong');
    const engineLabel = state.engine === 'native' ? 'Nativo (en el dispositivo)' : state.engine === 'wasm' ? 'WASM (en el navegador)' : 'En el dispositivo';
    if (engineLine) engineLine.textContent = engineLabel;
    if (perfLine) {
      if (state.status === 'ready') {
        const threads = state.threads ? `${state.threads} ${state.threads === 1 ? 'hilo' : 'hilos'}` : '—';
        const load = state.modelLoadMs ? ` · modelo ${(state.modelLoadMs / 1000).toFixed(1)} s` : '';
        perfLine.textContent = `${threads}${load}`;
      } else if (state.status === 'loading') {
        perfLine.textContent = 'Cargando modelo…';
      } else {
        perfLine.textContent = state.engine === 'wasm' ? (window.crossOriginIsolated ? 'Multihilo' : 'Modo compatible') : '—';
      }
    }
    if (lastLine) {
      if (state.lastTranscriptionMs && state.lastAudioSec) {
        lastLine.textContent = `${state.lastAudioSec.toFixed(1)} s audio / ${(state.lastTranscriptionMs / 1000).toFixed(2)} s`;
      } else {
        lastLine.textContent = '—';
      }
    }

    if (state.status === 'ready') {
      this.modelCard.innerHTML = `
        <span class="status-dot"></span>
        <div class="model-copy">
          <strong>Transcripción lista</strong>
          <p>${state.engine === 'native' ? 'Motor nativo cargado en tu dispositivo.' : 'Modelo WASM cargado y funcionando en tu dispositivo.'}</p>
        </div>
        <span class="status-chip">${state.engine === 'native' ? 'NATIVO' : 'EN'}</span>
      `;
    } else if (state.status === 'loading') {
      this.modelCard.innerHTML = `
        <span class="status-dot"></span>
        <div class="model-copy">
          <strong>Preparando el modelo</strong>
          <p>${state.engine === 'native' ? 'Cargando el motor nativo… puede tardar unos segundos la primera vez.' : 'La primera vez puede tardar unos segundos.'}</p>
        </div>
        <span class="spinner tiny"></span>
      `;
    } else if (state.status === 'error') {
      this.modelCard.innerHTML = `
        <span class="status-dot"></span>
        <div class="model-copy">
          <strong>Modelo no disponible</strong>
          <p>${escapeText(state.error ?? 'No se pudo iniciar el motor de voz.')}</p>
        </div>
        <button class="btn btn-quiet small" data-action="retry-model">${icon('refresh', 15)} Reintentar</button>
      `;
    } else {
      this.modelCard.innerHTML = `
        <span class="status-dot"></span>
        <div class="model-copy">
          <strong>Iniciando el motor</strong>
          <p>Un momento…</p>
        </div>
      `;
    }
  }

  private updateInstall(): void {
    if (isTauri()) {
      this.installButton.disabled = true;
      this.installHint.textContent = 'Estás usando la app de escritorio.';
      return;
    }
    if (this.standalone) {
      this.installButton.disabled = true;
      this.installHint.textContent = 'Ya está instalada en este dispositivo.';
      return;
    }
    this.installButton.disabled = !this.installAvailable;
    this.installHint.textContent = this.installAvailable
      ? 'Abre English Record como una app y úsala sin conexión.'
      : 'Desde el menú del navegador puedes añadirla a la pantalla de inicio.';
  }

  private async install(): Promise<void> {
    if (!this.installAvailable) {
      toast('Usa el menú del navegador para añadirla a la pantalla de inicio.', { icon: 'install' });
      return;
    }
    await this.callbacks.onInstall();
  }

  private async persist(): Promise<void> {
    const granted = await requestPersistence();
    toast(
      granted ? 'Almacenamiento protegido contra borrado automático.' : 'El navegador decidirá cuándo conservar los datos.',
      { icon: granted ? 'check' : 'info' },
    );
    await this.refreshStorage();
  }

  private async refreshStorage(): Promise<void> {
    let persisted = false;
    try {
      persisted = (await navigator.storage?.persisted?.()) ?? false;
    } catch {
      persisted = false;
    }

    let info: StorageInfo;
    try {
      info = { ...(await storageUsage()), persisted };
    } catch {
      info = { usage: 0, quota: 0, persisted };
    }
    if (this.disposed) return;

    const label = q<HTMLElement>(this.element, '[data-role="storage-label"]');
    const percent = q<HTMLElement>(this.element, '[data-role="storage-percent"]');
    const fill = q<HTMLElement>(this.element, '[data-role="storage-fill"]');

    if (!info.quota) {
      label.textContent = `${formatBytes(info.usage)} usados`;
      percent.textContent = '—';
      fill.style.width = '4%';
      return;
    }

    const ratio = Math.min(1, info.usage / info.quota);
    label.textContent = `${formatBytes(info.usage)} de ${formatBytes(info.quota)}${info.persisted ? ' · protegido' : ''}`;
    percent.textContent = `${Math.max(1, Math.round(ratio * 100))}%`;
    fill.style.width = `${Math.max(2, ratio * 100)}%`;
    this.storageCard.classList.toggle('is-persisted', info.persisted);
  }
}

function escapeText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
