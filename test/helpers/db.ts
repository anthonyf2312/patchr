import { afterEach, beforeEach } from 'vitest';
import { type Database, type DatabaseHandle, openDatabase } from '../../src/db/client.js';

/** A fresh in-memory database per test, migrated like production. */
export function useTestDatabase(): { readonly db: Database } {
  let handle: DatabaseHandle | undefined;

  beforeEach(async () => {
    handle = await openDatabase({ dataDir: 'memory://' });
  });

  afterEach(async () => {
    await handle?.close();
    handle = undefined;
  });

  return {
    get db() {
      if (!handle) throw new Error('database is only available inside a test');
      return handle.db;
    },
  };
}
