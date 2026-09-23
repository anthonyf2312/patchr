import { describe, expect, it } from 'vitest';
import { guilds } from '../../src/db/schema.js';
import { useTestDatabase } from '../helpers/db.js';

describe('openDatabase', () => {
  const ctx = useTestDatabase();

  it('applies migrations so the tables exist', async () => {
    await ctx.db.insert(guilds).values({ id: '1' });
    const rows = await ctx.db.select().from(guilds);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.autoPublish).toBe(true);
  });
});
