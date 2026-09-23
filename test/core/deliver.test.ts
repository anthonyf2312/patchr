import { MessageFlags } from 'discord.js';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { Deliverer } from '../../src/core/deliver.js';
import { noteHash } from '../../src/core/hash.js';
import { deliveryNonce } from '../../src/core/nonce.js';
import { feeds, githubRepos, guilds, posts } from '../../src/db/schema.js';
import { useTestDatabase } from '../helpers/db.js';
import { discordError, FakeRest, sampleNote, silentLog } from '../helpers/fakes.js';

const ctx = useTestDatabase();
let rest: FakeRest;
let announcementChannels: Set<string>;

function deliverer() {
  return new Deliverer({
    db: ctx.db,
    rest,
    log: silentLog,
    emojis: () => ({ patchr: '<:patchr:1>' }),
    isAnnouncementChannel: async (id) => announcementChannels.has(id),
  });
}

async function seedFeed(overrides: Partial<typeof feeds.$inferInsert> = {}) {
  await ctx.db.insert(guilds).values({ id: 'g1' }).onConflictDoNothing();
  await ctx.db.insert(githubRepos).values({ id: 7, fullName: 'acme/rocket' }).onConflictDoNothing();
  const [feed] = await ctx.db
    .insert(feeds)
    .values({
      guildId: 'g1',
      source: 'github',
      githubRepoId: 7,
      channelId: 'c1',
      createdBy: 'u1',
      ...overrides,
    })
    .returning();
  if (!feed) throw new Error('no feed');
  return feed;
}

beforeEach(() => {
  rest = new FakeRest();
  announcementChannels = new Set();
});

describe('Deliverer.deliverRelease', () => {
  it('posts the card with a nonce and records the message', async () => {
    const feed = await seedFeed({ pingRoleId: 'r1' });
    const note = sampleNote();

    const result = await deliverer().deliverRelease(feed, 'github:1', note, noteHash(note));

    expect(result).toMatchObject({ kind: 'sent', messageId: '1000' });
    const [call] = rest.messages();
    expect(call?.route).toBe('/channels/c1/messages');
    expect(call?.body).toMatchObject({
      flags: MessageFlags.IsComponentsV2,
      nonce: deliveryNonce(feed.id, 'github:1'),
      enforce_nonce: true,
      allowed_mentions: { parse: [], roles: ['r1'] },
    });
    const [row] = await ctx.db.select().from(posts);
    expect(row).toMatchObject({ status: 'sent', messageId: '1000', pingRoleId: 'r1', attempts: 1 });
  });

  it('never posts the same release to the same feed twice', async () => {
    const feed = await seedFeed();
    const note = sampleNote();
    const d = deliverer();

    await d.deliverRelease(feed, 'github:1', note, noteHash(note));
    const again = await d.deliverRelease(feed, 'github:1', note, noteHash(note));

    expect(again).toEqual({ kind: 'skipped' });
    expect(rest.messages()).toHaveLength(1);
  });

  it('pauses the feed when the channel is gone or locked', async () => {
    for (const [code, reason] of [
      [10003, 'unknown_channel'],
      [50001, 'missing_access'],
      [50013, 'missing_permissions'],
    ] as const) {
      const feed = await seedFeed({ channelId: `c-${code}` });
      rest.failWith(discordError(code));
      const result = await deliverer().deliverRelease(feed, 'github:1', sampleNote(), 'h');
      expect(result).toEqual({ kind: 'paused', reason });
      const [row] = await ctx.db.select().from(feeds).where(eq(feeds.id, feed.id));
      expect(row).toMatchObject({ status: 'paused', pausedReason: reason });
    }
  });

  it('marks other failures for retry, and retries them later', async () => {
    const feed = await seedFeed();
    rest.failWith(discordError(0, 500));
    const d = deliverer();

    expect(await d.deliverRelease(feed, 'github:1', sampleNote(), 'h')).toMatchObject({
      kind: 'failed',
      retryable: true,
    });
    expect(await d.deliverRelease(feed, 'github:1', sampleNote(), 'h')).toMatchObject({ kind: 'sent' });
    const [row] = await ctx.db.select().from(posts);
    expect(row).toMatchObject({ status: 'sent', attempts: 2 });
  });

  it('gives up after three attempts', async () => {
    const feed = await seedFeed();
    const d = deliverer();
    for (let i = 0; i < 3; i++) {
      rest.failWith(discordError(0, 500));
      await d.deliverRelease(feed, 'github:1', sampleNote(), 'h');
    }
    expect(await d.deliverRelease(feed, 'github:1', sampleNote(), 'h')).toEqual({ kind: 'skipped' });
    expect(rest.messages()).toHaveLength(3);
  });

  it('publishes posts in announcement channels', async () => {
    const feed = await seedFeed();
    announcementChannels.add('c1');
    await deliverer().deliverRelease(feed, 'github:1', sampleNote(), 'h');
    expect(rest.calls.map((c) => c.route)).toEqual([
      '/channels/c1/messages',
      '/channels/c1/messages/1000/crosspost',
    ]);
  });

  it('does not publish when the server turned auto-publish off', async () => {
    const feed = await seedFeed();
    await ctx.db.update(guilds).set({ autoPublish: false });
    announcementChannels.add('c1');
    await deliverer().deliverRelease(feed, 'github:1', sampleNote(), 'h');
    expect(rest.calls).toHaveLength(1);
  });

  it('still counts the post as sent when publishing fails', async () => {
    const feed = await seedFeed();
    announcementChannels.add('c1');
    const d = deliverer();
    const send = rest.post.bind(rest);
    rest.post = async (route, options) => {
      if (route.endsWith('/crosspost')) throw discordError(20022, 429);
      return send(route, options);
    };
    expect(await d.deliverRelease(feed, 'github:1', sampleNote(), 'h')).toMatchObject({ kind: 'sent' });
  });
});

