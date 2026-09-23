import { and, eq } from 'drizzle-orm';
import type { Post } from '../core/deliver.js';
import type { Database } from '../db/client.js';
import { posts } from '../db/schema.js';
import { isUuid } from './uuid.js';

/** The post behind a Discord message, if Patchr sent it in this server. */
export async function findPostByMessage(
  db: Database,
  guildId: string,
  messageId: string,
): Promise<Post | undefined> {
  const [row] = await db
    .select()
    .from(posts)
    .where(and(eq(posts.guildId, guildId), eq(posts.messageId, messageId)));
  return row;
}

export async function getPost(db: Database, guildId: string, postId: string): Promise<Post | undefined> {
  if (!isUuid(postId)) return undefined;
  const [row] = await db
    .select()
    .from(posts)
    .where(and(eq(posts.guildId, guildId), eq(posts.id, postId)));
  return row;
}
