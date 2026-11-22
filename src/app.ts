import { VadProvider } from './audio/vad-provider';
import { cleanTranscriptText, countWords, makeTitle } from './lib/format';
import { brandMark } from './lib/icons';
import { isTauri } from './lib/tauri';
import {
  deleteRecording,
  getAudio,
  getMeta,
  listRecordings,
  saveMeta,
} from './lib/storage';
import { decodeWav } from './lib/wav';
import { RecordingSession } from './session';
import { Transcriber } from './transcription/client';
import type { RecordingMeta, Route, TranscriberState, TranscriptChunk } from './types';
import { confirmDialog, toast } from './ui/dialog';
import { DetailView } from './ui/detail';
import { HomeView } from './ui/home';
import { RecordView } from './ui/record';
import { SettingsView } from './ui/settings';
import { getEffectiveTheme, getThemeMode, onThemeChange, setThemeMode, toggleTheme } from './ui/theme';

interface View {
  readonly element: HTMLElement;
  dispose(): void;
}

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export class App {
  private readonly root: HTMLElement;
  private readonly transcriber: Transcriber;
  private readonly vadProvider: VadProvider;
  private transcriberState: TranscriberState;

  private currentView: View | null = null;
  private currentRoute: Route = { name: 'home' };
  private homeView: HomeView | null = null;
  private recordView: RecordView | null = null;
  private detailView: DetailView | null = null;
  private settingsView: SettingsView | null = null;

  private activeSession: RecordingSession | null = null;
  private readonly sessions = new Map<string, RecordingSession>();
  private readonly sessionUnsubs = new Map<string, () => void>();
  private readonly cleanups: Array<() => void> = [];

  private routeToken = 0;
  private homeRefreshTimer = 0;
  private installPrompt: InstallPromptEvent | null = null;
  private installAvailable = false;

  constructor(root: HTMLElement) {
    this.root = root;
    this.transcriber = new Transcriber();
    this.transcriberState = this.transcriber.getState();

    const base = new URL(import.meta.env.BASE_URL, window.location.origin);
    this.vadProvider = new VadProvider(
      new URL('models/silero_vad.onnx', base).href,
      new URL('ort/', base).href,
    );
  }

  async start(): Promise<void> {
    this.cleanups.push(
      this.transcriber.onState((state) => {
        this.transcriberState = state;
        this.homeView?.setTranscriber(state);
        this.recordView?.setTranscriber(state);
        this.detailView?.setTranscriber(state);
        this.settingsView?.setTranscriber(state);
      }),
    );

    this.cleanups.push(
      onThemeChange((mode, effective) => {
        this.homeView?.setTheme(effective);
        this.settingsView?.setTheme(mode);
      }),
    );

    const onPopState = () => {
      void this.renderRoute();
    };
    window.addEventListener('popstate', onPopState);
    this.cleanups.push(() => {
      window.removeEventListener('popstate', onPopState);
    });

    if (!isTauri()) {
      const onInstallPrompt = (event: Event) => {
        const prompt = event as InstallPromptEvent;
        prompt.preventDefault();
        this.installPrompt = prompt;
        this.installAvailable = true;
        this.settingsView?.setInstallAvailable(true);
      };
      const onInstalled = () => {
        this.installPrompt = null;
        this.installAvailable = false;
        this.settingsView?.setInstallAvailable(false);
        toast('English Record instalada en tu dispositivo', { icon: 'check' });
      };
      window.addEventListener('beforeinstallprompt', onInstallPrompt);
      window.addEventListener('appinstalled', onInstalled);
      this.cleanups.push(() => {
        window.removeEventListener('beforeinstallprompt', onInstallPrompt);
        window.removeEventListener('appinstalled', onInstalled);
      });
    }

    if (!window.location.hash || window.location.hash === '#') {
      window.history.replaceState(null, '', '#/');
    }

    await this.renderRoute();
  }

  dispose(): void {
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    for (const unsubscribe of this.sessionUnsubs.values()) unsubscribe();
    this.sessionUnsubs.clear();
    this.currentView?.dispose();
    this.currentView = null;
    this.transcriber.dispose();
  }

  private async renderRoute(): Promise<void> {
    const token = ++this.routeToken;
    let route = parseRoute(window.location.hash);

    if (route.name === 'record' && !this.activeSession) {
      window.history.replaceState(null, '', hashFor({ name: 'home' }));
      route = { name: 'home' };
    }

    if (this.activeSession && route.name !== 'record') {
      if (this.activeSession.status === 'stopping') {
        toast('Espera a que se guarde la grabación.', { icon: 'info' });
        window.history.replaceState(null, '', hashFor({ name: 'record' }));
        this.renderRecord();
        return;
      }

      const leave = await confirmDialog({
        title: '¿Descartar la grabación?',
        message: 'El audio y la transcripción de esta sesión se perderán.',
        confirmLabel: 'Descartar',
        danger: true,
        icon: 'trash',
      });
      if (token !== this.routeToken) return;
      if (!leave) {
        window.history.replaceState(null, '', hashFor({ name: 'record' }));
        this.renderRecord();
        return;
      }
      await this.discardSession();
      if (token !== this.routeToken) return;
    }

    if (route.name === 'record') {
      this.renderRecord();
      return;
    }

    if (route.name === 'settings') {
      this.renderSettings();
      return;
    }

    if (route.name === 'detail') {
      await this.renderDetail(route.id, token);
      return;
    }

    await this.renderHome(token);
  }

  private renderRecord(): void {
    if (!this.activeSession) return;
    if (this.recordView && this.currentView === this.recordView) {
      this.currentRoute = { name: 'record' };
      return;
    }
    const view = new RecordView(
      this.activeSession,
      {
        onClose: () => {
          void this.closeRecord();
        },
        onTogglePause: () => {
          void this.togglePause();
        },
        onStop: () => {
          void this.stopRecording();
        },
        onDiscard: () => {
          void this.closeRecord();
        },
      },
      this.transcriberState,
    );
    this.setView(view, { name: 'record' });
  }

  private renderSettings(): void {
    const view = new SettingsView(getThemeMode(), {
      onBack: () => this.goBack(),
      onTheme: (mode) => setThemeMode(mode),
      onRetryTranscriber: () => this.transcriber.retry(),
      onInstall: () => this.promptInstall(),
    });
    view.setTranscriber(this.transcriberState);
    view.setInstallAvailable(this.installAvailable);
    this.setView(view, { name: 'settings' });
  }

  private async renderHome(token: number): Promise<void> {
    let recordings: RecordingMeta[] = [];
    try {
      recordings = await this.loadRecordings();
    } catch {
      toast('No se pudo leer la biblioteca de grabaciones.', { icon: 'info' });
    }
    if (token !== this.routeToken) return;

    const view = new HomeView({
      onRecord: () => {
        void this.beginRecording();
      },
      onOpen: (id) => this.navigate({ name: 'detail', id }),
      onSettings: () => this.navigate({ name: 'settings' }),
      onToggleTheme: () => toggleTheme(),
      onRetryTranscriber: () => this.transcriber.retry(),
    });
    view.setTheme(getEffectiveTheme());
    view.setTranscriber(this.transcriberState);
    view.setRecordings(recordings);
    this.setView(view, { name: 'home' });
  }

  private async renderDetail(id: string, token: number): Promise<void> {
    this.renderLoading('Abriendo grabación…', { name: 'detail', id });
    const session = this.sessions.get(id) ?? null;

    let meta: RecordingMeta | null = null;
    let blob: Blob | null = null;
    try {
      const loaded = await Promise.all([
        session?.meta ?? getMeta(id),
        session?.audioBlob ?? getAudio(id),
      ]);
      meta = loaded[0] ?? null;
      blob = loaded[1] ?? null;
    } catch {
      meta = null;
      blob = null;
    }

    if (token !== this.routeToken) return;
    if (!meta || !blob) {
      toast('No se encontró la grabación.', { icon: 'info' });
      window.history.replaceState(null, '', hashFor({ name: 'home' }));
      await this.renderRoute();
      return;
    }

    const view = new DetailView(meta, blob, session, this.transcriberState, {
      onBack: () => this.goBack(),
      onRename: (title) => this.renameRecording(id, title),
      onToggleStar: () => this.toggleStarred(id),
      onRetranscribe: () => this.retranscribe(id),
      onDelete: () => this.deleteSavedRecording(id),
    });
    if (token !== this.routeToken) {
      view.dispose();
      return;
    }
    this.setView(view, { name: 'detail', id });
  }

  private renderLoading(message: string, route: Route): void {
    const screen = document.createElement('section');
    screen.className = 'screen loading-screen';
    screen.innerHTML = `
      <div class="loading-content">
        <span class="loading-brand">${brandMark(54)}</span>
        <span class="spinner"></span>
        <p>${escapeText(message)}</p>
      </div>
    `;
    this.setView(
      {
        element: screen,
        dispose: () => screen.remove(),
      },
      route,
    );
  }

  private setView(view: View, route: Route): void {
    if (this.currentView && this.currentView !== view) this.currentView.dispose();
    this.currentView = view;
    this.currentRoute = route;
    this.homeView = view instanceof HomeView ? view : null;
    this.recordView = view instanceof RecordView ? view : null;
    this.detailView = view instanceof DetailView ? view : null;
    this.settingsView = view instanceof SettingsView ? view : null;
    this.root.replaceChildren(view.element);
  }

  private navigate(route: Route, replace = false): void {
    const hash = hashFor(route);
    if (window.location.hash !== hash) {
      if (replace) window.history.replaceState(null, '', hash);
      else window.history.pushState(null, '', hash);
    }
    void this.renderRoute();
  }

  private goBack(): void {
    if (window.location.hash && window.location.hash !== '#/') {
      window.history.back();
      window.setTimeout(() => {
        if (window.location.hash !== '#/') {
          this.navigate({ name: 'home' }, true);
        }
      }, 80);
      return;
    }
    this.navigate({ name: 'home' }, true);
  }

  private async beginRecording(): Promise<void> {
    if (this.activeSession) {
      this.navigate({ name: 'record' });
      return;
    }

    const session = new RecordingSession({
      vad: this.vadProvider.create(),
      transcriber: this.transcriber,
    });
    this.activeSession = session;
    this.renderRecord();
    window.history.pushState(null, '', hashFor({ name: 'record' }));

    const started = await session.start();
    if (this.activeSession !== session) return;
    if (!started) {
      this.recordView?.setTranscriber(this.transcriberState);
      toast(session.error ?? 'No se pudo iniciar la grabación.', { icon: 'info' });
    }
  }

  private async togglePause(): Promise<void> {
    if (!this.activeSession) return;
    try {
      await this.activeSession.togglePause();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'No se pudo cambiar la pausa.', { icon: 'info' });
    }
  }

  private async stopRecording(): Promise<void> {
    const session = this.activeSession;
    if (!session) return;
    if (session.status === 'stopping' || session.status === 'saved') return;
    this.recordView?.setSaving(true);
    try {
      const meta = await session.stop();
      if (this.activeSession !== session) return;
      this.activeSession = null;
      this.sessions.set(meta.id, session);
      this.watchSession(session);
      window.history.replaceState(null, '', hashFor({ name: 'detail', id: meta.id }));
      await this.renderRoute();
    } catch (error) {
      if (this.activeSession === session) this.recordView?.setSaving(false);
      toast(error instanceof Error ? error.message : 'No se pudo guardar la grabación.', { icon: 'info' });
    }
  }

  private async closeRecord(): Promise<void> {
    if (!this.activeSession) return;
    if (this.activeSession.status === 'stopping') {
      toast('Espera a que se guarde la grabación.', { icon: 'info' });
      return;
    }
    const leave = await confirmDialog({
      title: '¿Descartar esta grabación?',
      message: 'Se perderán el audio y la transcripción que has creado.',
      confirmLabel: 'Descartar',
      danger: true,
      icon: 'trash',
    });
    if (!leave) return;
    await this.discardSession();
    this.navigate({ name: 'home' }, true);
  }

  private async discardSession(): Promise<void> {
    const session = this.activeSession;
    this.activeSession = null;
    if (!session) return;
    try {
      await session.discard();
    } catch {
      toast('No se pudo cerrar el micrófono correctamente.', { icon: 'info' });
    }
  }

  private async loadRecordings(): Promise<RecordingMeta[]> {
    const stored = await listRecordings();
    const merged = new Map(stored.map((meta) => [meta.id, meta]));
    for (const [id, session] of this.sessions) {
      if (session.meta) merged.set(id, session.meta);
    }
    return Array.from(merged.values()).sort((a, b) => b.createdAt - a.createdAt);
  }

  private watchSession(session: RecordingSession): void {
    if (this.sessionUnsubs.has(session.id)) return;
    const unsubscribe = session.subscribe(() => {
      if (this.currentRoute.name !== 'home') return;
      window.clearTimeout(this.homeRefreshTimer);
      this.homeRefreshTimer = window.setTimeout(() => {
        void this.refreshHome();
      }, 180);
    });
    this.sessionUnsubs.set(session.id, unsubscribe);
  }

  private async refreshHome(): Promise<void> {
    if (this.currentRoute.name !== 'home' || !this.homeView) return;
    try {
      const recordings = await this.loadRecordings();
      if (this.currentRoute.name === 'home') this.homeView?.setRecordings(recordings);
    } catch {
      // la vista conserva los datos anteriores
    }
  }

  private async renameRecording(id: string, title: string): Promise<RecordingMeta> {
    const clean = title.trim().slice(0, 80);
    if (!clean) throw new Error('El nombre no puede estar vacío.');
    const session = this.sessions.get(id);
    if (session) {
      await session.rename(clean);
      if (!session.meta) throw new Error('La grabación no está guardada.');
      return session.meta;
    }
    const meta = await getMeta(id);
    if (!meta) throw new Error('La grabación no existe.');
    const next = { ...meta, title: clean };
    await saveMeta(next);
    return next;
  }

  private async toggleStarred(id: string): Promise<RecordingMeta> {
    const session = this.sessions.get(id);
    if (session) {
      if (!session.meta) throw new Error('La grabación no está guardada.');
      await session.setStarred(!session.meta.starred);
      return session.meta;
    }
    const meta = await getMeta(id);
    if (!meta) throw new Error('La grabación no existe.');
    const next = { ...meta, starred: !meta.starred };
    await saveMeta(next);
    return next;
  }

  private async retranscribe(id: string): Promise<RecordingMeta> {
    const session = this.sessions.get(id);
    if (session && session.pending > 0) {
      throw new Error('Espera a que termine la transcripción en curso.');
    }
    const blob = session?.audioBlob ?? (await getAudio(id));
    if (!blob) throw new Error('No se encontró el audio de la grabación.');

    const { samples, sampleRate } = decodeWav(await blob.arrayBuffer());
    const raw = await this.transcriber.transcribe(samples);
    const text = cleanTranscriptText(raw);
    if (!text) throw new Error('No se detectó voz en la grabación.');

    const base = session?.meta ?? (await getMeta(id));
    if (!base) throw new Error('La grabación no existe.');
    const duration = samples.length / sampleRate;
    const chunk: TranscriptChunk = {
      id: `manual-${Date.now().toString(36)}`,
      text,
      t0: 0,
      t1: duration,
      source: 'manual',
    };

    if (session) return session.replaceTranscript([chunk]);

    const title = base.title.startsWith('Grabación') ? makeTitle(text, base.createdAt) : base.title;
    const next: RecordingMeta = {
      ...base,
      title,
      transcript: [chunk],
      wordCount: countWords(text),
      transcribed: true,
      hadSpeech: true,
    };
    await saveMeta(next);
    return next;
  }

  private async deleteSavedRecording(id: string): Promise<void> {
    const session = this.sessions.get(id);
    session?.markDeleted();
    try {
      await deleteRecording(id);
    } catch (error) {
      toast('No se pudo eliminar la grabación.', { icon: 'info' });
      throw error;
    }
    this.sessionUnsubs.get(id)?.();
    this.sessionUnsubs.delete(id);
    this.sessions.delete(id);
    toast('Grabación eliminada', { icon: 'check' });
    this.navigate({ name: 'home' }, true);
  }

  private async promptInstall(): Promise<void> {
    const prompt = this.installPrompt;
    if (!prompt) return;
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      if (choice.outcome === 'accepted') {
        toast('Instalando English Record…', { icon: 'install' });
      }
    } catch {
      toast('No se pudo abrir la instalación.', { icon: 'info' });
    }
    this.installPrompt = null;
    this.installAvailable = false;
    this.settingsView?.setInstallAvailable(false);
  }
}

function parseRoute(hash: string): Route {
  const value = hash.replace(/^#/, '');
  if (value === '/grabar') return { name: 'record' };
  if (value === '/ajustes') return { name: 'settings' };
  const detail = /^\/grabacion\/(.+)$/.exec(value);
  if (detail) {
    try {
      return { name: 'detail', id: decodeURIComponent(detail[1]) };
    } catch {
      return { name: 'home' };
    }
  }
  return { name: 'home' };
}

function hashFor(route: Route): string {
  if (route.name === 'record') return '#/grabar';
  if (route.name === 'settings') return '#/ajustes';
  if (route.name === 'detail') return `#/grabacion/${encodeURIComponent(route.id)}`;
  return '#/';
}

function escapeText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
