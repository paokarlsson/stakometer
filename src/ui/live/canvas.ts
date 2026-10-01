// Live chart (spec §8.2): session time on x from now − 60 s to now + 60 s, power on y.
// Drawn for reading at 2–3 m: large text, thick lines, labelled reference lines.
// The legend and the axis title are HTML above the canvas (live view).
import type { LivePoint, LiveSession } from '../../session/live';
import { formatDuration } from '../format';

export const WINDOW_S = 60;
const COLUMN_PX = 2;
export const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

export interface Theme {
  bg: string;
  future: string;
  grid: string;
  text: string;
  muted: string;
  band: string;
  bandEdge: string;
  target: string;
  inBand: string;
  below: string;
  above: string;
  neutral: string;
  mpa: string;
  cp: string;
}

export function readTheme(el: Element): Theme {
  const css = getComputedStyle(el);
  const v = (name: string) => css.getPropertyValue(name).trim();
  return {
    bg: v('--chart-bg'),
    future: v('--chart-future'),
    grid: v('--chart-grid'),
    text: v('--text'),
    muted: v('--muted'),
    band: v('--chart-band'),
    bandEdge: v('--chart-band-edge'),
    target: v('--chart-target'),
    inBand: v('--accent'),
    below: v('--warn'),
    above: v('--danger'),
    neutral: v('--text'),
    mpa: v('--chart-mpa'),
    cp: v('--chart-cp'),
  };
}

/** Initial y scale per session: max(highest target × 1.4, CP × 1.5), or 400 W with neither. */
export function yMaxFor(highestTarget: number | null, cp: number | null): number {
  const max = Math.max(highestTarget !== null ? highestTarget * 1.4 : 0, cp !== null ? cp * 1.5 : 0);
  return max > 0 ? Math.ceil(max / 50) * 50 : 400;
}

export class LiveChart {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly theme: Theme;
  private readonly resizeObserver: ResizeObserver;
  private width = 0;
  private height = 0;
  /** Text size in px, from the chart height. */
  private fs = 16;
  private pad = { top: 40, right: 16, bottom: 34, left: 56 };

  constructor(
    private readonly canvas: HTMLCanvasElement,
    /** The scale is fixed per session, but grows (never shrinks) if power goes above it. */
    private yMax: number,
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D saknas');
    this.ctx = ctx;
    this.theme = readTheme(canvas);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();
  }

  dispose(): void {
    this.resizeObserver.disconnect();
  }

  draw(live: LiveSession): void {
    const { ctx, theme } = this;
    const now = live.sessionTime();
    const t0 = now - WINDOW_S;
    this.growScale(live, t0);

    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, this.width, this.height);
    // The future is slightly lighter, so "now" separates what was from what comes.
    const xNow = this.x(now, t0);
    ctx.fillStyle = theme.future;
    ctx.fillRect(xNow, 0, this.width - xNow, this.height);

    this.drawGrid();
    this.drawTimeAxis(t0, now);
    this.drawTargets(live, t0);
    const cp = live.signature?.cp;
    if (cp !== undefined) this.refLine(cp, theme.cp, `CP ${Math.round(cp)}`, [2, 4]);
    this.drawBoundaries(live, now);
    this.drawMpa(live.mpaSeries, t0, now, live.mpa());
    this.drawPower(live, t0, now);

