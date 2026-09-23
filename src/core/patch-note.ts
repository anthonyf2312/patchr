/**
 * The one shape every source produces. GitHub releases and `/patch` notes both become a
 * PatchNote, then go through the same renderer and delivery. A new source only has to
 * produce one of these.
 */
export interface PatchNote {
  source: 'github' | 'manual';
  project: {
    name: string;
    url?: string;
    iconUrl?: string;
  };
  version: string;
  title?: string;
  /** Discord markdown, before badges are applied. */
  body: string;
  /** True when the body was shortened; `url` has the full notes. */
  truncated?: boolean;
  url?: string;
  compareUrl?: string;
  prerelease: boolean;
  /** ISO 8601, so notes survive a JSON round trip through the database. */
  publishedAt: string;
  author?: {
    name: string;
    url?: string;
    discordId?: string;
  };
}
