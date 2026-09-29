#!/usr/bin/env python3
"""Changelog-driven releases: every change adds a file to changelog.d/, and the file names decide the version.

  changelog.py next <version-file>                print the next version, or nothing when changelog.d/ is empty
  changelog.py cut <version> <version-file>...    write changelog.d/ into CHANGELOG.md under the version,
                                                  delete those files, and set the version in every file
  changelog.py notes <version>                    print the notes of a released version

A change adds changelog.d/<name>.<heading>.md holding its entry, a "- " bullet written for the
people running it. The heading decides the bump, and the highest bump present wins:

  breaking, removed                  major
  added, changed, deprecated         minor
  fixed, security                    patch

One file per change means two pull requests never edit the same lines. Version files are JSON
with a top-level "version" (package.json, plugin.json); only that value is rewritten, the
formatting is kept. The same file lives in homelab-media-stack and Needle; keep the copies identical.
"""
from datetime import date
import json
from pathlib import Path
import re
import sys

CHANGELOG = Path("CHANGELOG.md")
FRAGMENTS = Path("changelog.d")
BUMPS = {"breaking": 0, "removed": 0, "added": 1, "changed": 1, "deprecated": 1, "fixed": 2, "security": 2}
HEADING_ORDER = ["breaking", "added", "changed", "deprecated", "removed", "fixed", "security"]
VERSION_FIELD = re.compile(r'("version"\s*:\s*")(\d+\.\d+\.\d+)(")')


def section_notes(changelog_text, heading_pattern):
    lines = changelog_text.splitlines()
    start = next((index for index, line in enumerate(lines) if re.fullmatch(heading_pattern, line)), None)
    if start is None:
        return None

    end = next((index for index in range(start + 1, len(lines)) if lines[index].startswith("## ")), len(lines))

    return "\n".join(lines[start + 1:end]).strip()


def changelog_entries(directory=FRAGMENTS):
    entries = []

    for path in sorted(directory.glob("*.md")):
        if path.name == "README.md":
            continue

        name, dot, heading = path.stem.rpartition(".")
        if not (dot and name and heading in BUMPS):
            sys.exit(f"{path}: name it <name>.<heading>.md with a heading from {', '.join(HEADING_ORDER)}")

        entry = path.read_text().strip()
        if not entry.startswith("- "):
            sys.exit(f"{path}: write the entry as a bullet starting with '- '")

        entries.append((path, heading, entry))

    return entries


def next_version(current_version, headings):
    if not headings:
        return None

    bump = min(BUMPS[heading] for heading in headings)
    parts = [int(part) for part in current_version.split(".")]
    parts[bump] += 1

    return ".".join(str(part) if index <= bump else "0" for index, part in enumerate(parts))


def release_section(version, release_date, entries):
    blocks = []
    for heading in HEADING_ORDER:
        heading_entries = [entry for _, entry_heading, entry in entries if entry_heading == heading]
        if heading_entries:
            blocks.append(f"### {heading.capitalize()}\n" + "\n".join(heading_entries))

    return f"## {version} - {release_date}\n\n" + "\n\n".join(blocks)


def cut_changelog(changelog_text, section):
    first_release = re.search(r"^## ", changelog_text, flags=re.M)
    if first_release is None:
        return changelog_text.rstrip("\n") + f"\n\n{section}\n"

    return changelog_text[:first_release.start()] + f"{section}\n\n" + changelog_text[first_release.start():]


def refuse_unreleased(changelog_text):
    # Entries left in the old format would be silently skipped; send them where they now belong.
    if re.search(r"^## Unreleased\b", changelog_text, flags=re.M):
        sys.exit(f"{CHANGELOG} still has a ## Unreleased section; move its entries into {FRAGMENTS}/ (see {FRAGMENTS}/README.md)")


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
        refuse_unreleased(changelog_text)
        version = next_version(file_version(args[1]), [heading for _, heading, _ in changelog_entries()])
        print(version or "")

    elif command == "cut" and len(args) >= 3:
        refuse_unreleased(changelog_text)
        entries = changelog_entries()
        if not entries:
            sys.exit(f"nothing in {FRAGMENTS}/ to release")

        CHANGELOG.write_text(cut_changelog(changelog_text, release_section(args[1], date.today().isoformat(), entries)))

        for path, _, _ in entries:
            path.unlink()

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
