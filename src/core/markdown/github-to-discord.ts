import type {
  Blockquote,
  Definition,
  List,
  Nodes,
  Paragraph,
  PhrasingContent,
  Root,
  RootContent,
  Table,
} from 'mdast';
import { emojify } from 'node-emoji';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { escapeInline, escapeLineStarts } from './escape.js';

export interface ConvertOptions {
  /** `owner/name` of the repo the notes belong to, used to resolve `#123` and shorten links. */
  repo?: string;
  /** Hard cap on the output length. Notes are cut at a block boundary when possible. */
  maxLength?: number;
  /** Drops the first node when it is a heading whose plain text matches, such as a repeated version. */
  dropLeadingHeading?: (plainText: string) => boolean;
}

export interface ConvertResult {
  text: string;
  truncated: boolean;
}

interface Context {
  repo?: { owner: string; name: string };
  definitions: Map<string, string>;
  inLink: boolean;
}

/** A rendered block. `tight` blocks (headings) join the next block with one newline instead of a blank line. */
interface Block {
  text: string;
  tight: boolean;
  heading: boolean;
}

const processor = unified().use(remarkParse).use(remarkGfm);

const ALERTS: Record<string, string> = {
  NOTE: 'ℹ️ Note',
  TIP: '💡 Tip',
  IMPORTANT: '❗ Important',
  WARNING: '⚠️ Warning',
  CAUTION: '🛑 Caution',
};

const ZERO_WIDTH_SPACE = String.fromCharCode(0x200b);

const IGNORED_MENTIONS = new Set(['everyone', 'here']);

/** Converts GitHub-flavoured markdown (release notes) into markdown Discord renders well. */
export function githubToDiscord(markdown: string, options: ConvertOptions = {}): ConvertResult {
  const tree = processor.parse(markdown.replace(/\r\n?/g, '\n')) as Root;
  const ctx: Context = { definitions: new Map(), inLink: false };

  if (options.repo) {
    const [owner, name] = options.repo.split('/');
    if (owner && name) ctx.repo = { owner, name };
  }

  for (const node of tree.children) {
    if (node.type === 'definition') collectDefinition(ctx, node);
  }

  let nodes = tree.children;
  const first = nodes[0];
  if (first?.type === 'heading' && options.dropLeadingHeading?.(plainText(first).trim())) {
    nodes = nodes.slice(1);
  }

  const blocks = emitBlocks(nodes, ctx);
  return fitBlocks(blocks, options.maxLength ?? Number.POSITIVE_INFINITY);
}

function collectDefinition(ctx: Context, node: Definition): void {
  ctx.definitions.set(node.identifier.toLowerCase(), node.url);
}

function emitBlocks(nodes: RootContent[], ctx: Context): Block[] {
  const blocks: Block[] = [];
  for (const node of nodes) {
    const block = emitBlock(node, ctx);
    if (block && block.text.trim() !== '') blocks.push(block);
  }
  return blocks;
}

function emitBlock(node: RootContent, ctx: Context): Block | undefined {
  switch (node.type) {
    case 'heading': {
      const text = emitInline(node.children, ctx).trim();
      if (node.depth <= 3) return { text: `### ${text}`, tight: true, heading: true };
      return { text: `**${text}**`, tight: true, heading: true };
    }
    case 'paragraph':
      return plain(emitParagraph(node, ctx));
    case 'list':
      return plain(emitList(node, ctx, 0));
    case 'blockquote':
      return plain(emitBlockquote(node, ctx));
    case 'code': {
      // A zero-width space stops a fence inside the code from closing the block early.
      const body = node.value.replaceAll('```', `\`${ZERO_WIDTH_SPACE}\`\``);
      return plain(`\`\`\`${node.lang ?? ''}\n${body}\n\`\`\``);
    }
    case 'table':
      return plain(emitTable(node, ctx));
    case 'html':
      return plain(htmlToDiscord(node.value).trim());
    default:
      // Thematic breaks, definitions, footnotes and front matter are dropped.
      return undefined;
  }
}

