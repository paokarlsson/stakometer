// Replays raw logs from a real PM5 (downloaded from the debug panel into tests/fixtures/)
// through the parsers and checks that they give the strokes the app logged live.
import { describe, expect, it } from 'vitest';
import type { StrokeSample } from '../src/sources/DataSource';
import { buildFrame, CMD, parseFrame, PM, StrokeState } from '../src/sources/pm5/csafe';
import { toHex } from '../src/sources/pm5/parse';
import { fromHex, parseAdditionalStrokeData } from '../src/sources/pm5/parse';
import { UsbDecoder } from '../src/sources/pm5/usb';
import type { RawLogFile } from '../src/sources/rawlog';

const fixtures = Object.entries(import.meta.glob<RawLogFile>('./fixtures/*.json', { eager: true, import: 'default' }));

function replay(file: RawLogFile): number[] {
  const powers: number[] = [];
  if (file.transport === 'usb') {
    const decoder = new UsbDecoder();
    for (const e of file.entries) {
      if (e.kind !== 'raw' || !e.char.startsWith('hid')) continue;
      const dv = fromHex(e.hex);
      const r = parseFrame(new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength));
      const stroke = r && decoder.handle(r, e.ts).stroke;
      if (stroke) powers.push(stroke.power);
    }
  } else {
    let last: number | null = null;
    for (const e of file.entries) {
      if (e.kind !== 'raw' || e.char !== '0036') continue;
      const d = parseAdditionalStrokeData(fromHex(e.hex));
      if (d.strokeCount === last) continue;
      last = d.strokeCount;
      powers.push(d.power);
    }
  }
  return powers;
}

describe('replay', () => {
  it('turns a USB log back into its strokes', () => {
    // Response frames have the same layout as requests after the status byte.
    const response = (state: number, power: number) => {
      const f = buildFrame([0x01, CMD.getPower, 3, power & 0xff, power >> 8, 0x58], [PM.strokeState, 1, state]);
      return { kind: 'raw' as const, ts: 0, char: 'hid2', hex: toHex(new DataView(f.buffer)) };
    };
    const states = [StrokeState.driving, StrokeState.dwellingAfterDrive, StrokeState.recovery, StrokeState.driving, StrokeState.recovery, StrokeState.recovery];
    const file: RawLogFile = {
      format: 'skierg-rawlog',
      version: 1,
      recordedAt: '',
      source: 'pm5',
      transport: 'usb',
      machineTypeCode: null,
      entries: states.map((s, i) => response(s, 200 + i)),
    };
    expect(replay(file)).toEqual([202, 205]);
  });
});

it('fixture files are skierg raw logs', () => {
  for (const [name, file] of fixtures) expect(file.format, name).toBe('skierg-rawlog');
});

for (const [name, file] of fixtures) {
  describe(name, () => {
    const logged = file.entries.filter((e): e is StrokeSample & { kind: 'stroke' } => e.kind === 'stroke');

    it('contains at least 20 strokes with plausible power', () => {
      expect(logged.length).toBeGreaterThanOrEqual(20);
      for (const s of logged) {
        expect(s.power).toBeGreaterThanOrEqual(0);
        expect(s.power).toBeLessThan(2000);
      }
    });

    it('replays to the same stroke powers as logged live', () => {
      // The log may start mid-stroke, so align on the end.
      const replayed = replay(file);
      const n = Math.min(replayed.length, logged.length) - 1;
      expect(n).toBeGreaterThanOrEqual(19);
      expect(replayed.slice(-n)).toEqual(logged.map((s) => s.power).slice(-n));
    });
  });
}
