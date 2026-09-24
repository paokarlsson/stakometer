/** Monotonic time source in seconds. Drives the timeline (spec §4.2). */
export interface Clock {
  now(): number;
}

export class RealClock implements Clock {
  now(): number {
    return performance.now() / 1000;
  }
}

export type SimSpeed = 1 | 5 | 20;

/**
 * Accelerated clock for the simulator and tests. Changing speed rebases so
 * that time stays continuous and monotonic.
 */
export class SimClock implements Clock {
  private baseSim = 0;
  private baseReal: number;

  constructor(
    private speedFactor: SimSpeed = 1,
    private readonly realNow: () => number = () => performance.now() / 1000,
  ) {
    this.baseReal = realNow();
  }

  now(): number {
    return this.baseSim + (this.realNow() - this.baseReal) * this.speedFactor;
  }

  get speed(): SimSpeed {
    return this.speedFactor;
  }

  setSpeed(speed: SimSpeed): void {
    this.baseSim = this.now();
    this.baseReal = this.realNow();
    this.speedFactor = speed;
  }
}
