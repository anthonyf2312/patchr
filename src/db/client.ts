import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import * as schema from './schema.js';

/** Either driver: Postgres in production, PGlite (in-process Postgres) for local runs and tests. */
export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;

export interface DatabaseHandle {
  db: Database;
  kind: 'postgres' | 'pglite';
  close: () => Promise<void>;
}

const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));

/**
 * Opens the database and applies any pending migrations.
 * With a `url` it connects to Postgres. Without one it runs PGlite, stored in `dataDir`,
 * or in memory when `dataDir` is `memory://`.
 */
export async function openDatabase(options: { url?: string; dataDir?: string }): Promise<DatabaseHandle> {
  if (options.url) {
    const { default: postgres } = await import('postgres');
    const { drizzle } = await import('drizzle-orm/postgres-js');
    const { migrate } = await import('drizzle-orm/postgres-js/migrator');

    const client = postgres(options.url, { max: 10, onnotice: () => {} });
    const db = drizzle({ client, schema });
    await migrate(db, { migrationsFolder });
    return { db, kind: 'postgres', close: () => client.end({ timeout: 5 }) };
  }

  const { PGlite } = await import('@electric-sql/pglite');
  const { drizzle } = await import('drizzle-orm/pglite');
  const { migrate } = await import('drizzle-orm/pglite/migrator');

  const dataDir = options.dataDir ?? './data/pglite';
  if (!dataDir.startsWith('memory://')) mkdirSync(dataDir, { recursive: true });
  const client = new PGlite(dataDir);
  const db = drizzle({ client, schema });
  await migrate(db, { migrationsFolder });
  return { db, kind: 'pglite', close: () => client.close() };
}
