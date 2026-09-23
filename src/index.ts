import { readFileSync } from 'node:fs';
import { ChannelType, Events } from 'discord.js';
import type { App } from './app.js';
import { commands, componentHandlers } from './commands/index.js';
import { loadConfig } from './config.js';
import { Deliverer } from './core/deliver.js';
import { openDatabase } from './db/client.js';
import { createClient } from './discord/client.js';
import { syncCommands } from './discord/command-sync.js';
import { type BrandEmojis, syncEmojis } from './discord/emoji-sync.js';
import { createRouter } from './interactions/router.js';
import { startHealthServer } from './lib/health.js';
import { createLogger } from './lib/logger.js';
import { GitHubApi } from './sources/github/api.js';
import { GitHubPoller } from './sources/github/poller.js';
import { pruneExpiredDrafts } from './store/drafts.js';
import { pauseFeedsForChannel } from './store/feeds.js';
import { deleteGuild, removeDepartedGuilds } from './store/guilds.js';

const HOUSEKEEPING_MS = 10 * 60_000;

async function main(): Promise<void> {
  const config = loadConfig();
  const log = createLogger(config.LOG_LEVEL);
  const version = readVersion();
  log.info({ version }, 'starting Patchr');
  if (!config.GITHUB_TOKEN) log.warn('GITHUB_TOKEN is not set, so GitHub allows only 60 requests an hour');

  // Migrations run before Discord connects, so a new version never runs against an old schema.
  const database = await openDatabase({ url: config.DATABASE_URL, dataDir: config.PGLITE_DIR });
  const { db } = database;
  log.info({ database: database.kind }, 'database ready');

  const client = createClient();
  let emojis: BrandEmojis = {};

  const github = new GitHubApi({
    token: config.GITHUB_TOKEN,
    userAgent: `Patchr/${version} (+${config.REPO_URL})`,
  });
  const deliverer = new Deliverer({
    db,
    rest: client.rest,
    log: log.child({ module: 'deliver' }),
    emojis: () => emojis,
    isAnnouncementChannel: async (channelId) => {
      const channel =
        client.channels.cache.get(channelId) ?? (await client.channels.fetch(channelId).catch(() => null));
      return channel?.type === ChannelType.GuildAnnouncement;
    },
  });
  const poller = new GitHubPoller({
    db,
    api: github,
    deliverer,
    log: log.child({ module: 'poller' }),
    intervalMs: config.POLL_INTERVAL_SECONDS * 1000,
  });

  const app: App = { config, db, deliverer, github, log, version, emojis: () => emojis };
  const route = createRouter(commands, componentHandlers, app);

  client.on(Events.InteractionCreate, (interaction) => {
    route(interaction).catch((error: unknown) => log.error({ err: error }, 'router failed'));
  });

  client.on(Events.GuildDelete, (guild) => {
    // An outage also removes a guild from the cache; only a real removal deletes its data.
    if (!guild.available) return;
    deleteGuild(db, guild.id)
      .then(() => log.info({ guildId: guild.id }, 'removed from a server; deleted its data'))
      .catch((error: unknown) => log.error({ err: error, guildId: guild.id }, 'could not delete guild data'));
  });

  client.on(Events.ChannelDelete, (channel) => {
    if (channel.isDMBased()) return;
    pauseFeedsForChannel(db, channel.id, 'unknown_channel').catch((error: unknown) =>
      log.error({ err: error, channelId: channel.id }, 'could not pause feeds'),
    );
  });

  client.on(Events.Error, (error) => log.error({ err: error }, 'discord client error'));
  client.on(Events.Warn, (message) => log.warn(message));

  client.once(Events.ClientReady, (ready) => {
    log.info({ user: ready.user.tag, guilds: ready.guilds.cache.size }, 'connected to Discord');
    const setup = async () => {
      // Servers that removed Patchr while it was offline never sent a guildDelete, so catch them here.
      // Only safe when this process holds every shard (no ShardingManager), i.e. sees every server.
      if (ready.shard === null) {
        const cleanup = await removeDepartedGuilds(db, new Set(ready.guilds.cache.keys()));
        if (cleanup.refused)
          log.warn('skipped cleanup: too many servers looked removed; is this the right token?');
        else if (cleanup.remove.length > 0)
          log.info({ count: cleanup.remove.length }, 'deleted data for departed servers');
      }
      emojis = await syncEmojis(ready.application.emojis, log);
      await syncCommands({
        db,
        rest: client.rest,
        applicationId: ready.application.id,
        guildId: config.DEV_GUILD_ID,
        commands: commands.map((command) => command.data),
        log,
      });
    };
    setup()
      .catch((error: unknown) => log.error({ err: error }, 'startup sync failed'))
      .finally(() => poller.start());
  });

  const health = config.HEALTH_PORT
    ? startHealthServer(config.HEALTH_PORT, () => ({ ok: client.isReady(), version, ping: client.ws.ping }))
    : undefined;

  const housekeeping = setInterval(() => {
    pruneExpiredDrafts(db).catch((error: unknown) => log.warn({ err: error }, 'draft cleanup failed'));
  }, HOUSEKEEPING_MS);
  housekeeping.unref();

  let stopping = false;
  /**
   * Stops everything in order and lets the process end by itself. Calling process.exit() while the
   * database is still closing its handles crashes Node on Windows, so it's only a last resort.
   */
  const shutdown = async (reason: string, exitCode: number) => {
    if (stopping) return;
    stopping = true;
    process.exitCode = exitCode;
    log.info({ reason }, 'shutting down');
    setTimeout(() => process.exit(), 10_000).unref();

    clearInterval(housekeeping);
    await poller.stop();
    health?.close();
    await client.destroy();
    await database.close();
  };
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      shutdown(signal, 0).catch((error: unknown) => log.error({ err: error }, 'shutdown failed'));
    });
  }
  process.on('unhandledRejection', (reason) => log.error({ err: reason }, 'unhandled rejection'));

  try {
    await client.login(config.DISCORD_TOKEN);
  } catch (error) {
    log.fatal({ err: error }, 'could not log in to Discord; check DISCORD_TOKEN');
    await shutdown('login failed', 1);
  }
}

function readVersion(): string {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
    version: string;
  };
  return `v${pkg.version}`;
}

main().catch((error: unknown) => {
  // Before the logger exists (bad config, unreachable database), stderr is all there is.
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
