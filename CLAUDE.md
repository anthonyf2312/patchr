# Patchr: notes for AI-assisted work

Discord bot (discord.js 14, TypeScript, Node 24, ESM) that posts GitHub releases and `/patch` notes. See README.md for what it does and CONTRIBUTING.md for conventions.

## Commands

- `npm test` (Vitest; database tests use in-memory PGlite, no setup needed)
- `npm run check` / `npm run format` (Biome)
- `npm run typecheck`
- `npm run db:generate` after any change to `src/db/schema.ts` (commit `drizzle/`)

## Rules that matter

- Every source produces a `PatchNote`, and every post goes through `renderCard` and `Deliverer`. Don't post to Discord any other way.
- Messages must pass `allowedMentions` that allow only the chosen role. Never `parse: ['everyone']`.
- Delivery must stay idempotent: claim the `posts` row first, and send with `deliveryNonce` and `enforce_nonce`.
- Never post drafts, and never follow private repos.
- A Components V2 message holds at most 4,000 characters of text in total. `renderCard` enforces this; keep it that way.
- User-facing text goes in `src/strings.ts`. Keep the voice plain and direct.
- Imports use `.js` extensions (NodeNext). `erasableSyntaxOnly` is on, so no enums or parameter properties.
- Write tests first. Discord and GitHub are faked in `test/helpers/fakes.ts`.
- Commits use Conventional Commits. They become Patchr's own patch notes, so write them for server owners.
