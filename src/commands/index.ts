import type { Command, ComponentHandler } from '../interactions/types.js';
import { editNoteCommand } from './edit-note.js';
import { feedButtons, feedCommand } from './feed.js';
import { helpCommand } from './help.js';
import { draftButtons, patchCommand, patchModals } from './patch.js';
import { settingsCommand } from './settings.js';

export const commands: Command[] = [patchCommand, feedCommand, settingsCommand, helpCommand, editNoteCommand];

export const componentHandlers: ComponentHandler[] = [patchModals, draftButtons, feedButtons];
