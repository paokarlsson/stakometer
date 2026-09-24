import { describe, expect, it } from 'vitest';
import { fit3p, fitForK } from '../src/model/fit3p';
import { powerAt } from '../src/model/morton3p';

describe('fit3p (§5.3)', () => {
  it('reference test: CP 211 ± 1, k 42 ± 1, W′ 16 548 ± 300, PP 605 ± 5', () => {
    const r = fit3p([
      { t: 30, p: 440.83 },
      { t: 180, p: 285.54 },
      { t: 600, p: 236.78 },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Math.abs(r.cp - 211)).toBeLessThanOrEqual(1);
    expect(Math.abs(r.k - 42)).toBeLessThanOrEqual(1);
    expect(Math.abs(r.wPrime - 16548)).toBeLessThanOrEqual(300);
    expect(Math.abs(r.pp - 605)).toBeLessThanOrEqual(5);
  });

  it('recovers a known signature from exact points', () => {
    const sig = { pp: 550, cp: 220, wPrime: 18000 };
    const r = fit3p([30, 180, 600].map((t) => ({ t, p: powerAt(t, sig) })));
    expect(r.ok && r.cp).toBeCloseTo(220, 1);
    expect(r.ok && r.wPrime).toBeCloseTo(18000, -1);
    expect(r.ok && r.pp).toBeCloseTo(550, 0);
  });

  it('solves CP and W′ by least squares for a fixed k', () => {
    const f = fitForK([{ t: 0, p: 300 }, { t: 50, p: 250 }, { t: 150, p: 225 }], 50)!;
    expect(f.cp).toBeCloseTo(200);
    expect(f.wPrime).toBeCloseTo(5000);
    expect(f.sse).toBeCloseTo(0);
  });

  it('explains why it cannot fit', () => {
    expect(fit3p([{ t: 30, p: 400 }, { t: 180, p: 300 }])).toMatchObject({ ok: false, error: expect.stringMatching(/tre/) });
    expect(fit3p([{ t: 30, p: 400 }, { t: 30, p: 390 }, { t: 180, p: 300 }])).toMatchObject({ ok: false, error: expect.stringMatching(/olika längder/) });
    // Longer tests with higher power: W′ would be negative
    const bad = fit3p([{ t: 30, p: 200 }, { t: 180, p: 250 }, { t: 600, p: 260 }]);
    expect(bad.ok).toBe(false);
    // Points that fit no curvature end up on the edge of the k range
    const flat = fit3p([{ t: 30, p: 300 }, { t: 180, p: 300 }, { t: 600, p: 300 }]);
    expect(flat.ok).toBe(false);
  });
});
