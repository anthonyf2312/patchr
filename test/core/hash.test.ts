import { describe, expect, it } from 'vitest';
import { noteHash } from '../../src/core/hash.js';
import { sampleNote } from '../helpers/fakes.js';

describe('noteHash', () => {
  it('is stable for the same note', () => {
    expect(noteHash(sampleNote())).toBe(noteHash(sampleNote()));
  });

  it('changes when anything shown changes', () => {
    const base = noteHash(sampleNote());
    expect(noteHash(sampleNote({ body: 'other' }))).not.toBe(base);
    expect(noteHash(sampleNote({ title: 'New name' }))).not.toBe(base);
    expect(noteHash(sampleNote({ prerelease: true }))).not.toBe(base);
  });

  it('ignores key order', () => {
    const note = sampleNote();
    const reordered = Object.fromEntries(Object.entries(note).reverse()) as typeof note;
    expect(noteHash(reordered)).toBe(noteHash(note));
  });
});
