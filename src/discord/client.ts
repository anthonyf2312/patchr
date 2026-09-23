import { ActivityType, Client, GatewayIntentBits, Options } from 'discord.js';

/**
 * Patchr needs only the Guilds intent: no message content, members or presences. That keeps it
 * free of privileged intents, which matters for Discord's verification.
 */
export function createClient(): Client {
  return new Client({
    intents: [GatewayIntentBits.Guilds],
    shards: 'auto',
    // Nothing Patchr sends pings anyone unless a call explicitly allows it.
    allowedMentions: { parse: [] },
    makeCache: Options.cacheWithLimits({
      ...Options.DefaultMakeCacheSettings,
      MessageManager: 0,
      ReactionManager: 0,
      PresenceManager: 0,
      VoiceStateManager: 0,
      GuildEmojiManager: 0,
      GuildStickerManager: 0,
      GuildInviteManager: 0,
      GuildScheduledEventManager: 0,
      StageInstanceManager: 0,
      AutoModerationRuleManager: 0,
      GuildMemberManager: { maxSize: 1, keepOverLimit: (member) => member.id === member.client.user.id },
    }),
    presence: {
      activities: [
        { name: 'Patch notes', type: ActivityType.Custom, state: 'Patch notes, posted beautifully.' },
      ],
    },
  });
}
