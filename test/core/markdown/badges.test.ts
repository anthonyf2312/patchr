import { describe, expect, it } from 'vitest';
import { applyBadges, badgeForHeading } from '../../../src/core/markdown/badges.js';

describe('badgeForHeading', () => {
  it.each([
    ['New Features', 'new'],
    ['Added', 'new'],
    ["What's New", 'new'],
    ['✨ Features', 'new'],
    ['Enhancements', 'new'],
    ['Bug Fixes', 'fix'],
    ['Fixes', 'fix'],
    ['Fixed', 'fix'],
    ['🐛 Hotfix', 'fix'],
    ['Changed', 'change'],
    ["What's Changed", 'change'],
    ['Improvements', 'change'],
    ['Patch Changes', 'change'],
    ['Breaking Changes', 'change'],
  ])('%s is %s', (heading, badge) => {
    expect(badgeForHeading(heading)).toBe(badge);
  });

  it.each(['New Contributors', 'Documentation', 'Security', '2.5.14', 'Linux package signing'])(
    '%s has no badge',
    (heading) => {
      expect(badgeForHeading(heading)).toBeUndefined();
    },
  );
});

describe('applyBadges', () => {
  const emojis = { new: '<:new:1>', fix: '<:fix:2>', change: '<:change:3>' };

  it('puts the badge after the heading marks', () => {
    expect(applyBadges('### Bug Fixes\n- one', emojis)).toBe('### <:fix:2> Bug Fixes\n- one');
    expect(applyBadges('# Added', emojis)).toBe('# <:new:1> Added');
  });

  it('badges a line that is entirely bold', () => {
    expect(applyBadges('**Changed**\n- two', emojis)).toBe('**<:change:3> Changed**\n- two');
  });

  it('leaves headings that already start with an emoji', () => {
    expect(applyBadges('### ✨ Features', emojis)).toBe('### ✨ Features');
    expect(applyBadges('### <:custom:9> Features', emojis)).toBe('### <:custom:9> Features');
  });

  it('ignores headings inside code blocks', () => {
    expect(applyBadges('```md\n## Fixes\n```', emojis)).toBe('```md\n## Fixes\n```');
  });

  it('leaves headings alone when that emoji is not available', () => {
    expect(applyBadges('### Bug Fixes', { new: '<:new:1>' })).toBe('### Bug Fixes');
  });
});
