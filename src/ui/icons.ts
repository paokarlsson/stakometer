// Line icons, 24 × 24, drawn with currentColor. Hand-written so no icon library is needed.

const PATHS = {
  today: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18M8.5 15.5l2.2 2.2 4.8-4.7"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18M7.5 14h.01M12 14h.01M16.5 14h.01M7.5 18h.01M12 18h.01"/>',
  bars: '<path d="M6 20v-7M12 20V5M18 20v-11" stroke-width="3"/>',
  activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  infinity: '<path d="M12 12c-2-2.67-4-4-6-4a4 4 0 1 0 0 8c2 0 4-1.33 6-4Zm0 0c2 2.67 4 4 6 4a4 4 0 0 0 0-8c-2 0-4 1.33-6 4Z"/>',
  history: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
  upload: '<path d="M12 15V3M7 8l5-5 5 5M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>',
  database: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.66 3.58 3 8 3s8-1.34 8-3V5M4 12c0 1.66 3.58 3 8 3s8-1.34 8-3"/>',
  gear:
    '<path d="M19.08 9.84 L21.88 10.44 L21.88 13.56 L19.08 14.16 L18.53 15.47 L20.09 17.88 L17.88 20.09 L15.47 18.53 L14.16 19.08 L13.56 21.88 L10.44 21.88 L9.84 19.08 L8.53 18.53 L6.12 20.09 L3.91 17.88 L5.47 15.47 L4.92 14.16 L2.12 13.56 L2.12 10.44 L4.92 9.84 L5.47 8.53 L3.91 6.12 L6.12 3.91 L8.53 5.47 L9.84 4.92 L10.44 2.12 L13.56 2.12 L14.16 4.92 L15.47 5.47 L17.88 3.91 L20.09 6.12 L18.53 8.53 Z" stroke-width="1.6"/><circle cx="12" cy="12" r="3"/>',
  curve: '<path d="M3 3v18h18"/><path d="M6.5 5c.8 6.5 4.5 10.5 13.5 11.5"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  back: '<path d="M19 12H5M12 19l-7-7 7-7"/>',
  play: '<path d="M7 4.5v15l12.5-7.5Z" fill="currentColor"/>',
  pause: '<path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor"/>',
  sound: '<path d="M11 5 6 9H2v6h4l5 4Z" fill="currentColor"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/>',
  mute: '<path d="M11 5 6 9H2v6h4l5 4Z" fill="currentColor"/><path d="m16 9 6 6M22 9l-6 6"/>',
  fullscreen: '<path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  usb: '<path d="M12 22v-5M9 8V2M15 8V2M18 8v4a6 6 0 0 1-12 0V8Z"/>',
  bluetooth: '<path d="m7 7 10 10-5 5V2l5 5L7 17"/>',
  chip: '<rect x="5" y="5" width="14" height="14" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>',
} as const;

export type IconName = keyof typeof PATHS;

/** An inline SVG icon, sized by CSS (1em by default). */
export function icon(name: IconName, className = 'icon'): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', className);
  svg.innerHTML = PATHS[name];
  return svg;
}
