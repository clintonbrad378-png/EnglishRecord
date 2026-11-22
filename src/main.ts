import './style.css';
import { App } from './app';
import { setupPwa } from './pwa';
import { initTheme } from './ui/theme';

async function boot(): Promise<void> {
  initTheme();

  const canContinue = await setupPwa();
  if (!canContinue) return;

  const root = document.getElementById('app');
  if (!root) throw new Error('No se encontró el contenedor principal.');

  await new App(root).start();

  const splash = document.getElementById('boot-splash');
  if (splash) {
    splash.classList.add('is-hidden');
    window.setTimeout(() => splash.remove(), 420);
  }
}

void boot().catch((error: unknown) => {
  const splash = document.getElementById('boot-splash');
  if (splash) {
    splash.classList.add('has-error');
    const label = splash.querySelector<HTMLElement>('[data-role="boot-label"]');
    if (label) label.textContent = 'No se pudo iniciar English Record';
    const detail = splash.querySelector<HTMLElement>('[data-role="boot-detail"]');
    if (detail) {
      detail.hidden = false;
      detail.textContent = error instanceof Error ? error.message : 'Recarga la página para intentarlo de nuevo.';
    }
  }
  console.error(error);
});
