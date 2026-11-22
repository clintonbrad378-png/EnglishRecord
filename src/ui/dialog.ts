import { icon } from '../lib/icons';

type IconName = Parameters<typeof icon>[0];

function overlayRoot(): HTMLElement {
  return document.getElementById('overlay-root') as HTMLElement;
}

function openOverlay(content: HTMLElement, className = ''): { close: () => void; panel: HTMLElement } {
  const root = overlayRoot();
  const backdrop = document.createElement('div');
  backdrop.className = `modal-backdrop ${className}`.trim();
  backdrop.appendChild(content);
  root.appendChild(backdrop);
  requestAnimationFrame(() => backdrop.classList.add('is-open'));

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    backdrop.classList.remove('is-open');
    const remove = () => backdrop.remove();
    backdrop.addEventListener('transitionend', remove, { once: true });
    window.setTimeout(remove, 320);
  };

  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) {
      const cancel = backdrop.querySelector<HTMLButtonElement>('[data-dismiss]');
      if (cancel) cancel.click();
      else close();
    }
  });

  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      const cancel = backdrop.querySelector<HTMLButtonElement>('[data-dismiss]');
      if (cancel) cancel.click();
      else close();
    }
  };
  window.addEventListener('keydown', onKey);

  const originalClose = close;
  const wrappedClose = () => {
    window.removeEventListener('keydown', onKey);
    originalClose();
  };

  return { close: wrappedClose, panel: content };
}

export function toast(message: string, options: { icon?: IconName; duration?: number } = {}): void {
  const root = document.getElementById('toast-root') as HTMLElement;
  const node = document.createElement('div');
  node.className = 'toast';
  node.setAttribute('role', 'status');
  node.innerHTML = `${options.icon ? icon(options.icon, 18, 2) : '<span class="toast-dot"></span>'}<span>${escapeText(message)}</span>`;
  root.appendChild(node);
  requestAnimationFrame(() => node.classList.add('is-visible'));
  const timeout = options.duration ?? 2800;
  window.setTimeout(() => {
    node.classList.remove('is-visible');
    window.setTimeout(() => node.remove(), 300);
  }, timeout);
}

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  icon?: IconName;
}

export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const panel = document.createElement('div');
    panel.className = 'sheet dialog';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.innerHTML = `
      ${options.icon ? `<div class="dialog-icon ${options.danger ? 'danger' : ''}">${icon(options.icon, 24)}</div>` : ''}
      <div class="dialog-copy">
        <h2>${escapeText(options.title)}</h2>
        ${options.message ? `<p>${escapeText(options.message)}</p>` : ''}
      </div>
      <div class="dialog-actions">
        <button class="btn btn-ghost" data-cancel data-dismiss>${escapeText(options.cancelLabel ?? 'Cancelar')}</button>
        <button class="btn ${options.danger ? 'btn-danger' : 'btn-primary'}" data-confirm>${escapeText(options.confirmLabel ?? 'Continuar')}</button>
      </div>
    `;

    const { close } = openOverlay(panel, 'center');
    let settled = false;
    panel.querySelector<HTMLButtonElement>('[data-cancel]')?.addEventListener('click', () => {
      if (settled) return;
      settled = true;
      close();
      resolve(false);
    });
    panel.querySelector<HTMLButtonElement>('[data-confirm]')?.addEventListener('click', () => {
      if (settled) return;
      settled = true;
      close();
      resolve(true);
    });
    window.setTimeout(() => {
      panel.querySelector<HTMLButtonElement>(options.danger ? '[data-cancel]' : '[data-confirm]')?.focus();
    }, 50);
  });
}

export interface PromptOptions {
  title: string;
  message?: string;
  value?: string;
  placeholder?: string;
  confirmLabel?: string;
  maxLength?: number;
}

export function promptDialog(options: PromptOptions): Promise<string | null> {
  return new Promise((resolve) => {
    const panel = document.createElement('div');
    panel.className = 'sheet dialog';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.innerHTML = `
      <div class="dialog-copy">
        <h2>${escapeText(options.title)}</h2>
        ${options.message ? `<p>${escapeText(options.message)}</p>` : ''}
      </div>
      <input class="text-input" type="text" maxlength="${options.maxLength ?? 80}" value="${escapeText(options.value ?? '')}" placeholder="${escapeText(options.placeholder ?? '')}" aria-label="${escapeText(options.title)}" />
      <div class="dialog-actions">
        <button class="btn btn-ghost" data-cancel data-dismiss>Cancelar</button>
        <button class="btn btn-primary" data-confirm>${escapeText(options.confirmLabel ?? 'Guardar')}</button>
      </div>
    `;
    const { close } = openOverlay(panel, 'center');
    const input = panel.querySelector<HTMLInputElement>('.text-input');
    let settled = false;
    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      close();
      resolve(value);
    };
    panel.querySelector<HTMLButtonElement>('[data-cancel]')?.addEventListener('click', () => finish(null));
    panel.querySelector<HTMLButtonElement>('[data-confirm]')?.addEventListener('click', () => {
      const value = input?.value.trim() ?? '';
      if (value) finish(value);
      else input?.focus();
    });
    input?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        const value = input.value.trim();
        if (value) finish(value);
      }
    });
    window.setTimeout(() => {
      input?.focus();
      input?.select();
    }, 60);
  });
}

export interface SheetAction {
  key: string;
  label: string;
  icon?: IconName;
  danger?: boolean;
  hint?: string;
}

export interface SheetOptions {
  title?: string;
  subtitle?: string;
  actions: SheetAction[];
}

export function actionSheet(options: SheetOptions): Promise<string | null> {
  return new Promise((resolve) => {
    const panel = document.createElement('div');
    panel.className = 'sheet action-sheet';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.innerHTML = `
      <div class="sheet-grabber"></div>
      ${options.title ? `<h2 class="sheet-title">${escapeText(options.title)}</h2>` : ''}
      ${options.subtitle ? `<p class="sheet-subtitle">${escapeText(options.subtitle)}</p>` : ''}
      <div class="sheet-actions">
        ${options.actions
          .map(
            (action) => `
          <button class="sheet-action ${action.danger ? 'danger' : ''}" data-action="${escapeText(action.key)}">
            ${action.icon ? `<span class="sheet-action-icon">${icon(action.icon, 21)}</span>` : ''}
            <span class="sheet-action-text">
              <span>${escapeText(action.label)}</span>
              ${action.hint ? `<small>${escapeText(action.hint)}</small>` : ''}
            </span>
            ${icon('arrow-right', 18)}
          </button>
        `,
          )
          .join('')}
        <button class="sheet-action cancel" data-dismiss>Cancelar</button>
      </div>
    `;
    const { close } = openOverlay(panel, 'bottom');
    let settled = false;
    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      close();
      resolve(value);
    };
    panel.addEventListener('click', (event) => {
      const target = (event.target as HTMLElement).closest<HTMLElement>('[data-action], [data-dismiss]');
      if (!target) return;
      if (target.hasAttribute('data-dismiss')) finish(null);
      else finish(target.dataset.action ?? null);
    });
  });
}

export function showBusy(text: string): () => void {
  const panel = document.createElement('div');
  panel.className = 'busy-card';
  panel.innerHTML = `<span class="spinner"></span><p>${escapeText(text)}</p>`;
  const { close } = openOverlay(panel, 'center busy-overlay');
  return close;
}

function escapeText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