    // Now line
    ctx.strokeStyle = theme.text;
    ctx.lineWidth = 2;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(xNow, this.pad.top - 10);
    ctx.lineTo(xNow, this.height - this.pad.bottom);
    ctx.stroke();
  }

  private resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    this.width = Math.max(1, rect.width);
    this.height = Math.max(1, rect.height);
    this.canvas.width = Math.round(this.width * dpr);
    this.canvas.height = Math.round(this.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.fs = Math.round(Math.min(24, Math.max(14, this.height / 26)));
    this.pad = { top: this.fs * 2.6, right: 16, bottom: this.fs * 2, left: this.fs * 3.6 };
  }

  private font(scale = 1, weight = 400): string {
    return `${weight} ${Math.round(this.fs * scale)}px ${FONT}`;
  }

  private x(t: number, t0: number): number {
    return this.pad.left + ((t - t0) / (2 * WINDOW_S)) * (this.width - this.pad.left - this.pad.right);
  }

  private y(p: number): number {
    const h = this.height - this.pad.top - this.pad.bottom;
    return this.pad.top + h - (Math.min(Math.max(p, 0), this.yMax) / this.yMax) * h;
  }

  private growScale(live: LiveSession, t0: number): void {
    let max = live.currentPowerAvg();
    for (const p of live.power) if (p.t >= t0 && p.value > max) max = p.value;
    if (max > this.yMax * 0.95) this.yMax = Math.ceil((max * 1.15) / 50) * 50;
  }

  private drawGrid(): void {
    const { ctx, theme } = this;
    const step = this.yMax > 500 ? 100 : 50;
    ctx.font = this.font(0.85);
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    for (let p = 0; p <= this.yMax; p += step) {
      const y = Math.round(this.y(p)) + 0.5;
      ctx.strokeStyle = theme.grid;
      ctx.beginPath();
      ctx.moveTo(this.pad.left, y);
      ctx.lineTo(this.width - this.pad.right, y);
      ctx.stroke();
      ctx.fillStyle = theme.muted;
      ctx.fillText(String(p), this.pad.left - 8, y);
    }
  }

  private drawTimeAxis(t0: number, now: number): void {
    const { ctx, theme } = this;
    ctx.font = this.font(0.85);
    ctx.fillStyle = theme.muted;
    ctx.textBaseline = 'top';
    const y = this.height - this.pad.bottom + 8;
    for (const d of [-60, -30, 0, 30, 60]) {
      const x = this.x(now + d, t0);
      ctx.textAlign = d === -60 ? 'left' : d === 60 ? 'right' : 'center';
      ctx.fillText(d === 0 ? 'Nu' : `${d > 0 ? '+' : '−'}${Math.abs(d)} s`, x, y);
    }
  }

  /** Target band and line, back and forward in time (ramps included), sampled per pixel column. */
  private drawTargets(live: LiveSession, t0: number): void {
    const { ctx, theme } = this;
    const runner = live.runner;
    if (!runner.timeline) return;
    const left = this.pad.left;
    const right = this.width - this.pad.right;
    const secPerPx = (2 * WINDOW_S) / (right - left);
    const cols: ({ x: number; hi: number; lo: number; t: number } | null)[] = [];
    for (let px = left; px <= right; px += COLUMN_PX) {
      const p = runner.targetPointAt(runner.timelineAt(t0 + (px - left) * secPerPx));
      cols.push(p ? { x: px, hi: this.y(p.hi), lo: this.y(p.lo), t: this.y(p.targetW) } : null);
    }
    ctx.fillStyle = theme.band;
    for (const c of cols) if (c) ctx.fillRect(c.x, c.hi, COLUMN_PX, c.lo - c.hi);
    const line = (key: 'hi' | 'lo' | 't', colour: string, width: number): void => {
      ctx.strokeStyle = colour;
      ctx.lineWidth = width;
      ctx.setLineDash([]);
      ctx.beginPath();
      let drawing = false;
      for (const c of cols) {
        if (!c) {
          drawing = false;
          continue;
        }
        if (drawing) ctx.lineTo(c.x + COLUMN_PX, c[key]);
        else ctx.moveTo(c.x, c[key]);
        drawing = true;
      }
      ctx.stroke();
    };
    line('hi', theme.bandEdge, 1);
    line('lo', theme.bandEdge, 1);
    line('t', theme.target, 2);
  }

  /** Vertical lines at upcoming segment starts, labelled e.g. "Vila 2:00 · 72 W". */
  private drawBoundaries(live: LiveSession, now: number): void {
    const { ctx, theme } = this;
    const runner = live.runner;
    if (!runner.timeline || runner.state === 'finished') return;
    const tl = runner.timelineTime();
    const t0 = now - WINDOW_S;
    ctx.font = this.font(1, 600);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    let labelRight = -Infinity; // avoid overlapping labels: skip one that would collide
    for (const seg of runner.timeline) {
      const t = now + (seg.start - tl);
      if (t <= now || t > now + WINDOW_S) continue;
      const x = Math.round(this.x(t, t0)) + 0.5;
      ctx.strokeStyle = theme.muted;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 5]);
      ctx.beginPath();
      ctx.moveTo(x, this.pad.top - 10);
      ctx.lineTo(x, this.height - this.pad.bottom);
      ctx.stroke();
      ctx.setLineDash([]);
      const text = `${seg.label} ${formatDuration(seg.end - seg.start)}${seg.targetW !== null ? ` · ${Math.round(seg.targetW)} W` : ''}`;
      const w = ctx.measureText(text).width;
      if (x + 6 < labelRight || x + 6 + w > this.width - this.pad.right) continue;
      ctx.fillStyle = theme.bg;
      ctx.globalAlpha = 0.8;
      ctx.fillRect(x + 2, 6, w + 10, this.fs * 1.35);
      ctx.globalAlpha = 1;
      ctx.fillStyle = theme.text;
      ctx.fillText(text, x + 7, 8);
      labelRight = x + 12 + w;
    }
  }

  private drawMpa(series: readonly LivePoint[], t0: number, now: number, current: number | null): void {
    if (current === null) return;
    const { ctx, theme } = this;
    ctx.strokeStyle = theme.mpa;
    ctx.lineWidth = 3;
    ctx.setLineDash([10, 7]);
    ctx.beginPath();
    let started = false;
    for (const p of series) {
      if (p.t < t0) continue;
      const x = this.x(p.t, t0);
      if (started) ctx.lineTo(x, this.y(p.value));
      else ctx.moveTo(x, this.y(p.value));
      started = true;
    }
    const xNow = this.x(now, t0);
    if (started) ctx.lineTo(xNow, this.y(current));
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.font = this.font(0.95, 700);
    ctx.fillStyle = theme.mpa;
    ctx.textAlign = 'right';
    if (current > this.yMax) {
      // Above the scale: arrow at the top edge with the value.
      const y = this.pad.top;
      ctx.beginPath();
      ctx.moveTo(xNow - 9, y + 2);
      ctx.lineTo(xNow + 9, y + 2);
      ctx.lineTo(xNow, y - 10);
      ctx.closePath();
      ctx.fill();
      ctx.textBaseline = 'top';
      ctx.fillText(`MPA ${Math.round(current)} W`, xNow - 14, y + 6);
    } else {
      ctx.textBaseline = 'bottom';
      ctx.fillText(`MPA ${Math.round(current)}`, xNow - 10, this.y(current) - 4);
    }
  }

  /** Power line coloured by the band at each point, with a dot and the value at "now". */
  private drawPower(live: LiveSession, t0: number, now: number): void {
    const { ctx, theme } = this;
    const runner = live.runner;
    const current = live.currentPowerAvg();
    const all = [...live.power.filter((p) => p.t >= t0 - 5), { t: now, value: current }];
    const colour = (p: LivePoint): string => {
      const band = runner.targetPointAt(runner.timelineAt(p.t));
      if (!band) return theme.neutral;
      return p.value < band.lo ? theme.below : p.value > band.hi ? theme.above : theme.inBand;
    };
    ctx.lineWidth = 4;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.setLineDash([]);
    for (let i = 1; i < all.length; i++) {
      const a = all[i - 1]!;
      const b = all[i]!;
      ctx.strokeStyle = colour(b);
      ctx.beginPath();
      ctx.moveTo(this.x(a.t, t0), this.y(a.value));
      ctx.lineTo(this.x(b.t, t0), this.y(b.value));
      ctx.stroke();
    }

    const x = this.x(now, t0);
    const y = this.y(current);
    const c = colour({ t: now, value: current });
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.arc(x, y, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = this.font(1.5, 800);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${Math.round(current)} W`, x + 14, Math.min(Math.max(y, this.pad.top + this.fs), this.height - this.pad.bottom - this.fs));
  }

  private refLine(p: number, colour: string, label: string, dash: number[]): void {
    const { ctx } = this;
    const y = Math.round(this.y(p)) + 0.5;
    ctx.strokeStyle = colour;
    ctx.lineWidth = 2;
    ctx.setLineDash(dash);
    ctx.beginPath();
    ctx.moveTo(this.pad.left, y);
    ctx.lineTo(this.width - this.pad.right, y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = colour;
    ctx.font = this.font(0.9, 700);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText(label, this.pad.left + 6, y - 3);
  }
}
