import { and, eq, gt, lte } from 'drizzle-orm';
import type { PatchNote } from '../core/patch-note.js';
import type { Database } from '../db/client.js';
import { drafts } from '../db/schema.js';
import { ensureGuild } from './guilds.js';
import { isUuid } from './uuid.js';

export type Draft = typeof drafts.$inferSelect;

/** Matches how long Discord keeps an interaction's buttons usable. */
const DRAFT_TTL_MS = 15 * 60_000;

export interface NewDraft {
  guildId: string;
  userId: string;
  channelId: string;
  pingRoleId: string | null;
  note: PatchNote;
}

export async function createDraft(db: Database, input: NewDraft): Promise<string> {
  await ensureGuild(db, input.guildId);
  const [row] = await db
    .insert(drafts)
    .values({
      ...input,
      ping: input.pingRoleId !== null,
      expiresAt: new Date(Date.now() + DRAFT_TTL_MS),
    })
    .returning({ id: drafts.id });
  if (!row) throw new Error('draft was not created');
  return row.id;
}

export async function getDraft(db: Database, id: string, now = new Date()): Promise<Draft | undefined> {
  if (!isUuid(id)) return undefined;
  const [row] = await db
    .select()
    .from(drafts)
    .where(and(eq(drafts.id, id), gt(drafts.expiresAt, now)));
  return row;
}

/** Saves changes and restarts the expiry clock. */
export async function updateDraft(
  db: Database,
  id: string,
  changes: Partial<Pick<Draft, 'ping' | 'note'>>,
): Promise<void> {
  await db
    .update(drafts)
    .set({ ...changes, expiresAt: new Date(Date.now() + DRAFT_TTL_MS) })
    .where(eq(drafts.id, id));
}

export async function deleteDraft(db: Database, id: string): Promise<void> {
  if (!isUuid(id)) return;
  await db.delete(drafts).where(eq(drafts.id, id));
}

export async function pruneExpiredDrafts(db: Database, now = new Date()): Promise<number> {
  const deleted = await db.delete(drafts).where(lte(drafts.expiresAt, now)).returning({ id: drafts.id });
  return deleted.length;
}
