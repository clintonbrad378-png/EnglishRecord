import { formatClock, formatTimestamp } from '../lib/format';
import { q } from '../lib/dom';
import { icon } from '../lib/icons';
import type { RecordingSession } from '../session';
import type { TranscriberState, TranscriptChunk } from '../types';

interface RecordCallbacks {
  onClose: () => void;
  onTogglePause: () => void;
  onStop: () => void;
  onDiscard: () => void;
}

const BARS = 46;

export class RecordView {
  readonly element: HTMLElement;
  private readonly session: RecordingSession;
  private readonly callbacks: RecordCallbacks;
  private readonly bars: HTMLElement[] = [];
  private readonly timer: HTMLElement;
  private readonly timerTenths: HTMLElement;
  private readonly statusLabel: HTMLElement;
  private readonly badge: HTMLElement;
  private readonly pauseButton: HTMLButtonElement;
  private readonly pauseLabel: HTMLElement;
  private readonly stopButton: HTMLButtonElement;
  private readonly discardButton: HTMLButtonElement;
  private readonly transcript: HTMLElement;
  private readonly saving: HTMLElement;
  private readonly languageNote: HTMLElement;
  private readonly unsubscribe: () => void;
  private raf = 0;
  private lastFrame = 0;
  private lastTick = 0;
  private smoothLevel = 0;
  private seen = new Set<string>();
  private pendingElement: HTMLElement | null = null;
  private placeholder: HTMLElement | null = null;
  private autoScroll = true;
  private transcriber: TranscriberState = { status: 'idle', pending: 0 };
  private lastPauseState: boolean | null = null;
  private savingState = false;

  constructor(session: RecordingSession, callbacks: RecordCallbacks, transcriber: TranscriberState) {
    this.session = session;
    this.callbacks = callbacks;
    this.transcriber = transcriber;

    const element = document.createElement('section');
    element.className = 'screen record-screen';
    element.innerHTML = `
      <div class="record-atmosphere" aria-hidden="true"></div>
      <header class="record-header">
        <button class="icon-button on-record" data-action="close" aria-label="Cerrar grabación">${icon('x', 21)}</button>
        <span class="record-heading">Nueva grabación</span>
        <span class="record-lang">EN</span>
      </header>

      <div class="record-body">
        <div class="record-stage">
          <div class="record-badge" data-role="badge"><span class="live-dot"></span><span data-role="badge-text">EN VIVO</span></div>
          <div class="record-timer" aria-live="off">
            <span data-role="timer">00:00</span><span class="timer-tenths" data-role="tenths">.0</span>
          </div>
          <div class="live-wave-shell">
            <div class="live-wave-glow"></div>
            <div class="live-wave" data-role="wave" aria-hidden="true"></div>
          </div>
          <p class="record-status" data-role="status" aria-live="polite">Preparando micrófono…</p>
        </div>

        <section class="live-transcript-card">
          <header class="live-transcript-head">
            <div>
              <p class="eyebrow">En vivo</p>
              <h2>Transcripción</h2>
            </div>
            <span class="language-chip">EN</span>
          </header>
          <div class="live-transcript-scroll" data-role="transcript">
            <div class="transcript-placeholder" data-role="placeholder">
              <span class="placeholder-icon">${icon('wave', 22)}</span>
              <p>Habla en inglés y verás el texto aquí mientras grabas.</p>
            </div>
          </div>
          <p class="live-transcript-foot" data-role="note">${icon('sparkle', 14)} Transcripción privada en tu dispositivo</p>
        </section>
      </div>

      <div class="record-controls">
        <div class="control-slot">
          <button class="control-secondary" data-action="pause" aria-label="Pausar grabación">${icon('pause', 24)}</button>
          <span class="control-label" data-role="pause-label">Pausar</span>
        </div>
        <button class="stop-button" data-action="stop" aria-label="Detener y guardar">
          <span class="stop-ring"></span>
          <span class="stop-square"></span>
        </button>
        <div class="control-slot">
          <button class="control-secondary subtle" data-action="discard" aria-label="Descartar grabación">${icon('trash', 22)}</button>
          <span class="control-label">Descartar</span>
        </div>
      </div>

      <div class="record-saving" data-role="saving" hidden>
        <div class="saving-card">
          <span class="spinner"></span>
          <p>Guardando tu grabación…</p>
        </div>
      </div>
    `;

    this.element = element;
    this.timer = q(element, '[data-role="timer"]');
    this.timerTenths = q(element, '[data-role="tenths"]');
    this.statusLabel = q(element, '[data-role="status"]');
    this.badge = q(element, '[data-role="badge"]');
    this.pauseButton = q(element, '[data-action="pause"]');
    this.pauseLabel = q(element, '[data-role="pause-label"]');
    this.stopButton = q(element, '[data-action="stop"]');
    this.discardButton = q(element, '[data-action="discard"]');
    this.transcript = q(element, '[data-role="transcript"]');
    this.saving = q(element, '[data-role="saving"]');
    this.languageNote = q(element, '[data-role="note"]');
    this.placeholder = q<HTMLElement>(element, '[data-role="placeholder"]');

    const wave = q(element, '[data-role="wave"]');
    for (let i = 0; i < BARS; i += 1) {
      const bar = document.createElement('i');
      bar.style.setProperty('--d', String(i));
      wave.appendChild(bar);
      this.bars.push(bar);
    }

    element.addEventListener('click', (event) => {
      const action = (event.target as HTMLElement).closest<HTMLElement>('[data-action]')?.dataset.action;
      if (action === 'close' || action === 'discard') this.callbacks.onClose();
      else if (action === 'pause') this.callbacks.onTogglePause();
      else if (action === 'stop') this.callbacks.onStop();
    });

    this.transcript.addEventListener('scroll', () => {
      const distance = this.transcript.scrollHeight - this.transcript.scrollTop - this.transcript.clientHeight;
      this.autoScroll = distance < 72;
    });

    this.unsubscribe = session.subscribe(() => this.syncTranscript());
    this.syncTranscript();
    this.updateStatus();
    this.renderTranscriberNote();
    this.raf = requestAnimationFrame(this.animate);
  }

