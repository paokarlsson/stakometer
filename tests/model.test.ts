import { describe, expect, it } from 'vitest';
import { mpa } from '../src/model/mpa';
import { powerAt, timeToExhaustion } from '../src/model/morton3p';
import { resample, Resampler } from '../src/model/resample';
import { DEFAULT_PM5_SIGNATURE, kOf, SIMULATOR_SIGNATURE, validateSignature } from '../src/model/signature';
import { DEFAULT_WBAL, recoveryTau, SKIBA, tau, timeToEmpty, wbalSeries, wbalStep, wbalZone } from '../src/model/wbal';

describe('signature', () => {
  it('derives k = W′/(PP − CP)', () => {
    expect(kOf(SIMULATOR_SIGNATURE)).toBe(50);
    expect(kOf(DEFAULT_PM5_SIGNATURE)).toBe(40);
  });

  it('has valid default signatures', () => {
    expect(validateSignature(SIMULATOR_SIGNATURE)).toBeNull();
    expect(validateSignature(DEFAULT_PM5_SIGNATURE)).toBeNull();
  });

  it('validates pp > cp > 0 and wPrime > 0', () => {
    expect(validateSignature({ pp: 500, cp: 200, wPrime: 15000 })).toBeNull();
    expect(validateSignature({ pp: 200, cp: 200, wPrime: 15000 })).toMatch(/PP/);
    expect(validateSignature({ pp: 500, cp: 0, wPrime: 15000 })).toMatch(/CP/);
    expect(validateSignature({ pp: 500, cp: 200, wPrime: 0 })).toMatch(/W′/);
    expect(validateSignature({ pp: NaN, cp: 200, wPrime: 1 })).not.toBeNull();
  });
});

describe('morton3p', () => {
  const ref = { cp: 211, wPrime: 16548, pp: 211 + 16548 / 42 }; // k = 42, reference from §5.3

  it('gives PP at t = 0 and approaches CP', () => {
    expect(powerAt(0, ref)).toBeCloseTo(ref.pp);
    expect(powerAt(1e7, ref)).toBeCloseTo(211, 1);
  });

  it('matches the §5.3 reference points', () => {
    expect(powerAt(30, ref)).toBeCloseTo(440.83, 1);
    expect(powerAt(180, ref)).toBeCloseTo(285.54, 1);
    expect(powerAt(600, ref)).toBeCloseTo(236.78, 1);
  });

  it('inverts to time to exhaustion', () => {
    expect(timeToExhaustion(powerAt(180, ref), ref)).toBeCloseTo(180);
    expect(timeToExhaustion(200, ref)).toBe(Infinity);
    expect(timeToExhaustion(ref.pp, ref)).toBeNull();
    expect(timeToExhaustion(ref.pp + 50, ref)).toBeNull();
  });
});

describe('resample (§5.4)', () => {
  it('holds the latest completed stroke and is 0 before the first', () => {
    expect(resample([{ t: 1.5, power: 200 }, { t: 3.2, power: 300 }], 5)).toEqual([0, 200, 200, 300, 300]);
  });

  it('drops to 0 when no stroke has come for more than 4 s', () => {
    expect(resample([{ t: 0.5, power: 250 }], 7)).toEqual([250, 250, 250, 250, 0, 0, 0]);
  });

  it('streams the same values incrementally', () => {
    const r = new Resampler();
    r.push({ t: 0.4, power: 100 });
    expect(r.advanceTo(1.9)).toEqual([100]);
    r.push({ t: 2.5, power: 180 });
    expect(r.advanceTo(3)).toEqual([100, 180]);
    expect(r.advanceTo(3.5)).toEqual([]);
    expect(r.seconds).toBe(3);
  });
});

