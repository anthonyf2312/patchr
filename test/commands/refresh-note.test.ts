import { beforeEach, describe, expect, it } from 'vitest';
import { type RefreshGitHub, refreshPost } from '../../src/commands/refresh-note.js';
import { Deliverer, type Post } from '../../src/core/deliver.js';
import { noteHash } from '../../src/core/hash.js';
import { feeds, githubRepos, guilds, posts } from '../../src/db/schema.js';
import type { GitHubRepo, ReleaseResult, RepoResult } from '../../src/sources/github/api.js';
import type { GitHubRelease } from '../../src/sources/github/to-note.js';
import { useTestDatabase } from '../helpers/db.js';
import { FakeRest, sampleNote, silentLog } from '../helpers/fakes.js';

const ctx = useTestDatabase();
const RAW_AVATAR = 'https://avatars.githubusercontent.com/u/1?v=4';

class FakeGitHub implements RefreshGitHub {
  repo: RepoResult = {
    kind: 'ok',
    repo: {
      id: 7,
      full_name: 'acme/rocket',
      private: false,
      html_url: 'https://github.com/acme/rocket',
      owner: { login: 'acme', avatar_url: RAW_AVATAR },
    },
  };
  release: ReleaseResult = { kind: 'ok', release: githubRelease() };
  avatarVersion: string | undefined = 'new';
  lookups: string[] = [];

  async getRepoById(id: number): Promise<RepoResult> {
    this.lookups.push(`id:${id}`);
    return this.repo;
  }

  async getRepo(fullName: string): Promise<RepoResult> {
    this.lookups.push(`name:${fullName}`);
    return this.repo;
  }

  async getRelease(): Promise<ReleaseResult> {
    return this.release;
  }

  async avatarUrl(raw: string): Promise<string | undefined> {
    return this.avatarVersion ? `${raw}&pv=${this.avatarVersion}` : undefined;
  }
}

function githubRelease(overrides: Partial<GitHubRelease> = {}): GitHubRelease {
  return {
    id: 1,
    tag_name: 'v1.0.0',
    name: null,
    body: 'Fresh notes',
    html_url: 'https://github.com/acme/rocket/releases/tag/v1.0.0',
    draft: false,
    prerelease: false,
    created_at: '2026-09-10T00:00:00Z',
    published_at: '2026-09-10T00:00:00Z',
    author: null,
    ...overrides,
  };
}

let github: FakeGitHub;
let rest: FakeRest;

function deps() {
  const deliverer = new Deliverer({
    db: ctx.db,
    rest,
    log: silentLog,
    emojis: () => ({}),
    isAnnouncementChannel: async () => false,
  });
  return { db: ctx.db, github, deliverer };
}

const server = { name: 'Survival Server', iconUrl: 'https://cdn.discordapp.com/icons/1/b.png' };

async function githubPost(options: { feed?: boolean } = {}): Promise<Post> {
  await ctx.db.insert(guilds).values({ id: 'g1' });
  await ctx.db
    .insert(githubRepos)
    .values({ id: 7, fullName: 'acme/rocket', ownerAvatarUrl: `${RAW_AVATAR}&pv=old` });
  const [feed] =
    options.feed === false
      ? []
      : await ctx.db
          .insert(feeds)
          .values({ guildId: 'g1', source: 'github', githubRepoId: 7, channelId: 'c1', createdBy: 'u1' })
          .returning();
  const note = sampleNote({
    project: { name: 'acme/rocket', url: 'https://github.com/acme/rocket', iconUrl: `${RAW_AVATAR}&pv=old` },
    compareUrl: 'https://github.com/acme/rocket/compare/v0.9.0...v1.0.0',
  });
  const [post] = await ctx.db
    .insert(posts)
    .values({
      guildId: 'g1',
      channelId: 'c1',
      messageId: 'm1',
      feedId: feed?.id ?? null,
      kind: 'github',
      releaseKey: 'github:1',
      note,
      contentHash: noteHash(note),
      status: 'sent',
    })
    .returning();
  if (!post) throw new Error('no post');
  return post;
}

