import {
  type APIMessageTopLevelComponent,
  type APITextDisplayComponent,
  ComponentType,
  MessageFlags,
} from 'discord.js';

/** Custom ids look like `namespace:action:arg…` and must fit Discord's 100-character limit. */
export function customId(namespace: string, action: string, ...args: string[]): string {
  const id = [namespace, action, ...args].join(':');
  if (id.length > 100) throw new Error(`custom id too long: ${id}`);
  return id;
}

export function parseCustomId(id: string): { namespace: string; action: string; args: string[] } {
  const [namespace = '', action = '', ...args] = id.split(':');
  return { namespace, action, args };
}

export function text(content: string): APITextDisplayComponent {
  return { type: ComponentType.TextDisplay, content };
}

/** A Components V2 message body that never pings anyone. Callers add `Ephemeral` when replying. */
export function notice(content: string, ...extra: APIMessageTopLevelComponent[]) {
  return {
    flags: MessageFlags.IsComponentsV2 as const,
    components: [text(content), ...extra],
    allowedMentions: { parse: [] },
  };
}

export const EPHEMERAL_V2 = MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral;

/** A private notice as a first reply. */
export function privateNotice(content: string, ...extra: APIMessageTopLevelComponent[]) {
  return { ...notice(content, ...extra), flags: EPHEMERAL_V2 };
}

export function jumpUrl(guildId: string, channelId: string, messageId: string): string {
  return `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;
}
