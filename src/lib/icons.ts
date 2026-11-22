type IconName =
  | 'mic'
  | 'pause'
  | 'play'
  | 'stop'
  | 'x'
  | 'back'
  | 'more'
  | 'copy'
  | 'download'
  | 'trash'
  | 'pencil'
  | 'settings'
  | 'sun'
  | 'moon'
  | 'monitor'
  | 'install'
  | 'check'
  | 'wave'
  | 'star'
  | 'sparkle'
  | 'info'
  | 'refresh'
  | 'arrow-right'
  | 'headphones'
  | 'text';

const paths: Record<IconName, string> = {
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 10.5a6.5 6.5 0 0 0 13 0"/><path d="M12 17v3.5"/><path d="M9 20.5h6"/>',
  pause: '<rect x="7" y="5" width="3.4" height="14" rx="1.7" fill="currentColor" stroke="none"/><rect x="13.6" y="5" width="3.4" height="14" rx="1.7" fill="currentColor" stroke="none"/>',
  play: '<path d="M8.2 5.4c0-.8.9-1.3 1.6-.9l9.2 5.9c.6.4.6 1.3 0 1.7l-9.2 5.9c-.7.4-1.6 0-1.6-.9z" fill="currentColor" stroke="none"/>',
  stop: '<rect x="7" y="7" width="10" height="10" rx="2.6" fill="currentColor" stroke="none"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  back: '<path d="M15 18l-6-6 6-6"/>',
  more: '<circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none"/>',
  copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="3"/><path d="M15.5 8.5V7a2.5 2.5 0 0 0-2.5-2.5H7A2.5 2.5 0 0 0 4.5 7v6a2.5 2.5 0 0 0 2.5 2.5h2"/>',
  download: '<path d="M12 4v11"/><path d="M7.5 10.5 12 15l4.5-4.5"/><path d="M5 19.5h14"/>',
  trash: '<path d="M4.5 7h15"/><path d="M9.5 7V5.5A1.5 1.5 0 0 1 11 4h2a1.5 1.5 0 0 1 1.5 1.5V7"/><path d="M6.5 7l.8 11a2 2 0 0 0 2 1.9h5.4a2 2 0 0 0 2-1.9l.8-11"/><path d="M10 11v5.5M14 11v5.5"/>',
  pencil: '<path d="M4.5 19.5l4.2-1 10-10a2.1 2.1 0 0 0-3-3l-10 10z"/><path d="M13.8 6.6l3.6 3.6"/>',
  settings: '<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.8 4.8l1.4 1.4M17.8 17.8l1.4 1.4M2.5 12h2M19.5 12h2M4.8 19.2l1.4-1.4M17.8 6.2l1.4-1.4"/>',
  moon: '<path d="M20 14.2A8.2 8.2 0 0 1 9.8 4 8.5 8.5 0 1 0 20 14.2z"/>',
  monitor: '<rect x="3" y="4.5" width="18" height="12.5" rx="2.5"/><path d="M9 21h6M12 17.5V21"/>',
  install: '<path d="M12 3.5v11"/><path d="M8 10.5l4 4 4-4"/><path d="M5 16.5v1A2.5 2.5 0 0 0 7.5 20h9a2.5 2.5 0 0 0 2.5-2.5v-1"/>',
  check: '<path d="M5 12.5l4.2 4L19 6.8"/>',
  wave: '<path d="M4 10v4M8 6.5v11M12 4v16M16 7.5v9M20 10.5v3"/>',
  star: '<path d="m12 3.8 2.5 5.1 5.6.8-4 4 .9 5.6-5-2.7-5 2.7.9-5.6-4-4 5.6-.8z"/>',
  sparkle: '<path d="M12 3l1.7 5.1L19 10l-5.3 1.9L12 17l-1.7-5.1L5 10l5.3-1.9z"/><path d="M19 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5"/><circle cx="12" cy="8" r="0.9" fill="currentColor" stroke="none"/>',
  refresh: '<path d="M20 7.5V4m0 3.5h-3.5"/><path d="M19.2 8A8 8 0 1 0 20 14"/>',
  'arrow-right': '<path d="M5 12h14M13 6l6 6-6 6"/>',
  headphones: '<path d="M4.5 13v-1a7.5 7.5 0 0 1 15 0v1"/><rect x="3" y="13" width="4" height="7" rx="2"/><rect x="17" y="13" width="4" height="7" rx="2"/>',
  text: '<path d="M5 6.5h14M5 12h9M5 17.5h12"/>',
};

export function icon(name: IconName, size = 24, strokeWidth = 1.8): string {
  return `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
}

export function brandMark(size = 30): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 32 32" fill="none" aria-hidden="true">
    <rect x="1" y="1" width="30" height="30" rx="10" fill="url(#brandGradient)"/>
    <rect x="9" y="12" width="2.2" height="8" rx="1.1" fill="white" fill-opacity=".92"/>
    <rect x="13" y="8.5" width="2.2" height="15" rx="1.1" fill="white"/>
    <rect x="17" y="10.5" width="2.2" height="11" rx="1.1" fill="white" fill-opacity=".92"/>
    <rect x="21" y="13" width="2.2" height="6" rx="1.1" fill="white" fill-opacity=".8"/>
    <defs>
      <linearGradient id="brandGradient" x1="4" y1="2" x2="29" y2="30" gradientUnits="userSpaceOnUse">
        <stop stop-color="#FF7A5C"/>
        <stop offset=".55" stop-color="#F4513F"/>
        <stop offset="1" stop-color="#D83A34"/>
      </linearGradient>
    </defs>
  </svg>`;
}