describe('wbal: Skiba 2012 (§5.5 reference tests)', () => {
  const skiba2012 = { model: 'skiba2012' as const, skiba: SKIBA };

  it('τ for CP 250 at 0 W and 200 W', () => {
    expect(tau(250)).toBeCloseTo(360.8, 1);
    expect(tau(50)).toBeCloseTo(647.2, 1);
  });

  it('60 s at 350 W then 60 s at 0 W (W′ 20 000 J, CP 250)', () => {
    const sig = { cp: 250, wPrime: 20000 };
    const series = wbalSeries([...Array(60).fill(350), ...Array(60).fill(0)], sig, skiba2012);
    expect(series[59]).toBe(14000);
    expect(series[119]).toBeCloseTo(14919, 0);
  });

  it('uses τ from the constants', () => {
    expect(recoveryTau(250, 20000, skiba2012)).toBeCloseTo(360.8, 1);
  });

  it('may go negative', () => {
    expect(wbalStep(100, 400, { cp: 200, wPrime: 15000 })).toBe(-100);
  });

  it('time to empty', () => {
    expect(timeToEmpty(6000, 300, 200)).toBe(60);
    expect(timeToEmpty(-50, 300, 200)).toBe(0);
    expect(timeToEmpty(6000, 200, 200)).toBeNull();
  });

  it('colour zones at 60 / 40 / 30 %', () => {
    expect([0.6, 0.59, 0.4, 0.39, 0.3, 0.29, -0.1].map((f) => wbalZone(f))).toEqual([
      'green',
      'yellow',
      'yellow',
      'orange',
      'orange',
      'red',
      'red',
    ]);
  });
});

describe('wbal: Skiba 2015 (default) and Bartram 2018', () => {
  const sig = { cp: 250, wPrime: 20000 };

  it('Skiba 2015 is the default, with τ = W′ / (CP − P)', () => {
    expect(DEFAULT_WBAL.model).toBe('skiba2015');
    expect(recoveryTau(250, 20000)).toBe(80);
    expect(recoveryTau(0, 20000)).toBe(Infinity);
  });

  it('Skiba 2015: 60 s at 350 W then 60 s at 0 W', () => {
    const series = wbalSeries([...Array(60).fill(350), ...Array(60).fill(0)], sig);
    expect(series[59]).toBe(14000);
    // 20 000 − 6 000 · e^(−60 · 250 / 20 000)
    expect(series[119]).toBeCloseTo(20000 - 6000 * Math.exp(-0.75), 6);
  });

  it('Skiba 2015 recovers much faster at rest than Skiba 2012, and slowly near CP', () => {
    const at = (p: number, model: 'skiba2015' | 'skiba2012') => {
      let w = 10000;
      for (let i = 0; i < 120; i++) w = wbalStep(w, p, sig, 1, { model, skiba: SKIBA });
      return w;
    };
    expect(at(0, 'skiba2015') - 10000).toBeGreaterThan(2 * (at(0, 'skiba2012') - 10000));
    expect(at(240, 'skiba2015') - 10000).toBeLessThan(700);
  });

  it('Bartram 2018: τ = 2287.2 · D^−0.688', () => {
    expect(recoveryTau(180, 10000, { model: 'bartram2018', skiba: SKIBA })).toBeCloseTo(64.2, 1);
    expect(recoveryTau(0, 10000, { model: 'bartram2018', skiba: SKIBA })).toBe(Infinity);
  });

  it('drains the same above CP in every model', () => {
    for (const model of ['skiba2015', 'skiba2012', 'bartram2018'] as const) {
      expect(wbalStep(5000, 300, sig, 1, { model, skiba: SKIBA })).toBe(4950);
    }
  });
});

describe('mpa (§5.6)', () => {
  it('is PP with full W′ and CP with empty W′', () => {
    const s = SIMULATOR_SIGNATURE;
    expect(mpa(s.wPrime, s)).toBe(500);
    expect(mpa(0, s)).toBe(200);
    expect(mpa(-500, s)).toBe(200);
    expect(mpa(7500, s)).toBe(350);
  });
});
