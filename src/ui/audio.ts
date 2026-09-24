/** Short beeps via Web Audio (spec §6.3). unlock() must run in a user gesture. */
export class Beeper {
  private ctx: AudioContext | null = null;

  unlock(): void {
    this.ctx ??= new AudioContext();
    void this.ctx.resume();
  }

  beep(frequency = 880, duration = 0.12): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = frequency;
    gain.gain.setValueAtTime(0.25, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration);
  }

  close(): void {
    void this.ctx?.close();
    this.ctx = null;
  }
}