describe('Deliverer.postManual', () => {
  it('posts a manual note and records who wrote it', async () => {
    await ctx.db.insert(guilds).values({ id: 'g1' });
    const note = sampleNote({ source: 'manual' });
    const result = await deliverer().postManual(
      { guildId: 'g1', channelId: 'c9', pingRoleId: null, createdBy: 'u1' },
      note,
    );
    expect(result).toMatchObject({ kind: 'sent', messageId: '1000' });
    const [row] = await ctx.db.select().from(posts);
    expect(row).toMatchObject({ kind: 'manual', createdBy: 'u1', channelId: 'c9', feedId: null });
    expect(row?.releaseKey).toBe(`manual:${row?.id}`);
  });

  it('reports a locked channel without retrying', async () => {
    await ctx.db.insert(guilds).values({ id: 'g1' });
    rest.failWith(discordError(50013));
    const result = await deliverer().postManual(
      { guildId: 'g1', channelId: 'c9', pingRoleId: null, createdBy: 'u1' },
      sampleNote(),
    );
    expect(result).toEqual({ kind: 'failed', error: 'missing_permissions', retryable: false });
    expect(await ctx.db.select().from(posts)).toHaveLength(0);
  });
});

describe('Deliverer.editPost', () => {
  it('re-renders the message and stores the new note', async () => {
    const feed = await seedFeed({ pingRoleId: 'r1' });
    const d = deliverer();
    await d.deliverRelease(feed, 'github:1', sampleNote(), 'old');
    const [post] = await ctx.db.select().from(posts);
    if (!post) throw new Error('no post');

    const updated = sampleNote({ body: 'Edited.' });
    expect(await d.editPost(post, updated, 'new')).toBe('edited');

    const edit = rest.calls.find((c) => c.method === 'patch');
    expect(edit?.route).toBe('/channels/c1/messages/1000');
    expect(JSON.stringify(edit?.body)).toContain('Edited.');
    expect(edit?.body).toMatchObject({ allowed_mentions: { parse: [], roles: ['r1'] } });
    const [row] = await ctx.db.select().from(posts);
    expect(row).toMatchObject({ contentHash: 'new', note: updated });
  });

  it('stops syncing a message that was deleted', async () => {
    const feed = await seedFeed();
    const d = deliverer();
    await d.deliverRelease(feed, 'github:1', sampleNote(), 'old');
    const [post] = await ctx.db.select().from(posts);
    if (!post) throw new Error('no post');

    rest.failWith(discordError(10008, 404));
    expect(await d.editPost(post, sampleNote({ body: 'x' }), 'new')).toBe('gone');
    const [row] = await ctx.db.select().from(posts);
    expect(row?.contentHash).toBe('new');
  });
});

describe('thumbnails', () => {
  const withIcon = sampleNote({
    project: { name: 'acme/rocket', iconUrl: 'https://avatars.githubusercontent.com/u/1?v=4' },
  });
  const hasThumbnail = (index: number) => JSON.stringify(rest.calls[index]?.body).includes('avatars');

  it('shows the icon by default', async () => {
    const feed = await seedFeed();
    await deliverer().deliverRelease(feed, 'github:1', withIcon, 'h');
    expect(hasThumbnail(0)).toBe(true);
  });

  it('follows the server setting when the feed has none', async () => {
    const feed = await seedFeed();
    await ctx.db.update(guilds).set({ showThumbnail: false });
    await deliverer().deliverRelease(feed, 'github:1', withIcon, 'h');
    expect(hasThumbnail(0)).toBe(false);
  });

  it("lets a feed override the server's setting", async () => {
    await ctx.db.insert(guilds).values({ id: 'g1', showThumbnail: false });
    const on = await seedFeed({ showThumbnail: true });
    const off = await seedFeed({ channelId: 'c2', showThumbnail: false });
    await ctx.db.update(guilds).set({ showThumbnail: true });
    const d = deliverer();

    await d.deliverRelease(off, 'github:1', withIcon, 'h');
    await ctx.db.update(guilds).set({ showThumbnail: false });
    await d.deliverRelease(on, 'github:1', withIcon, 'h');

    expect(hasThumbnail(0)).toBe(false);
    expect(hasThumbnail(1)).toBe(true);
  });

  it("uses the post's current feed setting when editing", async () => {
    const feed = await seedFeed();
    const d = deliverer();
    await d.deliverRelease(feed, 'github:1', withIcon, 'h');
    await ctx.db.update(feeds).set({ showThumbnail: false });
    const [post] = await ctx.db.select().from(posts);
    if (!post) throw new Error('no post');

    await d.editPost(post, withIcon, 'h2');
    expect(hasThumbnail(1)).toBe(false);
  });

  it('uses the server setting for manual notes', async () => {
    await ctx.db.insert(guilds).values({ id: 'g1', showThumbnail: false });
    await deliverer().postManual(
      { guildId: 'g1', channelId: 'c9', pingRoleId: null, createdBy: 'u1' },
      { ...withIcon, source: 'manual' },
    );
    expect(hasThumbnail(0)).toBe(false);
  });
});
