import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { Deliverer } from '../../../src/core/deliver.js';
import { feeds, githubRepos, guilds, posts } from '../../../src/db/schema.js';
import type { GitHubRepo, ReleasesResult, RepoResult } from '../../../src/sources/github/api.js';
import { GitHubPoller, type PollerOptions, type ReleaseApi } from '../../../src/sources/github/poller.js';
import type { GitHubRelease } from '../../../src/sources/github/to-note.js';
import { useTestDatabase } from '../../helpers/db.js';
import { FakeRest, silentLog } from '../../helpers/fakes.js';

const ctx = useTestDatabase();
const NOW = Date.parse('2026-09-23T12:00:00Z');
const INTERVAL = 180_000;

class FakeGitHub implements ReleaseApi {
  releases: GitHubRelease[] = [];
  next: ReleasesResult[] = [];
  repo: GitHubRepo = {
    id: 7,
    full_name: 'acme/rocket',
    private: false,
    html_url: 'https://github.com/acme/rocket',
    owner: { login: 'acme', avatar_url: 'https://avatars.githubusercontent.com/u/1' },
  };
  listCalls: { fullName: string; etag: string | undefined }[] = [];
  repoCalls = 0;
  rateLimitRemaining: number | undefined;

  async listReleases(fullName: string, etag?: string): Promise<ReleasesResult> {
    this.listCalls.push({ fullName, etag });
    return this.next.shift() ?? { kind: 'ok', releases: structuredClone(this.releases), etag: '"e1"' };
  }

  async getRepoById(): Promise<RepoResult> {
    this.repoCalls++;
    return { kind: 'ok', repo: this.repo };
  }
}

function release(id: number, publishedAt: string, overrides: Partial<GitHubRelease> = {}): GitHubRelease {
  return {
    id,
    tag_name: `v1.${id}.0`,
    name: null,
    body: `Notes for ${id}`,
    html_url: `https://github.com/acme/rocket/releases/tag/v1.${id}.0`,
    draft: false,
    prerelease: false,
    created_at: publishedAt,
    published_at: publishedAt,
    author: null,
    ...overrides,
  };
}

let github: FakeGitHub;
let rest: FakeRest;

function poller(options: Partial<PollerOptions> = {}) {
  const deliverer = new Deliverer({
    db: ctx.db,
    rest,
    log: silentLog,
    emojis: () => ({}),
    isAnnouncementChannel: async () => false,
  });
  return new GitHubPoller({
    db: ctx.db,
    api: github,
    deliverer,
    log: silentLog,
    intervalMs: INTERVAL,
    now: () => NOW,
    random: () => 0.5,
    ...options,
  });
}

async function seed(feed: Partial<typeof feeds.$inferInsert> = {}) {
  await ctx.db.insert(guilds).values({ id: 'g1' }).onConflictDoNothing();
  await ctx.db
    .insert(githubRepos)
    .values({
      id: 7,
      fullName: 'acme/rocket',
      nextPollAt: new Date(NOW - 1000),
      lastPrivacyCheckAt: new Date(NOW),
    })
    .onConflictDoNothing();
  const [row] = await ctx.db
    .insert(feeds)
    .values({
      guildId: 'g1',
      source: 'github',
      githubRepoId: 7,
      channelId: 'c1',
      createdBy: 'u1',
      baselineAt: new Date('2026-09-01T00:00:00Z'),
      ...feed,
    })
    .returning();
  if (!row) throw new Error('no feed');
  return row;
}

async function repoRow() {
  const [row] = await ctx.db.select().from(githubRepos).where(eq(githubRepos.id, 7));
  if (!row) throw new Error('no repo');
  return row;
}

const postedBodies = () => rest.messages().map((m) => JSON.stringify(m.body));

beforeEach(() => {
  github = new FakeGitHub();
  rest = new FakeRest();
});

