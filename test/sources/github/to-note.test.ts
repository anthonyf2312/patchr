import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { NOTES_MAX_LENGTH } from '../../../src/core/limits.js';
import { cleanTitle, type GitHubRelease, releaseToNote } from '../../../src/sources/github/to-note.js';

const fixture = (name: string): GitHubRelease =>
  JSON.parse(readFileSync(`test/fixtures/releases/${name}.json`, 'utf8'));

const repo = (fullName: string) => ({
  fullName,
  url: `https://github.com/${fullName}`,
  ownerAvatarUrl: 'https://avatars.githubusercontent.com/u/1',
});

describe('releaseToNote', () => {
  it('maps a release onto a note', () => {
    const note = releaseToNote(fixture('discordjs'), repo('discordjs/discord.js'), '14.26.0');
    expect(note).toMatchObject({
      source: 'github',
      project: {
        name: 'discordjs/discord.js',
        url: 'https://github.com/discordjs/discord.js',
        iconUrl: 'https://avatars.githubusercontent.com/u/1',
      },
      version: '14.27.0',
      url: 'https://github.com/discordjs/discord.js/releases/tag/14.27.0',
      compareUrl: 'https://github.com/discordjs/discord.js/compare/14.26.0...14.27.0',
      prerelease: false,
    });
    expect(note.title).toBeUndefined();
    expect(note.body.startsWith('### Bug Fixes')).toBe(true);
  });

  it('does not credit bot accounts', () => {
    expect(releaseToNote(fixture('discordjs'), repo('discordjs/discord.js')).author).toBeUndefined();
  });

  it('credits people', () => {
    const release = {
      ...fixture('discordjs'),
      author: { login: 'octo', html_url: 'https://github.com/octo', type: 'User' },
    };
    expect(releaseToNote(release, repo('discordjs/discord.js')).author).toEqual({
      name: 'octo',
      url: 'https://github.com/octo',
    });
  });

  it('drops the heading release-please repeats', () => {
    const note = releaseToNote(fixture('release-please'), repo('googleapis/release-please'));
    expect(note.body.startsWith('### Bug Fixes')).toBe(true);
  });

  it('drops a version heading in a monorepo release and cuts long notes', () => {
    const note = releaseToNote(fixture('biome'), repo('biomejs/biome'));
    expect(note.title).toBe('Biome CLI');
    expect(note.body.startsWith('### Patch Changes')).toBe(true);
    expect(note.truncated).toBe(true);
    expect(note.body.length).toBeLessThanOrEqual(NOTES_MAX_LENGTH);
  });

  it('has no compare link without a previous tag', () => {
    expect(releaseToNote(fixture('gh-cli'), repo('cli/cli')).compareUrl).toBeUndefined();
  });

  it('falls back to the creation date and an empty body', () => {
    const release = {
      ...fixture('gh-cli'),
      published_at: null,
      body: null,
      created_at: '2026-01-02T03:04:05Z',
    };
    const note = releaseToNote(release, repo('cli/cli'));
    expect(note.publishedAt).toBe('2026-01-02T03:04:05Z');
    expect(note.body).toBe('');
  });
});

describe('cleanTitle', () => {
  it.each([
    ['GitHub CLI 2.101.0', 'v2.101.0', 'GitHub CLI'],
    ['v1.2.0 - The Big One', 'v1.2.0', 'The Big One'],
    ['Liftoff', 'v1.2.0', 'Liftoff'],
    ['Biome CLI v2.5.14\n', '@biomejs/biome@2.5.14', 'Biome CLI'],
  ])('%j with tag %s is %j', (name, tag, expected) => {
    expect(cleanTitle(name, tag)).toBe(expected);
  });

  it.each([
    ['v1.2.0', 'v1.2.0'],
    ['1.2.0', 'v1.2.0'],
    ['Release 1.2.0', 'v1.2.0'],
    ['', 'v1.2.0'],
    [null, 'v1.2.0'],
  ])('%j with tag %s has no title', (name, tag) => {
    expect(cleanTitle(name, tag)).toBeUndefined();
  });
});
