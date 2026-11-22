export type ThemeMode = 'system' | 'light' | 'dark';
export type EffectiveTheme = 'light' | 'dark';

const STORAGE_KEY = 'english-record-theme';
const media = window.matchMedia('(prefers-color-scheme: dark)');
const listeners = new Set<(mode: ThemeMode, effective: EffectiveTheme) => void>();

let mode: ThemeMode = readStoredMode();
let effective: EffectiveTheme = resolve(mode);

function readStoredMode(): ThemeMode {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
  return 'system';
}

function resolve(value: ThemeMode): EffectiveTheme {
  if (value === 'system') return media.matches ? 'dark' : 'light';
  return value;
}

function apply(): void {
  effective = resolve(mode);
  document.documentElement.dataset.theme = effective;
  document.documentElement.style.colorScheme = effective;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', effective === 'dark' ? '#0e0d12' : '#f7f5f1');
  for (const listener of listeners) listener(mode, effective);
}

export function initTheme(): void {
  apply();
  media.addEventListener('change', () => {
    if (mode === 'system') apply();
  });
}

export function getThemeMode(): ThemeMode {
  return mode;
}

export function getEffectiveTheme(): EffectiveTheme {
  return effective;
}

export function setThemeMode(next: ThemeMode): void {
  mode = next;
  localStorage.setItem(STORAGE_KEY, next);
  apply();
}

export function toggleTheme(): void {
  setThemeMode(effective === 'dark' ? 'light' : 'dark');
}

export function onThemeChange(listener: (mode: ThemeMode, effective: EffectiveTheme) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
