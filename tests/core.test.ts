import { describe, expect, it, vi } from 'vitest';
import { SimClock } from '../src/core/clock';
import { Emitter, EventBus } from '../src/core/events';

describe('SimClock', () => {
  it('runs at the given speed and stays continuous when speed changes', () => {
    let real = 100;
    const clock = new SimClock(1, () => real);
    expect(clock.now()).toBe(0);
    real = 110;
    expect(clock.now()).toBe(10);
    clock.setSpeed(20);
    expect(clock.now()).toBe(10);
    real = 111;
    expect(clock.now()).toBe(30);
    clock.setSpeed(5);
    real = 113;
    expect(clock.now()).toBe(40);
  });
});

describe('Emitter', () => {
  it('delivers to listeners until unsubscribed', () => {
    const e = new Emitter<number>();
    const cb = vi.fn();
    const off = e.on(cb);
    e.emit(1);
    off();
    e.emit(2);
    expect(cb).toHaveBeenCalledExactlyOnceWith(1);
  });

  it('isolates a throwing listener', () => {
    const e = new Emitter<number>();
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const cb = vi.fn();
    e.on(() => {
      throw new Error('boom');
    });
    e.on(cb);
    e.emit(1);
    expect(cb).toHaveBeenCalledWith(1);
    err.mockRestore();
  });
});

describe('EventBus', () => {
  it('routes events by name', () => {
    const bus = new EventBus<{ a: number; b: string }>();
    const a = vi.fn();
    const b = vi.fn();
    bus.on('a', a);
    bus.on('b', b);
    bus.emit('a', 1);
    bus.emit('b', 'x');
    expect(a).toHaveBeenCalledExactlyOnceWith(1);
    expect(b).toHaveBeenCalledExactlyOnceWith('x');
  });
});
