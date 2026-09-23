export interface RepoRef {
  owner: string;
  name: string;
}

const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const NAME = /^[A-Za-z0-9._-]{1,100}$/;
const GITHUB_URL = /^(?:https?:\/\/)?(?:www\.)?github\.com\/(.+)$/i;

/** Reads `owner/repo` or any github.com URL that points into a repo. */
export function parseRepoInput(input: string): RepoRef | null {
  const trimmed = input.trim();
  const url = GITHUB_URL.exec(trimmed);

  let parts: string[];
  if (url?.[1]) {
    parts = url[1].split('/').filter(Boolean).slice(0, 2);
  } else {
    parts = trimmed.replace(/\/+$/, '').split('/');
    if (parts.length !== 2) return null;
  }

  const [owner, rawName] = parts;
  if (!owner || !rawName) return null;
  const name = rawName.replace(/\.git$/i, '');

  if (!OWNER.test(owner) || !NAME.test(name) || name === '.' || name === '..') return null;
  return { owner, name };
}
