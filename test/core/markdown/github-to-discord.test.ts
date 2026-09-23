import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { githubToDiscord } from '../../../src/core/markdown/github-to-discord.js';

const repo = 'acme/rocket';
const md = (input: string) => githubToDiscord(input, { repo }).text;

describe('githubToDiscord: blocks', () => {
  it('maps h1 to h3 onto Discord h3 and deeper headings onto bold', () => {
    expect(md('# One\n\n## Two\n\n### Three\n\n#### Four')).toBe('### One\n### Two\n### Three\n**Four**');
  });

  it('keeps paragraphs apart with a blank line', () => {
    expect(md('First.\n\nSecond.')).toBe('First.\n\nSecond.');
  });

  it('renders inline formatting', () => {
    expect(md('*em* **strong** ~~gone~~ `code`')).toBe('*em* **strong** ~~gone~~ `code`');
  });

  it('keeps nested lists indented', () => {
    expect(md('- a\n  - b\n    - c\n- d')).toBe('- a\n  - b\n    - c\n- d');
  });

  it('keeps ordered list numbering from its start', () => {
    expect(md('3. three\n4. four')).toBe('3. three\n4. four');
  });

  it('turns task list items into check boxes', () => {
    expect(md('- [x] done\n- [ ] todo')).toBe('- ☑ done\n- ☐ todo');
  });

  it('keeps fenced code with its language', () => {
    expect(md('```ts\nconst a = 1;\n```')).toBe('```ts\nconst a = 1;\n```');
  });

  it('quotes every line of a blockquote', () => {
    expect(md('> one\n> two')).toBe('> one\n> two');
  });

  it('renders GitHub alerts as a labelled quote', () => {
    expect(md('> [!IMPORTANT]\n> Update your keyring.')).toBe('> **❗ Important**\n> Update your keyring.');
    expect(md('> [!WARNING]\n> Careful.')).toBe('> **⚠️ Warning**\n> Careful.');
  });

  it('handles Windows line endings', () => {
    expect(md('> [!IMPORTANT]\r\n> Update your keyring.\r\n\r\nNext.')).toBe(
      '> **❗ Important**\n> Update your keyring.\n\nNext.',
    );
  });

  it('does not indent code blocks inside list items', () => {
    expect(md('- item\n\n  ```js\n  run()\n  ```')).toBe('- item\n```js\nrun()\n```');
  });

  it('turns tables into bullet rows', () => {
    expect(md('| Package | Version |\n| --- | --- |\n| core | 1.0 |\n| cli | 2.0 |')).toBe(
      '- **core** · 1.0\n- **cli** · 2.0',
    );
  });

  it('drops thematic breaks', () => {
    expect(md('above\n\n---\n\nbelow')).toBe('above\n\nbelow');
  });
});

describe('githubToDiscord: links', () => {
  it('wraps masked links so Discord does not unfurl them', () => {
    expect(md('[docs](https://example.com/docs)')).toBe('[docs](<https://example.com/docs>)');
  });

  it('shortens pull request and issue URLs from the same repo', () => {
    expect(md('in https://github.com/acme/rocket/pull/42')).toBe(
      'in [#42](<https://github.com/acme/rocket/pull/42>)',
    );
    expect(md('https://github.com/acme/rocket/issues/7')).toBe(
      '[#7](<https://github.com/acme/rocket/issues/7>)',
    );
  });

  it('keeps the repo name on references to other repos', () => {
    expect(md('https://github.com/other/thing/pull/9')).toBe(
      '[other/thing#9](<https://github.com/other/thing/pull/9>)',
    );
  });

  it('shortens commit and compare URLs', () => {
    expect(md('https://github.com/acme/rocket/commit/9592aea673df43561d8f7a23d86a29c9e17610cb')).toBe(
      '[9592aea](<https://github.com/acme/rocket/commit/9592aea673df43561d8f7a23d86a29c9e17610cb>)',
    );
    expect(md('**Full Changelog**: https://github.com/acme/rocket/compare/v1.0.0...v1.1.0')).toBe(
      '**Full Changelog**: [v1.0.0...v1.1.0](<https://github.com/acme/rocket/compare/v1.0.0...v1.1.0>)',
    );
  });

  it('wraps other bare URLs in angle brackets', () => {
    expect(md('see https://example.com/x')).toBe('see <https://example.com/x>');
  });

  it('links @mentions to GitHub profiles', () => {
    expect(md('by @octo-cat in #12')).toBe(
      'by [@octo-cat](<https://github.com/octo-cat>) in [#12](<https://github.com/acme/rocket/issues/12>)',
    );
  });

  it('does not link emails, @everyone or @here', () => {
    expect(md('mail a@b.co, @everyone and @here')).toBe('mail a@b.co, @everyone and @here');
  });

  it('leaves #123 alone when the repo is unknown', () => {
    expect(githubToDiscord('fixes #12').text).toBe('fixes #12');
  });

  it('turns images into links', () => {
    expect(md('![Screenshot](https://img.example/a.png) ![](https://img.example/b.png)')).toBe(
      '[Screenshot](<https://img.example/a.png>) [Image](<https://img.example/b.png>)',
    );
  });
});

