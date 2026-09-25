import { NOTES_MAX_LENGTH } from '../../core/limits.js';
import { githubToDiscord } from '../../core/markdown/github-to-discord.js';
import type { PatchNote } from '../../core/patch-note.js';

/** The fields Patchr reads from GitHub's release object. */
export interface GitHubRelease {
  id: number;
  tag_name: string;
  name: string | null;
  body: string | null;
  html_url: string;
  draft: boolean;
  prerelease: boolean;
  created_at: string;
  published_at: string | null;
  author: { login: string; html_url: string; type: string } | null;
}

export interface RepoInfo {
  fullName: string;
  url: string;
  ownerAvatarUrl?: string;
}

export function releaseToNote(release: GitHubRelease, repo: RepoInfo, previousTag?: string): PatchNote {
  const converted = githubToDiscord(release.body ?? '', {
    repo: repo.fullName,
    maxLength: NOTES_MAX_LENGTH,
    dropLeadingHeading: (text) => isVersionHeading(text, release.tag_name, release.name),
  });

  const tag = splitTag(release.tag_name);
  const repoName = repo.fullName.slice(repo.fullName.indexOf('/') + 1);
  const shortName = tag?.pkg ?? repoName;

  const note: PatchNote = {
    source: 'github',
    project: { name: repo.fullName, shortName, url: repo.url },
    version: tag ? `v${tag.version}` : release.tag_name,
    body: converted.text,
    url: release.html_url,
    prerelease: release.prerelease,
    publishedAt: release.published_at ?? release.created_at,
  };

  if (repo.ownerAvatarUrl) note.project.iconUrl = repo.ownerAvatarUrl;
  const title = cleanTitle(release.name, release.tag_name);
  // A release named "patchr v1.2.0" has no title beyond what the heading already says.
  const names = [shortName, repoName, repo.fullName].map((n) => n.toLowerCase());
  if (title && !names.includes(title.toLowerCase())) note.title = title;
  if (converted.truncated) note.truncated = true;
  if (previousTag) {
    note.compareUrl = `${repo.url}/compare/${encodeURIComponent(previousTag)}...${encodeURIComponent(release.tag_name)}`;
  }
  const bump = bumpOf(release.tag_name, previousTag);
  if (bump) note.bump = bump;
  // Release bots (release-please, github-actions) aren't worth crediting.
  if (release.author && release.author.type !== 'Bot') {
    note.author = { name: release.author.login, url: release.author.html_url };
  }

  return note;
}

/** The release name minus the version it repeats, or nothing when that leaves no real title. */
export function cleanTitle(name: string | null | undefined, tag: string): string | undefined {
  const trimmed = (name ?? '').trim();
  if (!trimmed || core(trimmed) === core(tag)) return undefined;

  let title = trimmed;
  const version = versionOf(tag);
  if (version) title = title.replace(new RegExp(String.raw`\bv?${escapeRegExp(version)}\b`, 'gi'), ' ');
  title = title
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-–—:·|,]+|[\s\-–—:·|,]+$/g, '')
    .trim();

  if (!title || /^(release|version|v)$/i.test(title)) return undefined;
  return title;
}

const PACKAGE_TAG = /^(.+?)(?:@|[-_/]v)(\d+\.\d+(?:\.\d+)?(?:[-+][0-9a-z.-]+)?)$/i;

/** A monorepo tag's package and version: `@scope/pkg@1.2.3`, `pkg-v1.2.3` or `pkg/v1.2.3`. */
export function splitTag(tag: string): { pkg: string; version: string } | undefined {
  const [, pkg, version] = PACKAGE_TAG.exec(tag.trim()) ?? [];
  if (!pkg || !version || /^(release|version)$/i.test(pkg)) return undefined;
  return { pkg, version };
}

const BUMPS = ['major', 'minor', 'patch'] as const;

/** Which part of the version went up since the previous tag, if both are versions of the same thing. */
export function bumpOf(tag: string, previousTag: string | undefined): PatchNote['bump'] {
  if (previousTag === undefined) return undefined;
  const current = splitTag(tag);
  const previous = splitTag(previousTag);
  if (current?.pkg !== previous?.pkg) return undefined;

  const now = versionNumbers(current?.version ?? versionOf(tag));
  const before = versionNumbers(previous?.version ?? versionOf(previousTag));
  if (!now || !before) return undefined;

  for (const [index, bump] of BUMPS.entries()) {
    const [a = 0, b = 0] = [now[index], before[index]];
    if (a > b) return bump;
    if (a < b) return undefined;
  }
  return undefined;
}

function versionNumbers(version: string | undefined): number[] | undefined {
  const match = /^(\d+)\.(\d+)(?:\.(\d+))?(?:[-+]|$)/.exec(version ?? '');
  return match ? [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)] : undefined;
}

/** True for a heading like "v1.2.0", "## [1.2.0](…) (2026-09-23)" or the release name. */
function isVersionHeading(text: string, tag: string, name: string | null): boolean {
  const candidate = core(text.replace(/\(\d{4}-\d{2}-\d{2}\)/g, ''));
  if (!candidate) return false;
  return candidate === core(tag) || candidate === core(name ?? '') || candidate === versionOf(tag);
}

function core(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^v(?=\d)/, '');
}

function versionOf(tag: string): string | undefined {
  return /v?(\d+(?:\.\d+)*(?:[-+][0-9a-z.-]+)?)$/i.exec(tag)?.[1]?.toLowerCase();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}
