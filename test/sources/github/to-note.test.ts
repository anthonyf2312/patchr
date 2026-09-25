import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { NOTES_MAX_LENGTH } from '../../../src/core/limits.js';
import {
  bumpOf,
  cleanTitle,
  type GitHubRelease,
  releaseToNote,
  splitTag,
} from '../../../src/sources/github/to-note.js';

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
        shortName: 'discord.js',
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
    expect(note.project.shortName).toBe('@biomejs/biome');
    expect(note.version).toBe('v2.5.14');
    expect(note.body.startsWith('### Patch Changes')).toBe(true);
    expect(note.truncated).toBe(true);
    expect(note.body.length).toBeLessThanOrEqual(NOTES_MAX_LENGTH);
  });

  it('has no compare link or update size without a previous tag', () => {
    const note = releaseToNote(fixture('gh-cli'), repo('cli/cli'));
    expect(note.compareUrl).toBeUndefined();
    expect(note.bump).toBeUndefined();
  });

  it('says how big the update is', () => {
    expect(releaseToNote(fixture('gh-cli'), repo('cli/cli'), 'v2.100.3').bump).toBe('minor');
  });

  it('drops a release name that only repeats the project', () => {
    const release = { ...fixture('gh-cli'), tag_name: 'v1.2.0', name: 'patchr v1.2.0' };
    expect(releaseToNote(release, repo('anthonyf2312/patchr')).title).toBeUndefined();
    const full = { ...release, name: 'AnthonyF2312/Patchr 1.2.0' };
    expect(releaseToNote(full, repo('anthonyf2312/patchr')).title).toBeUndefined();
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

describe('splitTag', () => {
  it.each([
    ['@biomejs/biome@2.5.14', '@biomejs/biome', '2.5.14'],
    ['patchr-v1.2.0', 'patchr', '1.2.0'],
    ['tools/v0.3', 'tools', '0.3'],
    ['web@1.0.0-beta.2', 'web', '1.0.0-beta.2'],
  ])('%s is %s at %s', (tag, pkg, version) => {
    expect(splitTag(tag)).toEqual({ pkg, version });
  });

  it.each(['v1.2.0', '1.2.0', 'release-2026-09', 'release-v1.2.0', 'version-v2.0', 'name@latest', 'nightly'])(
    '%s has no package',
    (tag) => {
      expect(splitTag(tag)).toBeUndefined();
    },
  );
});

describe('bumpOf', () => {
  it.each([
    ['v2.0.0', 'v1.9.3', 'major'],
    ['v1.3.0', 'v1.2.9', 'minor'],
    ['v0.22.0', 'v0.21.4', 'minor'],
    ['v1.2.4', 'v1.2.3', 'patch'],
    ['1.3', '1.2', 'minor'],
    ['v1.2.0-beta.1', 'v1.1.0', 'minor'],
    ['@biomejs/biome@2.5.14', '@biomejs/biome@2.5.13', 'patch'],
  ])('%s after %s is %s', (tag, previous, expected) => {
    expect(bumpOf(tag, previous)).toBe(expected);
  });

  it.each([
    ['v1.2.3', 'v1.2.4'],
    ['v1.2.3', 'v1.2.3'],
    ['v1.0.0-beta.2', 'v1.0.0-beta.1'],
    ['v1.0.0', 'v1.0.0-rc.1'],
    ['@biomejs/biome@2.5.14', '@biomejs/js-api@1.0.0'],
    ['@biomejs/biome@2.5.14', 'v2.5.13'],
    ['nightly', 'v1.0.0'],
    ['v1.0.0', 'nightly'],
    ['v1.0.0', undefined],
  ])('%s after %s has no size', (tag, previous) => {
    expect(bumpOf(tag, previous)).toBeUndefined();
  });
});
