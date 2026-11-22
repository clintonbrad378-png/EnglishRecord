import { dayLabel, formatDateLong, formatDuration, formatTimeOfDay, relativeSubtitle } from '../lib/format';
import { q, qa } from '../lib/dom';
import { brandMark, icon } from '../lib/icons';
import type { RecordingMeta, TranscriberState } from '../types';
import type { EffectiveTheme } from './theme';

interface HomeCallbacks {
  onRecord: () => void;
  onImport: () => void;
  onOpen: (id: string) => void;
  onSettings: () => void;
  onToggleTheme: () => void;
  onRetryTranscriber: () => void;
}

type Filter = 'all' | 'starred';

export class HomeView {
  readonly element: HTMLElement;
  private readonly callbacks: HomeCallbacks;
  private recordings: RecordingMeta[] = [];
  private filter: Filter = 'all';
  private transcriber: TranscriberState = { status: 'idle', pending: 0 };
  private readonly list: HTMLElement;
  private readonly statusButton: HTMLButtonElement;
  private readonly filterButtons: HTMLButtonElement[];
  private readonly themeButton: HTMLButtonElement;

  constructor(callbacks: HomeCallbacks) {
    this.callbacks = callbacks;
    const element = document.createElement('section');
    element.className = 'screen home-screen';
    element.innerHTML = `
      <div class="home-scroll">
        <header class="home-header">
          <div class="brand-row">
            <span class="brand-mark">${brandMark(38)}</span>
            <div class="brand-copy">
              <h1>English Record</h1>
              <p>${formatDateLong(Date.now())}</p>
            </div>
          </div>
          <button class="icon-button" data-action="theme" aria-label="Cambiar tema"></button>
        </header>

        <button class="model-status" data-action="status" aria-live="polite"></button>

        <div class="section-head">
          <div>
            <p class="eyebrow">Tu biblioteca</p>
            <h2>Grabaciones</h2>
          </div>
          <div class="section-actions">
            <span class="recordings-count" data-role="count">0</span>
            <button class="btn btn-quiet" data-action="import">${icon('upload', 15)}<span>Importar</span></button>
          </div>
        </div>

        <div class="tabs" role="tablist" aria-label="Filtrar grabaciones">
          <button class="tab is-active" data-filter="all" role="tab" aria-selected="true">Todas</button>
          <button class="tab" data-filter="starred" role="tab" aria-selected="false">Favoritas</button>
        </div>

        <div class="recordings-list" data-role="list"></div>
        <p class="privacy-note">${icon('info', 15, 2)}<span>Todo se procesa y se guarda en tu dispositivo. Nada sale de tu teléfono.</span></p>
      </div>

      <nav class="dock" aria-label="Navegación principal">
        <button class="dock-tab is-active" aria-current="page">
          <span class="dock-icon">${icon('headphones', 22)}</span>
          <span>Grabaciones</span>
        </button>
        <button class="record-fab" data-action="record" aria-label="Iniciar una grabación">
          <span class="record-fab-glow"></span>
          <span class="record-fab-core">${icon('mic', 30, 2)}</span>
        </button>
        <button class="dock-tab" data-action="settings">
          <span class="dock-icon">${icon('settings', 22)}</span>
          <span>Ajustes</span>
        </button>
      </nav>
    `;
    this.element = element;
    this.list = q(element, '[data-role="list"]');
    this.statusButton = q(element, '[data-action="status"]');
    this.themeButton = q(element, '[data-action="theme"]');
    this.filterButtons = qa(element, '[data-filter]');

    element.addEventListener('click', (event) => {
      const target = event.target as HTMLElement;
      const action = target.closest<HTMLElement>('[data-action]')?.dataset.action;
      if (action === 'record') {
        this.callbacks.onRecord();
        return;
      }
      if (action === 'import') {
        this.callbacks.onImport();
        return;
      }
      if (action === 'settings' || action === 'status') {
        this.callbacks.onSettings();
        return;
      }
      if (action === 'theme') {
        this.callbacks.onToggleTheme();
        return;
      }
      if (action === 'retry-model') {
        event.stopPropagation();
        this.callbacks.onRetryTranscriber();
        return;
      }

      const filter = target.closest<HTMLElement>('[data-filter]')?.dataset.filter as Filter | undefined;
      if (filter) {
        this.setFilter(filter);
        return;
      }

      const card = target.closest<HTMLElement>('[data-recording-id]');
      if (card?.dataset.recordingId) {
        this.callbacks.onOpen(card.dataset.recordingId);
      }
    });
  }

