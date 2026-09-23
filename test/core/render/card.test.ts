import {
  type APIActionRowComponent,
  type APIButtonComponentWithURL,
  type APIContainerComponent,
  type APIMessageTopLevelComponent,
  type APISectionComponent,
  type APITextDisplayComponent,
  ComponentType,
  MessageFlags,
} from 'discord.js';
import { describe, expect, it } from 'vitest';
import { BRAND_COLOR, MESSAGE_TEXT_LIMIT, NOTES_MAX_LENGTH } from '../../../src/core/limits.js';
import type { PatchNote } from '../../../src/core/patch-note.js';
import { renderCard } from '../../../src/core/render/card.js';

const release: PatchNote = {
  source: 'github',
  project: {
    name: 'acme/rocket',
    url: 'https://github.com/acme/rocket',
    iconUrl: 'https://avatars.githubusercontent.com/u/1',
  },
  version: 'v1.2.0',
  title: 'Liftoff',
  body: '### Bug Fixes\n- Fixed the thing',
  url: 'https://github.com/acme/rocket/releases/tag/v1.2.0',
  compareUrl: 'https://github.com/acme/rocket/compare/v1.1.0...v1.2.0',
  prerelease: false,
  publishedAt: '2026-09-23T12:00:00Z',
  author: { name: 'octo', url: 'https://github.com/octo' },
};

const manual: PatchNote = {
  source: 'manual',
  project: { name: 'Survival Server' },
  version: '2.0',
  body: 'Map reset.',
  prerelease: false,
  publishedAt: '2026-09-23T12:00:00Z',
  author: { name: 'Anthony', discordId: '42' },
};

function container(components: APIMessageTopLevelComponent[]): APIContainerComponent {
  const found = components.find((c) => c.type === ComponentType.Container);
  if (!found || found.type !== ComponentType.Container) throw new Error('no container');
  return found;
}

function texts(components: APIMessageTopLevelComponent[]): string[] {
  const out: string[] = [];
  const walk = (list: readonly { type: ComponentType }[]) => {
    for (const c of list) {
      if (c.type === ComponentType.TextDisplay) out.push((c as APITextDisplayComponent).content);
      if ('components' in c && Array.isArray(c.components)) walk(c.components);
    }
  };
  walk(components);
  return out;
}

function buttons(components: APIMessageTopLevelComponent[]): APIButtonComponentWithURL[] {
  const row = container(components).components.find((c) => c.type === ComponentType.ActionRow) as
    | APIActionRowComponent<APIButtonComponentWithURL>
    | undefined;
  return row?.components ?? [];
}

describe('renderCard', () => {
  it('marks the message as Components V2', () => {
    expect(renderCard(release).flags).toBe(MessageFlags.IsComponentsV2);
  });

  it('wraps the note in a pink container', () => {
    expect(container(renderCard(release).components).accent_color).toBe(BRAND_COLOR);
  });

  it('puts the project, version and title in the header next to the icon', () => {
    const section = container(renderCard(release).components).components[0] as APISectionComponent;
    expect(section.type).toBe(ComponentType.Section);
    expect(section.components[0]?.content).toBe(
      '-# [acme/rocket](<https://github.com/acme/rocket>)\n## v1.2.0 · Liftoff',
    );
    expect(section.accessory).toMatchObject({
      type: ComponentType.Thumbnail,
      media: { url: 'https://avatars.githubusercontent.com/u/1' },
    });
  });

  it('uses a plain header without a title or icon', () => {
    const first = container(renderCard(manual).components).components[0] as APITextDisplayComponent;
    expect(first.type).toBe(ComponentType.TextDisplay);
    expect(first.content).toBe('-# Survival Server\n## 2.0');
  });

  it('escapes user-written header text', () => {
    const card = renderCard({ ...manual, project: { name: '<@1> **Server**' }, title: '_hi_' });
    expect(texts(card.components)[0]).toBe('-# \\<@1> \\*\\*Server\\*\\*\n## 2.0 · \\_hi\\_');
  });

  it('applies badges to the body', () => {
    const card = renderCard(release, { emojis: { fix: '<:fix:2>' } });
    expect(texts(card.components)).toContain('### <:fix:2> Bug Fixes\n- Fixed the thing');
  });

  it('says so when there are no notes', () => {
    expect(texts(renderCard({ ...manual, body: '  ' }).components)).toContain('*No notes for this release.*');
  });

  it('credits the GitHub author and the release date in the footer', () => {
    const footer = texts(renderCard(release, { emojis: { patchr: '<:patchr:7>' } }).components).at(-1);
    expect(footer).toBe('-# <:patchr:7> Released <t:1790164800:D> · by [@octo](<https://github.com/octo>)');
  });

  it('credits the Discord author of a manual note', () => {
    expect(texts(renderCard(manual).components).at(-1)).toBe('-# Posted <t:1790164800:D> · by <@42>');
  });

  it('flags pre-releases', () => {
    expect(texts(renderCard({ ...release, prerelease: true }).components).at(-1)).toContain(
      'Pre-release · Released',
    );
  });

  it('links to the full notes when the body was shortened', () => {
    const all = texts(renderCard({ ...release, truncated: true }).components);
    expect(all).toContain(
      '-# Notes shortened. [Read the full notes](<https://github.com/acme/rocket/releases/tag/v1.2.0>)',
    );
  });

  it('adds link buttons for the release and the changelog', () => {
    expect(buttons(renderCard(release).components).map((b) => [b.label, b.url])).toEqual([
      ['View on GitHub', 'https://github.com/acme/rocket/releases/tag/v1.2.0'],
      ['Full changelog', 'https://github.com/acme/rocket/compare/v1.1.0...v1.2.0'],
    ]);
  });

  it('has no buttons without links', () => {
    expect(buttons(renderCard(manual).components)).toEqual([]);
  });

  it('pings only the chosen role', () => {
    const card = renderCard(release, { pingRoleId: '999' });
    expect(card.components[0]).toEqual({ type: ComponentType.TextDisplay, content: '<@&999>' });
    expect(card.allowedMentions).toEqual({ parse: [], roles: ['999'] });
  });

  it('allows no mentions at all without a ping role', () => {
    expect(renderCard(release).allowedMentions).toEqual({ parse: [], roles: [] });
  });

  it('leaves room for text the caller adds around the card', () => {
    const long: PatchNote = { ...manual, body: 'word '.repeat(800).trim() };
    const card = renderCard(long, { reservedText: 1000 });
    expect(texts(card.components).join('').length).toBeLessThanOrEqual(MESSAGE_TEXT_LIMIT - 1000);
  });

  it('stays within the message text limit with maximum-size parts', () => {
    const huge: PatchNote = {
      ...release,
      project: { ...release.project, name: 'n'.repeat(300) },
      version: 'v'.repeat(300),
      title: 't'.repeat(300),
      body: `${'line of notes\n'.repeat(400)}`.slice(0, NOTES_MAX_LENGTH + 500),
    };
    const card = renderCard(huge, { pingRoleId: '999', emojis: { patchr: '<:patchr:1234567890123456789>' } });
    const total = texts(card.components).join('').length;
    expect(total).toBeLessThanOrEqual(MESSAGE_TEXT_LIMIT);
    expect(texts(card.components).some((t) => t.includes('Notes shortened'))).toBe(true);
  });
});
