import { fileURLToPath } from 'node:url';
import type { Logger } from 'pino';
import type { BadgeEmojis } from '../core/markdown/badges.js';

export type BrandEmojis = BadgeEmojis & { patchr?: string };

interface EmojiLike {
  name: string | null;
  toString(): string;
}

/** The parts of discord.js's ApplicationEmojiManager used here. */
export interface EmojiManagerLike {
  fetch(): Promise<ReadonlyMap<string, EmojiLike>>;
  create(options: { attachment: string; name: string }): Promise<EmojiLike>;
}

const assets = (file: string) => fileURLToPath(new URL(`../../assets/emojis/${file}`, import.meta.url));

/** Application emojis belong to the bot, so they work in every server without Manage Emojis. */
const BRAND: { key: keyof BrandEmojis; name: string; file: string }[] = [
  { key: 'patchr', name: 'patchr', file: 'patchr.png' },
  { key: 'new', name: 'patchr_new', file: 'new.png' },
  { key: 'fix', name: 'patchr_fix', file: 'fix.png' },
  { key: 'change', name: 'patchr_change', file: 'change.png' },
];

/**
 * Uploads any brand emoji the application doesn't have yet and returns them formatted for messages.
 * A self-hosted copy gets the badges on first start; a missing one just means plain headings.
 */
export async function syncEmojis(manager: EmojiManagerLike, log: Logger): Promise<BrandEmojis> {
  const result: BrandEmojis = {};
  let existing: ReadonlyMap<string, EmojiLike>;
  try {
    existing = await manager.fetch();
  } catch (error) {
    log.warn({ err: error }, 'could not fetch application emojis');
    return result;
  }

  for (const emoji of BRAND) {
    const found = [...existing.values()].find((e) => e.name === emoji.name);
    try {
      const resolved = found ?? (await manager.create({ attachment: assets(emoji.file), name: emoji.name }));
      result[emoji.key] = resolved.toString();
    } catch (error) {
      log.warn({ err: error, emoji: emoji.name }, 'could not upload emoji');
    }
  }
  return result;
}
