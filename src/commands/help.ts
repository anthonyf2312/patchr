import {
  ApplicationIntegrationType,
  ComponentType,
  InteractionContextType,
  SeparatorSpacingSize,
  SlashCommandBuilder,
} from 'discord.js';
import { BRAND_COLOR } from '../core/limits.js';
import type { Command } from '../interactions/types.js';
import { EPHEMERAL_V2, text } from '../interactions/ui.js';
import { strings } from '../strings.js';

export const helpCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('What Patchr does and how to use it')
    .setContexts(InteractionContextType.Guild)
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
    .toJSON(),

  async chatInput(interaction, app) {
    const mark = app.emojis()?.patchr;
    await interaction.reply({
      flags: EPHEMERAL_V2,
      components: [
        {
          type: ComponentType.Container,
          accent_color: BRAND_COLOR,
          components: [
            text(
              mark
                ? strings.help.body(app.config.MAX_FEEDS_PER_GUILD).replace('## Patchr', `## ${mark} Patchr`)
                : strings.help.body(app.config.MAX_FEEDS_PER_GUILD),
            ),
            { type: ComponentType.Separator, divider: true, spacing: SeparatorSpacingSize.Small },
            text(
              strings.help.footer(
                app.version,
                app.config.WEBSITE_URL,
                app.config.REPO_URL,
                app.config.SUPPORT_URL,
              ),
            ),
          ],
        },
      ],
      allowedMentions: { parse: [] },
    });
  },
};
