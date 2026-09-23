import { describe, expect, it } from 'vitest';
import { syncCommands } from '../../src/discord/command-sync.js';
import { type EmojiManagerLike, syncEmojis } from '../../src/discord/emoji-sync.js';
import { useTestDatabase } from '../helpers/db.js';
import { silentLog } from '../helpers/fakes.js';

const ctx = useTestDatabase();

function fakeRest() {
  const puts: { route: string; body: unknown }[] = [];
  return {
    puts,
    async put(route: `/${string}`, options: { body?: unknown } = {}) {
      puts.push({ route, body: options.body });
      return [];
    },
  };
}

const commands = [{ name: 'help', description: 'What Patchr does' }];

describe('syncCommands', () => {
  it('registers global commands the first time', async () => {
    const rest = fakeRest();
    expect(await syncCommands({ db: ctx.db, rest, applicationId: 'app', commands, log: silentLog })).toBe(
      true,
    );
    expect(rest.puts).toEqual([{ route: '/applications/app/commands', body: commands }]);
  });

  it('skips registration when nothing changed', async () => {
    const rest = fakeRest();
    await syncCommands({ db: ctx.db, rest, applicationId: 'app', commands, log: silentLog });
    expect(await syncCommands({ db: ctx.db, rest, applicationId: 'app', commands, log: silentLog })).toBe(
      false,
    );
    expect(rest.puts).toHaveLength(1);
  });

  it('registers again when a command changes', async () => {
    const rest = fakeRest();
    await syncCommands({ db: ctx.db, rest, applicationId: 'app', commands, log: silentLog });
    const changed = [{ name: 'help', description: 'Changed' }];
    expect(
      await syncCommands({ db: ctx.db, rest, applicationId: 'app', commands: changed, log: silentLog }),
    ).toBe(true);
    expect(rest.puts).toHaveLength(2);
  });

  it('registers per guild in development, tracked separately', async () => {
    const rest = fakeRest();
    await syncCommands({ db: ctx.db, rest, applicationId: 'app', commands, log: silentLog });
    await syncCommands({ db: ctx.db, rest, applicationId: 'app', guildId: 'dev', commands, log: silentLog });
    expect(rest.puts.map((p) => p.route)).toEqual([
      '/applications/app/commands',
      '/applications/app/guilds/dev/commands',
    ]);
  });
});

function fakeEmojiManager(existing: string[] = []) {
  let nextId = 1;
  const emoji = (name: string) => {
    const id = String(nextId++);
    return { id, name, toString: () => `<:${name}:${id}>` };
  };
  const store = new Map(
    existing.map((name) => {
      const e = emoji(name);
      return [e.id, e];
    }),
  );
  const created: string[] = [];
  const manager: EmojiManagerLike = {
    async fetch() {
      return store;
    },
    async create({ name }) {
      created.push(name);
      const e = emoji(name);
      store.set(e.id, e);
      return e;
    },
  };
  return { manager, created };
}

describe('syncEmojis', () => {
  it('uploads missing brand emojis and returns them for rendering', async () => {
    const { manager, created } = fakeEmojiManager(['patchr_fix']);
    const emojis = await syncEmojis(manager, silentLog);
    expect(created.sort()).toEqual(['patchr', 'patchr_change', 'patchr_new']);
    expect(emojis).toEqual({
      patchr: expect.stringMatching(/^<:patchr:\d+>$/),
      new: expect.stringMatching(/^<:patchr_new:\d+>$/),
      fix: '<:patchr_fix:1>',
      change: expect.stringMatching(/^<:patchr_change:\d+>$/),
    });
  });

  it('keeps going without the emojis it could not upload', async () => {
    const { manager } = fakeEmojiManager();
    manager.create = async () => {
      throw new Error('Maximum number of emojis reached');
    };
    expect(await syncEmojis(manager, silentLog)).toEqual({});
  });
});
