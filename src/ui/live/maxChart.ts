// The maximal effort from its start to its end (spec §7.2): power as a filled area, the running
// average and the last test of the same length as reference lines.
import type { LiveSession } from '../../session/live';
import type { TimelineSegment } from '../../workout/schema';
import { FONT, readTheme, type Theme } from './canvas';

/** Tick spacing in seconds giving at most six intervals; whole minutes for efforts over 2 min. */
export function tickStep(duration: number): number {
  const steps = duration > 120 ? [60, 120, 180, 300, 600] : [10, 15, 30, 60];
  return steps.find((s) => duration / s <= 6) ?? steps.at(-1)!;
}

export class MaxChart {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly theme: Theme;
  private readonly resizeObserver: ResizeObserver;
  private width = 0;
  private height = 0;
  private fs = 16;
  private pad = { top: 20, right: 20, bottom: 34, left: 56 };
  private yMax = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
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

  draw(live: LiveSession, seg: TimelineSegment, average: number | null, previous: number | null): void {
    const { ctx, theme } = this;
    const runner = live.runner;
    const duration = seg.end - seg.start;
    const elapsed = Math.min(duration, Math.max(0, runner.timelineTime() - seg.start));
    const points: { x: number; p: number }[] = [];
    for (const p of live.power) {
      const tl = runner.timelineAt(p.t);
      if (tl !== null && tl >= seg.start && tl <= seg.end) points.push({ x: tl - seg.start, p: p.value });
    }
    points.push({ x: elapsed, p: live.currentPowerAvg() });
    const top = Math.max(previous ?? 0, ...points.map((q) => q.p));
    if (top * 1.12 > this.yMax) this.yMax = Math.max(200, Math.ceil((top * 1.2) / 100) * 100);

    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, this.width, this.height);
    this.drawAxes(duration);

    // Power as an area from the start of the effort to now.
    const x = (s: number) => this.pad.left + (s / duration) * (this.width - this.pad.left - this.pad.right);
    const base = this.y(0);
    if (points.length > 1) {
      const gradient = ctx.createLinearGradient(0, this.pad.top, 0, base);
      gradient.addColorStop(0, 'rgb(239 68 68 / 0.55)');
      gradient.addColorStop(1, 'rgb(239 68 68 / 0.08)');
      ctx.beginPath();
      ctx.moveTo(x(points[0]!.x), base);
      for (const q of points) ctx.lineTo(x(q.x), this.y(q.p));
      ctx.lineTo(x(points.at(-1)!.x), base);
      ctx.closePath();
      ctx.fillStyle = gradient;
      ctx.fill();
      ctx.beginPath();
      points.forEach((q, i) => (i === 0 ? ctx.moveTo(x(q.x), this.y(q.p)) : ctx.lineTo(x(q.x), this.y(q.p))));
      ctx.strokeStyle = theme.above;
      ctx.lineWidth = 3;
      ctx.lineJoin = 'round';
      ctx.setLineDash([]);
      ctx.stroke();
    }
    if (previous !== null) this.refLine(previous, theme.muted, `Förra ${Math.round(previous)}`, [8, 6], 'right');
    if (average !== null) this.refLine(average, theme.text, `Snitt ${Math.round(average)}`, [3, 5], 'left');

    // Now
    const xNow = x(elapsed);
    ctx.strokeStyle = theme.text;
    ctx.lineWidth = 2;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(xNow, this.pad.top);
    ctx.lineTo(xNow, base);
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
    this.fs = Math.round(Math.min(22, Math.max(13, this.height / 24)));
    this.pad = { top: this.fs, right: this.fs * 1.4, bottom: this.fs * 2, left: this.fs * 3.4 };
  }

  private y(p: number): number {
    const h = this.height - this.pad.top - this.pad.bottom;
    return this.pad.top + h - (Math.min(Math.max(p, 0), this.yMax) / this.yMax) * h;
  }

  private drawAxes(duration: number): void {
    const { ctx, theme } = this;
    const right = this.width - this.pad.right;
    const step = this.yMax > 600 ? 200 : 100;
    ctx.font = `400 ${Math.round(this.fs * 0.85)}px ${FONT}`;
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let p = 0; p <= this.yMax; p += step) {
      const y = Math.round(this.y(p)) + 0.5;
      ctx.strokeStyle = theme.grid;
      ctx.beginPath();
      ctx.moveTo(this.pad.left, y);
      ctx.lineTo(right, y);
      ctx.stroke();
      ctx.fillStyle = theme.muted;
      ctx.fillText(String(p), this.pad.left - 8, y);
    }
    const tick = tickStep(duration);
    ctx.textBaseline = 'top';
    for (let s = 0; s <= duration + 0.001; s += tick) {
      const x = this.pad.left + (s / duration) * (right - this.pad.left);
      ctx.textAlign = s === 0 ? 'left' : s >= duration ? 'right' : 'center';
      ctx.fillStyle = theme.muted;
      const last = s + tick > duration + 0.001;
      const text = duration > 120 ? `${s / 60}${last ? ' min' : ''}` : `${s}${last ? ' s' : ''}`;
      ctx.fillText(text, x, this.height - this.pad.bottom + 8);
    }
  }

  private refLine(p: number, colour: string, label: string, dash: number[], align: 'left' | 'right'): void {
    const { ctx } = this;
    const y = Math.round(this.y(p)) + 0.5;
    const right = this.width - this.pad.right;
    ctx.strokeStyle = colour;
    ctx.lineWidth = 2;
    ctx.setLineDash(dash);
    ctx.beginPath();
    ctx.moveTo(this.pad.left, y);
    ctx.lineTo(right, y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = colour;
    ctx.font = `700 ${Math.round(this.fs * 0.95)}px ${FONT}`;
    ctx.textAlign = align;
    ctx.textBaseline = 'bottom';
    ctx.fillText(label, align === 'left' ? this.pad.left + 6 : right - 6, y - 4);
  }
}
