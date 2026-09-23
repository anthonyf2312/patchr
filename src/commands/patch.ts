import {
  type APIActionRowComponent,
  type APIButtonComponent,
  ApplicationIntegrationType,
  ButtonStyle,
  ChannelType,
  ComponentType,
  type Guild,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import type { App } from '../app.js';
import { showThumbnail } from '../core/deliver.js';
import { noteHash } from '../core/hash.js';
import { renderCard } from '../core/render/card.js';
import { checkPingRole, checkPostChannel } from '../discord/targets.js';
import type { Command, ComponentHandler } from '../interactions/types.js';
import { customId, EPHEMERAL_V2, jumpUrl, notice, privateNotice, text } from '../interactions/ui.js';
import { createDraft, type Draft, deleteDraft, getDraft, updateDraft } from '../store/drafts.js';
import { getGuildSettings } from '../store/guilds.js';
import { getPost } from '../store/posts.js';
import { strings } from '../strings.js';
import { fieldsOf, manualNote, noteModal, readNoteFields, withFields } from './note-modal.js';

const NO_ROLE = '-';

export const patchCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('patch')
    .setDescription('Write patch notes and post them')
    .setContexts(InteractionContextType.Guild)
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption((option) =>
      option
        .setName('channel')
        .setDescription('Where to post (defaults to the channel set in /settings)')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
    )
    .addRoleOption((option) =>
      option.setName('ping').setDescription('Role to ping (defaults to the role set in /settings)'),
    )
    .toJSON(),

  async chatInput(interaction, app) {
    const settings = await getGuildSettings(app.db, interaction.guildId);
    const chosen = interaction.options.getChannel('channel');
    const channelId = chosen?.id ?? settings.defaultChannelId;
    if (!channelId) {
      await interaction.reply(privateNotice(strings.channel.none));
      return;
    }

    const target = await checkPostChannel(interaction.guild, channelId, {
      member: interaction.member,
      missingMessage: chosen ? strings.channel.deleted : strings.channel.gone,
    });
    if (!target.ok) {
      await interaction.reply(privateNotice(target.message));
      return;
    }

    const roleId = interaction.options.getRole('ping')?.id ?? settings.defaultPingRoleId;
    if (roleId) {
      const role = await checkPingRole(interaction.guild, roleId, target.channel, interaction.member);
      if (!role.ok) {
        await interaction.reply(privateNotice(role.message));
        return;
      }
    }

    await interaction.showModal(
      noteModal(customId('patch', 'new', channelId, roleId ?? NO_ROLE), strings.patch.modalTitle),
    );
  },
};

/** Modals: `patch:new:<channel>:<role>`, `patch:draft:<draft>` (editing a preview) and `patch:edit:<post>`. */
export const patchModals: ComponentHandler = {
  namespace: 'patch',

  async modal(interaction, app, action, args) {
    const fields = readNoteFields(interaction);

    if (action === 'new') {
      const [channelId = '', roleId = NO_ROLE] = args;
      const note = manualNote(interaction.guild, fields, {
        id: interaction.user.id,
        name: interaction.member.displayName,
      });
      const draftId = await createDraft(app.db, {
        guildId: interaction.guildId,
        userId: interaction.user.id,
        channelId,
        pingRoleId: roleId === NO_ROLE ? null : roleId,
        note,
      });
      const draft = await getDraft(app.db, draftId);
      if (!draft) throw new Error('draft vanished right after it was created');
      await interaction.reply({ ...(await preview(draft, interaction.guild, app)), flags: EPHEMERAL_V2 });
      return;
    }

    if (action === 'draft') {
      const [draftId = ''] = args;
      const draft = await getDraft(app.db, draftId);
      if (!draft || !interaction.isFromMessage()) {
        await interaction.reply(privateNotice(strings.patch.expired));
        return;
      }
      await updateDraft(app.db, draft.id, { note: withFields(draft.note, fields) });
      const updated = await getDraft(app.db, draft.id);
      if (!updated) throw new Error('draft vanished during an edit');
      await interaction.update(await preview(updated, interaction.guild, app));
      return;
    }

    if (action === 'edit') {
      const [postId = ''] = args;
      const post = await getPost(app.db, interaction.guildId, postId);
      if (post?.kind !== 'manual') {
        await interaction.reply(privateNotice(strings.editNote.notPatchr));
        return;
      }
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const note = withFields(post.note, fields);
      const result = await app.deliverer.editPost(post, note, noteHash(note));
      const message =
        result === 'edited'
          ? strings.editNote.updated
          : result === 'gone'
            ? strings.editNote.gone
            : strings.editNote.failed;
      await interaction.editReply(notice(message));
    }
  },
};