  setTranscriber(state: TranscriberState): void {
    this.transcriber = state;
    this.renderTranscriberNote();
    this.updateStatus();
  }

  setSaving(saving: boolean): void {
    this.savingState = saving;
    this.saving.hidden = !saving;
    if (saving) {
      this.stopButton.disabled = true;
      this.pauseButton.disabled = true;
      this.discardButton.disabled = true;
    } else {
      this.updateControls();
    }
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.unsubscribe();
    this.element.remove();
  }

  private animate = (now: number): void => {
    const active =
      this.session.status === 'recording' ||
      this.session.status === 'starting' ||
      this.session.status === 'stopping';
    const target = active ? this.session.level : 0;
    this.smoothLevel += (target - this.smoothLevel) * 0.18;

    if (now - this.lastFrame > 30) {
      this.lastFrame = now;
      const time = now / 1000;
      for (let i = 0; i < this.bars.length; i += 1) {
        const bar = this.bars[i];
        const centerBias = 1 - Math.abs(i - (BARS - 1) / 2) / (BARS * 0.62);
        const wobble =
          0.42 +
          0.3 * Math.sin(time * 5.3 + i * 0.72) +
          0.18 * Math.sin(time * 8.7 - i * 0.41) +
          0.1 * Math.sin(time * 2.2 + i * 1.3);
        const quiet = 0.035 + 0.018 * Math.sin(time * 1.7 + i * 0.5);
        const amplitude = Math.min(1, this.smoothLevel * 1.75);
        const scale = active
          ? Math.max(0.035, amplitude * Math.max(0.15, wobble) * (0.55 + centerBias * 0.75))
          : quiet;
        bar.style.transform = `scaleY(${scale.toFixed(3)})`;
        bar.style.opacity = String(active ? 0.55 + Math.min(0.45, amplitude) : 0.28);
      }
    }

    if (now - this.lastTick > 90) {
      this.lastTick = now;
      this.updateTimer();
      this.updateStatus();
      this.updateControls();
    }

    this.raf = requestAnimationFrame(this.animate);
  };

  private updateTimer(): void {
    const value = formatClock(this.session.elapsed, true);
    const [clock, tenths] = value.split('.');
    if (this.timer.textContent !== clock) this.timer.textContent = clock;
    if (this.timerTenths.textContent !== `.${tenths ?? '0'}`) {
      this.timerTenths.textContent = `.${tenths ?? '0'}`;
    }
  }

