import {
  type APIButtonComponentWithURL,
  type APIComponentInContainer,
  type APIMessageTopLevelComponent,
  type APITextDisplayComponent,
  ButtonStyle,
  ComponentType,
  MessageFlags,
  SeparatorSpacingSize,
} from 'discord.js';
import { BRAND_COLOR, MESSAGE_TEXT_LIMIT } from '../limits.js';
import { applyBadges, type BadgeEmojis } from '../markdown/badges.js';
import { escapeDiscord, escapeInline } from '../markdown/escape.js';
import type { PatchNote } from '../patch-note.js';

export interface RenderOptions {
  /** Formatted application emojis: the badges plus the Patchr mark for the footer. */
  emojis?: BadgeEmojis & { patchr?: string };
  pingRoleId?: string;
  /** Characters kept free for text the caller adds around the card, such as a preview header. */
  reservedText?: number;
}

export interface RenderedCard {
  flags: MessageFlags.IsComponentsV2;
  components: APIMessageTopLevelComponent[];
  /** Nothing pings except the chosen role, whatever the notes contain. */
  allowedMentions: { parse: []; roles: string[] };
}

const HEADER_PART_MAX = 120;
const EMPTY_BODY = '*No notes for this release.*';

/** Renders a note as a Components V2 message: one pink container, with the same layout every time. */
export function renderCard(note: PatchNote, options: RenderOptions = {}): RenderedCard {
  const header = renderHeader(note);
  const footer = renderFooter(note, options);
  const ping = options.pingRoleId ? `<@&${options.pingRoleId}>` : undefined;

  let body = note.body.trim() === '' ? EMPTY_BODY : applyBadges(note.body, options.emojis ?? {});
  let truncated = note.truncated === true;

  const fixed = header.length + footer.length + (ping?.length ?? 0) + shortenedLine(note).length;
  const budget = MESSAGE_TEXT_LIMIT - fixed - (options.reservedText ?? 0);
  if (body.length > budget) {
    body = cutToLines(body, budget);
    truncated = true;
  }

  const inner: APIComponentInContainer[] = [];

  if (note.project.iconUrl) {
    inner.push({
      type: ComponentType.Section,
      components: [text(header)],
      accessory: { type: ComponentType.Thumbnail, media: { url: note.project.iconUrl } },
    });
  } else {
    inner.push(text(header));
  }

  inner.push({ type: ComponentType.Separator, divider: true, spacing: SeparatorSpacingSize.Small });
  inner.push(text(body));
  if (truncated) inner.push(text(shortenedLine(note)));
  inner.push({ type: ComponentType.Separator, divider: false, spacing: SeparatorSpacingSize.Small });
  inner.push(text(footer));

  const links = linkButtons(note);
  if (links.length > 0) inner.push({ type: ComponentType.ActionRow, components: links });

  const components: APIMessageTopLevelComponent[] = [];
  if (ping) components.push(text(ping));
  components.push({ type: ComponentType.Container, accent_color: BRAND_COLOR, components: inner });

  return {
    flags: MessageFlags.IsComponentsV2,
    components,
    allowedMentions: { parse: [], roles: options.pingRoleId ? [options.pingRoleId] : [] },
  };
}

function renderHeader(note: PatchNote): string {
  const name = escapeDiscord(clip(note.project.name, HEADER_PART_MAX));
  const project = note.project.url ? `[${name}](<${note.project.url}>)` : name;
  const version = escapeInline(clip(note.version, HEADER_PART_MAX));
  const title = note.title?.trim() ? ` · ${escapeInline(clip(note.title.trim(), HEADER_PART_MAX))}` : '';
  return `-# ${project}\n## ${version}${title}`;
}

function renderFooter(note: PatchNote, options: RenderOptions): string {
  const parts: string[] = [];
  const mark = options.emojis?.patchr ? `${options.emojis.patchr} ` : '';
  const when = `<t:${Math.floor(Date.parse(note.publishedAt) / 1000)}:D>`;
  const verb = note.source === 'github' ? 'Released' : 'Posted';

  if (note.prerelease) parts.push('Pre-release');
  parts.push(`${verb} ${when}`);

  const author = note.author;
  if (author?.discordId) parts.push(`by <@${author.discordId}>`);
  else if (author?.url) parts.push(`by [@${escapeInline(author.name)}](<${author.url}>)`);
  else if (author) parts.push(`by ${escapeInline(clip(author.name, HEADER_PART_MAX))}`);

  return `-# ${mark}${parts.join(' · ')}`;
}

function shortenedLine(note: PatchNote): string {
  return note.url ? `-# Notes shortened. [Read the full notes](<${note.url}>)` : '-# Notes shortened.';
}

function linkButtons(note: PatchNote): APIButtonComponentWithURL[] {
  const buttons: APIButtonComponentWithURL[] = [];
  if (note.url) {
    const label = note.source === 'github' ? 'View on GitHub' : 'View release';
    buttons.push({ type: ComponentType.Button, style: ButtonStyle.Link, label, url: note.url });
  }
  if (note.compareUrl) {
    buttons.push({
      type: ComponentType.Button,
      style: ButtonStyle.Link,
      label: 'Full changelog',
      url: note.compareUrl,
    });
  }
  return buttons;
}

function text(content: string): APITextDisplayComponent {
  return { type: ComponentType.TextDisplay, content };
}

function clip(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/** Cuts at the last line break that fits, closing a code fence left open. */
function cutToLines(body: string, max: number): string {
  const room = max - 4;
  let cut = body.slice(0, Math.max(0, room));
  const lastBreak = cut.lastIndexOf('\n');
  if (lastBreak > 0) cut = cut.slice(0, lastBreak);
  const fences = cut.split('\n').filter((line) => line.trimStart().startsWith('```')).length;
  return fences % 2 === 1 ? `${cut}\n\`\`\`` : cut;
}
