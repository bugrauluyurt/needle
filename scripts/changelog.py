#!/usr/bin/env python3
"""Changelog-driven releases: the headings under "## Unreleased" in CHANGELOG.md decide the version.

  changelog.py next <version-file>                print the next version, or nothing when Unreleased is empty
  changelog.py cut <version> <version-file>...    move Unreleased under the version and set it in every file
  changelog.py notes <version>                    print the notes of a released version

  ### Breaking, ### Removed                  major
  ### Added, ### Changed, ### Deprecated     minor
  ### Fixed, ### Security                    patch

The highest bump present wins. Version files are JSON with a top-level "version"
(package.json, plugin.json); only that value is rewritten, the formatting is kept.
The same file lives in homelab-media-stack and Needle; keep the copies identical.
"""
from datetime import date
import json
from pathlib import Path
import re
import sys

CHANGELOG = Path("CHANGELOG.md")
BUMPS = {"breaking": 0, "removed": 0, "added": 1, "changed": 1, "deprecated": 1, "fixed": 2, "security": 2}
VERSION_FIELD = re.compile(r'("version"\s*:\s*")(\d+\.\d+\.\d+)(")')


def section_notes(changelog_text, heading_pattern):
    lines = changelog_text.splitlines()
    start = next((index for index, line in enumerate(lines) if re.fullmatch(heading_pattern, line)), None)
    if start is None:
        return None

    end = next((index for index in range(start + 1, len(lines)) if lines[index].startswith("## ")), len(lines))

    return "\n".join(lines[start + 1:end]).strip()


def next_version(current_version, unreleased_notes):
    headings = [line[4:].strip().lower() for line in unreleased_notes.splitlines() if line.startswith("### ")]
    unknown_headings = [heading for heading in headings if heading not in BUMPS]
    if unknown_headings:
        sys.exit(f"unknown changelog heading(s): {', '.join(unknown_headings)}; use one of {', '.join(BUMPS)}")

    if not unreleased_notes:
        return None
    if not headings:
        sys.exit("notes under ## Unreleased need a heading such as ### Fixed")

    bump = min(BUMPS[heading] for heading in headings)
    parts = [int(part) for part in current_version.split(".")]
    parts[bump] += 1

    return ".".join(str(part) if index <= bump else "0" for index, part in enumerate(parts))


def cut_changelog(changelog_text, version, release_date):
    notes = section_notes(changelog_text, r"## Unreleased")
    if not notes:
        sys.exit("nothing under ## Unreleased to release")

    unreleased = re.search(r"^## Unreleased\n(.*?)(?=^## |\Z)", changelog_text, flags=re.M | re.S)

    released_text = (changelog_text[:unreleased.start()] + f"## Unreleased\n\n## {version} - {release_date}\n\n{notes}\n\n"
                     + changelog_text[unreleased.end():].lstrip("\n"))

    return released_text.rstrip("\n") + "\n"


def file_version(version_file):
    return json.loads(Path(version_file).read_text())["version"]


def set_file_version(version_file, version):
    path = Path(version_file)
    text, count = VERSION_FIELD.subn(rf"\g<1>{version}\g<3>", path.read_text(), count=1)
    if not count:
        sys.exit(f'{version_file} has no "version" field')

    path.write_text(text)


def main(args):
    command = args[0] if args else ""
    changelog_text = CHANGELOG.read_text()

    if command == "next" and len(args) == 2:
        version = next_version(file_version(args[1]), section_notes(changelog_text, r"## Unreleased") or "")
        print(version or "")

    elif command == "cut" and len(args) >= 3:
        CHANGELOG.write_text(cut_changelog(changelog_text, args[1], date.today().isoformat()))
        for version_file in args[2:]:
            set_file_version(version_file, args[1])

    elif command == "notes" and len(args) == 2:
        notes = section_notes(changelog_text, rf"## {re.escape(args[1])} - .*")
        if notes is None:
            sys.exit(f"no ## {args[1]} section in {CHANGELOG}")

        print(notes)

    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main(sys.argv[1:])
