# Contributing

Thanks for helping. Bug reports, fixes and small improvements are all welcome. For anything bigger, open an issue first so we can agree on the approach before you spend time on it.

## Setup

You need Node 24 or newer. No database is needed: Patchr uses PGlite when `DATABASE_URL` is unset.

```sh
npm install
cp .env.example .env   # add a test bot token, and set DEV_GUILD_ID to your test server
npm run dev
```

Before opening a pull request:

```sh
npm run check && npm run typecheck && npm test
```

## Conventions

- **Tests first.** A change in behaviour comes with a test that fails without it. Database code is tested against in-memory PGlite (`test/helpers/db.ts`), and Discord and GitHub are replaced with small fakes (`test/helpers/fakes.ts`).
- **Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/)**, because the release notes are built from them: `feat:` goes under New, `fix:` under Fixes, and `perf:` and `deps:` under Changes. Other types (`docs:`, `chore:`, `refactor:`, `test:`, `ci:`) are left out of the notes.
- **Schema changes:** edit `src/db/schema.ts`, run `npm run db:generate`, and commit the new file in `drizzle/`. CI fails if you forget.
- **User-facing text** lives in `src/strings.ts`.
- **Formatting** is Biome's (`npm run format`).

## How the code is laid out

```
src/
  core/           PatchNote, markdown conversion, the card renderer, delivery
  sources/github/ GitHub API client, poller, release to PatchNote
  commands/       slash commands, the context menu, and their buttons and modals
  interactions/   routing and shared message helpers
  discord/        client setup, permission checks, command and emoji sync
  store/          database queries used by commands
  db/             schema and database connection
```

## How it works

```
GitHub ──poll (ETag)──▶ GitHub source ──┐
                                        ├──▶ PatchNote ──▶ render ──▶ deliver ──▶ Discord
/patch ──form ▶ preview ────────────────┘
```

- **Polling, not webhooks.** A webhook sent while the bot restarts is lost. Patchr keeps its state in the database and catches up after downtime, including a restart caused by its own release.
- **Exactly once.** A post is claimed in the database before it's sent, and carries a fixed nonce, so a crash mid-send can't post twice.
- **Safe by default.** Only the chosen role can be pinged, private repos and drafts never post, and Patchr won't post or ping anywhere the person asking couldn't.
- **Paced.** One check per repo however many servers follow it. Unchanged checks are free, requests are capped at 600 a minute, and quiet repos are checked less often.

## Adding a source

Every source ends up as a `PatchNote` (`src/core/patch-note.ts`) and goes through `Deliverer`, so a new source (GitLab, Modrinth, an RSS feed…) only has to:

1. fetch releases and turn each one into a `PatchNote`;
2. decide which feeds should get it, and call `deliverer.deliverRelease(feed, releaseKey, note, noteHash(note))`;
3. call `deliverer.editPost` when a release changes.

`src/sources/github/` is the example to follow. Delivery already takes care of never posting twice, pings, crossposting and pausing a feed.

## Releases

Releases are automated. Merging to `main` keeps a release PR up to date. Merging that PR tags the release, writes `CHANGELOG.md` and publishes the Docker image. Patchr posts its own release notes, so a clear commit message becomes a clear patch note.

To release a specific version (for example 1.0.0 at launch), add a `Release-As: 1.0.0` footer to a commit.
