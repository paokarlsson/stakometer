// Fits Morton's 3-parameter model to maximal efforts (spec §5.3).
// For a fixed k the model is linear: P = CP + W′ · x with x = 1 / (t + k),
// so CP and W′ come from least squares. k is found by a grid search over
// [1, 300] s in 0.5 s steps, refined with golden-section search (tolerance 0.01 s).

export interface EffortPoint {
  t: number; // duration of the maximal effort, s
  p: number; // average power over it, W
}

export interface Fit {
  cp: number;
  wPrime: number;
  k: number;
  pp: number;
  sse: number;
  /** Measured minus modelled power per point, W, in input order (spec §7.3). */
  residuals: number[];
}

export type FitResult = ({ ok: true } & Fit) | { ok: false; error: string };

export const K_MIN = 1;
export const K_MAX = 300;
const K_STEP = 0.5;
const K_TOLERANCE = 0.01;
const GOLDEN = (Math.sqrt(5) - 1) / 2;

/** Least squares for a fixed k. Null when all x are equal. */
export function fitForK(points: readonly EffortPoint[], k: number): Fit | null {
  const n = points.length;
  const xs = points.map((q) => 1 / (q.t + k));
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = points.reduce((a, q) => a + q.p, 0) / n;
  let sxx = 0;
  let sxy = 0;
  points.forEach((q, i) => {
    sxx += (xs[i]! - mx) ** 2;
    sxy += (xs[i]! - mx) * (q.p - my);
  });
  if (sxx === 0) return null;
  const wPrime = sxy / sxx;
  const cp = my - wPrime * mx;
  const residuals = points.map((q, i) => q.p - (cp + wPrime * xs[i]!));
  const sse = residuals.reduce((a, r) => a + r * r, 0);
  return { cp, wPrime, k, pp: cp + wPrime / k, sse, residuals };
}

export function fit3p(points: readonly EffortPoint[]): FitResult {
  if (points.length < 3) return { ok: false, error: 'Det behövs minst tre testresultat.' };
  if (new Set(points.map((q) => q.t)).size < 3) return { ok: false, error: 'Testen måste ha minst tre olika längder.' };
  if (points.some((q) => !(q.t > 0) || !(q.p > 0))) return { ok: false, error: 'Testresultaten måste ha positiv tid och effekt.' };

  const sseAt = (k: number): number => fitForK(points, k)?.sse ?? Infinity;

  // 1. Grid search
  let bestK = K_MIN;
  let bestSse = Infinity;
  for (let k = K_MIN; k <= K_MAX + 1e-9; k += K_STEP) {
    const sse = sseAt(k);
    if (sse < bestSse) {
      bestSse = sse;
      bestK = k;
    }
  }
  if (bestK <= K_MIN || bestK >= K_MAX) {
    return { ok: false, error: `Kurvan går inte att anpassa (k hamnade på sökintervallets kant, ${bestK} s). Testresultaten hänger inte ihop – mata in signaturen manuellt eller gör om ett test.` };
  }

  // 2. Golden-section refinement around the best grid point
  let a = Math.max(K_MIN, bestK - K_STEP);
  let b = Math.min(K_MAX, bestK + K_STEP);
  let c = b - GOLDEN * (b - a);
  let d = a + GOLDEN * (b - a);
  while (b - a > K_TOLERANCE) {
    if (sseAt(c) < sseAt(d)) b = d;
    else a = c;
    c = b - GOLDEN * (b - a);
    d = a + GOLDEN * (b - a);
  }
  const fit = fitForK(points, (a + b) / 2)!;

  if (fit.cp <= 0) return { ok: false, error: 'Anpassningen gav CP ≤ 0. Mata in signaturen manuellt eller gör om ett test.' };
  if (fit.wPrime <= 0) return { ok: false, error: 'Anpassningen gav W′ ≤ 0. Kortare test ska ge högre effekt – mata in manuellt eller gör om ett test.' };
  if (fit.pp <= fit.cp) return { ok: false, error: 'Anpassningen gav PP ≤ CP. Mata in signaturen manuellt eller gör om ett test.' };
  return { ok: true, ...fit };
}
