import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('applies defaults', () => {
    const config = loadConfig({ DISCORD_TOKEN: 'abc' });
    expect(config).toMatchObject({
      DISCORD_TOKEN: 'abc',
      POLL_INTERVAL_SECONDS: 180,
      HEALTH_PORT: 3000,
      MAX_FEEDS_PER_GUILD: 25,
      REPO_URL: 'https://github.com/anthonyf2312/Patchr-bot',
      WEBSITE_URL: 'https://anthonyf2312.github.io/patchr',
    });
    expect(config.DATABASE_URL).toBeUndefined();
  });

  it('treats empty strings as unset', () => {
    const config = loadConfig({ DISCORD_TOKEN: 'abc', DATABASE_URL: '', GITHUB_TOKEN: ' ', SUPPORT_URL: '' });
    expect(config.DATABASE_URL).toBeUndefined();
    expect(config.GITHUB_TOKEN).toBeUndefined();
    expect(config.SUPPORT_URL).toBeUndefined();
  });

  it('explains what is wrong', () => {
    expect(() => loadConfig({ POLL_INTERVAL_SECONDS: '5' })).toThrow(
      /DISCORD_TOKEN[\s\S]*POLL_INTERVAL_SECONDS/,
    );
  });
});
