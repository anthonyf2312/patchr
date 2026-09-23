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

  const note: PatchNote = {
    source: 'github',
    project: { name: repo.fullName, url: repo.url },
    version: release.tag_name,
    body: converted.text,
    url: release.html_url,
    prerelease: release.prerelease,
    publishedAt: release.published_at ?? release.created_at,
  };

  if (repo.ownerAvatarUrl) note.project.iconUrl = repo.ownerAvatarUrl;
  const title = cleanTitle(release.name, release.tag_name);
  if (title) note.title = title;
  if (converted.truncated) note.truncated = true;
  if (previousTag) {
    note.compareUrl = `${repo.url}/compare/${encodeURIComponent(previousTag)}...${encodeURIComponent(release.tag_name)}`;
  }
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
