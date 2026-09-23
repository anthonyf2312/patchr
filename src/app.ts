import type { Logger } from 'pino';
import type { Config } from './config.js';
import type { Deliverer } from './core/deliver.js';
import type { RenderOptions } from './core/render/card.js';
import type { Database } from './db/client.js';
import type { GitHubApi } from './sources/github/api.js';

/** Everything command handlers need, passed in rather than imported, so handlers stay testable. */
export interface App {
  config: Config;
  db: Database;
  deliverer: Deliverer;
  github: GitHubApi;
  log: Logger;
  version: string;
  emojis: () => RenderOptions['emojis'];
}
