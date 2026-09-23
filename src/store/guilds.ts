import { eq, inArray } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { guilds } from '../db/schema.js';

export interface GuildSettings {
  defaultChannelId: string | null;
  defaultPingRoleId: string | null;
  autoPublish: boolean;
  showThumbnail: boolean;
}

const DEFAULTS: GuildSettings = {
  defaultChannelId: null,
  defaultPingRoleId: null,
  autoPublish: true,
  showThumbnail: true,
};

export async function ensureGuild(db: Database, guildId: string): Promise<void> {
  await db.insert(guilds).values({ id: guildId }).onConflictDoNothing();
}

export async function getGuildSettings(db: Database, guildId: string): Promise<GuildSettings> {
  const [row] = await db
    .select({
      defaultChannelId: guilds.defaultChannelId,
      defaultPingRoleId: guilds.defaultPingRoleId,
      autoPublish: guilds.autoPublish,
      showThumbnail: guilds.showThumbnail,
    })
    .from(guilds)
    .where(eq(guilds.id, guildId));
  return row ?? { ...DEFAULTS };
}

export async function updateGuildSettings(
  db: Database,
  guildId: string,
  changes: Partial<GuildSettings>,
): Promise<GuildSettings> {
  await db
    .insert(guilds)
    .values({ id: guildId, ...changes })
    .onConflictDoUpdate({ target: guilds.id, set: { ...changes, updatedAt: new Date() } });
  return getGuildSettings(db, guildId);
}

/** Removes everything Patchr stored for a server. Feeds, posts and drafts cascade. */
export async function deleteGuild(db: Database, guildId: string): Promise<void> {
  await db.delete(guilds).where(eq(guilds.id, guildId));
}

export interface GuildCleanup {
  remove: string[];
  /** True when the cleanup looked wrong and was skipped. */
  refused: boolean;
}

/** Above this many servers, a cleanup may remove at most a quarter of them at once. */
const CLEANUP_GUARD_MIN = 10;
const CLEANUP_GUARD_SHARE = 0.25;

/**
 * Works out which servers removed Patchr while it was offline. If the list looks wrong (say, the
 * token belongs to a different bot than the one the database was built for), it refuses rather
 * than deleting most of the data.
 */
export function planGuildCleanup(stored: string[], present: ReadonlySet<string>): GuildCleanup {
  const remove = stored.filter((id) => !present.has(id));
  const suspicious = stored.length > CLEANUP_GUARD_MIN && remove.length / stored.length > CLEANUP_GUARD_SHARE;
  return suspicious ? { remove: [], refused: true } : { remove, refused: false };
}

export async function removeDepartedGuilds(
  db: Database,
  present: ReadonlySet<string>,
): Promise<GuildCleanup> {
  const stored = await db.select({ id: guilds.id }).from(guilds);
  const plan = planGuildCleanup(
    stored.map((row) => row.id),
    present,
  );
  if (plan.remove.length > 0) await db.delete(guilds).where(inArray(guilds.id, plan.remove));
  return plan;
}
