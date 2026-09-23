import type {
  AutocompleteInteraction,
  ButtonInteraction,
  ChatInputCommandInteraction,
  MessageContextMenuCommandInteraction,
  ModalSubmitInteraction,
  RESTPostAPIApplicationCommandsJSONBody,
} from 'discord.js';
import type { App } from '../app.js';

export interface Command {
  data: RESTPostAPIApplicationCommandsJSONBody;
  chatInput?(interaction: ChatInputCommandInteraction<'cached'>, app: App): Promise<void>;
  messageContextMenu?(interaction: MessageContextMenuCommandInteraction<'cached'>, app: App): Promise<void>;
  autocomplete?(interaction: AutocompleteInteraction<'cached'>, app: App): Promise<void>;
}

/** Handles buttons and modals whose custom id starts with `namespace:`. */
export interface ComponentHandler {
  namespace: string;
  button?(interaction: ButtonInteraction<'cached'>, app: App, action: string, args: string[]): Promise<void>;
  modal?(
    interaction: ModalSubmitInteraction<'cached'>,
    app: App,
    action: string,
    args: string[],
  ): Promise<void>;
}
