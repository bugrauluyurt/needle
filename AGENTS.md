# Agent guide: Needle

Music player for Navidrome. See README.md for what it does and how it's put together.

## Commands

```bash
pnpm lint          # ESLint (type-aware)
pnpm typecheck     # tsc in every package
pnpm test          # Vitest unit tests
pnpm e2e           # Playwright; build the web app first
pnpm dev           # server + Vite against the test Navidrome
```

Run lint, typecheck and the unit tests after every change; run the e2e suite after
anything that touches the UI or the player.

## Conventions

- `type`, never `interface`; never `any`; `??` over `||`.
- Relative imports only (no `~/` or `@/` aliases). Other packages by name
  (`@needle/shared`).
- No comments unless something is genuinely non-obvious.
- Don't repeat yourself: shared UI lives in `apps/web/src/components`, shared types
  in `packages/shared`.
- Styles are plain CSS in `apps/web/src/styles`, following the approved design:
  tokens in `global.css`, desktop layout in `layout.css`, phone in `mobile.css`.
- The server runs TypeScript with Node's type stripping, so no enums, namespaces
  or constructor parameter properties there.
- Copy is plain and specific, sentence case, active voice.

## Layout

- `apps/web/src/player`: the audio engine (two elements, Web Audio for crossfade and
  ReplayGain except on iOS), queue rules (`queue.ts`, pure and tested), and the
  controller that ties them to scrobbling, lock-screen controls and queue sync.
- `apps/web/src/offline`: downloads in Cache Storage, metadata in IndexedDB.
- `apps/web/src/remote`: the device hub client.
- `apps/server/src`: `app.ts` wires the routes; one file per integration.
- `e2e/fixtures`: `make-library.ts` generates the test library, `seed.ts` resets
  the test Navidrome and play log.
