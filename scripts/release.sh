#!/usr/bin/env bash
#
# Cuts a Needle release.
#
#   pnpm release <major.minor.patch>            release it
#   pnpm release <major.minor.patch> --dry-run  run every check, change nothing
#
# What it does, in order:
#   1. Checks the version number, and that you're on a clean `main` that matches GitHub.
#   2. Takes the release notes from the "## Unreleased" section of CHANGELOG.md.
#   3. Runs lint, typecheck and the unit tests.
#   4. Moves those notes under a new "## <version> - <date>" heading, leaving an empty
#      "Unreleased" section on top for the next release.
#   5. Sets the version in every package.json (the whole repo shares one version).
#   6. Commits "Release <version>", tags v<version>, pushes both, and creates the
#      GitHub release with the same notes (needs the `gh` CLI, signed in).
#
# With --dry-run it stops after step 3 and prints the notes it would publish.

set -euo pipefail
cd "$(dirname "$0")/.."

PACKAGES=(package.json apps/web/package.json apps/server/package.json packages/shared/package.json)
CHANGELOG=CHANGELOG.md

fail() {
  echo "$*" >&2
  exit 1
}

# --- 0. Read the arguments ---------------------------------------------------------

VERSION=""
DRY_RUN=false
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    *) VERSION=$arg ;;
  esac
done

[[ $VERSION =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "Usage: pnpm release <major.minor.patch> [--dry-run]"
TAG="v$VERSION"

# --- 1. Safety checks --------------------------------------------------------------

CURRENT=$(node -p 'require("./package.json").version')

# A version is released once. It may equal the current version only for the very
# first release, when no tag exists yet.
[[ -z $(git tag --list "$TAG") ]] || fail "$TAG already exists"
OLDEST=$(printf '%s\n%s\n' "$CURRENT" "$VERSION" | sort -V | head -1)
[[ $OLDEST == "$CURRENT" ]] || fail "$VERSION is older than the current $CURRENT"

# Release only what's on GitHub's main, with nothing uncommitted.
[[ $(git rev-parse --abbrev-ref HEAD) == main ]] || fail "Switch to main first"
[[ -z $(git status --porcelain) ]] || fail "Commit or stash your changes first"
git fetch --quiet origin main
[[ $(git rev-parse HEAD) == $(git rev-parse origin/main) ]] || fail "main differs from origin/main: pull or push first"

# --- 2. Release notes --------------------------------------------------------------

# Everything between "## Unreleased" and the next "## " heading, without the blank
# lines around it.
NOTES=$(awk '/^## Unreleased/ { inside = 1; next } /^## / { inside = 0 } inside' "$CHANGELOG" | sed '/./,$!d')
[[ -n $NOTES ]] || fail "Write what changed under \"## Unreleased\" in $CHANGELOG first"

# --- 3. Checks ---------------------------------------------------------------------

pnpm lint
pnpm typecheck
pnpm test

if $DRY_RUN; then
  printf '\nChecks passed. %s would be released with these notes:\n\n%s\n' "$TAG" "$NOTES"
  exit 0
fi

# --- 4. Changelog ------------------------------------------------------------------

# Insert the new version's heading right under "## Unreleased", so the notes that were
# there now belong to it.
HEADING="## $VERSION - $(date -u +%F)"
awk -v heading="$HEADING" '{ print } /^## Unreleased/ { print ""; print heading }' "$CHANGELOG" > "$CHANGELOG.tmp"
mv "$CHANGELOG.tmp" "$CHANGELOG"

# --- 5. Versions -------------------------------------------------------------------

# `-i.bak` works with both GNU sed (Linux) and BSD sed (macOS).
for file in "${PACKAGES[@]}"; do
  sed -i.bak "s/\"version\": \"[^\"]*\"/\"version\": \"$VERSION\"/" "$file"
  rm "$file.bak"
done

# --- 6. Commit, tag, push, publish -------------------------------------------------

git add "$CHANGELOG" "${PACKAGES[@]}"
git commit --quiet -m "Release $VERSION" -m "$NOTES"
git tag -a "$TAG" -m "Needle $VERSION"
git push --quiet --follow-tags origin main
gh release create "$TAG" --title "Needle $VERSION" --notes "$NOTES" --verify-tag

echo "Released $TAG"
