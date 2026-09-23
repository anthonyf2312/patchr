import { describe, expect, it } from 'vitest';
import { feeds, githubRepos, posts } from '../../src/db/schema.js';
import type { GitHubRepo } from '../../src/sources/github/api.js';
import { createDraft, getDraft, pruneExpiredDrafts, updateDraft } from '../../src/store/drafts.js';
import {
  countFeeds,
  createGithubFeed,
  deleteFeed,
  getFeed,
  listFeeds,
  pauseFeedsForChannel,
  updateFeed,
} from '../../src/store/feeds.js';
import { deleteGuild, getGuildSettings, updateGuildSettings } from '../../src/store/guilds.js';
import { findPostByMessage } from '../../src/store/posts.js';
import { useTestDatabase } from '../helpers/db.js';
import { sampleNote } from '../helpers/fakes.js';

const ctx = useTestDatabase();

const repo: GitHubRepo = {
  id: 7,
  full_name: 'acme/rocket',
  private: false,
  html_url: 'https://github.com/acme/rocket',
  owner: { login: 'acme', avatar_url: 'https://avatars.githubusercontent.com/u/1' },
};

const newFeed = (overrides: Partial<Parameters<typeof createGithubFeed>[1]> = {}) =>
  createGithubFeed(ctx.db, {
    guildId: 'g1',
    repo,
    channelId: 'c1',
    pingRoleId: null,
    includePrereleases: false,
    createdBy: 'u1',
    ...overrides,
  });

describe('guild settings', () => {
  it('has defaults before anything is saved', async () => {
    expect(await getGuildSettings(ctx.db, 'g1')).toEqual({
      defaultChannelId: null,
      defaultPingRoleId: null,
      autoPublish: true,
    });
  });

  it('saves partial updates', async () => {
    await updateGuildSettings(ctx.db, 'g1', { defaultChannelId: 'c1' });
    await updateGuildSettings(ctx.db, 'g1', { autoPublish: false });
    expect(await getGuildSettings(ctx.db, 'g1')).toEqual({
      defaultChannelId: 'c1',
      defaultPingRoleId: null,
      autoPublish: false,
    });
  });

  it('deletes everything a server owns', async () => {
    const created = await newFeed();
    if (created.kind !== 'created') throw new Error('not created');
    await ctx.db.insert(posts).values({
      guildId: 'g1',
      channelId: 'c1',
      kind: 'manual',
      releaseKey: 'manual:1',
      note: sampleNote(),
      contentHash: 'h',
    });
    await createDraft(ctx.db, {
      guildId: 'g1',
      userId: 'u1',
      channelId: 'c1',
      pingRoleId: null,
      note: sampleNote(),
    });

    await deleteGuild(ctx.db, 'g1');

    expect(await listFeeds(ctx.db, 'g1')).toEqual([]);
    expect(await ctx.db.select().from(posts)).toEqual([]);
  });
});

describe('feeds', () => {
  it('creates a feed and the repo it follows', async () => {
    const created = await newFeed({ pingRoleId: 'r1' });
    expect(created.kind).toBe('created');
    const [row] = await ctx.db.select().from(githubRepos);
    expect(row).toMatchObject({ id: 7, fullName: 'acme/rocket', ownerAvatarUrl: repo.owner.avatar_url });
    expect(await countFeeds(ctx.db, 'g1')).toBe(1);
  });

  it('refuses the same repo twice in one channel', async () => {
    await newFeed();
    expect((await newFeed()).kind).toBe('duplicate');
    expect((await newFeed({ channelId: 'c2' })).kind).toBe('created');
  });

  it('lists feeds with their repo', async () => {
    await newFeed();
    const [feed] = await listFeeds(ctx.db, 'g1');
    expect(feed).toMatchObject({
      channelId: 'c1',
      repoName: 'acme/rocket',
      repoStatus: 'ok',
      status: 'active',
    });
  });

  it('only finds feeds in their own server', async () => {
    const created = await newFeed();
    if (created.kind !== 'created') throw new Error('not created');
    expect(await getFeed(ctx.db, 'g1', created.feed.id)).toMatchObject({ repoName: 'acme/rocket' });
    expect(await getFeed(ctx.db, 'other', created.feed.id)).toBeUndefined();
    expect(await getFeed(ctx.db, 'g1', 'not-a-uuid')).toBeUndefined();
  });

  it('updates and resumes a feed', async () => {
    const created = await newFeed();
    if (created.kind !== 'created') throw new Error('not created');
    await pauseFeedsForChannel(ctx.db, 'c1', 'unknown_channel');
    expect((await getFeed(ctx.db, 'g1', created.feed.id))?.status).toBe('paused');

    await updateFeed(ctx.db, created.feed.id, { channelId: 'c3', status: 'active', pausedReason: null });
    expect(await getFeed(ctx.db, 'g1', created.feed.id)).toMatchObject({
      channelId: 'c3',
      status: 'active',
      pausedReason: null,
    });
  });

  it('deletes a feed but keeps its posts', async () => {
    const created = await newFeed();
    if (created.kind !== 'created') throw new Error('not created');
    await ctx.db.insert(posts).values({
      guildId: 'g1',
      channelId: 'c1',
      feedId: created.feed.id,
      kind: 'github',
      releaseKey: 'github:1',
      note: sampleNote(),
      contentHash: 'h',
      messageId: 'm1',
    });

    expect(await deleteFeed(ctx.db, 'g1', created.feed.id)).toBe(true);
    expect(await deleteFeed(ctx.db, 'g1', created.feed.id)).toBe(false);
    expect(await ctx.db.select().from(feeds)).toEqual([]);
    expect((await findPostByMessage(ctx.db, 'g1', 'm1'))?.feedId).toBeNull();
  });
});

describe('drafts', () => {
  const draftInput = { guildId: 'g1', userId: 'u1', channelId: 'c1', pingRoleId: 'r1', note: sampleNote() };

  it('round-trips a draft', async () => {
    const id = await createDraft(ctx.db, draftInput);
    const draft = await getDraft(ctx.db, id);
    expect(draft).toMatchObject({ userId: 'u1', ping: true, note: sampleNote() });
  });

  it('updates a draft', async () => {
    const id = await createDraft(ctx.db, draftInput);
    await updateDraft(ctx.db, id, { ping: false, note: sampleNote({ body: 'changed' }) });
    expect(await getDraft(ctx.db, id)).toMatchObject({ ping: false, note: { body: 'changed' } });
  });

  it('forgets expired drafts', async () => {
    const id = await createDraft(ctx.db, draftInput);
    const later = new Date(Date.now() + 16 * 60_000);
    expect(await getDraft(ctx.db, id, later)).toBeUndefined();
    expect(await pruneExpiredDrafts(ctx.db, later)).toBe(1);
  });
});