describe('GitHubPoller', () => {
  it('posts releases published after the feed was added, and not the back catalogue', async () => {
    await seed();
    github.releases = [release(1, '2026-08-01T00:00:00Z'), release(2, '2026-09-10T00:00:00Z')];

    await poller().tick();

    expect(rest.messages()).toHaveLength(1);
    expect(postedBodies()[0]).toContain('v1.2.0');
  });

  it('never posts drafts, even when the token can see them', async () => {
    await seed();
    github.releases = [release(3, '2026-09-10T00:00:00Z', { draft: true })];
    await poller().tick();
    expect(rest.messages()).toHaveLength(0);
  });

  it('skips pre-releases unless the feed wants them', async () => {
    await seed();
    await seed({ channelId: 'c2', includePrereleases: true });
    github.releases = [release(4, '2026-09-10T00:00:00Z', { prerelease: true })];

    await poller().tick();

    expect(rest.messages().map((m) => m.route)).toEqual(['/channels/c2/messages']);
  });

  it('posts a pre-release once it is promoted to a full release', async () => {
    await seed();
    const p = poller();
    github.releases = [release(5, '2026-09-10T00:00:00Z', { prerelease: true })];
    await p.pollRepo(await repoRow());
    expect(rest.messages()).toHaveLength(0);

    github.releases = [release(5, '2026-09-10T00:00:00Z', { prerelease: false })];
    await p.pollRepo(await repoRow());
    expect(rest.messages()).toHaveLength(1);
  });

  it('posts each release once however often it polls', async () => {
    await seed();
    github.releases = [release(6, '2026-09-10T00:00:00Z')];
    const p = poller();
    await p.pollRepo(await repoRow());
    await p.pollRepo(await repoRow());
    await poller().pollRepo(await repoRow());
    expect(rest.messages()).toHaveLength(1);
  });

  it('edits the post when the release notes change on GitHub', async () => {
    await seed();
    const p = poller();
    github.releases = [release(7, '2026-09-10T00:00:00Z')];
    await p.pollRepo(await repoRow());

    github.releases = [release(7, '2026-09-10T00:00:00Z', { body: 'Fixed a typo' })];
    await p.pollRepo(await repoRow());

    const edits = rest.calls.filter((c) => c.method === 'patch');
    expect(edits).toHaveLength(1);
    expect(JSON.stringify(edits[0]?.body)).toContain('Fixed a typo');
    await p.pollRepo(await repoRow());
    expect(rest.calls.filter((c) => c.method === 'patch')).toHaveLength(1);
  });

  it('posts oldest first, at most five per feed per poll, and finishes on the next poll', async () => {
    await seed();
    github.releases = Array.from({ length: 7 }, (_, i) =>
      release(20 + i, `2026-09-1${i}T00:00:00Z`),
    ).reverse();
    const p = poller();

    await p.pollRepo(await repoRow());
    expect(rest.messages()).toHaveLength(5);
    expect(postedBodies()[0]).toContain('v1.20.0');
    expect((await repoRow()).etag).toBeNull();

    await p.pollRepo(await repoRow());
    expect(rest.messages()).toHaveLength(7);
  });

  it('sends the etag and does nothing on 304', async () => {
    await seed();
    await ctx.db.update(githubRepos).set({ etag: '"old"' });
    github.next = [{ kind: 'not_modified' }];

    await poller().tick();

    expect(github.listCalls).toEqual([{ fullName: 'acme/rocket', etag: '"old"' }]);
    expect(rest.calls).toHaveLength(0);
    const repo = await repoRow();
    expect(repo.nextPollAt.getTime()).toBe(NOW + INTERVAL);
    expect(repo.failureCount).toBe(0);
  });

  it('clears the etag after a failed delivery so the next poll retries', async () => {
    await seed();
    github.releases = [release(8, '2026-09-10T00:00:00Z')];
    rest.failWith(Object.assign(new Error('boom'), { code: 0, status: 500 }));
    await poller().pollRepo(await repoRow());
    expect((await repoRow()).etag).toBeNull();

    await poller().pollRepo(await repoRow());
    expect(rest.messages()).toHaveLength(2);
    const [post] = await ctx.db.select().from(posts);
    expect(post?.status).toBe('sent');
  });

  it('backs off on errors and marks a repo unavailable after three misses', async () => {
    await seed();
    github.next = [
      { kind: 'gone', status: 404 },
      { kind: 'gone', status: 404 },
      { kind: 'gone', status: 404 },
    ];
    const p = poller();

    await p.pollRepo(await repoRow());
    expect(await repoRow()).toMatchObject({ failureCount: 1, status: 'ok' });
    expect((await repoRow()).nextPollAt.getTime()).toBe(NOW + INTERVAL * 2);

    await p.pollRepo(await repoRow());
    await p.pollRepo(await repoRow());
    expect(await repoRow()).toMatchObject({ failureCount: 3, status: 'unavailable' });
  });

  it('waits out a rate limit without counting it as a failure', async () => {
    await seed();
    github.next = [{ kind: 'rate_limited', retryAfterSeconds: 600 }];
    await poller().pollRepo(await repoRow());
    const repo = await repoRow();
    expect(repo.failureCount).toBe(0);
    expect(repo.nextPollAt.getTime()).toBe(NOW + 600_000);
  });

  it('stops following a repo that turned private', async () => {
    await seed();
    await ctx.db.update(githubRepos).set({ lastPrivacyCheckAt: new Date(NOW - 25 * 3600_000) });
    github.repo = { ...github.repo, private: true };
    github.releases = [release(9, '2026-09-10T00:00:00Z')];

    await poller().pollRepo(await repoRow());

    expect(github.listCalls).toHaveLength(0);
    expect(rest.calls).toHaveLength(0);
    expect((await repoRow()).status).toBe('private');
  });

  it('picks up a renamed repo during the daily check', async () => {
    await seed();
    await ctx.db.update(githubRepos).set({ lastPrivacyCheckAt: new Date(NOW - 25 * 3600_000) });
    github.repo = { ...github.repo, full_name: 'acme/rocket-ship' };
    github.next = [{ kind: 'not_modified' }];

    await poller().pollRepo(await repoRow());

    expect(github.listCalls[0]?.fullName).toBe('acme/rocket-ship');
    expect((await repoRow()).fullName).toBe('acme/rocket-ship');
  });

  it('only polls repos that are due and have an active feed', async () => {
    await seed({ status: 'paused' });
    await ctx.db
      .insert(githubRepos)
      .values({ id: 8, fullName: 'acme/later', nextPollAt: new Date(NOW + 60_000) });
    await ctx.db
      .insert(feeds)
      .values({ guildId: 'g1', source: 'github', githubRepoId: 8, channelId: 'c1', createdBy: 'u1' });

    expect(await poller().tick()).toBe(0);
    expect(github.listCalls).toHaveLength(0);
  });

  it('leases claimed repos so a second poller does not take them', async () => {
    await seed();
    github.next = [{ kind: 'not_modified' }];
    const claimed = await poller().claimDueRepos();
    expect(claimed).toHaveLength(1);
    expect(await poller().claimDueRepos()).toHaveLength(0);
  });

  it('works through a whole backlog in one go instead of one batch per tick', async () => {
    await seed();
    for (let id = 100; id < 104; id++) {
      await ctx.db.insert(githubRepos).values({
        id,
        fullName: `acme/repo-${id}`,
        nextPollAt: new Date(NOW - 1000),
        lastPrivacyCheckAt: new Date(NOW),
      });
      await ctx.db
        .insert(feeds)
        .values({ guildId: 'g1', source: 'github', githubRepoId: id, channelId: 'c1', createdBy: 'u1' });
    }

    expect(await poller({ batchSize: 2 }).drain()).toBe(5);
    expect(github.listCalls).toHaveLength(5);
  });
});

