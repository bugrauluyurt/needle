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

## Releases

One version for the whole repo, in every `package.json`. Add what changed as a file,
`changelog.d/<name>.<heading>.md`, written for people running Needle, never as an edit
to `CHANGELOG.md`. The heading sets the next version: breaking or removed (major),
added, changed or deprecated (minor), fixed or security (patch); `changelog.d/README.md`
has the format. One file per change keeps pull requests from conflicting over the
changelog. `scripts/changelog.py` reads them; it is shared with homelab-media-stack, so
keep the two copies identical.

On every push to `main` a bot keeps a "chore(release): vX.Y.Z" pull request open that bumps
the versions and writes the entries into `CHANGELOG.md`. GitHub holds its CI until a
maintainer approves the run (**Approve workflows to run** on the pull request). Once
`checks` passes and the e2e suite does too, approve the pull request and merge it:
that tags `vX.Y.Z`, publishes the GitHub release with the source archive and its
provenance, and pushes amd64 and arm64 images to `ghcr.io/bugrauluyurt/needle` with
build provenance. `main` takes a pull request only with a passing `checks` run and
another person's approval; maintainers merge their own through the admin bypass.

## Conventions

- Commits and pull request titles follow Conventional Commits (`type(scope): summary`, at
  most 72 characters, lowercase, imperative); the body says why. `CONTRIBUTING.md` has the
  types and scopes, and `.githooks/commit-msg` checks them
  (`git config core.hooksPath .githooks`).
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
  `status.ts` is Settings → Connections: add a check there when adding an integration.
  `people.ts` decides who may request music or use Spotify: a new route that fetches
  music or calls Spotify must go through `needLidarr` / `needSongs` / `needSpotify` in `app.ts`.
- `.github/workflows`: CI, the release pull request, the release itself and
  Scorecard. Pin every action to a full commit SHA with a `# vX.Y.Z` comment, and the
  Dockerfile's base image to a digest; Dependabot moves both.
- `examples/`: compose files, `.env.example` and a Caddyfile that the README walks
  through. Validate with `docker compose -f … config` after changing them.
- `docs/media/`: README images; `make-hero.sh` renders `hero.html` (with `home.png` and `phone-player.png`) to `hero.png` and `social-preview.png` in headless Chromium.
- `e2e/fixtures`: `make-library.ts` generates the test library, `seed.ts` resets
  the test Navidrome and play log.
