import {
  ApplicationIntegrationType,
  ButtonStyle,
  ChannelType,
  type ChatInputCommandInteraction,
  ComponentType,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import type { App } from '../app.js';
import { noteHash } from '../core/hash.js';
import { checkPingRole, checkPostChannel } from '../discord/targets.js';
import type { Command, ComponentHandler } from '../interactions/types.js';
import { customId, jumpUrl, notice, privateNotice, text } from '../interactions/ui.js';
import { parseRepoInput } from '../sources/github/repo-input.js';
import { type GitHubRelease, releaseToNote } from '../sources/github/to-note.js';
import {
  countFeeds,
  createGithubFeed,
  deleteFeed,
  type FeedWithRepo,
  getFeed,
  listFeeds,
  updateFeed,
} from '../store/feeds.js';
import { strings } from '../strings.js';

const postChannelTypes = [ChannelType.GuildText, ChannelType.GuildAnnouncement] as const;

const thumbnailChoices = [
  { name: 'On', value: 'on' },
  { name: 'Off', value: 'off' },
  { name: 'Server setting', value: 'server' },
];

/** The `thumbnail` option as stored: true, false, or null to follow the server. Undefined when not given. */
function thumbnailOption(interaction: ChatInputCommandInteraction<'cached'>): boolean | null | undefined {
  const value = interaction.options.getString('thumbnail');
  if (value === null) return undefined;
  return value === 'server' ? null : value === 'on';
}

export const feedCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('feed')
    .setDescription('Post releases automatically')
    .setContexts(InteractionContextType.Guild)
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommandGroup((group) =>
      group
        .setName('add')
        .setDescription('Start posting releases from a source')
        .addSubcommand((sub) =>
          sub
            .setName('github')
            .setDescription('Post new releases from a public GitHub repo')
            .addStringOption((o) =>
              o
                .setName('repo')
                .setDescription('owner/repo, or the repo URL')
                .setRequired(true)
                .setMaxLength(200),
            )
            .addChannelOption((o) =>
              o
                .setName('channel')
                .setDescription('Where releases are posted')
                .setRequired(true)
                .addChannelTypes(...postChannelTypes),
            )
            .addRoleOption((o) => o.setName('ping').setDescription('Role to ping for each release'))
            .addBooleanOption((o) =>
              o.setName('prereleases').setDescription('Post pre-releases too (default: no)'),
            )
            .addStringOption((o) =>
              o
                .setName('thumbnail')
                .setDescription("Show the owner's avatar on posts (default: server setting)")
                .addChoices(...thumbnailChoices),
            ),
        ),
    )
    .addSubcommand((sub) => sub.setName('list').setDescription("Show this server's feeds"))
    .addSubcommand((sub) =>
      sub
        .setName('edit')
        .setDescription("Change a feed, or resume one that's paused")
        .addStringOption((o) =>
          o.setName('feed').setDescription('The feed to change').setRequired(true).setAutocomplete(true),
        )
        .addChannelOption((o) =>
          o
            .setName('channel')
            .setDescription('Post somewhere else')
            .addChannelTypes(...postChannelTypes),
        )
        .addRoleOption((o) => o.setName('ping').setDescription('Role to ping for each release'))
        .addBooleanOption((o) => o.setName('clear-ping').setDescription('Stop pinging a role'))
        .addBooleanOption((o) => o.setName('prereleases').setDescription('Post pre-releases too'))
        .addStringOption((o) =>
          o
            .setName('thumbnail')
            .setDescription("Show the owner's avatar on posts")
            .addChoices(...thumbnailChoices),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('remove')
        .setDescription('Stop posting releases from a feed')
        .addStringOption((o) =>
          o.setName('feed').setDescription('The feed to remove').setRequired(true).setAutocomplete(true),
        ),
    )
    .toJSON(),

  async chatInput(interaction, app) {
    const group = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand();
    if (group === 'add' && sub === 'github') return addGithub(interaction, app);
    if (sub === 'list') return list(interaction, app);
    if (sub === 'edit') return edit(interaction, app);
    if (sub === 'remove') return remove(interaction, app);
  },

  async autocomplete(interaction, app) {
    const query = interaction.options.getFocused().toLowerCase();
    const choices = (await listFeeds(app.db, interaction.guildId))
      .map((feed) => ({
        name: feedLabel(feed, interaction.guild.channels.cache.get(feed.channelId)?.name),
        value: feed.id,
      }))
      .filter((choice) => choice.name.toLowerCase().includes(query))
      .slice(0, 25);
    await interaction.respond(choices);
  },
};

/** `feed:latest:<feed>` posts the newest release right away, to show the feed works. */
export const feedButtons: ComponentHandler = {
  namespace: 'feed',

  async button(interaction, app, action, args) {
    if (action !== 'latest') return;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const feed = await getFeed(app.db, interaction.guildId, args[0] ?? '');
    if (!feed?.repoName) {
      await interaction.editReply(notice(strings.feed.unknown));
      return;
    }

    const result = await app.github.listReleases(feed.repoName);
    if (result.kind !== 'ok') {
      await interaction.editReply(notice(strings.generic.githubDown));
      return;
    }

    const published = result.releases
      .filter((r): r is GitHubRelease & { published_at: string } => !r.draft && r.published_at !== null)
      .filter((r) => !r.prerelease || feed.includePrereleases)
      .sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at));
    const [latest, previous] = published;
    if (!latest) {
      await interaction.editReply(notice(strings.feed.noReleases));
      return;
    }

    const note = releaseToNote(
      latest,
      {
        fullName: feed.repoName,
        url: `https://github.com/${feed.repoName}`,
        ...(feed.repoAvatarUrl && { ownerAvatarUrl: feed.repoAvatarUrl }),
      },
      previous?.tag_name,
    );
    const delivery = await app.deliverer.deliverRelease(feed, `github:${latest.id}`, note, noteHash(note));

    switch (delivery.kind) {
      case 'sent':
        await interaction.editReply(
          notice(
            strings.feed.latestPosted(
              latest.tag_name,
              jumpUrl(feed.guildId, feed.channelId, delivery.messageId),
            ),
          ),
        );
        return;
      case 'skipped':
        await interaction.editReply(notice(strings.feed.latestAlready));
        return;
      case 'paused':
        await interaction.editReply(
          notice(strings.channel.missing(feed.channelId, ['View Channel', 'Send Messages', 'Embed Links'])),
        );
        return;
      case 'failed':
        await interaction.editReply(notice(strings.patch.retry));
        return;
    }
  },
};

