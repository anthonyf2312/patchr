import {
  ApplicationCommandType,
  ApplicationIntegrationType,
  ContextMenuCommandBuilder,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
} from 'discord.js';
import { eq } from 'drizzle-orm';
import type { Deliverer, Post } from '../core/deliver.js';
import { noteHash } from '../core/hash.js';
import type { PatchNote } from '../core/patch-note.js';
import type { Database } from '../db/client.js';
import { feeds, githubRepos } from '../db/schema.js';
import type { Command } from '../interactions/types.js';
import { notice, privateNotice } from '../interactions/ui.js';
import { currentAvatar, type GitHubApi } from '../sources/github/api.js';
import { releaseToNote } from '../sources/github/to-note.js';
import { findPostByMessage } from '../store/posts.js';
import { strings } from '../strings.js';

export type RefreshGitHub = Pick<GitHubApi, 'getRepoById' | 'getRepo' | 'getRelease' | 'avatarUrl'>;

export interface RefreshDeps {
  db: Database;
  github: RefreshGitHub;
  deliverer: Pick<Deliverer, 'editPost'>;
}

export type RefreshResult = keyof typeof strings.refreshNote.result;

/** Right-click a Patchr post → Apps → Refresh patch note. */
export const refreshNoteCommand: Command = {
  data: new ContextMenuCommandBuilder()
    .setName('Refresh patch note')
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

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const icon = interaction.guild.iconURL({ size: 128, extension: 'png' });
    const result = await refreshPost(app, post, {
      name: interaction.guild.name,
      ...(icon && { iconUrl: icon }),
    });
    await interaction.editReply(notice(strings.refreshNote.result[result]));
  },
};

/**
 * Re-renders a post from fresh data, whether or not anything changed: the release as GitHub has
 * it now (or marked pulled if it's gone), the owner's current avatar, and the current thumbnail
 * setting. A `/patch` note takes the server's current name and icon.
 */
export async function refreshPost(
  deps: RefreshDeps,
  post: Post,
  server: { name: string; iconUrl?: string },
): Promise<RefreshResult> {
  if (post.kind === 'manual') {
    const { iconUrl: _, ...project } = post.note.project;
    const note: PatchNote = {
      ...post.note,
      project: { ...project, name: server.name, ...(server.iconUrl && { iconUrl: server.iconUrl }) },
    };
    return edited(await deps.deliverer.editPost(post, note, noteHash(note)), 'refreshed');
  }

  const [feed] = post.feedId
    ? await deps.db.select({ repoId: feeds.githubRepoId }).from(feeds).where(eq(feeds.id, post.feedId))
    : [];
  const lookup = feed?.repoId
    ? await deps.github.getRepoById(feed.repoId)
    : await deps.github.getRepo(post.note.project.name);
  if (lookup.kind === 'gone') return 'repo_gone';
  if (lookup.kind !== 'ok') return 'github_down';
  // Never read from a private repo, even if the token can.
  if (lookup.repo.private) return 'private';

  const repo = lookup.repo;
  const [stored] = await deps.db
    .select({ avatar: githubRepos.ownerAvatarUrl })
    .from(githubRepos)
    .where(eq(githubRepos.id, repo.id));
  const avatar = await currentAvatar(deps.github, repo.owner.avatar_url, stored?.avatar);
  await deps.db
    .update(githubRepos)
    .set({ fullName: repo.full_name, ownerAvatarUrl: avatar })
    .where(eq(githubRepos.id, repo.id));

  const repoInfo = { fullName: repo.full_name, url: `https://github.com/${repo.full_name}` };
  const project = { name: repo.full_name, url: repoInfo.url, iconUrl: avatar };
  const release = await deps.github.getRelease(
    repo.full_name,
    Number(post.releaseKey.slice('github:'.length)),
  );

  if (release.kind === 'gone' || (release.kind === 'ok' && release.release.draft)) {
    const note: PatchNote = { ...post.note, project: { ...post.note.project, ...project }, pulled: true };
    return edited(await deps.deliverer.editPost(post, note, noteHash(note)), 'pulled');
  }
  if (release.kind !== 'ok') return 'github_down';

  const note = releaseToNote(release.release, { ...repoInfo, ownerAvatarUrl: avatar });
  // Finding the previous tag would take another call; the changelog link and update size it gave still hold.
  if (post.note.compareUrl) note.compareUrl = post.note.compareUrl;
  if (post.note.bump) note.bump = post.note.bump;
  return edited(await deps.deliverer.editPost(post, note, noteHash(note)), 'refreshed');
}

function edited(
  result: Awaited<ReturnType<Deliverer['editPost']>>,
  success: 'refreshed' | 'pulled',
): RefreshResult {
  if (result === 'edited') return success;
  return result === 'gone' ? 'message_gone' : 'failed';
}
