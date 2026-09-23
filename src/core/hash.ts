import { createHash } from 'node:crypto';
import type { PatchNote } from './patch-note.js';

/** A fingerprint of everything a post shows, used to notice when a release was edited. */
export function noteHash(note: PatchNote): string {
  return createHash('sha256').update(stableStringify(note)).digest('hex');
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}
