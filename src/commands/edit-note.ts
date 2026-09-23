import {
  ApplicationCommandType,
  ApplicationIntegrationType,
  ContextMenuCommandBuilder,
  InteractionContextType,
  PermissionFlagsBits,
} from 'discord.js';
import type { Command } from '../interactions/types.js';
import { customId, privateNotice } from '../interactions/ui.js';
import { findPostByMessage } from '../store/posts.js';
import { strings } from '../strings.js';
import { fieldsOf, noteModal } from './note-modal.js';

/** Right-click a Patchr post → Apps → Edit patch note. The modal is handled by `patchModals` (`patch:edit`). */
export const editNoteCommand: Command = {
  data: new ContextMenuCommandBuilder()
    .setName('Edit patch note')
    .setType(ApplicationCommandType.Message)
    .setContexts(InteractionContextType.Guild)
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .toJSON(),

  async messageContextMenu(interaction, app) {
    const message = interaction.targetMessage;
    const post =
      message.author.id === interaction.client.user.id
        ? await findPostByMessage(app.db, interaction.guildId, message.id)
        : undefined;

    if (!post) {
      await interaction.reply(privateNotice(strings.editNote.notPatchr));
      return;
    }
    if (post.kind === 'github') {
      await interaction.reply(privateNotice(strings.editNote.fromGithub));
      return;
    }

    await interaction.showModal(
      noteModal(customId('patch', 'edit', post.id), strings.patch.editModalTitle, fieldsOf(post.note)),
    );
  },
};
