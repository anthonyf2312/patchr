import { describe, expect, it } from 'vitest';
import { parseRepoInput } from '../../../src/sources/github/repo-input.js';

describe('parseRepoInput', () => {
  it.each([
    ['acme/rocket', 'acme', 'rocket'],
    [' acme/rocket/ ', 'acme', 'rocket'],
    ['https://github.com/acme/rocket', 'acme', 'rocket'],
    ['https://github.com/acme/rocket.git', 'acme', 'rocket'],
    ['github.com/acme/rocket/releases/tag/v1.0.0', 'acme', 'rocket'],
    ['http://www.github.com/Acme/Rocket.js', 'Acme', 'Rocket.js'],
    ['anthonyf2312/Patchr-bot', 'anthonyf2312', 'Patchr-bot'],
  ])('reads %s', (input, owner, name) => {
    expect(parseRepoInput(input)).toEqual({ owner, name });
  });

  it.each([
    '',
    'acme',
    'a/b/c',
    'https://gitlab.com/a/b',
    '-bad/repo',
    'acme/..',
    'acme/.',
    'ac me/rocket',
    'acme/rock et',
  ])('rejects %j', (input) => {
    expect(parseRepoInput(input)).toBeNull();
  });
});
