import pino from 'pino';
import type { DiscordRest } from '../../src/core/deliver.js';
import type { PatchNote } from '../../src/core/patch-note.js';

export const silentLog = pino({ level: 'silent' });

export interface RestCall {
  method: 'post' | 'patch';
  route: string;
  body: Record<string, unknown>;
}

/** Records every call. Queue errors with `failWith` to make the next calls throw. */
export class FakeRest implements DiscordRest {
  calls: RestCall[] = [];
  #errors: unknown[] = [];
  #nextId = 1000;

  failWith(...errors: unknown[]): void {
    this.#errors.push(...errors);
  }

  async post(route: `/${string}`, options: { body?: unknown } = {}): Promise<unknown> {
    return this.#record('post', route, options.body);
  }

  async patch(route: `/${string}`, options: { body?: unknown } = {}): Promise<unknown> {
    return this.#record('patch', route, options.body);
  }

  messages(): RestCall[] {
    return this.calls.filter((c) => c.method === 'post' && /\/messages$/.test(c.route));
  }

  #record(method: RestCall['method'], route: string, body: unknown): unknown {
    this.calls.push({ method, route, body: (body ?? {}) as Record<string, unknown> });
    if (this.#errors.length > 0) throw this.#errors.shift();
    return { id: String(this.#nextId++) };
  }
}

/** Shaped like discord.js's DiscordAPIError, which is all the delivery code looks at. */
export function discordError(code: number, status = 403): Error & { code: number; status: number } {
  return Object.assign(new Error(`Discord error ${code}`), { code, status });
}

export function sampleNote(overrides: Partial<PatchNote> = {}): PatchNote {
  return {
    source: 'github',
    project: { name: 'acme/rocket', url: 'https://github.com/acme/rocket' },
    version: 'v1.0.0',
    body: '### Fixes\n- one',
    url: 'https://github.com/acme/rocket/releases/tag/v1.0.0',
    prerelease: false,
    publishedAt: '2026-09-23T12:00:00Z',
    ...overrides,
  };
}