async function addGithub(interaction: ChatInputCommandInteraction<'cached'>, app: App) {
  const ref = parseRepoInput(interaction.options.getString('repo', true));
  if (!ref) {
    await interaction.reply(privateNotice(strings.feed.invalidRepo));
    return;
  }

  const channelId = interaction.options.getChannel('channel', true, [...postChannelTypes]).id;
  const target = await checkPostChannel(interaction.guild, channelId, { member: interaction.member });
  if (!target.ok) {
    await interaction.reply(privateNotice(target.message));
    return;
  }

  const pingRoleId = interaction.options.getRole('ping')?.id ?? null;
  let warning: string | undefined;
  if (pingRoleId) {
    const role = await checkPingRole(interaction.guild, pingRoleId, target.channel, interaction.member);
    if (!role.ok) {
      await interaction.reply(privateNotice(role.message));
      return;
    }
    warning = role.warning;
  }

  if ((await countFeeds(app.db, interaction.guildId)) >= app.config.MAX_FEEDS_PER_GUILD) {
    await interaction.reply(privateNotice(strings.feed.limit(app.config.MAX_FEEDS_PER_GUILD)));
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const name = `${ref.owner}/${ref.name}`;
  const lookup = await app.github.getRepo(name);
  if (lookup.kind === 'gone' || (lookup.kind === 'ok' && lookup.repo.private)) {
    // Private repos are refused even if the token can see them, or any server could read them.
    await interaction.editReply(notice(strings.feed.notFound(name)));
    return;
  }
  if (lookup.kind !== 'ok') {
    await interaction.editReply(notice(strings.generic.githubDown));
    return;
  }

  const includePrereleases = interaction.options.getBoolean('prereleases') ?? false;
  const avatarUrl = await app.github.avatarUrl(lookup.repo.owner.avatar_url);
  const created = await createGithubFeed(app.db, {
    guildId: interaction.guildId,
    repo: lookup.repo,
    channelId,
    pingRoleId,
    includePrereleases,
    showThumbnail: thumbnailOption(interaction) ?? null,
    ...(avatarUrl && { avatarUrl }),
    createdBy: interaction.user.id,
  });
  if (created.kind === 'duplicate') {
    await interaction.editReply(notice(strings.feed.duplicate(lookup.repo.full_name, channelId)));
    return;
  }

  const message = [strings.feed.created(lookup.repo.full_name, channelId, pingRoleId, includePrereleases)];
  if (warning) message.push(warning);
  await interaction.editReply(
    notice(message.join('\n'), {
      type: ComponentType.ActionRow,
      components: [
        {
          type: ComponentType.Button,
          style: ButtonStyle.Secondary,
          custom_id: customId('feed', 'latest', created.feed.id),
          label: strings.feed.postLatest,
        },
      ],
    }),
  );
}

async function list(interaction: ChatInputCommandInteraction<'cached'>, app: App) {
  const feeds = await listFeeds(app.db, interaction.guildId);
  if (feeds.length === 0) {
    await interaction.reply(privateNotice(strings.feed.listEmpty));
    return;
  }

  const lines = feeds.flatMap((feed) => {
    const line = [
      strings.feed.listLine(
        feed.repoName ?? 'unknown repo',
        feed.channelId,
        feed.pingRoleId,
        feed.includePrereleases,
        feed.showThumbnail,
      ),
    ];
    if (feed.status === 'paused') {
      const reason = feed.pausedReason as keyof typeof strings.pauseReason | null;
      line.push(strings.feed.paused(reason ? strings.pauseReason[reason] : 'Patchr could not post'));
    }
    if (feed.repoStatus === 'unavailable') line.push(strings.feed.repoUnavailable);
    if (feed.repoStatus === 'private') line.push(strings.feed.repoPrivate);
    return line;
  });

  await interaction.reply({
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    components: [
      {
        type: ComponentType.Container,
        components: [text(`${strings.feed.listTitle}\n${lines.join('\n')}`.slice(0, 4000))],
      },
    ],
    allowedMentions: { parse: [] },
  });
}

async function edit(interaction: ChatInputCommandInteraction<'cached'>, app: App) {
  const feed = await getFeed(app.db, interaction.guildId, interaction.options.getString('feed', true));
  if (!feed) {
    await interaction.reply(privateNotice(strings.feed.unknown));
    return;
  }

  const channelId =
    interaction.options.getChannel('channel', false, [...postChannelTypes])?.id ?? feed.channelId;
  const target = await checkPostChannel(interaction.guild, channelId, { member: interaction.member });
  if (!target.ok) {
    await interaction.reply(privateNotice(target.message));
    return;
  }

  const newRole = interaction.options.getRole('ping')?.id;
  const pingRoleId = interaction.options.getBoolean('clear-ping') ? null : (newRole ?? feed.pingRoleId);
  let warning: string | undefined;
  if (pingRoleId) {
    const role = await checkPingRole(interaction.guild, pingRoleId, target.channel, interaction.member);
    if (!role.ok) {
      await interaction.reply(privateNotice(role.message));
      return;
    }
    warning = role.warning;
  }

  const thumbnail = thumbnailOption(interaction);

  // Every edit re-checks the channel, so a successful edit also resumes a paused feed.
  await updateFeed(app.db, feed.id, {
    channelId,
    pingRoleId,
    includePrereleases: interaction.options.getBoolean('prereleases') ?? feed.includePrereleases,
    showThumbnail: thumbnail === undefined ? feed.showThumbnail : thumbnail,
    status: 'active',
    pausedReason: null,
  });

  const message = [strings.feed.updated(feed.repoName ?? 'feed')];
  if (feed.status === 'paused') message.push(strings.feed.resumed);
  if (warning) message.push(warning);
  await interaction.reply(privateNotice(message.join('\n')));
}

async function remove(interaction: ChatInputCommandInteraction<'cached'>, app: App) {
  const feedId = interaction.options.getString('feed', true);
  const feed = await getFeed(app.db, interaction.guildId, feedId);
  if (!feed || !(await deleteFeed(app.db, interaction.guildId, feedId))) {
    await interaction.reply(privateNotice(strings.feed.unknown));
    return;
  }
  await interaction.reply(privateNotice(strings.feed.removed(feed.repoName ?? 'that repo')));
}

function feedLabel(feed: FeedWithRepo, channelName: string | undefined): string {
  const paused = feed.status === 'paused' ? ' (paused)' : '';
  return `${feed.repoName ?? 'unknown repo'} → #${channelName ?? 'deleted-channel'}${paused}`.slice(0, 100);
}
