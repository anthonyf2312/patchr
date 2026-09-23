import { z } from 'zod';

const optional = z
  .string()
  .trim()
  .transform((value) => (value === '' ? undefined : value))
  .optional();

const TOKEN_MISSING = 'is missing. Copy .env.example to .env and add your bot token.';

const schema = z.object({
  DISCORD_TOKEN: z.string({ error: TOKEN_MISSING }).trim().min(1, TOKEN_MISSING),
  /** Postgres connection string. Leave it unset to use the built-in PGlite database. */
  DATABASE_URL: optional,
  PGLITE_DIR: z.string().default('./data/pglite'),
  /** A fine-grained token with read-only access to public repositories. Without one GitHub allows 60 requests an hour. */
  GITHUB_TOKEN: optional,
  POLL_INTERVAL_SECONDS: z.coerce.number().int().min(60).default(180),
  /** Registers commands in one server only, where changes show up instantly. For development. */
  DEV_GUILD_ID: optional,
  /** Port for the /healthz endpoint. 0 turns it off. */
  HEALTH_PORT: z.coerce.number().int().min(0).max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  MAX_FEEDS_PER_GUILD: z.coerce.number().int().min(1).max(100).default(25),
  SUPPORT_URL: optional.pipe(z.url().optional()),
  REPO_URL: z.url().default('https://github.com/anthonyf2312/patchr'),
  WEBSITE_URL: z.url().default('https://anthonyf2312.github.io/patchr'),
  NODE_ENV: z.string().default('production'),
});

export type Config = z.infer<typeof schema>;

/** Reads the environment once at startup and stops with a clear message if anything is wrong. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = schema.safeParse(env);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid configuration:\n${problems}`);
  }
  return result.data;
}
