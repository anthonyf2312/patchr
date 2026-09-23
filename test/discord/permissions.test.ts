import { PermissionFlagsBits, PermissionsBitField } from 'discord.js';
import { describe, expect, it } from 'vitest';
import {
  memberCanPing,
  memberCanPost,
  missingPostPermissions,
  pingRoleProblem,
} from '../../src/discord/permissions.js';

const { ViewChannel, SendMessages, EmbedLinks, MentionEveryone } = PermissionFlagsBits;

describe('missingPostPermissions', () => {
  it('is empty when Patchr can post', () => {
    expect(missingPostPermissions(new PermissionsBitField([ViewChannel, SendMessages, EmbedLinks]))).toEqual(
      [],
    );
  });

  it('names what is missing', () => {
    expect(missingPostPermissions(new PermissionsBitField([ViewChannel]))).toEqual([
      'Send Messages',
      'Embed Links',
    ]);
  });

  it('treats unknown permissions as all missing', () => {
    expect(missingPostPermissions(null)).toEqual(['View Channel', 'Send Messages', 'Embed Links']);
  });
});

describe('memberCanPost', () => {
  it('needs the member to see and send in the channel themselves', () => {
    expect(memberCanPost(new PermissionsBitField([ViewChannel, SendMessages]))).toBe(true);
    expect(memberCanPost(new PermissionsBitField([ViewChannel]))).toBe(false);
    expect(memberCanPost(null)).toBe(false);
  });
});

describe('memberCanPing', () => {
  it('allows mentionable roles for anyone', () => {
    expect(memberCanPing({ mentionable: true }, new PermissionsBitField())).toBe(true);
  });

  it('allows other roles only for members who may mention every role', () => {
    expect(memberCanPing({ mentionable: false }, new PermissionsBitField())).toBe(false);
    expect(memberCanPing({ mentionable: false }, new PermissionsBitField([MentionEveryone]))).toBe(true);
  });
});

describe('pingRoleProblem', () => {
  const none = new PermissionsBitField();

  it('rejects @everyone', () => {
    expect(pingRoleProblem({ id: 'g1', mentionable: true }, 'g1', none)).toBe('everyone');
  });

  it('flags a role that will not ping', () => {
    expect(pingRoleProblem({ id: 'r1', mentionable: false }, 'g1', none)).toBe('not_mentionable');
  });

  it('accepts a mentionable role, or any role when Patchr can mention all roles', () => {
    expect(pingRoleProblem({ id: 'r1', mentionable: true }, 'g1', none)).toBeUndefined();
    expect(
      pingRoleProblem({ id: 'r1', mentionable: false }, 'g1', new PermissionsBitField([MentionEveryone])),
    ).toBeUndefined();
  });
});
