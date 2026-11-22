import { isTauri } from './lib/tauri';

const RELOAD_KEY = 'english-record-coi-reload';

export async function setupPwa(): Promise<boolean> {
  if (isTauri()) return true;
  if (import.meta.env.DEV) return true;
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return true;

  try {
    const base = new URL(import.meta.env.BASE_URL, window.location.origin);
    const swUrl = new URL('sw.js', base);
    await navigator.serviceWorker.register(swUrl.href, { scope: base.pathname });
    await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<void>((resolve) => window.setTimeout(resolve, 4000)),
    ]);

    if (!navigator.serviceWorker.controller) {
      await new Promise<void>((resolve) => {
        const timer = window.setTimeout(resolve, 2500);
        navigator.serviceWorker.addEventListener(
          'controllerchange',
          () => {
            window.clearTimeout(timer);
            resolve();
          },
          { once: true },
        );
      });
    }

    if (navigator.serviceWorker.controller && window.crossOriginIsolated) {
      sessionStorage.removeItem(RELOAD_KEY);
      return true;
    }

    if (!sessionStorage.getItem(RELOAD_KEY)) {
      sessionStorage.setItem(RELOAD_KEY, '1');
      window.location.reload();
      return false;
    }

    sessionStorage.removeItem(RELOAD_KEY);
    return true;
  } catch (error) {
    console.warn('No se pudo activar el service worker.', error);
    return true;
  }
}