  setRecordings(recordings: RecordingMeta[]): void {
    this.recordings = recordings;
    this.renderList();
  }

  setTranscriber(state: TranscriberState): void {
    this.transcriber = state;
    this.renderStatus();
  }

  setTheme(effective: EffectiveTheme): void {
    this.themeButton.innerHTML = icon(effective === 'dark' ? 'sun' : 'moon', 21);
    this.themeButton.setAttribute(
      'aria-label',
      effective === 'dark' ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro',
    );
  }

  setFilter(filter: Filter): void {
    this.filter = filter;
    for (const button of this.filterButtons) {
      const isActive = button.dataset.filter === filter;
      button.classList.toggle('is-active', isActive);
      button.setAttribute('aria-selected', String(isActive));
    }
    this.renderList();
  }

  dispose(): void {
    this.element.remove();
  }

  private renderStatus(): void {
    const state = this.transcriber;
    const statusClass =
      state.status === 'ready'
        ? 'is-ready'
        : state.status === 'error'
          ? 'is-error'
          : state.status === 'loading'
            ? 'is-loading'
            : 'is-idle';

    this.statusButton.className = `model-status ${statusClass}`;
    if (state.status === 'ready') {
      this.statusButton.innerHTML = `
        <span class="status-dot"></span>
        <span class="status-copy">
          <strong>Transcripción lista</strong>
          <small>Whisper · inglés · en el dispositivo</small>
        </span>
        <span class="status-chip">EN</span>
        ${icon('arrow-right', 17)}
      `;
    } else if (state.status === 'error') {
      this.statusButton.innerHTML = `
        <span class="status-dot"></span>
        <span class="status-copy">
          <strong>El motor de voz no está listo</strong>
          <small>${escapeText(state.error ?? 'No se pudo cargar el modelo')}</small>
        </span>
        <span class="status-retry" data-action="retry-model">Reintentar</span>
      `;
    } else if (state.status === 'loading') {
      this.statusButton.innerHTML = `
        <span class="status-dot"></span>
        <span class="status-copy">
          <strong>Preparando la transcripción</strong>
          <small>La primera vez descarga el modelo en tu dispositivo</small>
        </span>
        <span class="spinner tiny"></span>
      `;
    } else {
      this.statusButton.innerHTML = `
        <span class="status-dot"></span>
        <span class="status-copy">
          <strong>Iniciando motor de voz</strong>
          <small>Un momento…</small>
        </span>
      `;
    }
  }

  private renderList(): void {
    const filtered =
      this.filter === 'starred' ? this.recordings.filter((recording) => recording.starred) : this.recordings;
    const count = q(this.element, '[data-role="count"]');
    count.textContent = String(filtered.length);

    if (filtered.length === 0) {
      this.list.innerHTML =
        this.filter === 'starred'
          ? `
        <div class="empty-state compact">
          <div class="empty-icon">${icon('star', 28)}</div>
          <h3>Aún no hay favoritas</h3>
          <p>Abre una grabación y márcala con la estrella para encontrarla aquí.</p>
        </div>
      `
          : this.emptyState();
      return;
    }

    const groups = new Map<string, RecordingMeta[]>();
    for (const recording of filtered) {
      const label = this.filter === 'starred' ? 'Favoritas' : dayLabel(recording.createdAt);
      const items = groups.get(label) ?? [];
      items.push(recording);
      groups.set(label, items);
    }

    let index = 0;
    this.list.innerHTML = Array.from(groups.entries())
      .map(
        ([label, items]) => `
        <section class="day-group">
          <div class="day-heading">
            <h3>${escapeText(label)}</h3>
            <span>${items.length}</span>
          </div>
          ${items.map((recording) => this.renderCard(recording, index++)).join('')}
        </section>
      `,
      )
      .join('');
  }

