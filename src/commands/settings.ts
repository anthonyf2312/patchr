import {
  ApplicationIntegrationType,
  ChannelType,
  ComponentType,
  InteractionContextType,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import { checkPingRole, checkPostChannel } from '../discord/targets.js';
import type { Command } from '../interactions/types.js';
import { EPHEMERAL_V2, privateNotice, text } from '../interactions/ui.js';
import { type GuildSettings, getGuildSettings, updateGuildSettings } from '../store/guilds.js';
import { strings } from '../strings.js';

export const settingsCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('settings')
    .setDescription("See or change Patchr's defaults for this server")
    .setContexts(InteractionContextType.Guild)
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption((o) =>
      o
        .setName('channel')
        .setDescription('Default channel for /patch')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
    )
    .addRoleOption((o) => o.setName('ping').setDescription('Default role to ping for /patch'))
    .addBooleanOption((o) => o.setName('clear-ping').setDescription('Stop pinging a role by default'))
    .addBooleanOption((o) =>
      o.setName('auto-publish').setDescription('Publish posts in announcement channels (default: on)'),
    )
    .addBooleanOption((o) =>
      o
        .setName('thumbnail')
        .setDescription("Show the repo owner's avatar or the server icon on posts (default: on)"),
    )
    .toJSON(),

  async chatInput(interaction, app) {
    const changes: Partial<GuildSettings> = {};
    const warnings: string[] = [];

    const current = await getGuildSettings(app.db, interaction.guildId);

    const channelId = interaction.options.getChannel('channel')?.id;
    if (channelId) {
      const target = await checkPostChannel(interaction.guild, channelId, { member: interaction.member });
      if (!target.ok) {
        await interaction.reply(privateNotice(target.message));
        return;
      }
      changes.defaultChannelId = channelId;
    }

    const roleId = interaction.options.getRole('ping')?.id;
    if (roleId) {
      if (roleId === interaction.guildId) {
        await interaction.reply(privateNotice(strings.ping.everyone));
        return;
      }
      changes.defaultPingRoleId = roleId;

      // Whether the role will actually ping depends on the channel, so check it against the default one.
      const checkIn = channelId ?? current.defaultChannelId;
      const target = checkIn ? await checkPostChannel(interaction.guild, checkIn) : undefined;
      if (target?.ok) {
        const role = await checkPingRole(interaction.guild, roleId, target.channel, interaction.member);
        if (!role.ok) {
          await interaction.reply(privateNotice(role.message));
          return;
        }
        if (role.warning) warnings.push(role.warning);
      }
    }
    if (interaction.options.getBoolean('clear-ping')) changes.defaultPingRoleId = null;

    const autoPublish = interaction.options.getBoolean('auto-publish');
    if (autoPublish !== null) changes.autoPublish = autoPublish;

    const thumbnail = interaction.options.getBoolean('thumbnail');
    if (thumbnail !== null) changes.showThumbnail = thumbnail;

    const changed = Object.keys(changes).length > 0;
    const settings = changed ? await updateGuildSettings(app.db, interaction.guildId, changes) : current;

    const lines = [
      strings.settings.title,
      strings.settings.summary(
        settings.defaultChannelId,
        settings.defaultPingRoleId,
        settings.autoPublish,
        settings.showThumbnail,
      ),
      ...warnings,
    ];
    if (changed) lines.push(strings.settings.saved);

    await interaction.reply({
      flags: EPHEMERAL_V2,
      components: [{ type: ComponentType.Container, components: [text(lines.join('\n'))] }],
      allowedMentions: { parse: [] },
    });
  },
};
