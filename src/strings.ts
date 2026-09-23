import type { PauseReason } from './core/deliver.js';
import { NOTES_MAX_LENGTH } from './core/limits.js';

/**
 * Everything Patchr says to people, in one place, so the voice stays consistent and the text
 * can be translated later without touching command code.
 */

const channel = (id: string) => `<#${id}>`;
const role = (id: string) => `<@&${id}>`;
const notesLimit = NOTES_MAX_LENGTH.toLocaleString('en-US');

export const strings = {
  generic: {
    error: (code: string) =>
      `Something went wrong on Patchr's side. Try again, and if it keeps happening, report error \`${code}\`.`,
    guildOnly: 'Patchr works inside servers.',
    githubDown: "GitHub didn't answer. Try again in a minute.",
  },

  channel: {
    none: 'Pick a channel, or set a default one with `/settings channel`.',
    gone: 'The default channel no longer exists. Pick a channel, or set a new default with `/settings channel`.',
    deleted: 'That channel no longer exists. Pick another one with the `channel` option.',
    wrongType: 'Patchr posts in text and announcement channels.',
    memberCannotPost: (id: string) =>
      `You can't post in ${channel(id)} yourself, so Patchr won't post there for you.`,
    missing: (id: string, permissions: string[]) =>
      `I can't post in ${channel(id)} yet. I need **${permissions.join('**, **')}** there. Fix the channel's permissions, then try again.`,
  },

  ping: {
    everyone: "@everyone can't be the ping role. Pick a role people opt into.",
    memberCannot: (id: string) => `You can't mention ${role(id)} yourself, so Patchr won't ping it for you.`,
    notMentionable: (id: string) =>
      `Heads-up: ${role(id)} isn't mentionable, so posts won't ping it. Turn on **Allow anyone to @mention this role** in Server Settings → Roles, or give Patchr **Mention All Roles**.`,
  },

  patch: {
    modalTitle: 'New patch note',
    editModalTitle: 'Edit patch note',
    versionLabel: 'Version',
    versionHint: 'For example 1.4.0, or Season 3',
    titleLabel: 'Title',
    titleHint: 'Optional. A name for this update',
    notesLabel: 'Notes',
    notesHint: `Discord markdown works. Up to ${notesLimit} characters.`,
    previewHeader: (channelId: string) =>
      `-# Preview. Only you can see this. It will post to ${channel(channelId)}.`,
    post: 'Post',
    edit: 'Edit',
    cancel: 'Cancel',
    pingOn: (roleName: string) => `Ping @${roleName}: on`,
    pingOff: (roleName: string) => `Ping @${roleName}: off`,
    posted: (url: string, channelId: string) => `Posted to ${channel(channelId)}. [Jump to it](${url})`,
    discarded: 'Discarded. Nothing was posted.',
    expired: 'This preview expired. Run `/patch` again.',
    notYours: 'This preview belongs to someone else.',
    retry: "Discord didn't take the post. Try again in a moment.",
  },

  editNote: {
    notPatchr: "That message isn't a Patchr post.",
    fromGithub:
      'This post comes from a GitHub release. Edit the release on GitHub and Patchr updates the post within a few minutes.',
    gone: "That post's message is gone, so there's nothing to edit.",
    updated: 'Updated.',
    failed: "Discord didn't take the edit. Try again in a moment.",
  },

  feed: {
    invalidRepo: "That doesn't look like a GitHub repo. Use `owner/repo` or the repo's URL.",
    notFound: (name: string) => `I couldn't find **${name}** on GitHub. Patchr can only follow public repos.`,
    limit: (max: number) =>
      `This server already has ${max} feeds, the most Patchr allows. Remove one with \`/feed remove\` first.`,
    duplicate: (repo: string, channelId: string) => `**${repo}** already posts to ${channel(channelId)}.`,
    created: (repo: string, channelId: string, pingRoleId: string | null, prereleases: boolean) =>
      [
        `Watching **${repo}**. New releases post to ${channel(channelId)}${pingRoleId ? ` and ping ${role(pingRoleId)}` : ''}.`,
        prereleases ? 'Pre-releases are included.' : 'Pre-releases are skipped.',
        '-# Want to see a post now? Post the latest release.',
      ].join('\n'),
    postLatest: 'Post latest release',
    unknown: "I couldn't find that feed. Pick one from the list.",
    removed: (repo: string) => `Stopped watching **${repo}**. Posts already made stay where they are.`,
    updated: (repo: string) => `Updated **${repo}**.`,
    resumed: 'Posting again.',
    noReleases: 'That repo has no releases yet. Patchr posts the first one when it comes out.',
    latestPosted: (tag: string, url: string) => `Posted **${tag}**. [Jump to it](${url})`,
    latestAlready: 'The latest release is already posted there.',
    listTitle: '## Feeds',
    listEmpty: 'No feeds yet. Add one with `/feed add github`.',
    listLine: (repo: string, channelId: string, pingRoleId: string | null, prereleases: boolean) =>
      `**${repo}** → ${channel(channelId)}${pingRoleId ? ` · pings ${role(pingRoleId)}` : ''}${prereleases ? ' · pre-releases' : ''}`,
    paused: (reason: string) =>
      `-# ⚠️ Paused: ${reason}. Fix it, then run \`/feed edit\` on this feed to resume.`,
    repoUnavailable: "-# ⚠️ GitHub can't find this repo any more.",
    repoPrivate: '-# ⚠️ This repo is private now, so Patchr stopped following it.',
  },

  pauseReason: {
    unknown_channel: 'the channel was deleted',
    missing_access: "Patchr can't see the channel",
    missing_permissions: 'Patchr is missing permissions in the channel',
  } satisfies Record<PauseReason, string>,

  settings: {
    title: '## Settings',
    summary: (defaultChannelId: string | null, defaultPingRoleId: string | null, autoPublish: boolean) =>
      [
        `**Default channel for /patch:** ${defaultChannelId ? channel(defaultChannelId) : 'none'}`,
        `**Default ping role:** ${defaultPingRoleId ? role(defaultPingRoleId) : 'none'}`,
        `**Publish in announcement channels:** ${autoPublish ? 'on' : 'off'}`,
      ].join('\n'),
    saved: '-# Saved.',
  },

  help: {
    body: (maxFeeds: number) =>
      [
        '## Patchr',
        'Patch notes, posted beautifully.',
        '### GitHub releases',
        `\`/feed add github\` watches a public repo and posts each new release to the channel you pick. Up to ${maxFeeds} feeds per server, each with its own channel. Edit a release on GitHub and the post updates too.`,
        '### Custom notes',
        `\`/patch\` opens a form for the version, title and notes, then shows you a private preview before anything is posted. Notes can be up to ${notesLimit} characters, and Discord markdown works. To fix a post later, right-click it → **Apps** → **Edit patch note**.`,
        '### Pings and announcements',
        'Choose a role to ping for each feed or note, or set a default with `/settings`. In announcement channels, Patchr publishes the post so servers following the channel get it too.',
        '### Good to know',
        '- Patchr only follows public repos. Very long release notes are shortened, with a link to the rest.',
        '- In the channel it posts to, Patchr needs **View Channel**, **Send Messages** and **Embed Links**.',
        '- By default only members with **Manage Server** can use `/patch`, `/feed` and `/settings`. To let a role post notes, go to Server Settings → Integrations → Patchr.',
        '- Patchr only posts where you could post yourself, and only pings roles you could mention yourself.',
      ].join('\n'),
    footer: (version: string, websiteUrl: string, repoUrl: string, supportUrl: string | undefined) =>
      `-# Patchr ${version} · [Website](<${websiteUrl}>) · [Source](<${repoUrl}>)${supportUrl ? ` · [Support](<${supportUrl}>)` : ''}`,
  },
} as const;