  private renderCard(recording: RecordingMeta, index: number): string {
    const words = recording.wordCount || 0;
    const preview = recording.transcript.map((chunk) => chunk.text).join(' ').trim();
    const badge =
      recording.transcript.length > 0
        ? 'Transcrito'
        : recording.hadSpeech
          ? 'Voz detectada'
          : 'Solo audio';
    const badgeClass = recording.transcript.length > 0 ? 'is-done' : recording.hadSpeech ? 'is-pending' : '';
    const meta = `${relativeSubtitle(recording.createdAt)} · ${formatDuration(recording.duration)}`;
    const bars = renderBars(recording.peaks, 34);

    return `
      <button class="recording-card" data-recording-id="${escapeText(recording.id)}" style="--i:${Math.min(index, 8)}" aria-label="Abrir ${escapeText(recording.title)}">
        <span class="card-leading">${icon('wave', 22)}</span>
        <span class="card-content">
          <span class="card-topline">
            <span class="card-title">${escapeText(recording.title)}</span>
            <span class="card-time">${formatTimeOfDay(recording.createdAt)}</span>
          </span>
          <span class="card-meta">${escapeText(meta)}</span>
          <span class="mini-wave">${bars}</span>
          <span class="card-foot">
            <span class="card-badge ${badgeClass}">${badge}</span>
            <span>${words} ${words === 1 ? 'palabra' : 'palabras'}</span>
            ${recording.starred ? `<span class="star-mark">${icon('star', 13, 2.2)}</span>` : ''}
            <span class="card-preview">${preview ? escapeText(preview.slice(0, 64)) + (preview.length > 64 ? '…' : '') : 'Toca para abrir y escuchar'}</span>
          </span>
        </span>
        <span class="card-chevron">${icon('arrow-right', 18)}</span>
      </button>
    `;
  }

  private emptyState(): string {
    return `
      <div class="empty-state">
        <div class="empty-visual">
          <span class="empty-ring ring-1"></span>
          <span class="empty-ring ring-2"></span>
          <span class="empty-mic">${icon('mic', 34, 1.9)}</span>
          <span class="empty-wave">${[12, 26, 38, 22, 30, 16, 24].map((height) => `<i style="height:${height}px"></i>`).join('')}</span>
        </div>
        <h3>Tu primera grabación<br />empieza con una idea</h3>
        <p>Habla en inglés y la transcripción aparecerá aquí, en tiempo real y sin enviar tu voz a ningún servidor.</p>
        <div class="empty-actions">
          <button class="btn btn-primary" data-action="record">${icon('mic', 18, 2)} Grabar ahora</button>
          <button class="btn btn-ghost" data-action="import">${icon('upload', 18, 2)} Importar audio</button>
        </div>
      </div>
    `;
  }
}

function renderBars(peaks: number[], count: number): string {
  const source = peaks.length > 0 ? peaks : new Array(count).fill(0.12);
  return Array.from({ length: count }, (_, index) => {
    const start = Math.floor((index * source.length) / count);
    const end = Math.max(start + 1, Math.floor(((index + 1) * source.length) / count));
    let peak = 0;
    for (let i = start; i < end && i < source.length; i += 1) peak = Math.max(peak, source[i]);
    const height = Math.round(4 + Math.max(0.08, Math.min(1, peak)) * 22);
    return `<i style="height:${height}px"></i>`;
  }).join('');
}

function escapeText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
