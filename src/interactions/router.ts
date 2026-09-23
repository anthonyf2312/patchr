import { randomBytes } from 'node:crypto';
import type { Interaction } from 'discord.js';
import type { App } from '../app.js';
import { strings } from '../strings.js';
import type { Command, ComponentHandler } from './types.js';
import { EPHEMERAL_V2, notice, parseCustomId, privateNotice } from './ui.js';

/** Sends each interaction to its handler. Failures are logged with a short code the user can report. */
export function createRouter(commands: Command[], components: ComponentHandler[], app: App) {
  const byName = new Map(commands.map((command) => [command.data.name, command]));
  const byNamespace = new Map(components.map((handler) => [handler.namespace, handler]));

  return async function route(interaction: Interaction): Promise<void> {
    if (!interaction.inCachedGuild()) {
      if (interaction.isRepliable()) await interaction.reply(privateNotice(strings.generic.guildOnly));
      return;
    }

    try {
      if (interaction.isChatInputCommand()) {
        await byName.get(interaction.commandName)?.chatInput?.(interaction, app);
      } else if (interaction.isMessageContextMenuCommand()) {
        await byName.get(interaction.commandName)?.messageContextMenu?.(interaction, app);
      } else if (interaction.isAutocomplete()) {
        await byName.get(interaction.commandName)?.autocomplete?.(interaction, app);
      } else if (interaction.isButton()) {
        const { namespace, action, args } = parseCustomId(interaction.customId);
        await byNamespace.get(namespace)?.button?.(interaction, app, action, args);
      } else if (interaction.isModalSubmit()) {
        const { namespace, action, args } = parseCustomId(interaction.customId);
        await byNamespace.get(namespace)?.modal?.(interaction, app, action, args);
      }
    } catch (error) {
      const code = randomBytes(3).toString('hex');
      app.log.error({ err: error, code, interaction: describe(interaction) }, 'interaction failed');
      if (!interaction.isRepliable()) return;
      const message = { ...notice(strings.generic.error(code)), flags: EPHEMERAL_V2 };
      const send =
        interaction.deferred || interaction.replied
          ? interaction.followUp(message)
          : interaction.reply(message);
      await send.catch((replyError: unknown) =>
        app.log.warn({ err: replyError, code }, 'could not report error'),
      );
    }
  };
}

function describe(interaction: Interaction): string {
  if ('commandName' in interaction) return `command:${interaction.commandName}`;
  if ('customId' in interaction) return `component:${interaction.customId}`;
  return 'interaction';
}