function plain(text: string): Block {
  return { text, tight: false, heading: false };
}

function emitParagraph(node: Paragraph, ctx: Context): string {
  return escapeLineStarts(emitInline(node.children, ctx));
}

function emitList(list: List, ctx: Context, depth: number): string {
  const start = list.start ?? 1;
  const indent = '  '.repeat(depth);

  return list.children
    .map((item, index) => {
      const marker = list.ordered ? `${start + index}. ` : '- ';
      const check = item.checked === true ? '☑ ' : item.checked === false ? '☐ ' : '';
      const continuation = indent + ' '.repeat(marker.length);
      const lines: string[] = [];

      for (const child of item.children) {
        if (child.type === 'list') {
          lines.push(emitList(child, ctx, depth + 1));
          continue;
        }
        const block = emitBlock(child, ctx);
        if (!block) continue;
        const blockLines = block.text.split('\n');
        if (child.type === 'code') {
          // Indenting a fence leaks the indent into the code in Discord, so code sits flush left.
          lines.push(...blockLines);
          continue;
        }
        blockLines.forEach((line, lineIndex) => {
          const isFirst = lines.length === 0 && lineIndex === 0;
          lines.push(isFirst ? `${indent}${marker}${check}${line}` : `${continuation}${line}`);
        });
      }

      if (lines.length === 0) lines.push(`${indent}${marker}${check}`.trimEnd());
      return lines.join('\n');
    })
    .join('\n');
}

function emitBlockquote(node: Blockquote, ctx: Context): string {
  const lines: string[] = [];
  const [first, ...rest] = node.children;
  let children = node.children;

  // GitHub alerts: "> [!NOTE]" on the first line of the quote.
  if (first?.type === 'paragraph' && first.children[0]?.type === 'text') {
    const text = first.children[0];
    const match = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*\n?/.exec(text.value);
    const label = match?.[1] ? ALERTS[match[1]] : undefined;
    if (match && label) {
      lines.push(`**${label}**`);
      const remainder = text.value.slice(match[0].length);
      const paragraph: Paragraph = {
        ...first,
        children: [{ ...text, value: remainder }, ...first.children.slice(1)],
      };
      children = [paragraph, ...rest];
    }
  }

  for (const block of emitBlocks(children, ctx)) lines.push(block.text);
  return lines
    .join('\n')
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
}

function emitTable(table: Table, ctx: Context): string {
  return table.children
    .slice(1)
    .map((row) => {
      const cells = row.children.map((cell) => emitInline(cell.children, ctx).trim()).filter(Boolean);
      const [head, ...tail] = cells;
      if (head === undefined) return '';
      return tail.length > 0 ? `- **${head}** · ${tail.join(' · ')}` : `- ${head}`;
    })
    .filter(Boolean)
    .join('\n');
}

function emitInline(nodes: PhrasingContent[], ctx: Context): string {
  return nodes.map((node) => emitPhrasing(node, ctx)).join('');
}

function emitPhrasing(node: PhrasingContent, ctx: Context): string {
  switch (node.type) {
    case 'text':
      return emitText(node.value, ctx);
    case 'emphasis':
      return `*${emitInline(node.children, ctx)}*`;
    case 'strong':
      return `**${emitInline(node.children, ctx)}**`;
    case 'delete':
      return `~~${emitInline(node.children, ctx)}~~`;
    case 'inlineCode':
      return node.value.includes('`') ? `\`\` ${node.value} \`\`` : `\`${node.value}\``;
    case 'break':
      return '\n';
    case 'link':
      return emitLink(node.url, node.children, ctx);
    case 'linkReference': {
      const url = ctx.definitions.get(node.identifier.toLowerCase());
      if (url) return emitLink(url, node.children, ctx);
      return `\\[${emitInline(node.children, ctx)}\\]`;
    }
    case 'image':
      return maskedLink(node.alt || 'Image', node.url);
    case 'imageReference': {
      const url = ctx.definitions.get(node.identifier.toLowerCase());
      return url ? maskedLink(node.alt || 'Image', url) : escapeInline(node.alt ?? '');
    }
    case 'html':
      return htmlToDiscord(node.value);
    default:
      return '';
  }
}

