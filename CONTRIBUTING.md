# Contributing

Thanks for helping. Issues and pull requests are welcome; for anything larger than a fix, open
an issue first so we can agree on the approach.

## How the code is written

[AGENTS.md](AGENTS.md) is the guide for people and coding agents alike: the commands, the layout,
the conventions and the design rules. Read it before changing anything; the rules there are the
review checklist.

## Making a change

1. Fork, branch, and change the smallest thing that solves the problem.
2. Run `pnpm lint`, `pnpm typecheck` and `pnpm test`. For anything that touches the UI or the
   player, also run the e2e suite (`pnpm navidrome:test`, then `pnpm e2e`). CI runs the first three.
3. If people running Needle would notice the change, add its entry as a file,
   `changelog.d/<name>.<heading>.md`, instead of editing `CHANGELOG.md`
   ([format](changelog.d/README.md)). The heading (`added`, `changed`, `fixed`, `security`,
   `removed`, `breaking`) decides the next version. One file per change means your pull request
   never conflicts with another one over the changelog.
4. Enable the commit hook once: `git config core.hooksPath .githooks`.

## Commit messages

Commits follow [Conventional Commits](https://www.conventionalcommits.org), the format
[commitizen](https://commitizen-tools.github.io/commitizen/) writes. `.cz.toml` configures it, so
`cz commit` asks for each part and `cz check` validates a message. The hook in `.githooks/`
rejects a summary that doesn't follow it.

```text
<type>(<scope>)!: <summary>

<body: why the change was needed, wrapped at 72 characters>

<footer: BREAKING CHANGE: what users must do, Refs #12>
```

- **Type** says what kind of change it is:

  | Type       | Use it for                                       |
  | ---------- | ------------------------------------------------ |
  | `feat`     | A new capability for the people using Needle     |
  | `fix`      | A bug fix                                        |
  | `docs`     | Documentation only                               |
  | `refactor` | Code that changes shape but not behaviour        |
  | `perf`     | Faster or lighter, same behaviour                |
  | `test`     | Tests only, unit or e2e                          |
  | `build`    | The Docker image, dependencies, the build        |
  | `ci`       | GitHub workflows                                 |
  | `chore`    | Upkeep that fits nothing above, such as releases |
  | `style`    | Formatting only                                  |
  | `revert`   | Undoing an earlier commit                        |

- **Scope** is optional: the area touched, in lowercase, such as `web`, `server`, `shared`,
  `player`, `spotify`, `remote`, `offline`, `docker`, `e2e`, `docs`, `deps` or `release`.
- **`!`** after the scope marks a breaking change; explain it in a `BREAKING CHANGE:` footer.
- **Summary:** imperative mood ("add", not "added" or "adds"), lowercase, no final period, and
  the whole line at most 72 characters. Say what changes for the user, not which files moved.
- **Body:** optional for small changes. Explain why, not what; the diff shows what.

```text
fix(spotify): pick a new player when spotify drops the old one

Needle kept the first device id for the life of the page, so after a
network drop every play went to a player Spotify had already forgotten.
```

Not `Fixed stuff`, `update player.ts` or `Improve search and docs`: none has a type, and none
says what changed for the user.

The type doesn't pick the version: the heading in the `changelog.d/` file name does. A `feat`
usually pairs with `.added.md` and a `fix` with `.fixed.md`.

## Pull requests

Pull requests are squash-merged, and the pull request **title** becomes the commit on `main`:
write it in the same format. The **PR title** check runs the commit hook on it. A pull request
merges into `main` once it is up to date with `main`, its `checks` run passes and a maintainer
approves it; maintainers merge their own through the admin bypass.

By contributing you agree that your work is released under the [MIT license](LICENSE).
