import { setTimeout as delay } from 'node:timers/promises';

const WINDOW_MS = 60_000;

export interface RateLimiterOptions {
  perMinute: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<unknown>;
}

/**
 * A sliding one-minute window. Callers wait their turn in order, so a burst (say, a backlog of
 * overdue repos) is spread out instead of tripping the other side's limit.
 */
export class RateLimiter {
  readonly #perMinute: number;
  readonly #now: () => number;
  readonly #sleep: (ms: number) => Promise<unknown>;
  readonly #stamps: number[] = [];
  #queue: Promise<void> = Promise.resolve();

  constructor(options: RateLimiterOptions) {
    this.#perMinute = options.perMinute;
    this.#now = options.now ?? Date.now;
    this.#sleep = options.sleep ?? delay;
  }

  acquire(): Promise<void> {
    const turn = this.#queue.then(() => this.#take());
    this.#queue = turn.catch(() => {});
    return turn;
  }

  async #take(): Promise<void> {
    for (;;) {
      const now = this.#now();
      while (this.#stamps.length > 0 && (this.#stamps[0] ?? 0) <= now - WINDOW_MS) this.#stamps.shift();
      if (this.#stamps.length < this.#perMinute) {
        this.#stamps.push(now);
        return;
      }
      await this.#sleep((this.#stamps[0] ?? now) + WINDOW_MS - now);
    }
  }
}
