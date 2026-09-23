/** Escapes inline syntax: formatting, mentions, custom emoji and masked-link brackets. */
export function escapeInline(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/[*_~`|<[\]]/g, '\\$&');
}

/** Escapes syntax that only means something at the start of a line: headings, subtext, quotes and lists. */
export function escapeLineStarts(text: string): string {
  return text.replace(/^(\s*)(#|-|>|\+)/gm, '$1\\$2').replace(/^(\s*\d+)\./gm, '$1\\.');
}

/**
 * Escapes literal text so Discord shows it exactly as written: no formatting,
 * no mentions, no masked links, and no headings or lists at the start of a line.
 */
export function escapeDiscord(text: string): string {
  return escapeLineStarts(escapeInline(text));
}