describe('githubToDiscord: text safety', () => {
  it('escapes literal markdown and mentions in text', () => {
    expect(md('use snake_case, not <@&123>')).toBe('use snake\\_case, not \\<@&123>');
  });

  it('leaves code spans untouched', () => {
    expect(md('`<@123> snake_case`')).toBe('`<@123> snake_case`');
  });

  it('converts emoji shortcodes outside code', () => {
    expect(md(':sparkles: new `:bug:`')).toBe('✨ new `:bug:`');
  });
});

describe('githubToDiscord: HTML', () => {
  it('strips comments', () => {
    expect(md('<!-- hidden -->\n\nShown.')).toBe('Shown.');
  });

  it('turns details and summary into a bold line plus the content', () => {
    expect(md('<details>\n<summary>More</summary>\n\nInside.\n\n</details>')).toBe('**More**\n\nInside.');
  });

  it('turns img tags into links and br into newlines', () => {
    expect(md('a<br>b')).toBe('a\nb');
    expect(md('<img src="https://img.example/c.png" alt="Chart">')).toBe(
      '[Chart](<https://img.example/c.png>)',
    );
  });

  it('keeps the text inside unknown tags', () => {
    expect(md('Press <kbd>Ctrl</kbd>')).toBe('Press Ctrl');
  });
});

describe('githubToDiscord: options', () => {
  it('drops a leading heading that repeats the version', () => {
    const input =
      '## [17.11.2](https://github.com/googleapis/release-please/compare/v17.11.1...v17.11.2) (2026-08-24)\n\n### Bug Fixes\n\n* bump deps';
    const out = githubToDiscord(input, { dropLeadingHeading: (text) => text.includes('17.11.2') });
    expect(out.text).toBe('### Bug Fixes\n- bump deps');
  });

  it('cuts long notes at a block boundary and reports it', () => {
    const input = Array.from({ length: 50 }, (_, i) => `Paragraph ${i} ${'x'.repeat(80)}`).join('\n\n');
    const out = githubToDiscord(input, { maxLength: 500 });
    expect(out.truncated).toBe(true);
    expect(out.text.length).toBeLessThanOrEqual(500);
    expect(out.text.endsWith('x')).toBe(true);
  });

  it('closes a code fence it had to cut through', () => {
    const input = `\`\`\`\n${Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n')}\n\`\`\``;
    const out = githubToDiscord(input, { maxLength: 200 });
    expect(out.truncated).toBe(true);
    expect(out.text.length).toBeLessThanOrEqual(200);
    expect(out.text.endsWith('\n```')).toBe(true);
  });

  it('reports not truncated when everything fits', () => {
    expect(githubToDiscord('short', { maxLength: 100 })).toEqual({ text: 'short', truncated: false });
  });
});

describe('githubToDiscord: real releases', () => {
  const fixtures = ['discordjs', 'release-please', 'biome', 'gh-cli'];
  for (const name of fixtures) {
    it(`converts ${name} within the limit without raw mentions`, () => {
      const release = JSON.parse(readFileSync(`test/fixtures/releases/${name}.json`, 'utf8'));
      const out = githubToDiscord(release.body, {
        repo: release.html_url.split('/').slice(3, 5).join('/'),
        maxLength: 3500,
      });
      expect(out.text.length).toBeGreaterThan(0);
      expect(out.text.length).toBeLessThanOrEqual(3500);
      expect(out.text).not.toMatch(/(?<!\\)<@/);
      expect(out.text).not.toMatch(/https:\/\/github\.com\/[^\s>)]+(?![^\s]*>)\s/);
    });
  }
});
