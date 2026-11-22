import { formatDateLong, formatDuration, formatTimeOfDay, sanitizeFilename } from '../lib/format';
import { q } from '../lib/dom';
import { icon } from '../lib/icons';
import type { RecordingSession } from '../session';
import type { RecordingMeta, TranscriberState, TranscriptChunk } from '../types';
import { actionSheet, confirmDialog, promptDialog, showBusy, toast } from './dialog';

interface DetailCallbacks {
  onBack: () => void;
  onRename: (title: string) => Promise<RecordingMeta>;
  onToggleStar: () => Promise<RecordingMeta>;
  onRetranscribe: () => Promise<RecordingMeta>;
  onDelete: () => Promise<void>;
}

const WAVE_BARS = 82;

export class DetailView {
  readonly element: HTMLElement;
  private meta: RecordingMeta;
  private readonly audio: HTMLAudioElement;
  private readonly audioUrl: string;
  private readonly session: RecordingSession | null;
  private readonly callbacks: DetailCallbacks;
  private readonly titleElement: HTMLElement;
  private readonly subtitleElement: HTMLElement;
  private readonly playButton: HTMLButtonElement;
  private readonly timeElement: HTMLElement;
  private readonly speedButton: HTMLButtonElement;
  private readonly wave: HTMLElement;
  private readonly transcriptList: HTMLElement;
  private readonly transcriptMeta: HTMLElement;
  private readonly starButton: HTMLButtonElement;
  private readonly bars: HTMLElement[] = [];
  private readonly unsubscribe: (() => void) | null;
  private transcriber: TranscriberState;
  private transcriptSignature = '';
  private raf = 0;
  private speed = 1;
  private disposed = false;