const lastEdit = () => JSON.stringify(rest.calls.filter((c) => c.method === 'patch').at(-1)?.body);

beforeEach(() => {
  github = new FakeGitHub();
  rest = new FakeRest();
});

describe('refreshPost', () => {
  it('re-renders a GitHub post with the latest notes and a new avatar', async () => {
    const post = await githubPost();

    expect(await refreshPost(deps(), post, server)).toBe('refreshed');

    expect(github.lookups).toEqual(['id:7']);
    expect(lastEdit()).toContain('Fresh notes');
    expect(lastEdit()).toContain(`${RAW_AVATAR}&pv=new`);
    expect(lastEdit()).toContain('Full changelog');
    const [repo] = await ctx.db.select().from(githubRepos);
    expect(repo?.ownerAvatarUrl).toBe(`${RAW_AVATAR}&pv=new`);
  });

  it('re-renders even when nothing changed', async () => {
    const post = await githubPost();
    await refreshPost(deps(), post, server);
    const [updated] = await ctx.db.select().from(posts);
    if (!updated) throw new Error('no post');

    expect(await refreshPost(deps(), updated, server)).toBe('refreshed');
    expect(rest.calls.filter((c) => c.method === 'patch')).toHaveLength(2);
  });

  it('keeps the stored avatar when the new one cannot be checked', async () => {
    const post = await githubPost();
    github.avatarVersion = undefined;

    await refreshPost(deps(), post, server);

    expect(lastEdit()).toContain(`${RAW_AVATAR}&pv=old`);
  });

  it('finds the repo by name when the feed was removed', async () => {
    const post = await githubPost({ feed: false });
    expect(await refreshPost(deps(), post, server)).toBe('refreshed');
    expect(github.lookups).toEqual(['name:acme/rocket']);
  });

  it('marks the post as pulled when the release is gone', async () => {
    const post = await githubPost();
    github.release = { kind: 'gone', status: 404 };

    expect(await refreshPost(deps(), post, server)).toBe('pulled');

    expect(lastEdit()).toContain('Release pulled');
    const [row] = await ctx.db.select().from(posts);
    expect(row?.note.pulled).toBe(true);
  });

  it('treats a release turned back into a draft as pulled', async () => {
    const post = await githubPost();
    github.release = { kind: 'ok', release: githubRelease({ draft: true }) };
    expect(await refreshPost(deps(), post, server)).toBe('pulled');
  });

  it('refuses a repo that turned private, and changes nothing', async () => {
    const post = await githubPost();
    if (github.repo.kind !== 'ok') throw new Error('bad fake');
    github.repo = { kind: 'ok', repo: { ...github.repo.repo, private: true } as GitHubRepo };

    expect(await refreshPost(deps(), post, server)).toBe('private');
    expect(rest.calls).toHaveLength(0);
  });

  it('changes nothing when GitHub does not answer', async () => {
    const post = await githubPost();
    github.release = { kind: 'error', message: 'GitHub 502' };
    expect(await refreshPost(deps(), post, server)).toBe('github_down');
    expect(rest.calls).toHaveLength(0);
  });

  it("gives a manual note the server's current name and icon", async () => {
    await ctx.db.insert(guilds).values({ id: 'g1' });
    const note = sampleNote({ source: 'manual', project: { name: 'Old Name' }, body: 'Map reset.' });
    const [post] = await ctx.db
      .insert(posts)
      .values({
        guildId: 'g1',
        channelId: 'c1',
        messageId: 'm1',
        kind: 'manual',
        releaseKey: 'manual:x',
        note,
        contentHash: noteHash(note),
        status: 'sent',
      })
      .returning();
    if (!post) throw new Error('no post');

    expect(await refreshPost(deps(), post, server)).toBe('refreshed');

    expect(github.lookups).toEqual([]);
    expect(lastEdit()).toContain('Survival Server');
    expect(lastEdit()).toContain(server.iconUrl);
    expect(lastEdit()).toContain('Map reset.');
  });
});
