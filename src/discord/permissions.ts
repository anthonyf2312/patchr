import { PermissionFlagsBits, type PermissionsBitField } from 'discord.js';

/** What Patchr needs in a channel to post a card there. */
const POST_PERMISSIONS = [
  [PermissionFlagsBits.ViewChannel, 'View Channel'],
  [PermissionFlagsBits.SendMessages, 'Send Messages'],
  [PermissionFlagsBits.EmbedLinks, 'Embed Links'],
] as const;

/** Names of the posting permissions Patchr lacks. `null` (unknown) counts as lacking them all. */
export function missingPostPermissions(permissions: Readonly<PermissionsBitField> | null): string[] {
  return POST_PERMISSIONS.filter(([flag]) => !permissions?.has(flag)).map(([, name]) => name);
}

/**
 * Patchr never posts somewhere on a person's behalf that they couldn't post themselves. This matters
 * once an admin lets a less trusted role use /patch through Server Settings → Integrations.
 */
export function memberCanPost(memberPermissions: Readonly<PermissionsBitField> | null): boolean {
  return (
    memberPermissions?.has(PermissionFlagsBits.ViewChannel) === true &&
    memberPermissions.has(PermissionFlagsBits.SendMessages)
  );
}

/** Nor pings a role they couldn't mention themselves. */
export function memberCanPing(
  role: { mentionable: boolean },
  memberPermissions: Readonly<PermissionsBitField> | null,
): boolean {
  return role.mentionable || memberPermissions?.has(PermissionFlagsBits.MentionEveryone) === true;
}

export type PingProblem = 'everyone' | 'not_mentionable';

/**
 * Why a role would make a bad ping target: @everyone is refused outright, and a role that
 * isn't mentionable won't actually ping unless Patchr may mention all roles in that channel.
 */
export function pingRoleProblem(
  role: { id: string; mentionable: boolean },
  guildId: string,
  channelPermissions: Readonly<PermissionsBitField> | null,
): PingProblem | undefined {
  if (role.id === guildId) return 'everyone';
  if (!role.mentionable && !channelPermissions?.has(PermissionFlagsBits.MentionEveryone))
    return 'not_mentionable';
  return undefined;
}