  constructor(
    meta: RecordingMeta,
    blob: Blob,
    session: RecordingSession | null,
    transcriber: TranscriberState,
    callbacks: DetailCallbacks,
  ) {
    this.meta = meta;
    this.session = session;
    this.transcriber = transcriber;
    this.callbacks = callbacks;
    this.audioUrl = URL.createObjectURL(blob);
    this.audio = new Audio(this.audioUrl);
    this.audio.preload = 'metadata';

    const element = document.createElement('section');
    element.className = 'screen detail-screen';
    element.innerHTML = `
      <header class="detail-header">
        <button class="icon-button" data-action="back" aria-label="Volver">${icon('back', 22)}</button>
        <span class="detail-kicker">${icon('wave', 16)} Grabación</span>
        <button class="icon-button" data-action="menu" aria-label="Más opciones">${icon('more', 22)}</button>
      </header>

      <div class="detail-scroll">
        <div class="detail-title-row">
          <div>
            <h1 data-role="title"></h1>
            <p data-role="subtitle"></p>
          </div>
          <button class="star-button" data-action="star" aria-label="Marcar como favorita">${icon('star', 21)}</button>
        </div>

        <section class="player-card">
          <div class="player-top">
            <span class="player-chip">EN</span>
            <span class="player-duration" data-role="duration"></span>
          </div>
          <div class="detail-wave" data-role="wave" role="slider" tabindex="0" aria-label="Posición de reproducción" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"></div>
          <div class="player-controls">
            <span class="player-time" data-role="time">0:00</span>
            <button class="play-button" data-action="play" aria-label="Reproducir">${icon('play', 27)}</button>
            <button class="speed-button" data-action="speed" aria-label="Velocidad de reproducción">1×</button>
          </div>
        </section>

        <section class="detail-transcript">
          <header class="detail-transcript-head">
            <div>
              <p class="eyebrow">Texto</p>
              <h2>Transcripción</h2>
            </div>
            <div class="transcript-tools">
              <span class="transcript-pending-badge" data-role="pending" hidden><span class="spinner tiny"></span> En curso</span>
              <button class="btn btn-quiet" data-action="copy">${icon('copy', 16)}<span>Copiar</span></button>
            </div>
          </header>
          <div class="detail-transcript-body" data-role="transcript"></div>
          <p class="transcript-meta" data-role="meta"></p>
        </section>

        <p class="detail-footnote">${icon('info', 14)} Grabación y transcripción guardadas en este dispositivo.</p>
      </div>
    `;
    this.element = element;

    this.titleElement = q(element, '[data-role="title"]');
    this.subtitleElement = q(element, '[data-role="subtitle"]');
    this.playButton = q(element, '[data-action="play"]');
    this.timeElement = q(element, '[data-role="time"]');
    this.speedButton = q(element, '[data-action="speed"]');
    this.wave = q(element, '[data-role="wave"]');
    this.transcriptList = q(element, '[data-role="transcript"]');
    this.transcriptMeta = q(element, '[data-role="meta"]');
    this.starButton = q(element, '[data-action="star"]');

    for (let i = 0; i < WAVE_BARS; i += 1) {
      const bar = document.createElement('i');
      this.wave.appendChild(bar);
      this.bars.push(bar);
    }

    element.addEventListener('click', (event) => {
      const action = (event.target as HTMLElement).closest<HTMLElement>('[data-action]')?.dataset.action;
      if (!action) return;
      if (action === 'back') this.callbacks.onBack();
      else if (action === 'play') void this.togglePlayback();
      else if (action === 'speed') this.cycleSpeed();
      else if (action === 'star') void this.toggleStar();
      else if (action === 'menu') void this.openMenu();
      else if (action === 'copy') void this.copyTranscript();
    });

    this.wave.addEventListener('click', (event) => this.seekFromEvent(event));
    this.wave.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      const delta = event.key === 'ArrowRight' ? 5 : -5;
      this.audio.currentTime = Math.max(0, Math.min(this.duration(), this.audio.currentTime + delta));
    });

    this.audio.addEventListener('play', () => this.syncPlayState());
    this.audio.addEventListener('pause', () => this.syncPlayState());
    this.audio.addEventListener('ended', () => {
      this.audio.currentTime = 0;
      this.syncPlayState();
      this.syncProgress();
    });
    this.audio.addEventListener('timeupdate', () => this.syncProgress());
    this.audio.addEventListener('loadedmetadata', () => this.syncProgress());

    this.unsubscribe = session ? session.subscribe(() => this.syncSession()) : null;

    this.setMeta(meta);
    this.syncTranscript(true);
    this.syncProgress();
    this.animateProgress();
  }

  setMeta(meta: RecordingMeta): void {
    this.meta = meta;
    this.titleElement.textContent = meta.title;
    this.subtitleElement.textContent = `${formatDateLong(meta.createdAt)} · ${formatTimeOfDay(meta.createdAt)} · ${formatDuration(meta.duration)}`;
    q(this.element, '[data-role="duration"]').textContent = formatDuration(meta.duration);
    this.starButton.classList.toggle('is-starred', meta.starred);
    this.starButton.setAttribute('aria-label', meta.starred ? 'Quitar de favoritas' : 'Marcar como favorita');
    this.wave.setAttribute('aria-valuemax', String(Math.round(meta.duration)));
    this.renderWave();
    this.syncTranscript(true);
  }

  setTranscriber(state: TranscriberState): void {
    this.transcriber = state;
    this.syncTranscript(true);
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.unsubscribe?.();
    this.audio.pause();
    this.audio.src = '';
    URL.revokeObjectURL(this.audioUrl);
    this.element.remove();
  }

  private async togglePlayback(): Promise<void> {
    if (this.audio.paused) {
      try {
        await this.audio.play();
      } catch {
        toast('No se pudo reproducir el audio.');
      }
    } else {
      this.audio.pause();
    }
  }

  private cycleSpeed(): void {
    const speeds = [1, 1.25, 1.5, 2];
    const index = speeds.indexOf(this.speed);
    this.speed = speeds[(index + 1) % speeds.length];
    this.audio.playbackRate = this.speed;
    this.speedButton.textContent = `${this.speed}×`;
  }

  private syncPlayState(): void {
    const playing = !this.audio.paused && !this.audio.ended;
    this.playButton.innerHTML = icon(playing ? 'pause' : 'play', 27);
    this.playButton.setAttribute('aria-label', playing ? 'Pausar' : 'Reproducir');
    this.element.classList.toggle('is-playing', playing);
  }

  private animateProgress = (): void => {
    if (this.disposed) return;
    if (!this.audio.paused) this.syncProgress();
    this.raf = requestAnimationFrame(this.animateProgress);
  };

  private syncProgress(): void {
    const duration = this.duration();
    const current = Math.min(this.audio.currentTime, duration);
    const ratio = duration > 0 ? current / duration : 0;
    this.timeElement.textContent = `${formatDuration(current)} / ${formatDuration(duration)}`;
    this.wave.style.setProperty('--progress', String(ratio));
    this.wave.setAttribute('aria-valuenow', String(Math.round(current)));
    this.wave.setAttribute('aria-valuemax', String(Math.max(1, Math.round(duration))));
    const playedBars = Math.round(ratio * this.bars.length);
    this.bars.forEach((bar, index) => bar.classList.toggle('is-played', index < playedBars));
    this.highlightTranscript(current);
  }

  private highlightTranscript(current: number): void {
    const rows = this.transcriptList.querySelectorAll<HTMLElement>('[data-start]');
    rows.forEach((row) => {
      const start = Number(row.dataset.start);
      const end = Number(row.dataset.end);
      row.classList.toggle('is-active', current >= start && current < end);
    });
  }

  private syncSession(): void {
    if (!this.session?.meta) return;
    this.setMeta(this.session.meta);
  }

  private syncTranscript(force: boolean): void {
    const chunks = this.session?.meta?.transcript ?? this.meta.transcript;
    const pending = this.session?.pending ?? 0;
    const signature = `${chunks.map((chunk) => chunk.id + chunk.text).join('|')}#${pending}#${this.transcriber.status}`;
    if (!force && signature === this.transcriptSignature) return;
    this.transcriptSignature = signature;

    const pendingBadge = q<HTMLElement>(this.element, '[data-role="pending"]');
    pendingBadge.hidden = pending === 0;

    if (chunks.length > 0) {
      this.transcriptList.innerHTML = '';
      for (const chunk of chunks) {
        this.transcriptList.appendChild(this.renderChunk(chunk));
      }
      if (pending > 0) {
        const pendingRow = document.createElement('div');
        pendingRow.className = 'transcript-pending-row';
        pendingRow.innerHTML = '<span class="spinner tiny"></span><span>Transcribiendo el siguiente fragmento…</span>';
        this.transcriptList.appendChild(pendingRow);
      }
      this.transcriptList.scrollTop = this.transcriptList.scrollHeight;
      this.transcriptMeta.textContent = `${this.meta.wordCount} palabras · ${formatDuration(this.meta.duration)} de audio`;
      return;
    }

    this.transcriptList.innerHTML = '';
    if (pending > 0 || (this.transcriber.status === 'loading' && this.meta.hadSpeech)) {
      this.transcriptList.innerHTML = `
        <div class="transcript-loading">
          <span class="spinner"></span>
          <div>
            <strong>${this.transcriber.status === 'loading' ? 'Preparando el modelo de voz…' : 'Transcribiendo tu grabación…'}</strong>
            <p>El texto aparecerá aquí automáticamente.</p>
          </div>
        </div>
      `;
    } else if (this.meta.hadSpeech) {
      this.transcriptList.innerHTML = `
        <div class="transcript-empty">
          <p>La transcripción no está disponible para esta grabación.</p>
          <button class="btn btn-primary" data-action="retry-transcript">${icon('refresh', 16, 2)} Transcribir de nuevo</button>
        </div>
      `;
      this.transcriptList.querySelector('[data-action="retry-transcript"]')?.addEventListener('click', () => {
        void this.retranscribe();
      });
    } else {
      this.transcriptList.innerHTML = `
        <div class="transcript-empty">
          <p>No se detectó voz en esta grabación.</p>
        </div>
      `;
    }
    this.transcriptMeta.textContent = `${formatDuration(this.meta.duration)} de audio`;
  }

  private renderChunk(chunk: TranscriptChunk): HTMLElement {
    const row = document.createElement('button');
    row.className = 'transcript-row';
    row.dataset.start = String(chunk.t0);
    row.dataset.end = String(Math.max(chunk.t1, chunk.t0 + 0.4));
    row.innerHTML = `<span class="transcript-time">${formatDuration(chunk.t0)}</span>`;
    const text = document.createElement('span');
    text.className = 'transcript-text';
    text.textContent = chunk.text;
    row.appendChild(text);
    row.addEventListener('click', () => {
      this.audio.currentTime = Math.min(this.duration(), chunk.t0);
      this.syncProgress();
      if (this.audio.paused) void this.togglePlayback();
    });
    return row;
  }

  private renderWave(): void {
    const peaks = this.meta.peaks.length > 0 ? this.meta.peaks : new Array(WAVE_BARS).fill(0.12);
    this.bars.forEach((bar, index) => {
      const start = Math.floor((index * peaks.length) / WAVE_BARS);
      const end = Math.max(start + 1, Math.floor(((index + 1) * peaks.length) / WAVE_BARS));
      let peak = 0;
      for (let i = start; i < end && i < peaks.length; i += 1) peak = Math.max(peak, peaks[i]);
      bar.style.height = `${Math.round(8 + Math.max(0.08, Math.min(1, peak)) * 46)}px`;
    });
  }

  private seekFromEvent(event: MouseEvent): void {
    const rect = this.wave.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    this.audio.currentTime = ratio * this.duration();
    this.syncProgress();
  }

  private duration(): number {
    return Number.isFinite(this.audio.duration) && this.audio.duration > 0 ? this.audio.duration : this.meta.duration;
  }

  private async toggleStar(): Promise<void> {
    try {
      const meta = await this.callbacks.onToggleStar();
      this.setMeta(meta);
    } catch {
      toast('No se pudo actualizar la favorita.');
    }
  }

  private async openMenu(): Promise<void> {
    const action = await actionSheet({
      title: this.meta.title,
      subtitle: `${formatDateLong(this.meta.createdAt)} · ${formatDuration(this.meta.duration)}`,
      actions: [
        { key: 'rename', label: 'Renombrar', icon: 'pencil' },
        {
          key: 'star',
          label: this.meta.starred ? 'Quitar de favoritas' : 'Marcar como favorita',
          icon: 'star',
        },
        { key: 'audio', label: 'Descargar audio', icon: 'download', hint: 'Archivo WAV' },
        {
          key: 'text',
          label: 'Descargar transcripción',
          icon: 'text',
          hint: 'Archivo TXT',
        },
        { key: 'retranscribe', label: 'Volver a transcribir', icon: 'refresh' },
        { key: 'delete', label: 'Eliminar grabación', icon: 'trash', danger: true },
      ],
    });

    if (action === 'rename') {
      const title = await promptDialog({
        title: 'Renombrar grabación',
        value: this.meta.title,
        confirmLabel: 'Guardar',
        maxLength: 80,
      });
      if (!title) return;
      try {
        const meta = await this.callbacks.onRename(title);
        this.setMeta(meta);
        toast('Nombre actualizado');
      } catch {
        toast('No se pudo renombrar.');
      }
    } else if (action === 'star') {
      await this.toggleStar();
    } else if (action === 'audio') {
      this.downloadAudio();
    } else if (action === 'text') {
      this.downloadTranscript();
    } else if (action === 'retranscribe') {
      await this.retranscribe();
    } else if (action === 'delete') {
      const confirmed = await confirmDialog({
        title: '¿Eliminar esta grabación?',
        message: 'Se borrarán el audio y la transcripción. Esta acción no se puede deshacer.',
        confirmLabel: 'Eliminar',
        danger: true,
        icon: 'trash',
      });
      if (!confirmed) return;
      try {
        await this.callbacks.onDelete();
      } catch {
        toast('No se pudo eliminar la grabación.');
      }
    }
  }

  private async retranscribe(): Promise<void> {
    if (this.transcriber.status !== 'ready') {
      toast('El modelo de voz todavía no está listo.');
      return;
    }
    const confirmed = await confirmDialog({
      title: 'Volver a transcribir',
      message: 'Se reemplazará la transcripción actual usando el audio guardado.',
      confirmLabel: 'Transcribir',
      icon: 'refresh',
    });
    if (!confirmed) return;

    const close = showBusy('Transcribiendo la grabación completa…');
    try {
      const meta = await this.callbacks.onRetranscribe();
      this.setMeta(meta);
      toast('Transcripción actualizada', { icon: 'check' });
    } catch (error) {
      toast(error instanceof Error ? error.message : 'No se pudo transcribir.', { icon: 'info' });
    } finally {
      close();
    }
  }

  private async copyTranscript(): Promise<void> {
    const text = (this.session?.meta?.transcript ?? this.meta.transcript).map((chunk) => chunk.text).join(' ');
    if (!text.trim()) {
      toast('Todavía no hay texto para copiar.');
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      toast('Transcripción copiada', { icon: 'check' });
    } catch {
      const area = document.createElement('textarea');
      area.value = text;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      area.remove();
      toast('Transcripción copiada', { icon: 'check' });
    }
  }

  private downloadAudio(): void {
    const anchor = document.createElement('a');
    anchor.href = this.audioUrl;
    anchor.download = `${sanitizeFilename(this.meta.title)}.wav`;
    anchor.click();
    toast('Descargando audio', { icon: 'download' });
  }

  private async downloadTranscript(): Promise<void> {
    const text = (this.session?.meta?.transcript ?? this.meta.transcript).map((chunk) => chunk.text).join('\n\n');
    if (!text.trim()) {
      toast('Todavía no hay texto para descargar.');
      return;
    }
    const blob = new Blob([`${this.meta.title}\n${formatDateLong(this.meta.createdAt)}\n\n${text}\n`], {
      type: 'text/plain;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${sanitizeFilename(this.meta.title)}.txt`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('Descargando transcripción', { icon: 'download' });
  }
}
