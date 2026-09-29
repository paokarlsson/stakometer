// Post-session charts with uPlot (spec §3, §7.3, §8.3).
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { powerAt } from '../model/morton3p';
import type { SignatureParams } from '../model/signature';
import type { SessionAnalysis } from '../session/analysis';
import type { Session } from '../storage/types';
import { targetAt } from '../workout/ramp';
import { formatDuration } from './format';

const css = (name: string): string => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/** Keeps the chart as wide as its container. Returns a disposer. */
function mount(el: HTMLElement, make: (width: number) => uPlot): () => void {
  const plot = make(el.clientWidth || 600);
  const ro = new ResizeObserver(() => plot.setSize({ width: el.clientWidth, height: plot.height }));
  ro.observe(el);
  return () => {
    ro.disconnect();
    plot.destroy();
  };
}

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

const axisStyle = (): Partial<uPlot.Axis> => ({
  stroke: css('--muted'),
  font: `15px ${FONT}`,
  labelFont: `600 15px ${FONT}`,
  grid: { stroke: css('--chart-grid'), width: 1 },
  ticks: { stroke: css('--chart-grid'), width: 1 },
});

/** Whole session: target band, power at 1 Hz and W′ balance on a right axis (spec §8.3). */
export function sessionChart(el: HTMLElement, session: Session, a: SessionAnalysis): () => void {
  const n = a.power.length;
  const x = Array.from({ length: n }, (_, i) => i + 1);
  // Band and target at each second, ramps included.
  const points = x.map((_, i) => {
    const tl = a.timeline[i];
    return tl === null || tl === undefined || !session.timeline ? null : targetAt(session.timeline, tl);
  });
  const lo = points.map((p) => p?.lo ?? null);
  const hi = points.map((p) => p?.hi ?? null);
  const target = points.map((p) => p?.targetW ?? null);
  const wPrime = session.signatureSnapshot?.wPrime;
  const wbalPct = a.wbal && wPrime ? a.wbal.map((w) => (w / wPrime) * 100) : x.map(() => null);

  return mount(el, (width) => {
    const opts: uPlot.Options = {
      width,
      height: 380,
      cursor: { drag: { x: true, y: false } },
      scales: { x: { time: false }, pct: { range: [Math.min(0, ...wbalPct.map((v) => v ?? 0)), 100] } },
      axes: [
        { ...axisStyle(), values: (_u, vals) => vals.map((v) => formatDuration(v)) },
        { ...axisStyle(), label: 'W', size: 64 },
        { ...axisStyle(), scale: 'pct', side: 1, label: 'W′ %', grid: { show: false }, size: 64 },
      ],
      series: [
        { label: 'Tid', value: (_u, v) => (v === null ? '–' : formatDuration(v)) },
        { label: 'Band, nedre', stroke: css('--chart-band-edge'), width: 1, points: { show: false } },
        { label: 'Band, övre', stroke: css('--chart-band-edge'), width: 1, points: { show: false } },
        { label: 'Mål', stroke: css('--chart-target'), width: 2.5, points: { show: false }, value: (_u, v) => (v === null ? '–' : `${Math.round(v)} W`) },
        { label: 'Effekt', stroke: css('--text'), width: 2, points: { show: false }, value: (_u, v) => (v === null ? '–' : `${Math.round(v)} W`) },
        { label: 'W′', scale: 'pct', stroke: css('--chart-mpa'), width: 3, points: { show: false }, value: (_u, v) => (v === null ? '–' : `${Math.round(v)} %`) },
      ],
      bands: [{ series: [2, 1], fill: css('--chart-band') }],
    };
    return new uPlot(opts, [x, lo, hi, target, a.power, wbalPct], el);
  });
}

/**
 * Test results with the fitted curve from 10 s to 30 min on a log x axis, and the
 * previous signature's curve dashed for comparison (spec §7.3).
 */
export function signatureChart(el: HTMLElement, points: readonly { t: number; p: number }[], fitted: SignatureParams, previous: SignatureParams | null): () => void {
  const grid = Array.from({ length: 80 }, (_, i) => 10 * Math.pow(180, i / 79)); // 10 s … 1800 s
  const x = [...new Set([...grid, ...points.map((q) => q.t)])].sort((a, b) => a - b);
  const measured = x.map((t) => points.find((q) => q.t === t)?.p ?? null);
  const ticks = [10, 30, 60, 180, 360, 720, 1800];

  return mount(el, (width) => {
    const series: uPlot.Series[] = [
      { label: 'Tid', value: (_u, v) => (v === null ? '–' : formatDuration(v)) },
      { label: 'Ny kurva', stroke: css('--accent'), width: 3.5, points: { show: false }, value: (_u, v) => (v === null ? '–' : `${Math.round(v)} W`) },
      {
        label: 'Testresultat',
        stroke: css('--text'),
        fill: css('--text'),
        paths: () => null,
        points: { show: true, size: 14, stroke: css('--text'), fill: css('--text') },
        value: (_u, v) => (v === null ? '–' : `${Math.round(v)} W`),
      },
    ];
    const data: uPlot.AlignedData = [x, x.map((t) => powerAt(t, fitted)), measured];
    if (previous) {
      series.push({ label: 'Tidigare', stroke: css('--muted'), width: 2.5, dash: [8, 6], points: { show: false }, value: (_u, v) => (v === null ? '–' : `${Math.round(v)} W`) });
      data.push(x.map((t) => powerAt(t, previous)));
    }
    return new uPlot(
      {
        width,
        height: 340,
        scales: { x: { time: false, distr: 3 } },
        axes: [
          // Keep every tick: uPlot's log axis otherwise drops those not starting with 1.
          { ...axisStyle(), splits: () => ticks, filter: (_u, splits) => splits, values: (_u, vals) => vals.map((v) => formatDuration(v)) },
          { ...axisStyle(), label: 'W', size: 64 },
        ],
        series,
      },
      data,
      el,
    );
  });
}
