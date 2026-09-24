// Live chart (spec §8.2): session time on x from now − 60 s to now + 60 s, power on y.
import type { LivePoint, LiveSession } from '../../session/live';
import type { TimelineSegment } from '../../workout/schema';
import { formatDuration } from '../format';

export const WINDOW_S = 60;
const PAD = { top: 28, right: 12, bottom: 22, left: 44 };
const COLUMN_PX = 2;

interface Theme {
  bg: string;
  grid: string;
  text: string;
  muted: string;
  band: string;
  target: string;
  inBand: string;
  below: string;
  above: string;
  neutral: string;
  mpa: string;
  cp: string;
  now: string;
}

function readTheme(el: Element): Theme {
  const css = getComputedStyle(el);
  const v = (name: string) => css.getPropertyValue(name).trim();
  return {
    bg: v('--chart-bg'),
    grid: v('--chart-grid'),
    text: v('--text'),
    muted: v('--muted'),
    band: v('--chart-band'),
    target: v('--chart-target'),
    inBand: v('--accent'),
    below: v('--warn'),
    above: v('--danger'),
    neutral: v('--text'),
    mpa: v('--chart-mpa'),
    cp: v('--muted'),
    now: v('--text'),
  };
}

/** Fixed y scale per session: max(highest target × 1.4, CP × 1.5), or 400 W with neither. */
export function yMaxFor(highestTarget: number | null, cp: number | null): number {
  const candidates = [highestTarget !== null ? highestTarget * 1.4 : 0, cp !== null ? cp * 1.5 : 0];
  const max = Math.max(...candidates);
  return max > 0 ? Math.ceil(max / 50) * 50 : 400;
}

