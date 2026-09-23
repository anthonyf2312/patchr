import { createHash } from 'node:crypto';
import { Routes } from 'discord.js';
import { eq } from 'drizzle-orm';
import type { Logger } from 'pino';
import type { Database } from '../db/client.js';
import { meta } from '../db/schema.js';

export interface CommandSyncOptions {
  db: Database;
  rest: { put(route: `/${string}`, options?: { body?: unknown }): Promise<unknown> };
  applicationId: string;
  /** Set in development: commands register in this server only and show up instantly. */
  guildId?: string | undefined;
  commands: unknown[];
  log: Logger;
}

/**
 * Registers slash commands, but only when their definitions changed since the last run.
 * Deploys therefore never need a separate "deploy commands" step, and restarts don't use up rate limits.
 */
export async function syncCommands(options: CommandSyncOptions): Promise<boolean> {
  const scope = options.guildId ? `guild:${options.guildId}` : 'global';
  const key = `commands:${options.applicationId}:${scope}`;
  const hash = createHash('sha256').update(JSON.stringify(options.commands)).digest('hex');

  const [stored] = await options.db.select().from(meta).where(eq(meta.key, key));
  if (stored?.value === hash) return false;

  const route = options.guildId
    ? Routes.applicationGuildCommands(options.applicationId, options.guildId)
    : Routes.applicationCommands(options.applicationId);
  await options.rest.put(route, { body: options.commands });

  await options.db
    .insert(meta)
    .values({ key, value: hash })
    .onConflictDoUpdate({ target: meta.key, set: { value: hash, updatedAt: new Date() } });
  options.log.info({ scope, count: options.commands.length }, 'registered commands');
  return true;
}
