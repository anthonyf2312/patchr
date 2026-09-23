import { describe, expect, it, vi } from 'vitest';
import { GitHubApi } from '../../../src/sources/github/api.js';

function respond(status: number, body: unknown = null, headers: Record<string, string> = {}) {
  return new Response(body === null ? null : JSON.stringify(body), { status, headers });
}

function apiWith(...responses: (Response | Error)[]) {
  const fetch = vi.fn<typeof globalThis.fetch>();
  for (const response of responses) {
    if (response instanceof Error) fetch.mockRejectedValueOnce(response);
    else fetch.mockResolvedValueOnce(response);
  }
  const api = new GitHubApi({ token: 'secret', fetch, userAgent: 'Patchr-test' });
  return { api, fetch };
}

const release = { id: 1, tag_name: 'v1', draft: false };

describe('GitHubApi.listReleases', () => {
  it('returns releases and the new etag', async () => {
    const { api, fetch } = apiWith(respond(200, [release], { etag: 'W/"abc"' }));
    const result = await api.listReleases('acme/rocket');
    expect(result).toEqual({ kind: 'ok', releases: [release], etag: 'W/"abc"' });
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe('https://api.github.com/repos/acme/rocket/releases?per_page=20');
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer secret');
    expect(new Headers(init?.headers).get('user-agent')).toBe('Patchr-test');
  });

  it('sends the etag and reports not modified', async () => {
    const { api, fetch } = apiWith(respond(304));
    expect(await api.listReleases('acme/rocket', 'W/"abc"')).toEqual({ kind: 'not_modified' });
    expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get('if-none-match')).toBe('W/"abc"');
  });

  it('reports a missing repo as gone', async () => {
    const { api } = apiWith(respond(404, { message: 'Not Found' }));
    expect(await api.listReleases('acme/rocket')).toEqual({ kind: 'gone', status: 404 });
  });

  it('reports a spent rate limit with the time until reset', async () => {
    const reset = Math.floor(Date.now() / 1000) + 120;
    const { api } = apiWith(
      respond(
        403,
        { message: 'rate limit' },
        { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(reset) },
      ),
    );
    const result = await api.listReleases('acme/rocket');
    expect(result.kind).toBe('rate_limited');
    if (result.kind === 'rate_limited') expect(result.retryAfterSeconds).toBeGreaterThan(100);
  });

  it('honours retry-after on secondary limits', async () => {
    const { api } = apiWith(respond(429, { message: 'slow down' }, { 'retry-after': '30' }));
    expect(await api.listReleases('acme/rocket')).toEqual({ kind: 'rate_limited', retryAfterSeconds: 30 });
  });

  it('reports server and network failures as errors', async () => {
    const { api } = apiWith(respond(502, { message: 'Bad Gateway' }), new TypeError('fetch failed'));
    expect(await api.listReleases('acme/rocket')).toMatchObject({ kind: 'error' });
    expect(await api.listReleases('acme/rocket')).toMatchObject({ kind: 'error', message: 'fetch failed' });
  });

  it('waits for the rate limiter before every request', async () => {
    const order: string[] = [];
    const fetch = vi.fn<typeof globalThis.fetch>(async () => {
      order.push('fetch');
      return respond(304);
    });
    const limiter = {
      acquire: async () => {
        order.push('acquire');
      },
    };
    const api = new GitHubApi({ fetch, userAgent: 'Patchr-test', limiter });
    await api.listReleases('acme/rocket', '"e"');
    await api.listReleases('acme/rocket', '"e"');
    expect(order).toEqual(['acquire', 'fetch', 'acquire', 'fetch']);
  });

  it('tracks the remaining rate limit', async () => {
    const { api } = apiWith(respond(200, [], { 'x-ratelimit-remaining': '42' }));
    await api.listReleases('acme/rocket');
    expect(api.rateLimitRemaining).toBe(42);
  });
});

describe('GitHubApi.getRepo', () => {
  const repo = {
    id: 7,
    full_name: 'acme/rocket',
    private: false,
    html_url: 'https://github.com/acme/rocket',
    owner: { login: 'acme', avatar_url: 'https://avatars.githubusercontent.com/u/1?v=4' },
  };

  it('returns the repo', async () => {
    const { api, fetch } = apiWith(respond(200, repo));
    expect(await api.getRepo('acme/rocket')).toEqual({ kind: 'ok', repo });
    expect(fetch.mock.calls[0]?.[0]).toBe('https://api.github.com/repos/acme/rocket');
  });

  it('looks repos up by id', async () => {
    const { api, fetch } = apiWith(respond(200, repo));
    await api.getRepoById(7);
    expect(fetch.mock.calls[0]?.[0]).toBe('https://api.github.com/repositories/7');
  });

  it('reports a missing repo', async () => {
    const { api } = apiWith(respond(404, { message: 'Not Found' }));
    expect(await api.getRepo('acme/nope')).toEqual({ kind: 'gone', status: 404 });
  });
});
