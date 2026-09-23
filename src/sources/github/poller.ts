import { and, asc, eq, exists, inArray, isNull, lte, notInArray, sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import { type Deliverer, type Feed, MAX_ATTEMPTS } from '../../core/deliver.js';
import { noteHash } from '../../core/hash.js';
import type { Database } from '../../db/client.js';
import { feeds, githubRepos, posts } from '../../db/schema.js';
import { currentAvatar, type GitHubApi, RELEASES_PAGE_SIZE } from './api.js';
import { type GitHubRelease, releaseToNote } from './to-note.js';

export type RepoRow = typeof githubRepos.$inferSelect;
export type ReleaseApi = Pick<
  GitHubApi,
  'listReleases' | 'getRepoById' | 'getRelease' | 'avatarUrl' | 'rateLimitRemaining'
>;

export interface PollerOptions {
  db: Database;
  api: ReleaseApi;
  deliverer: Pick<Deliverer, 'deliverRelease' | 'editPost'>;
  log: Logger;
  /** How often an active repo is checked. Quieter repos are checked less often (see `activityMultiplier`). */
  intervalMs: number;
  concurrency?: number;
  /** Repos claimed per round. A full round means there's a backlog, so the next starts at once. */
  batchSize?: number;
  now?: () => number;
  random?: () => number;
}

const TICK_MS = 15_000;
const DAY_MS = 24 * 60 * 60_000;
/** No release for this long: checked half as often. */
const QUIET_AFTER_MS = 30 * DAY_MS;
/** No release for this long: checked a fifth as often. */
const DORMANT_AFTER_MS = 180 * DAY_MS;
/** A claimed repo is hidden from other pollers this long; if this one crashes, another picks it up after. */
const LEASE_MS = 5 * 60_000;
const MAX_BACKOFF_MS = 60 * 60_000;
const PRIVACY_CHECK_MS = 24 * 60 * 60_000;
const GONE_THRESHOLD = 3;
/** Caps posts per feed per poll, so a burst of releases can't flood a channel all at once. */
const MAX_NEW_PER_FEED = 5;
const LOW_RATE_LIMIT = 200;

/**
 * Checks watched repos for new or edited releases. State lives in the database, so a restart
 * (for example, one caused by Patchr's own release) just catches up on the next poll.
 */
export class GitHubPoller {
  readonly #db: Database;
  readonly #api: ReleaseApi;
  readonly #deliverer: PollerOptions['deliverer'];
  readonly #log: Logger;
  readonly #intervalMs: number;
  readonly #concurrency: number;
  readonly #batchSize: number;
  readonly #now: () => number;
  readonly #random: () => number;

  #timer: NodeJS.Timeout | undefined;
  #current: Promise<unknown> | undefined;
  #stopped = false;

  constructor(options: PollerOptions) {
    this.#db = options.db;
    this.#api = options.api;
    this.#deliverer = options.deliverer;
    this.#log = options.log;
    this.#intervalMs = options.intervalMs;
    this.#concurrency = options.concurrency ?? 8;
    this.#batchSize = options.batchSize ?? 50;
    this.#now = options.now ?? Date.now;
    this.#random = options.random ?? Math.random;
  }

  start(): void {
    if (this.#timer) return;
    this.#stopped = false;
    const loop = async () => {
      this.#current = this.drain().catch((error: unknown) =>
        this.#log.error({ err: error }, 'poll round failed'),
      );
      await this.#current;
      if (!this.#stopped) this.#timer = setTimeout(loop, TICK_MS);
    };
    this.#timer = setTimeout(loop, 0);
  }

  /**
   * Keeps polling until nothing is due. Throughput is bounded by the GitHub client's rate limiter,
   * not by a fixed number of repos per tick, so a large backlog clears as fast as GitHub allows.
   */
  async drain(): Promise<number> {
    let total = 0;
    for (;;) {
      const polled = await this.tick();
      total += polled;
      if (polled < this.#batchSize || this.#stopped) return total;
    }
  }

  async stop(): Promise<void> {
    this.#stopped = true;
    clearTimeout(this.#timer);
    this.#timer = undefined;
    await this.#current;
  }

  /** Polls every repo that is due. Returns how many were polled. */
  async tick(): Promise<number> {
    const repos = await this.claimDueRepos();
    const queue = [...repos];
    const worker = async () => {
      for (let repo = queue.shift(); repo; repo = queue.shift()) {
        await this.pollRepo(repo).catch((error: unknown) =>
          this.#log.error({ err: error, repo: repo?.fullName }, 'poll failed'),
        );
      }
    };
    await Promise.all(Array.from({ length: Math.min(this.#concurrency, queue.length) }, worker));
    return repos.length;
  }

  /** Takes due repos with a lease, skipping rows another poller has locked. */
  async claimDueRepos(): Promise<RepoRow[]> {
    const now = new Date(this.#now());
    const hasActiveFeed = exists(
      this.#db
        .select({ id: feeds.id })
        .from(feeds)
        .where(and(eq(feeds.githubRepoId, githubRepos.id), eq(feeds.status, 'active'))),
    );
    const due = this.#db
      .select({ id: githubRepos.id })
      .from(githubRepos)
      .where(and(lte(githubRepos.nextPollAt, now), hasActiveFeed))
      .orderBy(asc(githubRepos.nextPollAt))
      .limit(this.#batchSize)
      .for('update', { skipLocked: true });

    return this.#db
      .update(githubRepos)
      .set({ nextPollAt: new Date(now.getTime() + LEASE_MS) })
      .where(inArray(githubRepos.id, due))
      .returning();
  }

  async pollRepo(claimed: RepoRow): Promise<void> {
    const now = this.#now();
    let repo = claimed;

    if (repo.status === 'private' || now - repo.lastPrivacyCheckAt.getTime() >= PRIVACY_CHECK_MS) {
      const checked = await this.#checkRepo(repo);
      if (!checked) return;
      repo = checked;
    }

    const result = await this.#api.listReleases(repo.fullName, repo.etag ?? undefined);

    switch (result.kind) {
      case 'not_modified':
        await this.#update(
          repo,
          { failureCount: 0, lastError: null, status: 'ok' },
          this.#nextPoll(repo.lastReleaseAt),
        );
        return;

      case 'rate_limited':
        await this.#update(repo, {}, now + result.retryAfterSeconds * 1000);
        return;

      case 'error':
        await this.#fail(repo, result.message, false);
        return;

      case 'gone':
        await this.#fail(repo, `GitHub ${result.status}`, true);
        return;

      case 'ok': {
        const { retry: failed, lastReleaseAt } = await this.#process(repo, result.releases);
        const retry = (await this.#markPulled(repo, result.releases)) || failed;
        // Dropping the etag forces a full response next time, which is what retries failed deliveries.
        const etag = retry ? null : (result.etag ?? null);
        await this.#update(
          repo,
          { etag, lastReleaseAt, failureCount: 0, lastError: null, status: 'ok' },
          this.#nextPoll(lastReleaseAt),
        );
        return;
      }
    }
  }

  /** Posts new eligible releases and edits posts whose release changed. */
  async #process(
    repo: RepoRow,
    releases: GitHubRelease[],
  ): Promise<{ retry: boolean; lastReleaseAt: Date | null }> {
    const published = releases
      .filter((r): r is GitHubRelease & { published_at: string } => !r.draft && r.published_at !== null)
      .sort((a, b) => Date.parse(a.published_at) - Date.parse(b.published_at));
    const newest = published.at(-1);
    if (!newest) return { retry: false, lastReleaseAt: null };

    const repoFeeds = await this.#db
      .select()
      .from(feeds)
      .where(and(eq(feeds.githubRepoId, repo.id), eq(feeds.status, 'active')));
    const keys = published.map((r) => releaseKey(r));
    const existing = await this.#db.select().from(posts).where(inArray(posts.releaseKey, keys));

    const repoInfo = {
      fullName: repo.fullName,
      url: `https://github.com/${repo.fullName}`,
      ...(repo.ownerAvatarUrl && { ownerAvatarUrl: repo.ownerAvatarUrl }),
    };
    const sentThisPoll = new Map<string, number>();
    const paused = new Set<string>();
    let retry = false;

    for (const [index, release] of published.entries()) {
      const key = releaseKey(release);
      const note = releaseToNote(release, repoInfo, published[index - 1]?.tag_name);
      const hash = noteHash(note);
      const releasePosts = existing.filter((p) => p.releaseKey === key);

      for (const post of releasePosts) {
        if (post.status !== 'sent' || post.contentHash === hash) continue;
        if ((await this.#deliverer.editPost(post, note, hash)) === 'failed') retry = true;
      }

      for (const feed of repoFeeds) {
        if (paused.has(feed.id) || !isEligible(feed, release)) continue;
        const post = releasePosts.find((p) => p.feedId === feed.id);
        if (post && (post.status === 'sent' || post.attempts >= MAX_ATTEMPTS)) continue;

        if ((sentThisPoll.get(feed.id) ?? 0) >= MAX_NEW_PER_FEED) {
          retry = true;
          continue;
        }

        const result = await this.#deliverer.deliverRelease(feed, key, note, hash);
        if (result.kind === 'sent') sentThisPoll.set(feed.id, (sentThisPoll.get(feed.id) ?? 0) + 1);
        if (result.kind === 'paused') paused.add(feed.id);
        if (result.kind === 'failed' && result.retryable) retry = true;
      }
    }

    return { retry, lastReleaseAt: new Date(newest.published_at) };
  }

  /**
   * Marks posts whose release was deleted or turned back into a draft. Only releases the list
   * should include are checked, and only GitHub's own answer for that release marks one:
   * a release that just fell off the list is left alone. Returns true if an edit failed.
   */
  async #markPulled(repo: RepoRow, releases: GitHubRelease[]): Promise<boolean> {
    const listed = releases.filter((r) => !r.draft && r.published_at !== null);
    const oldest = listed.map((r) => r.published_at as string).sort()[0];
    const complete = releases.length < RELEASES_PAGE_SIZE;
    if (!complete && !oldest) return false;

    const publishedAt = sql<string>`${posts.note}->>'publishedAt'`;
    const candidates = await this.#db
      .select({ post: posts })
      .from(posts)
      .innerJoin(feeds, eq(posts.feedId, feeds.id))
      .where(
        and(
          eq(feeds.githubRepoId, repo.id),
          eq(posts.kind, 'github'),
          eq(posts.status, 'sent'),
          isNull(sql`${posts.note}->>'pulled'`),
          listed.length > 0 ? notInArray(posts.releaseKey, listed.map(releaseKey)) : undefined,
          complete ? undefined : sql`${publishedAt} >= ${oldest}`,
        ),
      );

    let failed = false;
    const checked = new Map<string, boolean>();
    for (const { post } of candidates) {
      let pulled = checked.get(post.releaseKey);
      if (pulled === undefined) {
        const result = await this.#api.getRelease(
          repo.fullName,
          Number(post.releaseKey.slice('github:'.length)),
        );
        pulled = result.kind === 'gone' || (result.kind === 'ok' && result.release.draft);
        checked.set(post.releaseKey, pulled);
      }
      if (!pulled) continue;

      const note = { ...post.note, pulled: true };
      if ((await this.#deliverer.editPost(post, note, noteHash(note))) === 'failed') failed = true;
    }
    return failed;
  }

  /** The daily check: catches renames, and stops a repo that turned private. Returns undefined to stop this poll. */
  async #checkRepo(repo: RepoRow): Promise<RepoRow | undefined> {
    const now = this.#now();
    const result = await this.#api.getRepoById(repo.id);
    if (result.kind !== 'ok') return repo;

    if (result.repo.private) {
      this.#log.warn({ repo: repo.fullName }, 'repo is private now; no longer following it');
      await this.#update(
        repo,
        { status: 'private', etag: null, lastPrivacyCheckAt: new Date(now) },
        now + PRIVACY_CHECK_MS,
      );
      return undefined;
    }

    const updates = {
      fullName: result.repo.full_name,
      ownerAvatarUrl: await currentAvatar(this.#api, result.repo.owner.avatar_url, repo.ownerAvatarUrl),
      status: 'ok' as const,
      lastPrivacyCheckAt: new Date(now),
    };
    await this.#db.update(githubRepos).set(updates).where(eq(githubRepos.id, repo.id));
    return { ...repo, ...updates };
  }

  /** Backs off exponentially. A repo GitHub keeps answering 404/410 for is marked unavailable. */
  async #fail(repo: RepoRow, message: string, gone: boolean): Promise<void> {
    const failures = repo.failureCount + 1;
    const unavailable = gone && failures >= GONE_THRESHOLD;
    const delay = unavailable ? MAX_BACKOFF_MS : Math.min(this.#intervalMs * 2 ** failures, MAX_BACKOFF_MS);
    this.#log.warn({ repo: repo.fullName, failures, message }, 'poll failed');
    await this.#update(
      repo,
      {
        failureCount: failures,
        lastError: message,
        ...(unavailable && { status: 'unavailable' as const, etag: null }),
      },
      this.#now() + delay,
    );
  }

  async #update(
    repo: RepoRow,
    values: Partial<typeof githubRepos.$inferInsert>,
    nextPollAt: number,
  ): Promise<void> {
    await this.#db
      .update(githubRepos)
      .set({ ...values, lastPolledAt: new Date(this.#now()), nextPollAt: new Date(nextPollAt) })
      .where(eq(githubRepos.id, repo.id));
  }

  /**
   * The interval for this repo's activity, with ±10% jitter so checks spread out, stretched
   * further when the GitHub rate limit runs low.
   */
  #nextPoll(lastReleaseAt: Date | null): number {
    const jitter = 0.9 + this.#random() * 0.2;
    const remaining = this.#api.rateLimitRemaining;
    const slow = remaining !== undefined && remaining < LOW_RATE_LIMIT ? 4 : 1;
    const pace = activityMultiplier(lastReleaseAt, this.#now());
    return this.#now() + Math.round(this.#intervalMs * pace * jitter * slow);
  }
}

/**
 * How much less often to check a repo, by how long ago it last released: active repos every
 * interval, quiet ones (30+ days) half as often, dormant ones (180+ days) a fifth as often.
 * A repo with no releases stays at the normal pace, so a new project's first release posts quickly.
 */
export function activityMultiplier(lastReleaseAt: Date | null, now: number): number {
  if (!lastReleaseAt) return 1;
  const age = now - lastReleaseAt.getTime();
  if (age > DORMANT_AFTER_MS) return 5;
  if (age > QUIET_AFTER_MS) return 2;
  return 1;
}

function releaseKey(release: GitHubRelease): string {
  return `github:${release.id}`;
}

/** Published after the feed was set up, and a pre-release only if the feed wants those. */
function isEligible(feed: Feed, release: GitHubRelease & { published_at: string }): boolean {
  if (Date.parse(release.published_at) < feed.baselineAt.getTime()) return false;
  return !release.prerelease || feed.includePrereleases;
}
