# Agent guide: Needle

Music player for Navidrome. See README.md for what it does and how it's put together.

## Commands

```bash
pnpm format:check   # Prettier and Ruff formatting
pnpm lint           # ESLint and Ruff linting
pnpm typecheck      # TypeScript in every package and e2e
pnpm test           # Vitest and Python bridge tests
pnpm build          # production web build
pnpm e2e            # Playwright; build the web app first
pnpm dev            # server and Vite against the test Navidrome
```

Run format check, lint, typecheck and tests after every change. Run the build after
structural or dependency changes. Run e2e after changes to the UI, player, HTTP routes
or realtime behavior.

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
`checks` and `e2e` pass, approve the pull request and merge it:
that tags `vX.Y.Z`, publishes the GitHub release with the source archive and its
provenance, and pushes amd64 and arm64 images to `ghcr.io/bugrauluyurt/needle` with
build provenance. `main` takes a pull request only with passing `checks` and `e2e`
runs and another person's approval; maintainers merge their own through the admin bypass.

## Conventions

- Commits and pull request titles follow Conventional Commits (`type(scope): summary`, at
  most 72 characters, lowercase, imperative); the body says why. `CONTRIBUTING.md` has the
  types and scopes, and `.githooks/commit-msg` checks them
  (`git config core.hooksPath .githooks`).
- Prefer `type`. Use `interface` only when declaration merging requires it. Never
  use `any`; prefer `??` over `||` when nullish fallback is intended.
- Relative imports only (no `~/` or `@/` aliases). Other packages by name
  (`@needle/shared`).
- No comments unless something is genuinely non-obvious.
- Put domain routes, components, hooks and clients under `features/<domain>`. Keep
  only cross-feature UI in `components`.
- Shared contracts belong in `packages/shared/src/types`; runtime schemas belong in
  `packages/shared/src/schemas`.
- Styles stay as plain CSS. Keep global tokens and application layout in the root
  style files, and contextual rules under `styles/components` or `styles/pages`.
- UI copy must use typed translation keys. Keep English and Turkish dictionaries
  complete and select language manually, with English as the default.
- Python belongs only in `bridges/youtube-music`. Manage it with uv and `uv.lock`;
  do not install bridge dependencies with pip.
- The server runs TypeScript with Node's type stripping, so no enums, namespaces
  or constructor parameter properties there.
- Copy is plain and specific, sentence case, active voice.

## Layout

- `apps/web/src/app`: application bootstrap, router and runtime hooks.
- `apps/web/src/features`: contextual routes, components, hooks and clients for
  catalog, library, search, settings, providers and remote devices.
- `apps/web/src/components`: cross-feature UI. Track UI and actions live under
  `components/tracks`.
- `apps/web/src/player`: the audio engine, pure queue rules and controller.
- `apps/web/src/offline`: downloads in Cache Storage, metadata in IndexedDB.
- `apps/web/src/i18n`: typed English and Turkish resources and the language runtime.
- `apps/server/src/app.ts`: service construction and route registration only.
- `apps/server/src/routes`: contextual Hono routes.
- `apps/server/src/http`: authentication, authorization, validation and unified errors.
- `apps/server/src/db`: schema, versioned migrations and startup backup checks.
- `apps/server/src/realtime`: Hono WebSocket upgrades and device transport.
- `apps/server/src/status.ts`: Settings → Connections. Add a check when adding an
  integration, and protect routes with the applicable authorization middleware.
- `bridges/youtube-music`: the isolated uv Python project and its tests.
- `.github/workflows`: CI, the release pull request, the release itself and
  Scorecard. Pin every action to a full commit SHA with a `# vX.Y.Z` comment, and the
  Dockerfile's base image to a digest; Dependabot moves both.
- `examples/`: compose files, `.env.example` and a Caddyfile that the README walks
  through. Validate with `docker compose -f … config` after changing them.
- `docs/media/`: README images; `make-hero.sh` renders `hero.html` (with `home.png` and `phone-player.png`) to `hero.png` and `social-preview.png` in headless Chromium.
- `e2e/fixtures`: `make-library.ts` generates the test library, `seed.ts` resets
  the test Navidrome and play log.
