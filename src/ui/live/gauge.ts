// W′ balance as a dial (spec §8.2): a 270° arc filled to wbal / W′ in the zone's colour (§5.7),
// with marks at the zone limits.
import type { WbalZone } from '../../model/wbal';
import { h } from '../dom';
import { formatKJ } from '../format';

const SVG = 'http://www.w3.org/2000/svg';
const CX = 100;
const CY = 100;
const R = 80;
const START = 135; // degrees, bottom left; the arc runs clockwise over the top
const SWEEP = 270;

const point = (deg: number, r = R): [number, number] => {
  const a = (deg * Math.PI) / 180;
  return [CX + r * Math.cos(a), CY + r * Math.sin(a)];
};

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

export interface GaugeState {
  /** wbal / W′, may be negative. */
  fraction: number;
  wbal: number; // J
  wPrime: number; // J
  zone: WbalZone;
  note: string;
  /** Red-zone note shown as a warning (not in test mode). */
  warn: boolean;
}

export function wbalGauge(zoneLimits: readonly number[]): { el: HTMLElement; update: (s: GaugeState | null) => void } {
  const [x0, y0] = point(START);
  const [x1, y1] = point(START + SWEEP);
  const d = `M ${x0} ${y0} A ${R} ${R} 0 1 1 ${x1} ${y1}`;
  const arc = (cls: string) => svg('path', { d, class: cls, 'stroke-width': 16, 'stroke-linecap': 'round', fill: 'none', pathLength: 100 });
  const fill = arc('fill');
  fill.setAttribute('stroke-dasharray', '100 100');
  const dial = svg('svg', { viewBox: '0 0 200 172', role: 'img', 'aria-label': 'W′-balans' });
  dial.append(arc('track'), fill);
  for (const z of zoneLimits) {
    const deg = START + SWEEP * z;
    const [ax, ay] = point(deg, R - 11);
    const [bx, by] = point(deg, R + 11);
    dial.append(svg('line', { x1: ax, y1: ay, x2: bx, y2: by, class: 'tick', 'stroke-width': 3 }));
  }

  const pct = h('div', { class: 'gauge-pct' }, '–');
  const amount = h('div', { class: 'gauge-kj' });
  const note = h('div', { class: 'gauge-note' });
  const el = h(
    'section',
    { class: 'card gauge' },
    h('h2', {}, 'W′-balans'),
    h('div', { class: 'gauge-dial' }, dial, h('div', { class: 'gauge-center' }, pct, amount)),
    note,
  );

  let shown = '';
  const update = (s: GaugeState | null): void => {
    el.hidden = s === null;
    if (!s) return;
    const f = Math.min(Math.max(s.fraction, 0), 1);
    const key = `${Math.round(f * 1000)}|${s.zone}|${s.note}|${s.warn}|${Math.round(s.wbal / 100)}`;
    if (key === shown) return;
    shown = key;
    el.dataset.zone = s.zone;
    el.dataset.warn = String(s.warn);
    fill.style.strokeDashoffset = String(100 - f * 100);
    fill.style.visibility = f > 0.004 ? 'visible' : 'hidden';
    pct.textContent = `${Math.round(f * 100)} %`;
    amount.textContent = `${formatKJ(Math.max(s.wbal, 0))} kJ av ${formatKJ(s.wPrime)} kJ`;
    note.textContent = s.note;
  };
  return { el, update };
}