function emitLink(url: string, children: PhrasingContent[], ctx: Context): string {
  if (url.startsWith('mailto:')) return escapeInline(plainText({ type: 'paragraph', children }));
  if (!/^https?:\/\//i.test(url)) return emitInline(children, ctx);

  const label = plainText({ type: 'paragraph', children });
  const isAutolink = label === url || `http://${label}` === url || `https://${label}` === url;
  if (isAutolink) return smartLink(url, ctx);

  const inner = emitInline(children, { ...ctx, inLink: true });
  return `[${inner}](<${safeUrl(url)}>)`;
}

/** Shortens GitHub URLs the way GitHub itself displays them. */
function smartLink(url: string, ctx: Context): string {
  const sameRepo = (owner: string, name: string) =>
    ctx.repo !== undefined &&
    ctx.repo.owner.toLowerCase() === owner.toLowerCase() &&
    ctx.repo.name.toLowerCase() === name.toLowerCase();

  const issue =
    /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/(?:pull|issues|discussions)\/(\d+)\/?(?:[#?].*)?$/.exec(
      url,
    );
  if (issue) {
    const [, owner = '', name = '', number = ''] = issue;
    return maskedLink(sameRepo(owner, name) ? `#${number}` : `${owner}/${name}#${number}`, url);
  }

  const commit = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/commit\/([0-9a-f]{7,40})/i.exec(url);
  if (commit) {
    const [, owner = '', name = '', sha = ''] = commit;
    const short = sha.slice(0, 7);
    return maskedLink(sameRepo(owner, name) ? short : `${owner}/${name}@${short}`, url);
  }

  const compare = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/compare\/([^?#]+)/.exec(url);
  if (compare?.[1]) return maskedLink(decodeURIComponent(compare[1]), url);

  const profile = /^https:\/\/github\.com\/([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/?$/.exec(url);
  if (profile?.[1]) return maskedLink(`@${profile[1]}`, url);

  return `<${safeUrl(url)}>`;
}

function maskedLink(label: string, url: string): string {
  if (!/^https?:\/\//i.test(url)) return escapeInline(label);
  return `[${escapeInline(label)}](<${safeUrl(url)}>)`;
}

function safeUrl(url: string): string {
  return url.replace(/[<> ]/g, (char) => encodeURIComponent(char));
}

const REFERENCE =
  /(?<pre>^|[^\w@/.-])@(?<user>[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38})(?![\w/@-])|(?<pre2>^|[^\w&/#-])(?<xrepo>[A-Za-z0-9-]+\/[\w.-]+)?#(?<num>\d+)(?![\w-])/g;

/** Plain text: emoji shortcodes become emoji, and @users and #123 become links, unless inside a link label. */
function emitText(value: string, ctx: Context): string {
  const text = emojify(value);
  if (ctx.inLink) return escapeInline(text);

  let out = '';
  let last = 0;
  for (const match of text.matchAll(REFERENCE)) {
    const groups = match.groups ?? {};
    const pre = groups.pre ?? groups.pre2 ?? '';
    const start = match.index + pre.length;
    let link: string | undefined;

    if (groups.user && !IGNORED_MENTIONS.has(groups.user.toLowerCase())) {
      link = maskedLink(`@${groups.user}`, `https://github.com/${groups.user}`);
    } else if (groups.num) {
      if (groups.xrepo) {
        link = maskedLink(
          `${groups.xrepo}#${groups.num}`,
          `https://github.com/${groups.xrepo}/issues/${groups.num}`,
        );
      } else if (ctx.repo) {
        link = maskedLink(
          `#${groups.num}`,
          `https://github.com/${ctx.repo.owner}/${ctx.repo.name}/issues/${groups.num}`,
        );
      }
    }

    if (link === undefined) continue;
    out += escapeInline(text.slice(last, start)) + link;
    last = match.index + match[0].length;
  }
  return out + escapeInline(text.slice(last));
}

/** Reduces raw HTML to Discord markdown: images and anchors become links, summaries become bold, the rest is text. */
function htmlToDiscord(html: string): string {
  const source = html.replace(/<!--[\s\S]*?-->/g, '');
  const tag = /<(\/?)([a-zA-Z][\w-]*)([^>]*)>/g;
  const anchors: { href: string; start: number }[] = [];
  let out = '';
  let last = 0;

  for (const match of source.matchAll(tag)) {
    out += escapeInline(decodeEntities(source.slice(last, match.index)));
    last = match.index + match[0].length;

    const closing = match[1] === '/';
    const name = (match[2] ?? '').toLowerCase();
    const attrs = match[3] ?? '';

    switch (name) {
      case 'br':
        out += '\n';
        break;
      case 'img': {
        const src = attribute(attrs, 'src');
        if (src) out += maskedLink(attribute(attrs, 'alt') || 'Image', src);
        break;
      }
      case 'summary':
      case 'b':
      case 'strong':
        out += '**';
        break;
      case 'a':
        if (!closing) {
          anchors.push({ href: attribute(attrs, 'href') ?? '', start: out.length });
        } else {
          const anchor = anchors.pop();
          if (anchor && /^https?:\/\//i.test(anchor.href)) {
            const label = out.slice(anchor.start);
            out = `${out.slice(0, anchor.start)}[${label}](<${safeUrl(anchor.href)}>)`;
          }
        }
        break;
      default:
        break;
    }
  }

  return out + escapeInline(decodeEntities(source.slice(last)));
}

function attribute(attrs: string, name: string): string | undefined {
  const match = new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(attrs);
  const value = match?.[1] ?? match?.[2] ?? match?.[3];
  return value === undefined ? undefined : decodeEntities(value);
}

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function plainText(node: Nodes): string {
  if ('value' in node && typeof node.value === 'string') return node.value;
  if ('alt' in node && typeof node.alt === 'string') return node.alt;
  if ('children' in node) return (node.children as Nodes[]).map(plainText).join('');
  return '';
}

/** Joins blocks up to `max` characters, cutting at a block (or line) boundary. */
function fitBlocks(blocks: Block[], max: number): ConvertResult {
  let out = '';
  let lastHeadingEnd = -1;

  for (const [index, block] of blocks.entries()) {
    const previous = blocks[index - 1];
    const separator = index === 0 ? '' : previous?.tight ? '\n' : '\n\n';

    if (out.length + separator.length + block.text.length <= max) {
      out += separator + block.text;
      lastHeadingEnd = block.heading ? out.length : -1;
      continue;
    }

    const room = max - out.length - separator.length;
    const partial = cutBlock(block.text, room, out.length === 0);
    if (partial) {
      out += separator + partial;
    } else if (lastHeadingEnd === out.length) {
      // Don't end on a heading with nothing under it.
      out = out.slice(0, out.lastIndexOf('\n', out.length - 1) + 1).trimEnd();
    }
    return { text: out, truncated: true };
  }

  return { text: out, truncated: false };
}

function cutBlock(text: string, room: number, mustFill: boolean): string {
  if (room <= 0) return '';
  const lines = text.split('\n');
  const kept: string[] = [];
  let length = 0;
  let inFence = false;

  for (const line of lines) {
    const opensOrCloses = line.trimStart().startsWith('```');
    const nextFence: boolean = opensOrCloses ? !inFence : inFence;
    const closer = nextFence ? '\n```' : '';
    const added = (kept.length === 0 ? 0 : 1) + line.length;
    if (length + added + closer.length > room) break;
    kept.push(line);
    length += added;
    inFence = nextFence;
  }

  if (kept.length === 0 || (inFence && kept.length === 1)) {
    if (!mustFill || room < 2) return '';
    const head = (lines[0] ?? '').slice(0, room - 1);
    const cut = head.lastIndexOf(' ');
    return `${cut > 0 ? head.slice(0, cut) : head}…`;
  }

  return inFence ? `${kept.join('\n')}\n\`\`\`` : kept.join('\n');
}
