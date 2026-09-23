import { describe, expect, it } from 'vitest';
import { guilds } from '../../src/db/schema.js';
import { planGuildCleanup, removeDepartedGuilds } from '../../src/store/guilds.js';
import { useTestDatabase } from '../helpers/db.js';

describe('planGuildCleanup', () => {
  it('removes servers Patchr is no longer in', () => {
    expect(planGuildCleanup(['a', 'b', 'c'], new Set(['a', 'b']))).toEqual({ remove: ['c'], refused: false });
  });

  it('refuses to remove a large share of servers at once', () => {
    const stored = Array.from({ length: 20 }, (_, i) => `g${i}`);
    expect(planGuildCleanup(stored, new Set(['g0']))).toEqual({ remove: [], refused: true });
  });

  it('allows small instances to clean up freely', () => {
    expect(planGuildCleanup(['a', 'b'], new Set())).toEqual({ remove: ['a', 'b'], refused: false });
  });
});

describe('removeDepartedGuilds', () => {
  const ctx = useTestDatabase();

  it('deletes data for servers that removed Patchr while it was offline', async () => {
    await ctx.db.insert(guilds).values([{ id: 'a' }, { id: 'b' }]);
    const result = await removeDepartedGuilds(ctx.db, new Set(['a']));
    expect(result).toEqual({ remove: ['b'], refused: false });
    expect((await ctx.db.select().from(guilds)).map((g) => g.id)).toEqual(['a']);
  });
});