describe('GitHubPoller pacing', () => {
  it.each([
    ['released this week', '2026-09-20T00:00:00Z', 1],
    ['quiet for a few months', '2026-06-01T00:00:00Z', 2],
    ['dormant for most of a year', '2025-12-01T00:00:00Z', 5],
  ])('checks a repo %s (last release %s) every %i× the interval', async (_label, publishedAt, multiplier) => {
    await seed({ baselineAt: new Date(NOW) });
    github.releases = [release(1, publishedAt)];

    await poller().pollRepo(await repoRow());

    const repo = await repoRow();
    expect(repo.lastReleaseAt?.toISOString()).toBe(new Date(publishedAt).toISOString());
    expect(repo.nextPollAt.getTime()).toBe(NOW + INTERVAL * multiplier);
  });

  it('keeps the pace across unchanged checks', async () => {
    await seed({ baselineAt: new Date(NOW) });
    github.releases = [release(1, '2025-12-01T00:00:00Z')];
    const p = poller();
    await p.pollRepo(await repoRow());

    github.next = [{ kind: 'not_modified' }];
    await p.pollRepo(await repoRow());

    expect((await repoRow()).nextPollAt.getTime()).toBe(NOW + INTERVAL * 5);
  });

  it('checks repos with no releases yet at the normal pace, so a first release posts quickly', async () => {
    await seed();
    github.releases = [release(2, '2025-01-01T00:00:00Z', { draft: true, published_at: null })];

    await poller().pollRepo(await repoRow());

    const repo = await repoRow();
    expect(repo.lastReleaseAt).toBeNull();
    expect(repo.nextPollAt.getTime()).toBe(NOW + INTERVAL);
  });
});
