import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type { PatchNote } from '../core/patch-note.js';

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/** Per-server settings. Every other server-owned row cascades from here, so removing Patchr deletes it all. */
export const guilds = pgTable('guilds', {
  id: text('id').primaryKey(),
  defaultChannelId: text('default_channel_id'),
  defaultPingRoleId: text('default_ping_role_id'),
  autoPublish: boolean('auto_publish').notNull().default(true),
  /** Show the repo owner's avatar or the server icon on posts. A feed can override it. */
  showThumbnail: boolean('show_thumbnail').notNull().default(true),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
  updatedAt: timestamptz('updated_at').notNull().defaultNow(),
});

/** One row per watched repo, however many servers follow it. Keyed by GitHub's id, which survives renames. */
export const githubRepos = pgTable(
  'github_repos',
  {
    id: bigint('id', { mode: 'number' }).primaryKey(),
    fullName: text('full_name').notNull(),
    ownerAvatarUrl: text('owner_avatar_url'),
    etag: text('etag'),
    status: text('status', { enum: ['ok', 'unavailable', 'private'] })
      .notNull()
      .default('ok'),
    failureCount: integer('failure_count').notNull().default(0),
    lastError: text('last_error'),
    nextPollAt: timestamptz('next_poll_at').notNull().defaultNow(),
    lastPolledAt: timestamptz('last_polled_at'),
    lastPrivacyCheckAt: timestamptz('last_privacy_check_at').notNull().defaultNow(),
    /** Newest published release, which sets how often the repo is checked. Null until one exists. */
    lastReleaseAt: timestamptz('last_release_at'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [index('github_repos_next_poll').on(t.nextPollAt)],
);

export const feeds = pgTable(
  'feeds',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    guildId: text('guild_id')
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    source: text('source', { enum: ['github'] }).notNull(),
    githubRepoId: bigint('github_repo_id', { mode: 'number' }).references(() => githubRepos.id),
    channelId: text('channel_id').notNull(),
    pingRoleId: text('ping_role_id'),
    includePrereleases: boolean('include_prereleases').notNull().default(false),
    /** Null follows the server's setting. */
    showThumbnail: boolean('show_thumbnail'),
    status: text('status', { enum: ['active', 'paused'] })
      .notNull()
      .default('active'),
    pausedReason: text('paused_reason'),
    /** Only releases published after this are posted, so adding a feed never floods a channel with history. */
    baselineAt: timestamptz('baseline_at').notNull().defaultNow(),
    createdBy: text('created_by').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('feeds_guild_repo_channel').on(t.guildId, t.githubRepoId, t.channelId),
    index('feeds_github_repo').on(t.githubRepoId),
    index('feeds_channel').on(t.channelId),
  ],
);

/**
 * Every message Patchr posts. A row is claimed as `pending` before sending, and the unique
 * (feed, release) index is what stops a release being posted twice to the same feed.
 */
export const posts = pgTable(
  'posts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    guildId: text('guild_id')
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    channelId: text('channel_id').notNull(),
    messageId: text('message_id'),
    feedId: uuid('feed_id').references(() => feeds.id, { onDelete: 'set null' }),
    kind: text('kind', { enum: ['github', 'manual'] }).notNull(),
    /** `github:<release id>` or `manual:<post id>`. */
    releaseKey: text('release_key').notNull(),
    note: jsonb('note').$type<PatchNote>().notNull(),
    contentHash: text('content_hash').notNull(),
    pingRoleId: text('ping_role_id'),
    status: text('status', { enum: ['pending', 'sent', 'failed'] })
      .notNull()
      .default('pending'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    createdBy: text('created_by'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('posts_feed_release').on(t.feedId, t.releaseKey),
    index('posts_release_key').on(t.releaseKey),
    index('posts_message').on(t.messageId),
  ],
);

/** A `/patch` note waiting in its private preview. */
export const drafts = pgTable(
  'drafts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    guildId: text('guild_id')
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(),
    channelId: text('channel_id').notNull(),
    pingRoleId: text('ping_role_id'),
    ping: boolean('ping').notNull().default(true),
    note: jsonb('note').$type<PatchNote>().notNull(),
    expiresAt: timestamptz('expires_at').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [index('drafts_expires').on(t.expiresAt)],
);

/** Small bits of instance state, such as the hash of the last registered command set. */
export const meta = pgTable('meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: timestamptz('updated_at').notNull().defaultNow(),
});
