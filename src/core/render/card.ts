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
import { BRAND_COLOR, MESSAGE_TEXT_LIMIT, PRERELEASE_COLOR, PULLED_COLOR } from '../limits.js';
import { applyBadges, type BadgeEmojis } from '../markdown/badges.js';
import { escapeDiscord, escapeInline } from '../markdown/escape.js';
import type { PatchNote } from '../patch-note.js';

export interface RenderOptions {
  /** Formatted application emojis: the badges plus the Patchr mark for the footer. */
  emojis?: BadgeEmojis & { patchr?: string };
  pingRoleId?: string;
  /** Characters kept free for text the caller adds around the card, such as a preview header. */
  reservedText?: number;
  /** Show the project icon next to the header. On unless a server or feed turned it off. */
  thumbnail?: boolean;
}

export interface RenderedCard {
  flags: MessageFlags.IsComponentsV2;
  components: APIMessageTopLevelComponent[];
  /** Nothing pings except the chosen role, whatever the notes contain. */
  allowedMentions: { parse: []; roles: string[] };
}

const HEADER_PART_MAX = 120;
const EMPTY_BODY = '*No notes for this release.*';
const PULLED_LINE = "**Release pulled.** It's no longer on GitHub.";
const BUMP_LABELS = { major: 'Major update', minor: 'Minor update', patch: 'Patch update' } as const;

/** Renders a note as a Components V2 message: one container (pink, or grey once pulled), with the same layout every time. */
export function renderCard(note: PatchNote, options: RenderOptions = {}): RenderedCard {
  const header = renderHeader(note);
  const footer = renderFooter(note, options);
  const ping = options.pingRoleId ? `<@&${options.pingRoleId}>` : undefined;

  let body = note.body.trim() === '' ? EMPTY_BODY : applyBadges(note.body, options.emojis ?? {});
  let truncated = note.truncated === true;

  const pulled = note.pulled ? PULLED_LINE : undefined;

  const fixed =
    header.length + footer.length + (ping?.length ?? 0) + (pulled?.length ?? 0) + shortenedLine(note).length;
  const budget = MESSAGE_TEXT_LIMIT - fixed - (options.reservedText ?? 0);
  if (body.length > budget) {
    body = cutToLines(body, budget);
    truncated = true;
  }

  const inner: APIComponentInContainer[] = [];

  if (note.project.iconUrl && options.thumbnail !== false) {
    inner.push({
      type: ComponentType.Section,
      components: [text(header)],
      accessory: { type: ComponentType.Thumbnail, media: { url: note.project.iconUrl } },
    });
  } else {
    inner.push(text(header));
  }
  if (pulled) inner.push(text(pulled));

  inner.push({ type: ComponentType.Separator, divider: true, spacing: SeparatorSpacingSize.Small });
  inner.push(text(body));
  if (truncated) inner.push(text(shortenedLine(note)));
  inner.push({ type: ComponentType.Separator, divider: false, spacing: SeparatorSpacingSize.Small });
  inner.push(text(footer));

  const links = linkButtons(note);
  if (links.length > 0) inner.push({ type: ComponentType.ActionRow, components: links });

  const components: APIMessageTopLevelComponent[] = [];
  if (ping) components.push(text(ping));
  const accent = note.pulled ? PULLED_COLOR : note.prerelease ? PRERELEASE_COLOR : BRAND_COLOR;
  components.push({ type: ComponentType.Container, accent_color: accent, components: inner });

  return {
    flags: MessageFlags.IsComponentsV2,
    components,
    allowedMentions: { parse: [], roles: options.pingRoleId ? [options.pingRoleId] : [] },
  };
}

/**
 * "## spoti.pw v0.22.0 · Title", under a linked "-# owner/repo" line when the project has a page.
 * A `/patch` note has no page, and the line would only repeat the server's name.
 */
function renderHeader(note: PatchNote): string {
  const name = clip(note.project.shortName ?? note.project.name, HEADER_PART_MAX);
  const version = clip(note.version, HEADER_PART_MAX);
  const named = version.toLowerCase().includes(name.toLowerCase()) ? version : `${name} ${version}`;
  const parts = [escapeInline(named)];
  if (note.prerelease) parts.push('Pre-release');
  if (note.title?.trim()) parts.push(escapeInline(clip(note.title.trim(), HEADER_PART_MAX)));
  const heading = `## ${parts.join(' · ')}`;

  if (!note.project.url) return heading;
  const link = `[${escapeDiscord(clip(note.project.name, HEADER_PART_MAX))}](<${note.project.url}>)`;
  const bump = note.bump ? ` · ${BUMP_LABELS[note.bump]}` : '';
  return `-# ${link}${bump}\n${heading}`;
}

function renderFooter(note: PatchNote, options: RenderOptions): string {
  const parts: string[] = [];
  const mark = options.emojis?.patchr ? `${options.emojis.patchr} ` : '';
  const when = `<t:${Math.floor(Date.parse(note.publishedAt) / 1000)}:D>`;
  const verb = note.source === 'github' ? 'Released' : 'Posted';

  parts.push(`${verb} ${when}`);

  const author = note.author;
  if (author?.discordId) parts.push(`by <@${author.discordId}>`);
  else if (author?.url) parts.push(`by [@${escapeInline(author.name)}](<${author.url}>)`);
  else if (author) parts.push(`by ${escapeInline(clip(author.name, HEADER_PART_MAX))}`);

  return `-# ${mark}${parts.join(' · ')}`;
}

function shortenedLine(note: PatchNote): string {
  return note.url && !note.pulled
    ? `-# Notes shortened. [Read the full notes](<${note.url}>)`
    : '-# Notes shortened.';
}

function linkButtons(note: PatchNote): APIButtonComponentWithURL[] {
  const buttons: APIButtonComponentWithURL[] = [];
  // A pulled release's page is gone, and its tag may be too.
  if (note.pulled) return buttons;
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
