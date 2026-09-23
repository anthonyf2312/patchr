import { RateLimiter } from '../../lib/rate-limiter.js';
import type { GitHubRelease } from './to-note.js';

export interface GitHubRepo {
  id: number;
  full_name: string;
  private: boolean;
  html_url: string;
  owner: { login: string; avatar_url: string };
}

/** Failures every call can report. `gone` is a 404 or 410: deleted, renamed away or private. */
type Failure =
  | { kind: 'gone'; status: number }
  | { kind: 'rate_limited'; retryAfterSeconds: number }
  | { kind: 'error'; message: string };

export type ReleasesResult =
  | { kind: 'ok'; releases: GitHubRelease[]; etag?: string }
  | { kind: 'not_modified' }
  | Failure;

export type RepoResult = { kind: 'ok'; repo: GitHubRepo } | Failure;

export interface GitHubApiOptions {
  token?: string;
  userAgent: string;
  fetch?: typeof globalThis.fetch;
  baseUrl?: string;
  timeoutMs?: number;
  /** Paces every request. Defaults to 600 a minute. */
  limiter?: { acquire(): Promise<void> };
}

/**
 * GitHub's secondary limit is 900 REST requests a minute per token, and its docs don't say
 * whether unchanged (304) answers count toward it. 600 leaves room for whatever else shares the token.
 */
export const GITHUB_REQUESTS_PER_MINUTE = 600;

/** The two GitHub endpoints Patchr needs, with ETags and rate limits handled. */
export class GitHubApi {
  readonly #token: string | undefined;
  readonly #userAgent: string;
  readonly #fetch: typeof globalThis.fetch;
  readonly #baseUrl: string;
  readonly #timeoutMs: number;
  readonly #limiter: { acquire(): Promise<void> };

  /** From the last response's `x-ratelimit-remaining`, so the poller can slow down before it runs out. */
  rateLimitRemaining: number | undefined;

  constructor(options: GitHubApiOptions) {
    this.#token = options.token;
    this.#userAgent = options.userAgent;
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#baseUrl = options.baseUrl ?? 'https://api.github.com';
    this.#timeoutMs = options.timeoutMs ?? 15_000;
    this.#limiter = options.limiter ?? new RateLimiter({ perMinute: GITHUB_REQUESTS_PER_MINUTE });
  }

  async listReleases(fullName: string, etag?: string): Promise<ReleasesResult> {
    const response = await this.#request(`/repos/${fullName}/releases?per_page=20`, etag);
    if ('kind' in response) return response;
    if (response.status === 304) return { kind: 'not_modified' };

    const releases = (await response.json()) as GitHubRelease[];
    const newEtag = response.headers.get('etag') ?? undefined;
    return newEtag ? { kind: 'ok', releases, etag: newEtag } : { kind: 'ok', releases };
  }

  async getRepo(fullName: string): Promise<RepoResult> {
    return this.#repo(`/repos/${fullName}`);
  }

  async getRepoById(id: number): Promise<RepoResult> {
    return this.#repo(`/repositories/${id}`);
  }

  async #repo(path: string): Promise<RepoResult> {
    const response = await this.#request(path);
    if ('kind' in response) return response;
    return { kind: 'ok', repo: (await response.json()) as GitHubRepo };
  }

  /** Returns the response for 2xx and 304, and a Failure for everything else. */
  async #request(path: string, etag?: string): Promise<Response | Failure> {
    const headers = new Headers({
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': this.#userAgent,
    });
    if (this.#token) headers.set('authorization', `Bearer ${this.#token}`);
    if (etag) headers.set('if-none-match', etag);

    await this.#limiter.acquire();
    let response: Response;
    try {
      response = await this.#fetch(`${this.#baseUrl}${path}`, {
        headers,
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch (error) {
      return { kind: 'error', message: error instanceof Error ? error.message : String(error) };
    }

    const remaining = response.headers.get('x-ratelimit-remaining');
    if (remaining !== null) this.rateLimitRemaining = Number(remaining);

    if (response.ok || response.status === 304) return response;
    if (response.status === 404 || response.status === 410) return { kind: 'gone', status: response.status };

    const retryAfter = rateLimitDelay(response);
    if (retryAfter !== undefined) return { kind: 'rate_limited', retryAfterSeconds: retryAfter };

    const body = await response.text().catch(() => '');
    return { kind: 'error', message: `GitHub ${response.status}: ${body.slice(0, 200)}` };
  }
}

/** Seconds to wait when a 403 or 429 is a rate limit, following GitHub's documented headers. */
function rateLimitDelay(response: Response): number | undefined {
  if (response.status !== 403 && response.status !== 429) return undefined;

  const retryAfter = response.headers.get('retry-after');
  if (retryAfter !== null) return Math.max(1, Number(retryAfter));

  if (response.headers.get('x-ratelimit-remaining') === '0') {
    const reset = Number(response.headers.get('x-ratelimit-reset'));
    return Math.max(1, Math.ceil(reset - Date.now() / 1000));
  }

  // A 429 without headers is still a secondary limit; GitHub asks for at least a minute.
  return response.status === 429 ? 60 : undefined;
}