/** Preview buttons: `draft:<post|edit|ping|cancel>:<draft>`. */
export const draftButtons: ComponentHandler = {
  namespace: 'draft',

  async button(interaction, app, action, args) {
    const [draftId = ''] = args;
    const draft = await getDraft(app.db, draftId);
    if (!draft) {
      await interaction.update(notice(strings.patch.expired));
      return;
    }
    if (draft.userId !== interaction.user.id) {
      await interaction.reply(privateNotice(strings.patch.notYours));
      return;
    }

    switch (action) {
      case 'post': {
        await interaction.deferUpdate();
        const target = await checkPostChannel(interaction.guild, draft.channelId, {
          member: interaction.member,
        });
        if (!target.ok) {
          await interaction.editReply(await preview(draft, interaction.guild, app, target.message));
          return;
        }

        const result = await app.deliverer.postManual(
          {
            guildId: draft.guildId,
            channelId: draft.channelId,
            pingRoleId: draft.ping ? draft.pingRoleId : null,
            createdBy: draft.userId,
          },
          { ...draft.note, publishedAt: new Date().toISOString() },
        );

        if (result.kind === 'sent') {
          await deleteDraft(app.db, draft.id);
          const url = jumpUrl(draft.guildId, draft.channelId, result.messageId);
          await interaction.editReply(notice(strings.patch.posted(url, draft.channelId)));
          return;
        }
        const problem =
          result.kind === 'failed' && !result.retryable
            ? strings.channel.missing(draft.channelId, ['View Channel', 'Send Messages', 'Embed Links'])
            : strings.patch.retry;
        await interaction.editReply(await preview(draft, interaction.guild, app, problem));
        return;
      }

      case 'edit':
        await interaction.showModal(
          noteModal(customId('patch', 'draft', draft.id), strings.patch.editModalTitle, fieldsOf(draft.note)),
        );
        return;

      case 'ping': {
        await updateDraft(app.db, draft.id, { ping: !draft.ping });
        const updated = await getDraft(app.db, draft.id);
        if (updated) await interaction.update(await preview(updated, interaction.guild, app));
        return;
      }

      case 'cancel':
        await deleteDraft(app.db, draft.id);
        await interaction.update(notice(strings.patch.discarded));
        return;
    }
  },
};

/** The private preview: a header, the card exactly as it will look, and the controls. */
async function preview(draft: Draft, guild: Guild, app: App, problem?: string) {
  const lines = [strings.patch.previewHeader(draft.channelId)];
  if (problem) lines.push(problem);

  if (draft.pingRoleId && draft.ping) {
    const channel = await checkPostChannel(guild, draft.channelId);
    if (channel.ok) {
      const role = await checkPingRole(guild, draft.pingRoleId, channel.channel);
      if (role.ok && role.warning) lines.push(role.warning);
    }
  }

  const header = lines.join('\n');
  const card = renderCard(draft.note, {
    emojis: app.emojis(),
    thumbnail: await showThumbnail(app.db, draft.guildId, null),
    reservedText: header.length,
    ...(draft.ping && draft.pingRoleId && { pingRoleId: draft.pingRoleId }),
  });

  const buttons: APIButtonComponent[] = [
    button('post', draft.id, strings.patch.post, ButtonStyle.Success),
    button('edit', draft.id, strings.patch.edit, ButtonStyle.Secondary),
  ];
  if (draft.pingRoleId) {
    const roleName = guild.roles.cache.get(draft.pingRoleId)?.name ?? 'role';
    const label = draft.ping ? strings.patch.pingOn(roleName) : strings.patch.pingOff(roleName);
    buttons.push(button('ping', draft.id, label.slice(0, 80), ButtonStyle.Secondary));
  }
  buttons.push(button('cancel', draft.id, strings.patch.cancel, ButtonStyle.Secondary));

  const controls: APIActionRowComponent<APIButtonComponent> = {
    type: ComponentType.ActionRow,
    components: buttons,
  };
  return {
    flags: MessageFlags.IsComponentsV2 as const,
    components: [text(header), ...card.components, controls],
    // A preview never pings, even though it shows the ping line.
    allowedMentions: { parse: [] },
  };
}

function button(
  action: string,
  draftId: string,
  label: string,
  style: ButtonStyle.Success | ButtonStyle.Secondary,
) {
  return { type: ComponentType.Button as const, custom_id: customId('draft', action, draftId), label, style };
}