export class LiveChart {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly theme: Theme;
  private readonly resizeObserver: ResizeObserver;
  private width = 0;
  private height = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly yMax: number,
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
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, this.width, this.height);
    this.drawGrid();
    this.drawTargets(live, t0);
    const cp = live.signature?.cp;
    if (cp !== undefined) this.hline(cp, theme.cp, 1, [], 'CP');
    this.drawBoundaries(live, now);
    this.drawMpa(live.mpaSeries, t0, now, live.mpa());
    this.drawPower(live, t0, now);
    // Now line
    const xNow = this.x(now, t0);
    ctx.strokeStyle = theme.now;
    ctx.lineWidth = 2;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(xNow, PAD.top - 8);
    ctx.lineTo(xNow, this.height - PAD.bottom);
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
  }

  private x(t: number, t0: number): number {
    return PAD.left + ((t - t0) / (2 * WINDOW_S)) * (this.width - PAD.left - PAD.right);
  }

  private y(p: number): number {
    const h = this.height - PAD.top - PAD.bottom;
    return PAD.top + h - (Math.min(Math.max(p, 0), this.yMax) / this.yMax) * h;
  }

  private drawGrid(): void {
    const { ctx, theme } = this;
    const step = this.yMax > 600 ? 100 : 50;
    ctx.font = '12px system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    for (let p = 0; p <= this.yMax; p += step) {
      const y = Math.round(this.y(p)) + 0.5;
      ctx.strokeStyle = theme.grid;
      ctx.beginPath();
      ctx.moveTo(PAD.left, y);
      ctx.lineTo(this.width - PAD.right, y);
      ctx.stroke();
      ctx.fillStyle = theme.muted;
      ctx.fillText(String(p), PAD.left - 6, y);
    }
  }

  /** Target band and line, back and forward in time, sampled per pixel column and merged into runs. */
  private drawTargets(live: LiveSession, t0: number): void {
    const { ctx, theme } = this;
    const runner = live.runner;
    if (!runner.timeline) return;
    const left = PAD.left;
    const right = this.width - PAD.right;
    const secPerPx = (2 * WINDOW_S) / (right - left);

    let runSeg: TimelineSegment | null = null;
    let runStart = left;
    const flush = (end: number): void => {
      const s = runSeg;
      if (!s || s.lo === null || s.hi === null || s.targetW === null) return;
      ctx.fillStyle = theme.band;
      ctx.fillRect(runStart, this.y(s.hi), end - runStart, this.y(s.lo) - this.y(s.hi));
      ctx.strokeStyle = theme.target;
      ctx.lineWidth = 2;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(runStart, this.y(s.targetW));
      ctx.lineTo(end, this.y(s.targetW));
      ctx.stroke();
    };
    for (let px = left; px <= right; px += COLUMN_PX) {
      const seg = runner.segmentAt(runner.timelineAt(t0 + (px - left) * secPerPx));
      if (seg !== runSeg) {
        flush(px);
        runSeg = seg;
        runStart = px;
      }
    }
    flush(right);
  }

  /** Vertical lines at upcoming segment starts, labelled e.g. "Vila 2:00". */
  private drawBoundaries(live: LiveSession, now: number): void {
    const { ctx, theme } = this;
    const runner = live.runner;
    if (!runner.timeline || runner.state === 'finished') return;
    const tl = runner.timelineTime();
    const t0 = now - WINDOW_S;
    ctx.font = '13px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    for (const seg of runner.timeline) {
      const t = now + (seg.start - tl);
      if (t <= now || t > now + WINDOW_S) continue;
      const x = Math.round(this.x(t, t0)) + 0.5;
      ctx.strokeStyle = theme.muted;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(x, PAD.top - 8);
      ctx.lineTo(x, this.height - PAD.bottom);
      ctx.stroke();
      ctx.fillStyle = theme.text;
      ctx.fillText(`${seg.label} ${formatDuration(seg.end - seg.start)}`, x + 4, 4);
    }
    ctx.setLineDash([]);
  }

  private drawMpa(series: readonly LivePoint[], t0: number, now: number, current: number | null): void {
    if (current === null) return;
    const { ctx, theme } = this;
    ctx.strokeStyle = theme.mpa;
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 6]);
    ctx.beginPath();
    let started = false;
    for (const p of series) {
      if (p.t < t0) continue;
      const x = this.x(p.t, t0);
      if (started) ctx.lineTo(x, this.y(p.value));
      else ctx.moveTo(x, this.y(p.value));
      started = true;
    }
    if (started) ctx.lineTo(this.x(now, t0), this.y(current));
    ctx.stroke();
    ctx.setLineDash([]);

    // Above the scale: arrow at the top edge with the value.
    if (current > this.yMax) {
      const x = this.x(now, t0);
      const y = PAD.top;
      ctx.fillStyle = theme.mpa;
      ctx.beginPath();
      ctx.moveTo(x - 7, y + 2);
      ctx.lineTo(x + 7, y + 2);
      ctx.lineTo(x, y - 8);
      ctx.closePath();
      ctx.fill();
      ctx.font = '13px system-ui, sans-serif';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(`MPA ${Math.round(current)} W`, x - 12, y);
    }
  }

  /** Power line coloured by the band at each point: in band, below or above. */
  private drawPower(live: LiveSession, t0: number, now: number): void {
    const { ctx, theme } = this;
    const runner = live.runner;
    const points = live.power.filter((p) => p.t >= t0 - 5);
    const current = live.currentPowerAvg();
    const all = [...points, { t: now, value: current }];
    const colour = (p: LivePoint): string => {
      const seg = runner.segmentAt(runner.timelineAt(p.t));
      if (!seg || seg.lo === null || seg.hi === null) return theme.neutral;
      return p.value < seg.lo ? theme.below : p.value > seg.hi ? theme.above : theme.inBand;
    };
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
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
  }

  private hline(p: number, colour: string, width: number, dash: number[], label?: string): void {
    const { ctx } = this;
    const y = Math.round(this.y(p)) + 0.5;
    ctx.strokeStyle = colour;
    ctx.lineWidth = width;
    ctx.setLineDash(dash);
    ctx.beginPath();
    ctx.moveTo(PAD.left, y);
    ctx.lineTo(this.width - PAD.right, y);
    ctx.stroke();
    ctx.setLineDash([]);
    if (label) {
      ctx.fillStyle = colour;
      ctx.font = '12px system-ui, sans-serif';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'bottom';
      ctx.fillText(label, this.width - PAD.right - 4, y - 2);
    }
  }
}
