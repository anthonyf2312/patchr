export type Badge = 'new' | 'fix' | 'change';

/** Formatted emoji for each badge, e.g. `<:fix:123>`. Missing badges are skipped. */
export type BadgeEmojis = Partial<Record<Badge, string>>;

const NONE = /\b(contributors?|documentation|docs|security|thanks|credits)\b/;
const FIX = /\b(fix|fixes|fixed|bug|bugs|bugfix|bugfixes|hotfix|hotfixes)\b/;
const NEW = /\b(new|added|add|feature|features|feat|enhancements?|highlights)\b/;
const CHANGE =
  /\b(change|changes|changed|improvements?|improved|updates?|updated|refactor|performance|perf|breaking|deprecated|deprecations|removed|removals)\b/;

/** Classifies a changelog heading such as "Bug Fixes" or "What's Changed". */
export function badgeForHeading(heading: string): Badge | undefined {
  const text = heading.toLowerCase();
  if (NONE.test(text)) return undefined;
  if (FIX.test(text)) return 'fix';
  if (CHANGE.test(text)) return 'change';
  if (NEW.test(text)) return 'new';
  return undefined;
}

const HEADING = /^(#{1,3} )(.+)$/;
const BOLD_LINE = /^\*\*([^*].*[^*]|[^*])\*\*$/;
const STARTS_WITH_EMOJI = /^(\p{Extended_Pictographic}|<a?:\w+:\d+>)/u;

/** Adds the matching badge emoji to headings (and whole-line bold) outside code blocks. */
export function applyBadges(markdown: string, emojis: BadgeEmojis): string {
  let inFence = false;

  return markdown
    .split('\n')
    .map((line) => {
      if (line.trimStart().startsWith('```')) inFence = !inFence;
      if (inFence) return line;

      const heading = HEADING.exec(line);
      if (heading) {
        const [, marks = '', text = ''] = heading;
        const emoji = emojiFor(text, emojis);
        return emoji ? `${marks}${emoji} ${text}` : line;
      }

      const bold = BOLD_LINE.exec(line);
      if (bold) {
        const [, text = ''] = bold;
        const emoji = emojiFor(text, emojis);
        return emoji ? `**${emoji} ${text}**` : line;
      }

      return line;
    })
    .join('\n');
}

function emojiFor(text: string, emojis: BadgeEmojis): string | undefined {
  if (STARTS_WITH_EMOJI.test(text.trim())) return undefined;
  const badge = badgeForHeading(text);
  return badge ? emojis[badge] : undefined;
}