  private updateStatus(): void {
    const state = this.session.status;
    const pending = this.session.pending;
    const modelReady = this.transcriber.status === 'ready';
    let label = 'Escuchando…';
    let badge = 'EN VIVO';

    if (state === 'starting') {
      label = 'Preparando micrófono…';
      badge = 'INICIANDO';
    } else if (state === 'paused') {
      label = this.session.error ?? 'Grabación en pausa';
      badge = 'PAUSA';
    } else if (state === 'stopping' || state === 'saved') {
      label = 'Guardando tu grabación…';
      badge = 'GUARDANDO';
    } else if (state === 'error') {
      label = this.session.error ?? 'Ocurrió un error';
      badge = 'ERROR';
    } else if (pending > 0 && !modelReady) {
      label = 'Guardando tu voz, el modelo se está preparando…';
      badge = 'EN VIVO';
    } else if (pending > 0) {
      label = 'Escuchando y transcribiendo…';
      badge = 'EN VIVO';
    }

    if (this.statusLabel.textContent !== label) this.statusLabel.textContent = label;
    const badgeText = q(this.badge, '[data-role="badge-text"]');
    if (badgeText.textContent !== badge) badgeText.textContent = badge;

    this.badge.classList.toggle('is-paused', state === 'paused');
    this.badge.classList.toggle('is-live', state === 'recording' || state === 'starting');
    this.element.classList.toggle('is-paused', state === 'paused');
  }

  private updateControls(): void {
    const paused = this.session.status === 'paused';
    const disabled =
      this.session.status === 'starting' ||
      this.session.status === 'stopping' ||
      this.session.status === 'saved' ||
      this.session.status === 'error' ||
      this.savingState;
    if (this.lastPauseState !== paused) {
      this.lastPauseState = paused;
      this.pauseButton.innerHTML = icon(paused ? 'play' : 'pause', 24);
      this.pauseButton.setAttribute('aria-label', paused ? 'Reanudar grabación' : 'Pausar grabación');
      this.pauseLabel.textContent = paused ? 'Reanudar' : 'Pausar';
    }
    this.pauseButton.disabled = disabled;
    this.stopButton.disabled = disabled;
    this.discardButton.disabled = disabled;
  }

  private renderTranscriberNote(): void {
    if (this.transcriber.status === 'error') {
      this.languageNote.innerHTML = `${icon('info', 14)} El modelo no está disponible. Puedes guardar el audio.`;
      return;
    }
    if (this.transcriber.status === 'loading') {
      this.languageNote.innerHTML = `${icon('sparkle', 14)} Preparando el modelo de voz…`;
      return;
    }
    this.languageNote.innerHTML = `${icon('sparkle', 14)} Transcripción privada en tu dispositivo`;
  }

  private syncTranscript(): void {
    const chunks = this.session.currentTranscript;
    const pending = this.session.pending;

    if (chunks.length > 0) {
      if (this.placeholder) {
        this.placeholder.remove();
        this.placeholder = null;
      }
      for (const chunk of chunks) {
        if (this.seen.has(chunk.id)) continue;
        this.seen.add(chunk.id);
        this.appendChunk(chunk);
      }
    } else if (!this.placeholder) {
      this.placeholder = document.createElement('div');
      this.placeholder.className = 'transcript-placeholder';
      this.placeholder.innerHTML = `
        <span class="placeholder-icon">${icon('wave', 22)}</span>
        <p>Habla en inglés y verás el texto aquí mientras grabas.</p>
      `;
      this.transcript.prepend(this.placeholder);
    }

    if (pending > 0) {
      if (!this.pendingElement) {
        this.pendingElement = document.createElement('div');
        this.pendingElement.className = 'transcript-pending';
        this.pendingElement.innerHTML = '<span class="spinner tiny"></span><span>Transcribiendo…</span>';
        this.transcript.appendChild(this.pendingElement);
      }
    } else if (this.pendingElement) {
      this.pendingElement.remove();
      this.pendingElement = null;
    }

    if (this.autoScroll) {
      requestAnimationFrame(() => {
        this.transcript.scrollTop = this.transcript.scrollHeight;
      });
    }
  }

  private appendChunk(chunk: TranscriptChunk): void {
    const node = document.createElement('div');
    node.className = 'live-chunk';
    const time = document.createElement('span');
    time.className = 'chunk-time';
    time.textContent = formatTimestamp(chunk.t0);
    const text = document.createElement('p');
    text.textContent = chunk.text;
    node.append(time, text);
    if (this.pendingElement) this.transcript.insertBefore(node, this.pendingElement);
    else this.transcript.appendChild(node);
  }
}
