const pad = (value: number) => String(value).padStart(2, '0');

export function formatDuration(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds || 0));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  if (hours > 0) return `${hours}:${pad(minutes)}:${pad(secs)}`;
  return `${minutes}:${pad(secs)}`;
}

export function formatClock(seconds: number, tenths = false): string {
  const safe = Math.max(0, seconds || 0);
  const totalSeconds = Math.floor(safe);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  const base = hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${pad(minutes)}:${pad(secs)}`;
  if (!tenths) return base;
  return `${base}.${Math.floor((safe % 1) * 10)}`;
}

export function formatTimestamp(seconds: number): string {
  const safe = Math.max(0, seconds || 0);
  const minutes = Math.floor(safe / 60);
  const secs = Math.floor(safe % 60);
  return `${pad(minutes)}:${pad(secs)}`;
}

export function formatTimeOfDay(timestamp: number): string {
  return new Intl.DateTimeFormat('es', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp));
}

export function formatDateLong(timestamp: number): string {
  return new Intl.DateTimeFormat('es', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date(timestamp));
}

export function formatDateShort(timestamp: number): string {
  return new Intl.DateTimeFormat('es', {
    day: 'numeric',
    month: 'short',
  }).format(new Date(timestamp));
}

export function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export function dayLabel(timestamp: number, now = new Date()): string {
  const today = startOfDay(now);
  const yesterday = today - 86_400_000;
  const value = startOfDay(new Date(timestamp));
  if (value === today) return 'Hoy';
  if (value === yesterday) return 'Ayer';
  if (value > today - 7 * 86_400_000) return 'Esta semana';
  if (new Date(timestamp).getFullYear() === now.getFullYear()) {
    return new Intl.DateTimeFormat('es', { month: 'long' }).format(new Date(timestamp));
  }
  return new Intl.DateTimeFormat('es', { month: 'long', year: 'numeric' }).format(new Date(timestamp));
}

export function relativeSubtitle(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const days = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
  const time = formatTimeOfDay(timestamp);
  if (days === 0) return `Hoy, ${time}`;
  if (days === 1) return `Ayer, ${time}`;
  if (days > 1 && days < 7) {
    const weekday = new Intl.DateTimeFormat('es', { weekday: 'long' }).format(date);
    return `${weekday}, ${time}`;
  }
  return `${formatDateShort(timestamp)}, ${time}`;
}

export function capitalize(text: string): string {
  if (!text) return text;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function makeTitle(transcript: string, createdAt: number): string {
  const cleaned = cleanTranscriptText(transcript)
    .replace(/[^\p{L}\p{N}'’\s,.-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) {
    const date = formatDateShort(createdAt);
    const time = formatTimeOfDay(createdAt);
    return `Grabación ${date} · ${time}`;
  }

  const words = cleaned.split(' ').slice(0, 8).join(' ');
  const clipped = words.length > 48 ? `${words.slice(0, 45).trim()}…` : words;
  return capitalize(clipped.replace(/[,.]+$/, ''));
}

export function countWords(text: string): number {
  return cleanTranscriptText(text)
    .split(/\s+/)
    .filter(Boolean).length;
}

const ANNOTATION = 'blank_?audio|silence|inaudible|musical|música|musica|music|applause|laughter|laughing|sighs?|breathing|coughing|noise|static';

export function buildContextPrompt(parts: string[]): string | undefined {
  const text = parts.join(' ').replace(/\s+/g, ' ').trim();
  if (!text) return undefined;
  if (text.length <= 180) return text;
  const tail = text.slice(-180);
  const cut = tail.search(/\s/);
  const prompt = (cut > 0 ? tail.slice(cut + 1) : tail).trim();
  return prompt || undefined;
}

export function cleanTranscriptText(text: string): string {
  return text
    .replace(new RegExp(`\\[(?:${ANNOTATION})[^\\]]*\\]`, 'gi'), ' ')
    .replace(new RegExp(`\\((?:${ANNOTATION})[^)]*\\)`, 'gi'), ' ')
    .replace(/[♪♫♬♩]/g, ' ')
    .replace(/\b([\p{L}\p{N}'’]+(?:\s+[\p{L}\p{N}'’]+){0,2})(?:\s+\1\b){2,}/giu, '$1')
    .replace(
      /\b(you|oh|yeah|okay|ok|no|yes|bye|thanks|thank|please|the|and|so)\b(?:\s+\1\b)+/giu,
      '$1',
    )
    .replace(/\s+([,.!?;:])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

export function sanitizeFilename(value: string): string {
  const cleaned = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9-_ ]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 60);
  return cleaned || 'grabacion';
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}
