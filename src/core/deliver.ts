import { randomUUID } from 'node:crypto';
import { Routes } from 'discord.js';
import { and, eq, sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import type { Database } from '../db/client.js';
import { feeds, guilds, posts } from '../db/schema.js';
import { noteHash } from './hash.js';
import { deliveryNonce } from './nonce.js';
import type { PatchNote } from './patch-note.js';
import { type RenderedCard, type RenderOptions, renderCard } from './render/card.js';

/** The slice of discord.js's REST client that delivery uses, so tests can pass a fake. */
export interface DiscordRest {
  post(route: `/${string}`, options?: { body?: unknown }): Promise<unknown>;
  patch(route: `/${string}`, options?: { body?: unknown }): Promise<unknown>;
}

export type Feed = typeof feeds.$inferSelect;
export type Post = typeof posts.$inferSelect;

export type PauseReason = 'unknown_channel' | 'missing_access' | 'missing_permissions';

export type DeliveryResult =
  | { kind: 'sent'; postId: string; messageId: string }
  | { kind: 'skipped' }
  | { kind: 'paused'; reason: PauseReason }
  | { kind: 'failed'; error: string; retryable: boolean };

export interface DelivererOptions {
  db: Database;
  rest: DiscordRest;
  log: Logger;
  /** Current application emojis. A function, because emoji sync can finish after startup. */
  emojis: () => RenderOptions['emojis'];
  isAnnouncementChannel: (channelId: string) => Promise<boolean>;
}

export const MAX_ATTEMPTS = 3;
/** A `pending` claim older than this is treated as a crashed attempt and retried (with the same nonce). */
const STALE_PENDING_MS = 2 * 60_000;

const PAUSE_REASONS: Record<number, PauseReason> = {
  10003: 'unknown_channel',
  50001: 'missing_access',
  50013: 'missing_permissions',
};

/** Error codes meaning the message can no longer be edited. */
const MESSAGE_GONE = new Set([10003, 10008, 50001]);

export class Deliverer {
  readonly #db: Database;
  readonly #rest: DiscordRest;
  readonly #log: Logger;
  readonly #emojis: DelivererOptions['emojis'];
  readonly #isAnnouncementChannel: DelivererOptions['isAnnouncementChannel'];

  constructor(options: DelivererOptions) {
    this.#db = options.db;
    this.#rest = options.rest;
    this.#log = options.log;
    this.#emojis = options.emojis;
    this.#isAnnouncementChannel = options.isAnnouncementChannel;
  }

  /**
   * Posts a release to a feed exactly once. The post row is claimed before sending and the
   * message carries a deterministic nonce, so crashes and retries can't double-post.
   */
  async deliverRelease(
    feed: Feed,
    releaseKey: string,
    note: PatchNote,
    contentHash: string,
  ): Promise<DeliveryResult> {
    const postId = await this.#claim(feed, releaseKey, note, contentHash);
    if (!postId) return { kind: 'skipped' };

    const card = renderCard(note, {
      emojis: this.#emojis(),
      ...(feed.pingRoleId && { pingRoleId: feed.pingRoleId }),
    });

    try {
      const message = (await this.#rest.post(Routes.channelMessages(feed.channelId), {
        body: { ...messageBody(card), nonce: deliveryNonce(feed.id, releaseKey), enforce_nonce: true },
      })) as { id: string };

      await this.#db
        .update(posts)
        .set({
          status: 'sent',
          messageId: message.id,
          attempts: sql`${posts.attempts} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(posts.id, postId));

      await this.#publish(feed.guildId, feed.channelId, message.id);
      return { kind: 'sent', postId, messageId: message.id };
    } catch (error) {
      const reason = pauseReason(error);
      await this.#db
        .update(posts)
        .set({
          status: 'failed',
          attempts: sql`${posts.attempts} + 1`,
          lastError: describe(error),
          updatedAt: new Date(),
        })
        .where(eq(posts.id, postId));

      if (reason) {
        await this.#db
          .update(feeds)
          .set({ status: 'paused', pausedReason: reason, updatedAt: new Date() })
          .where(eq(feeds.id, feed.id));
        this.#log.warn({ feedId: feed.id, channelId: feed.channelId, reason }, 'feed paused');
        return { kind: 'paused', reason };
      }

      this.#log.error({ err: error, feedId: feed.id, releaseKey }, 'delivery failed');
      return { kind: 'failed', error: describe(error), retryable: true };
    }
  }

  /** Posts a `/patch` note. Nothing is stored unless Discord accepted the message. */
  async postManual(
    target: { guildId: string; channelId: string; pingRoleId: string | null; createdBy: string },
    note: PatchNote,
  ): Promise<DeliveryResult> {
    const postId = randomUUID();
    const card = renderCard(note, {
      emojis: this.#emojis(),
      ...(target.pingRoleId && { pingRoleId: target.pingRoleId }),
    });

    let messageId: string;
    try {
      const message = (await this.#rest.post(Routes.channelMessages(target.channelId), {
        body: { ...messageBody(card), nonce: deliveryNonce('manual', postId), enforce_nonce: true },
      })) as { id: string };
      messageId = message.id;
    } catch (error) {
      const reason = pauseReason(error);
      if (reason) return { kind: 'failed', error: reason, retryable: false };
      this.#log.error({ err: error, channelId: target.channelId }, 'manual post failed');
      return { kind: 'failed', error: describe(error), retryable: true };
    }

    await this.#db.insert(posts).values({
      id: postId,
      guildId: target.guildId,
      channelId: target.channelId,
      messageId,
      kind: 'manual',
      releaseKey: `manual:${postId}`,
      note,
      contentHash: noteHash(note),
      pingRoleId: target.pingRoleId,
      status: 'sent',
      attempts: 1,
      createdBy: target.createdBy,
    });

    await this.#publish(target.guildId, target.channelId, messageId);
    return { kind: 'sent', postId, messageId };
  }

  /** Re-renders a posted message with a new version of its note. */
  async editPost(post: Post, note: PatchNote, contentHash: string): Promise<'edited' | 'gone' | 'failed'> {
    if (!post.messageId) return 'gone';
    const card = renderCard(note, {
      emojis: this.#emojis(),
      ...(post.pingRoleId && { pingRoleId: post.pingRoleId }),
    });

    try {
      await this.#rest.patch(Routes.channelMessage(post.channelId, post.messageId), {
        body: messageBody(card),
      });
    } catch (error) {
      const code = discordCode(error);
      if (code !== undefined && MESSAGE_GONE.has(code)) {
        // Record the new hash anyway so a deleted message isn't retried on every poll.
        await this.#db
          .update(posts)
          .set({ contentHash, lastError: describe(error), updatedAt: new Date() })
          .where(eq(posts.id, post.id));
        return 'gone';
      }
      this.#log.error({ err: error, postId: post.id }, 'edit failed');
      return 'failed';
    }

    await this.#db
      .update(posts)
      .set({ note, contentHash, lastError: null, updatedAt: new Date() })
      .where(eq(posts.id, post.id));
    return 'edited';
  }

  /** Returns the post id when this call owns the delivery, or undefined when it's done or someone else has it. */
  async #claim(
    feed: Feed,
    releaseKey: string,
    note: PatchNote,
    contentHash: string,
  ): Promise<string | undefined> {
    const [existing] = await this.#db
      .select()
      .from(posts)
      .where(and(eq(posts.feedId, feed.id), eq(posts.releaseKey, releaseKey)))
      .limit(1);

    if (!existing) {
      const [inserted] = await this.#db
        .insert(posts)
        .values({
          guildId: feed.guildId,
          channelId: feed.channelId,
          feedId: feed.id,
          kind: 'github',
          releaseKey,
          note,
          contentHash,
          pingRoleId: feed.pingRoleId,
          status: 'pending',
        })
        .onConflictDoNothing()
        .returning({ id: posts.id });
      return inserted?.id;
    }

    if (existing.status === 'sent' || existing.attempts >= MAX_ATTEMPTS) return undefined;
    const stale = Date.now() - existing.updatedAt.getTime() > STALE_PENDING_MS;
    if (existing.status === 'pending' && !stale) return undefined;

    // Compare-and-set on updated_at, so two pollers can't both reclaim the same row.
    const [reclaimed] = await this.#db
      .update(posts)
      .set({ status: 'pending', note, contentHash, updatedAt: new Date() })
      .where(and(eq(posts.id, existing.id), eq(posts.updatedAt, existing.updatedAt)))
      .returning({ id: posts.id });
    return reclaimed?.id;
  }

  /** Crossposts in announcement channels, so servers following the channel get the post too. */
  async #publish(guildId: string, channelId: string, messageId: string): Promise<void> {
    try {
      if (!(await this.#isAnnouncementChannel(channelId))) return;
      const [guild] = await this.#db
        .select({ autoPublish: guilds.autoPublish })
        .from(guilds)
        .where(eq(guilds.id, guildId));
      if (guild && !guild.autoPublish) return;
      await this.#rest.post(Routes.channelMessageCrosspost(channelId, messageId));
    } catch (error) {
      // Publishing is a bonus: Discord allows 10 per hour per channel, and a miss shouldn't fail the post.
      this.#log.warn({ err: error, channelId, messageId }, 'crosspost failed');
    }
  }
}

function messageBody(card: RenderedCard) {
  return { flags: card.flags, components: card.components, allowed_mentions: card.allowedMentions };
}

function discordCode(error: unknown): number | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'number') {
    return error.code;
  }
  return undefined;
}

function pauseReason(error: unknown): PauseReason | undefined {
  const code = discordCode(error);
  return code === undefined ? undefined : PAUSE_REASONS[code];
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
