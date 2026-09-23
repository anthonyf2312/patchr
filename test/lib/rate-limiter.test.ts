import { describe, expect, it } from 'vitest';
import { RateLimiter } from '../../src/lib/rate-limiter.js';

/** A clock that only moves when the limiter sleeps, so waits are exact and instant. */
function fakeClock() {
  let now = 0;
  const waits: number[] = [];
  return {
    waits,
    now: () => now,
    sleep: async (ms: number) => {
      waits.push(ms);
      now += ms;
    },
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe('RateLimiter', () => {
  it('lets requests through up to the limit without waiting', async () => {
    const clock = fakeClock();
    const limiter = new RateLimiter({ perMinute: 3, now: clock.now, sleep: clock.sleep });
    await limiter.acquire();
    await limiter.acquire();
    await limiter.acquire();
    expect(clock.waits).toEqual([]);
  });

  it('waits for the oldest request to leave the window', async () => {
    const clock = fakeClock();
    const limiter = new RateLimiter({ perMinute: 2, now: clock.now, sleep: clock.sleep });
    await limiter.acquire();
    clock.advance(10_000);
    await limiter.acquire();
    await limiter.acquire();
    expect(clock.waits).toEqual([50_000]);
  });

  it('keeps callers in order when several wait at once', async () => {
    const clock = fakeClock();
    const limiter = new RateLimiter({ perMinute: 1, now: clock.now, sleep: clock.sleep });
    await Promise.all([limiter.acquire(), limiter.acquire(), limiter.acquire()]);
    expect(clock.waits).toEqual([60_000, 60_000]);
  });
});
