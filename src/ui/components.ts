// Building blocks shared by the views: page header, wall clock, menu tiles and stat tiles.
import { h } from './dom';
import { icon, type IconName } from './icons';

/** "10:24". Kept current by main.ts for every element with the class `wall-clock`. */
export const clockText = (d = new Date()): string => d.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });

export function wallClock(): HTMLElement {
  return h('span', { class: 'wall-clock' }, clockText());
}

/** Updates every wall clock on the page. Call on an interval. */
export function tickWallClocks(): void {
  const text = clockText();
  document.querySelectorAll('.wall-clock').forEach((el) => {
    if (el.textContent !== text) el.textContent = text;
  });
}

export interface HeaderOptions {
  title: string | Node;
  subtitle?: string | Node;
  /** Shows a back arrow. */
  onBack?: () => void;
  /** Right-hand side, e.g. the wall clock or a settings button. */
  right?: (Node | null | false)[];
}

export function pageHeader(o: HeaderOptions): HTMLElement {
  return h(
    'header',
    { class: 'page-head' },
    o.onBack ? iconButton('back', 'Tillbaka', o.onBack) : null,
    h('div', { class: 'page-title' }, h('h1', {}, o.title), o.subtitle ? h('div', { class: 'page-sub' }, o.subtitle) : null),
    h('div', { class: 'page-right' }, ...(o.right ?? [])),
  );
}

export function iconButton(name: IconName, label: string, onClick: () => void, className = 'icon-btn'): HTMLButtonElement {
  const b = h('button', { class: className, title: label, 'aria-label': label }, icon(name));
  b.addEventListener('click', onClick);
  return b;
}

export interface TileOptions {
  icon: IconName;
  title: string | Node;
  detail?: string | Node;
  onClick: () => void;
  primary?: boolean;
}

/** A large menu row with an icon, a title, a detail line and a chevron (start page). */
export function tile(o: TileOptions): { el: HTMLButtonElement; title: HTMLElement; detail: HTMLElement } {
  const title = h('span', { class: 'tile-title' }, o.title);
  const detail = h('span', { class: 'tile-detail' }, o.detail ?? '');
  const el = h('button', { class: o.primary ? 'tile primary' : 'tile' }, icon(o.icon, 'icon tile-icon'), h('span', { class: 'tile-text' }, title, detail), icon('chevron', 'icon tile-chevron'));
  el.addEventListener('click', o.onClick);
  return { el, title, detail };
}

/** A labelled value, e.g. "Distans / 6 482 m". */
export function stat(label: string, value = '–', className = 'stat'): { el: HTMLElement; value: HTMLElement; label: HTMLElement } {
  const labelEl = h('div', { class: 'stat-label' }, label);
  const valueEl = h('div', { class: 'stat-value' }, value);
  return { el: h('div', { class: className }, labelEl, valueEl), value: valueEl, label: labelEl };
}

/** Downloads JSON as a file. */
export function downloadJson(data: unknown, filename: string): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
  h('a', { href: url, download: filename }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
