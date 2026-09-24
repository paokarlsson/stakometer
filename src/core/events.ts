export type Unsubscribe = () => void;
export type Listener<T> = (value: T) => void;

/** Single-event emitter. Listener errors are isolated so one bad listener cannot stop the data flow. */
export class Emitter<T> {
  private readonly listeners = new Set<Listener<T>>();

  on(listener: Listener<T>): Unsubscribe {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(value: T): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(value);
      } catch (err) {
        console.error(err);
      }
    }
  }

  get size(): number {
    return this.listeners.size;
  }
}

/** Typed event bus keyed by event name. */
export class EventBus<Events extends Record<string, unknown>> {
  private readonly emitters = new Map<keyof Events, Emitter<never>>();

  on<K extends keyof Events>(name: K, listener: Listener<Events[K]>): Unsubscribe {
    return this.emitter(name).on(listener);
  }

  emit<K extends keyof Events>(name: K, value: Events[K]): void {
    this.emitters.get(name)?.emit(value as never);
  }

  private emitter<K extends keyof Events>(name: K): Emitter<Events[K]> {
    let e = this.emitters.get(name);
    if (!e) {
      e = new Emitter<never>();
      this.emitters.set(name, e);
    }
    return e as unknown as Emitter<Events[K]>;
  }
}
