import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PACKAGES = ["package.json", "apps/web/package.json", "apps/server/package.json", "packages/shared/package.json"];
const CHANGELOG = "CHANGELOG.md";
const UNRELEASED = "## Unreleased";
const SEMVER = /^\d+\.\d+\.\d+$/;

const args = process.argv.slice(2);
const dry = args.includes("--dry-run");
const next = args.find((a) => !a.startsWith("--"));

const run = (cmd: string, cmdArgs: string[]) => execFileSync(cmd, cmdArgs, { stdio: "inherit" });
const out = (cmd: string, cmdArgs: string[]) => execFileSync(cmd, cmdArgs, { encoding: "utf8" }).trim();

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

if (!next || !SEMVER.test(next)) fail("Usage: pnpm release <major.minor.patch> [--dry-run]");
const current = (JSON.parse(readFileSync("package.json", "utf8")) as { version: string }).version;
const tag = `v${next}`;
if (out("git", ["tag", "--list", tag])) fail(`${tag} already exists`);
if (next !== current && next.localeCompare(current, undefined, { numeric: true }) < 0) fail(`${next} is older than ${current}`);
if (out("git", ["rev-parse", "--abbrev-ref", "HEAD"]) !== "main") fail("Release from main");
if (out("git", ["status", "--porcelain"])) fail("Commit or stash your changes first");
run("git", ["fetch", "--quiet", "origin", "main"]);
if (out("git", ["rev-parse", "HEAD"]) !== out("git", ["rev-parse", "origin/main"])) fail("main differs from origin/main: pull or push first");

const log = readFileSync(CHANGELOG, "utf8");
const start = log.indexOf(UNRELEASED);
if (start < 0) fail(`${CHANGELOG} has no "${UNRELEASED}" section`);
const end = log.indexOf("\n## ", start + UNRELEASED.length);
const notes = log.slice(start + UNRELEASED.length, end < 0 ? undefined : end).trim();
if (!notes) fail(`Write what changed under "${UNRELEASED}" in ${CHANGELOG} first`);

for (const script of ["lint", "typecheck", "test"]) run("pnpm", [script]);

if (dry) {
  console.log(`\nChecks passed. ${tag} would be released with these notes:\n\n${notes}`);
  process.exit(0);
}

const date = new Date().toISOString().slice(0, 10);
writeFileSync(CHANGELOG, `${log.slice(0, start)}${UNRELEASED}\n\n## ${next} - ${date}\n\n${notes}\n${end < 0 ? "" : log.slice(end)}`);
for (const file of PACKAGES) writeFileSync(file, readFileSync(file, "utf8").replace(/"version": "[^"]+"/, `"version": "${next}"`));
run("git", ["add", CHANGELOG, ...PACKAGES]);
run("git", ["commit", "--quiet", "-m", `Release ${next}`, "-m", notes]);
run("git", ["tag", "-a", tag, "-m", `Needle ${next}`]);
run("git", ["push", "--quiet", "--follow-tags", "origin", "main"]);
const notesFile = join(mkdtempSync(join(tmpdir(), "needle-release-")), "notes.md");
writeFileSync(notesFile, notes);
run("gh", ["release", "create", tag, "--title", `Needle ${next}`, "--notes-file", notesFile, "--verify-tag"]);
console.log(`Released ${tag}`);
