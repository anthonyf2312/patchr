import {
  type Guild,
  LabelBuilder,
  ModalBuilder,
  type ModalSubmitInteraction,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { NOTES_MAX_LENGTH, TITLE_MAX_LENGTH, VERSION_MAX_LENGTH } from '../core/limits.js';
import type { PatchNote } from '../core/patch-note.js';
import { strings } from '../strings.js';

export interface NoteFields {
  version: string;
  title?: string;
  notes: string;
}

/** The form behind `/patch` and "Edit patch note", optionally pre-filled. */
export function noteModal(customId: string, title: string, values?: NoteFields): ModalBuilder {
  const version = new TextInputBuilder()
    .setCustomId('version')
    .setStyle(TextInputStyle.Short)
    .setMaxLength(VERSION_MAX_LENGTH)
    .setRequired(true);
  const name = new TextInputBuilder()
    .setCustomId('title')
    .setStyle(TextInputStyle.Short)
    .setMaxLength(TITLE_MAX_LENGTH)
    .setRequired(false);
  const notes = new TextInputBuilder()
    .setCustomId('notes')
    .setStyle(TextInputStyle.Paragraph)
    .setMaxLength(NOTES_MAX_LENGTH)
    .setRequired(true);

  if (values?.version) version.setValue(values.version.slice(0, VERSION_MAX_LENGTH));
  if (values?.title) name.setValue(values.title.slice(0, TITLE_MAX_LENGTH));
  if (values?.notes) notes.setValue(values.notes.slice(0, NOTES_MAX_LENGTH));

  return new ModalBuilder()
    .setCustomId(customId)
    .setTitle(title)
    .addLabelComponents(
      new LabelBuilder()
        .setLabel(strings.patch.versionLabel)
        .setDescription(strings.patch.versionHint)
        .setTextInputComponent(version),
      new LabelBuilder()
        .setLabel(strings.patch.titleLabel)
        .setDescription(strings.patch.titleHint)
        .setTextInputComponent(name),
      new LabelBuilder()
        .setLabel(strings.patch.notesLabel)
        .setDescription(strings.patch.notesHint)
        .setTextInputComponent(notes),
    );
}

export function readNoteFields(interaction: ModalSubmitInteraction): NoteFields {
  const title = interaction.fields.getTextInputValue('title').trim();
  return {
    version: interaction.fields.getTextInputValue('version').trim(),
    ...(title && { title }),
    notes: interaction.fields.getTextInputValue('notes').trimEnd(),
  };
}

export function fieldsOf(note: PatchNote): NoteFields {
  return { version: note.version, ...(note.title && { title: note.title }), notes: note.body };
}

/** A manual note: the server is the project, and the person who wrote it is credited. */
export function manualNote(
  guild: Guild,
  fields: NoteFields,
  author: { id: string; name: string },
): PatchNote {
  const icon = guild.iconURL({ size: 128, extension: 'png' });
  return {
    source: 'manual',
    project: { name: guild.name, ...(icon && { iconUrl: icon }) },
    version: fields.version,
    ...(fields.title && { title: fields.title }),
    body: fields.notes,
    prerelease: false,
    publishedAt: new Date().toISOString(),
    author: { name: author.name, discordId: author.id },
  };
}

/** Applies edited fields to a note, keeping who wrote it and when. */
export function withFields(note: PatchNote, fields: NoteFields): PatchNote {
  const { title: _, ...rest } = note;
  return {
    ...rest,
    version: fields.version,
    ...(fields.title && { title: fields.title }),
    body: fields.notes,
  };
}
