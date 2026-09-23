import { describe, expect, it } from 'vitest';
import { escapeDiscord } from '../../../src/core/markdown/escape.js';

describe('escapeDiscord', () => {
  it('leaves plain words alone', () => {
    expect(escapeDiscord('Fixed a crash on startup')).toBe('Fixed a crash on startup');
  });

  it('escapes inline markdown characters', () => {
    expect(escapeDiscord('snake_case and *stars* ~~x~~ `code` ||spoiler||')).toBe(
      'snake\\_case and \\*stars\\* \\~\\~x\\~\\~ \\`code\\` \\|\\|spoiler\\|\\|',
    );
  });

  it('neutralises mentions, channels, timestamps and custom emoji', () => {
    expect(escapeDiscord('<@123> <@&456> <#789> <t:1:R> <:x:1>')).toBe(
      '\\<@123> \\<@&456> \\<#789> \\<t:1:R> \\<:x:1>',
    );
  });

  it('escapes masked-link brackets', () => {
    expect(escapeDiscord('[click](https://evil.example)')).toBe('\\[click\\](https://evil.example)');
  });

  it('escapes block syntax at the start of a line', () => {
    expect(escapeDiscord('# big\n-# small\n> quote\n- item\n1. first')).toBe(
      '\\# big\n\\-# small\n\\> quote\n\\- item\n1\\. first',
    );
  });

  it('does not escape block characters in the middle of a line', () => {
    expect(escapeDiscord('a - b > c # d 1. e')).toBe('a - b > c # d 1. e');
  });

  it('escapes backslashes first so escapes are not doubled', () => {
    expect(escapeDiscord('C:\\path_x')).toBe('C:\\\\path\\_x');
  });
});
