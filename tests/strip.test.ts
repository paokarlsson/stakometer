import { describe, expect, it } from 'vitest';
import { tickStep } from '../src/ui/live/maxChart';
import { partIndexAt, stripParts } from '../src/ui/strip';
import { BUILTIN_WORKOUTS, workoutById } from '../src/workout/builtin';
import { parsePlan } from '../src/workout/plan';
import example from './fixtures/plan/plan-exempel.json';

const parts = (id: string) => stripParts(workoutById(id)!).map(({ title, detail }) => `${title} ${detail}`);

describe('workout strip (live view header)', () => {
  it('merges a test warm-up with pickups into one part', () => {
    expect(parts('test-180s')).toEqual(['Uppvärmning 10:00', 'Lätt 3:00', 'Maxinsats 3:00', 'Nedvarvning 5:00']);
  });

  it('shows repeats with their rest', () => {
    expect(parts('3x10-40-20')).toEqual(['Block 1 10 × 0:40/0:20', 'Vila 3:00', 'Block 2 10 × 0:40/0:20', 'Vila 3:00', 'Block 3 10 × 0:40/0:20']);
    expect(parts('4x4-threshold')).toEqual(['Intervall 4 × 4:00/2:00']);
  });

  it('gives a block its label and covers the whole timeline', () => {
    const vo2 = parsePlan(example).workouts.find((w) => w.segments.length > 0 && w.segments[0]!.kind === 'block')!;
    const p = stripParts(vo2);
    expect(p[0]!.title).toBe('Uppvärmning');
    expect(p[0]!.start).toBe(0);
    for (let i = 1; i < p.length; i++) expect(p[i]!.start).toBe(p[i - 1]!.end);
    expect(BUILTIN_WORKOUTS.every((w) => stripParts(w).length > 0)).toBe(true);
  });

  it('finds the part at a time, and the last one after the end', () => {
    const p = stripParts(workoutById('test-180s')!);
    expect(partIndexAt(p, 0)).toBe(0);
    expect(partIndexAt(p, 600)).toBe(1);
    expect(partIndexAt(p, 780)).toBe(2);
    expect(partIndexAt(p, 99_999)).toBe(3);
  });
});

describe('max effort chart', () => {
  it('ticks whole minutes for efforts over two minutes', () => {
    expect(tickStep(30)).toBe(10);
    expect(tickStep(180)).toBe(60);
    expect(tickStep(360)).toBe(60);
    expect(tickStep(720)).toBe(120);
  });
});
