/**
 * The one shape every source produces. GitHub releases and `/patch` notes both become a
 * PatchNote, then go through the same renderer and delivery. A new source only has to
 * produce one of these.
 */
export interface PatchNote {
  source: 'github' | 'manual';
  project: {
    name: string;
    /** What the heading calls it, when that differs from `name`: a repo's name without its owner, or a monorepo package. */
    shortName?: string;
    url?: string;
    iconUrl?: string;
  };
  version: string;
  title?: string;
  /** How big the update is next to the release before it. */
  bump?: 'major' | 'minor' | 'patch';
  /** Discord markdown, before badges are applied. */
  body: string;
  /** True when the body was shortened; `url` has the full notes. */
  truncated?: boolean;
  url?: string;
  compareUrl?: string;
  prerelease: boolean;
  /** The release was deleted on GitHub or turned back into a draft. */
  pulled?: boolean;
  /** ISO 8601, so notes survive a JSON round trip through the database. */
  publishedAt: string;
  author?: {
    name: string;
    url?: string;
    discordId?: string;
  };
}
