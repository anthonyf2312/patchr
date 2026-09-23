import {
  ChannelType,
  type Guild,
  type GuildBasedChannel,
  type GuildMember,
  type NewsChannel,
  type TextChannel,
} from 'discord.js';
import { strings } from '../strings.js';
import { memberCanPing, memberCanPost, missingPostPermissions, pingRoleProblem } from './permissions.js';

export type PostChannel = TextChannel | NewsChannel;

export type ChannelCheck = { ok: true; channel: PostChannel } | { ok: false; message: string };
export type RoleCheck = { ok: true; warning?: string } | { ok: false; message: string };

export interface ChannelCheckOptions {
  /** The person asking. Patchr won't post where they couldn't post themselves. */
  member?: GuildMember;
  /** What to say when the channel no longer exists. */
  missingMessage?: string;
}

/** Confirms Patchr (and the person asking) can post a card in the channel, and says what's missing if not. */
export async function checkPostChannel(
  guild: Guild,
  channelId: string,
  options: ChannelCheckOptions = {},
): Promise<ChannelCheck> {
  const channel: GuildBasedChannel | undefined = guild.channels.cache.get(channelId);
  if (!channel) return { ok: false, message: options.missingMessage ?? strings.channel.deleted };
  if (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement) {
    return { ok: false, message: strings.channel.wrongType };
  }

  if (options.member && !memberCanPost(channel.permissionsFor(options.member))) {
    return { ok: false, message: strings.channel.memberCannotPost(channel.id) };
  }

  const me = guild.members.me ?? (await guild.members.fetchMe());
  const missing = missingPostPermissions(channel.permissionsFor(me));
  if (missing.length > 0) return { ok: false, message: strings.channel.missing(channel.id, missing) };
  return { ok: true, channel };
}

/**
 * @everyone is refused, and so is a role the person couldn't mention themselves. A role that
 * won't ping is allowed, with a warning explaining how to fix it.
 */
export async function checkPingRole(
  guild: Guild,
  roleId: string,
  channel: PostChannel,
  member?: GuildMember,
): Promise<RoleCheck> {
  const role = guild.roles.cache.get(roleId);
  if (!role) return { ok: true };
  if (role.id === guild.id) return { ok: false, message: strings.ping.everyone };
  if (member && !memberCanPing(role, channel.permissionsFor(member))) {
    return { ok: false, message: strings.ping.memberCannot(roleId) };
  }

  const me = guild.members.me ?? (await guild.members.fetchMe());
  const problem = pingRoleProblem(role, guild.id, channel.permissionsFor(me));
  if (problem === 'not_mentionable') return { ok: true, warning: strings.ping.notMentionable(roleId) };
  return { ok: true };
}
