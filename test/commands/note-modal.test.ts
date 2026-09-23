import type { Guild } from 'discord.js';
import { describe, expect, it } from 'vitest';
import { fieldsOf, manualNote, withFields } from '../../src/commands/note-modal.js';
import { sampleNote } from '../helpers/fakes.js';

const guild = {
  name: 'Survival Server',
  iconURL: () => 'https://cdn.discordapp.com/icons/1/a.png',
} as unknown as Guild;

describe('manualNote', () => {
  it('uses the server as the project and credits the writer', () => {
    const note = manualNote(
      guild,
      { version: '2.0', title: 'Map reset', notes: 'New map.' },
      { id: '42', name: 'Anthony' },
    );
    expect(note).toMatchObject({
      source: 'manual',
      project: { name: 'Survival Server', iconUrl: 'https://cdn.discordapp.com/icons/1/a.png' },
      version: '2.0',
      title: 'Map reset',
      body: 'New map.',
      prerelease: false,
      author: { name: 'Anthony', discordId: '42' },
    });
  });

  it('leaves out an empty title and a missing icon', () => {
    const plain = { name: 'X', iconURL: () => null } as unknown as Guild;
    const note = manualNote(plain, { version: '1', notes: 'n' }, { id: '1', name: 'A' });
    expect(note).not.toHaveProperty('title');
    expect(note.project).toEqual({ name: 'X' });
  });
});

describe('withFields', () => {
  it('replaces the text but keeps the author and date', () => {
    const original = sampleNote({ source: 'manual', title: 'Old', author: { name: 'A', discordId: '1' } });
    const edited = withFields(original, { version: '1.1', notes: 'New text' });
    expect(edited).toMatchObject({ version: '1.1', body: 'New text', author: { discordId: '1' } });
    expect(edited.publishedAt).toBe(original.publishedAt);
    expect(edited).not.toHaveProperty('title');
  });

  it('round-trips through the form fields', () => {
    const note = sampleNote({ title: 'Liftoff' });
    expect(withFields(note, fieldsOf(note))).toEqual(note);
  });
});
