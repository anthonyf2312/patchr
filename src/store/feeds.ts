import { and, asc, count, eq, getTableColumns } from 'drizzle-orm';
import type { Feed, PauseReason } from '../core/deliver.js';
import type { Database } from '../db/client.js';
import { feeds, githubRepos } from '../db/schema.js';
import type { GitHubRepo } from '../sources/github/api.js';
import { ensureGuild } from './guilds.js';
import { isUuid } from './uuid.js';

export type FeedWithRepo = Feed & {
  repoName: string | null;
  repoStatus: (typeof githubRepos.$inferSelect)['status'] | null;
  repoAvatarUrl: string | null;
};

export interface NewGithubFeed {
  guildId: string;
  repo: GitHubRepo;
  channelId: string;
  pingRoleId: string | null;
  includePrereleases: boolean;
  /** Null follows the server's setting. */
  showThumbnail?: boolean | null;
  /** The owner's avatar with a version on it (see `GitHubApi.avatarUrl`), when that lookup worked. */
  avatarUrl?: string;
  createdBy: string;
}

export type CreateFeedResult = { kind: 'created'; feed: Feed } | { kind: 'duplicate' };

const withRepo = {
  ...getTableColumns(feeds),
  repoName: githubRepos.fullName,
  repoStatus: githubRepos.status,
  repoAvatarUrl: githubRepos.ownerAvatarUrl,
};

export async function countFeeds(db: Database, guildId: string): Promise<number> {
  const [row] = await db.select({ value: count() }).from(feeds).where(eq(feeds.guildId, guildId));
  return row?.value ?? 0;
}

export async function listFeeds(db: Database, guildId: string): Promise<FeedWithRepo[]> {
  return db
    .select(withRepo)
    .from(feeds)
    .leftJoin(githubRepos, eq(feeds.githubRepoId, githubRepos.id))
    .where(eq(feeds.guildId, guildId))
    .orderBy(asc(feeds.createdAt));
}

/** A feed, only if it belongs to this server. */
export async function getFeed(
  db: Database,
  guildId: string,
  feedId: string,
): Promise<FeedWithRepo | undefined> {
  if (!isUuid(feedId)) return undefined;
  const [row] = await db
    .select(withRepo)
    .from(feeds)
    .leftJoin(githubRepos, eq(feeds.githubRepoId, githubRepos.id))
    .where(and(eq(feeds.guildId, guildId), eq(feeds.id, feedId)));
  return row;
}

/** Starts following a repo in a channel. Releases published before now are never posted. */
export async function createGithubFeed(db: Database, input: NewGithubFeed): Promise<CreateFeedResult> {
  const now = new Date();
  await ensureGuild(db, input.guildId);

  const repoValues = {
    fullName: input.repo.full_name,
    status: 'ok' as const,
    failureCount: 0,
    lastPrivacyCheckAt: now,
  };
  // Without a versioned avatar, keep the stored one: swapping URLs would re-edit every post.
  await db
    .insert(githubRepos)
    .values({
      id: input.repo.id,
      nextPollAt: now,
      ownerAvatarUrl: input.avatarUrl ?? input.repo.owner.avatar_url,
      ...repoValues,
    })
    .onConflictDoUpdate({
      target: githubRepos.id,
      set: { ...repoValues, ...(input.avatarUrl && { ownerAvatarUrl: input.avatarUrl }) },
    });

  const [feed] = await db
    .insert(feeds)
    .values({
      guildId: input.guildId,
      source: 'github',
      githubRepoId: input.repo.id,
      channelId: input.channelId,
      pingRoleId: input.pingRoleId,
      includePrereleases: input.includePrereleases,
      showThumbnail: input.showThumbnail ?? null,
      baselineAt: now,
      createdBy: input.createdBy,
    })
    .onConflictDoNothing()
    .returning();

  return feed ? { kind: 'created', feed } : { kind: 'duplicate' };
}

export async function updateFeed(
  db: Database,
  feedId: string,
  changes: Partial<
    Pick<
      Feed,
      'channelId' | 'pingRoleId' | 'includePrereleases' | 'showThumbnail' | 'status' | 'pausedReason'
    >
  >,
): Promise<void> {
  await db
    .update(feeds)
    .set({ ...changes, updatedAt: new Date() })
    .where(eq(feeds.id, feedId));
}

export async function deleteFeed(db: Database, guildId: string, feedId: string): Promise<boolean> {
  if (!isUuid(feedId)) return false;
  const deleted = await db
    .delete(feeds)
    .where(and(eq(feeds.guildId, guildId), eq(feeds.id, feedId)))
    .returning({ id: feeds.id });
  return deleted.length > 0;
}

/** Pauses every active feed posting into a channel, for example when the channel is deleted. */
export async function pauseFeedsForChannel(
  db: Database,
  channelId: string,
  reason: PauseReason,
): Promise<number> {
  const paused = await db
    .update(feeds)
    .set({ status: 'paused', pausedReason: reason, updatedAt: new Date() })
    .where(and(eq(feeds.channelId, channelId), eq(feeds.status, 'active')))
    .returning({ id: feeds.id });
  return paused.length;
}
