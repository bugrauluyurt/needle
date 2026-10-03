# Changelog entries

A pull request with a change that people running Needle would notice adds one file here. The
release pull request gathers the files into `CHANGELOG.md` under the next version and deletes
them, so two pull requests never edit the same lines.

Name the file `<name>.<heading>.md`. The name is anything unique; the branch name works. The
heading decides the next version:

| Heading                            | Bump                       | Use it when                                                    |
| ---------------------------------- | -------------------------- | -------------------------------------------------------------- |
| `breaking` or `removed`            | Major (`1.4.2` to `2.0.0`) | People must change their setup: a renamed setting, a new mount |
| `added`, `changed` or `deprecated` | Minor (`1.4.2` to `1.5.0`) | A new feature, or different behaviour that needs no action     |
| `fixed` or `security`              | Patch (`1.4.2` to `1.4.3`) | A bug fix or a security fix                                    |

The file holds the entry exactly as the release notes will show it: a `- ` bullet written for the
people running Needle, with continuation lines indented by two spaces.

```text
changelog.d/queue-shuffle-repeat.fixed.md

- Shuffle keeps the current song playing when you turn repeat on.
```

`python3 scripts/changelog.py next package.json` prints the version these files would release and
rejects a misnamed file; CI runs it on every pull request.
