import { access, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import type { open as openFile, rmdir as removeDirectory, unlink as unlinkFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fileRace = vi.hoisted(() => ({
  beforeOpen: null as (() => Promise<void>) | null,
  beforeOpenSuffix: "",
  beforeRmdir: null as (() => Promise<void>) | null,
  beforeUnlink: new Map<number, () => Promise<void>>(),
  failUnlink: new Set<number>(),
  rmdirCalls: 0,
  unlinkCalls: 0,
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const fileSystem = await importOriginal<{
    open: typeof openFile;
    rmdir: typeof removeDirectory;
    unlink: typeof unlinkFile;
  }>();

  return {
    ...fileSystem,
    open: async (filePath: string, flags: number, mode?: number) => {
      if (fileRace.beforeOpen && String(filePath).endsWith(fileRace.beforeOpenSuffix)) {
        const beforeOpen = fileRace.beforeOpen;

        fileRace.beforeOpen = null;
        await beforeOpen();
      }

      return fileSystem.open(filePath, flags, mode);
    },
    rmdir: async (directoryPath: string) => {
      fileRace.rmdirCalls += 1;

      if (fileRace.beforeRmdir) {
        const beforeRmdir = fileRace.beforeRmdir;

        fileRace.beforeRmdir = null;
        await beforeRmdir();
      }

      return fileSystem.rmdir(directoryPath);
    },
    unlink: async (filePath: string) => {
      fileRace.unlinkCalls += 1;
      const unlinkCall = fileRace.unlinkCalls;
      const beforeUnlink = fileRace.beforeUnlink.get(unlinkCall);

      if (beforeUnlink) await beforeUnlink();
      if (fileRace.failUnlink.has(unlinkCall)) throw new Error("simulated unlink refusal");

      return fileSystem.unlink(filePath);
    },
  };
});

import { moveDownloadedFile } from "../src/soulseek-files.ts";

const temporaryDirectories: string[] = [];

async function fileFixture() {
  const rootDirectory = await mkdtemp(join(tmpdir(), "needle-soulseek-race-"));
  const downloadsDirectory = join(rootDirectory, "downloads");
  const singlesDirectory = join(rootDirectory, "singles");
  const sourceDirectory = join(downloadsDirectory, "Björk");
  const sourcePath = join(sourceDirectory, "Jóga.flac");
  const targetDirectory = join(singlesDirectory, "Björk");
  const targetPath = join(targetDirectory, "Björk - Jóga.flac");

  temporaryDirectories.push(rootDirectory);

  await mkdir(sourceDirectory, { recursive: true });
  await mkdir(singlesDirectory);
  await writeFile(sourcePath, "music");

  return {
    rootDirectory,
    downloadsDirectory,
    singlesDirectory,
    sourceDirectory,
    sourcePath,
    targetDirectory,
    targetPath,
  };
}

function downloadInput(fixture: Awaited<ReturnType<typeof fileFixture>>) {
  const filename = "Collection\\Björk\\Jóga.flac";
  const file = { filename, size: 5, extension: "flac" };

  return {
    downloadsDir: fixture.downloadsDirectory,
    singlesDir: fixture.singlesDirectory,
    song: { artist: "Björk", title: "Jóga" },
    pick: { username: "listener", file },
    transfer: {
      username: "listener",
      filename,
      state: "Completed, Succeeded",
      size: 5,
    },
  };
}

beforeEach(() => {
  fileRace.beforeOpen = null;
  fileRace.beforeOpenSuffix = "";
  fileRace.beforeRmdir = null;
  fileRace.beforeUnlink.clear();
  fileRace.failUnlink.clear();
  fileRace.rmdirCalls = 0;
  fileRace.unlinkCalls = 0;
});

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("Soulseek parent directory races", () => {
  it("never creates the destination through a swapped directory pathname", async () => {
    const fixture = await fileFixture();
    const originalTargetDirectory = `${fixture.targetDirectory}.original`;
    const outsideDirectory = join(fixture.rootDirectory, "outside-create");

    await mkdir(outsideDirectory);
    fileRace.beforeOpenSuffix = "Björk - Jóga.flac";
    fileRace.beforeOpen = async () => {
      await rename(fixture.targetDirectory, originalTargetDirectory);
      await symlink(outsideDirectory, fixture.targetDirectory);
    };

    await expect(moveDownloadedFile(downloadInput(fixture))).rejects.toThrow();
    await expect(access(join(outsideDirectory, "Björk - Jóga.flac"))).rejects.toThrow();
    expect(await readFile(fixture.sourcePath, "utf8")).toBe("music");
  });

  it("rolls back through the original destination directory after its pathname is swapped", async () => {
    const fixture = await fileFixture();
    const originalTargetDirectory = `${fixture.targetDirectory}.original`;
    const outsideDirectory = join(fixture.rootDirectory, "outside-rollback");
    const outsideTargetPath = join(outsideDirectory, "Björk - Jóga.flac");

    await mkdir(outsideDirectory);
    await writeFile(outsideTargetPath, "outside");
    fileRace.failUnlink.add(1);
    fileRace.beforeUnlink.set(2, async () => {
      await rename(fixture.targetDirectory, originalTargetDirectory);
      await symlink(outsideDirectory, fixture.targetDirectory);
    });

    await expect(moveDownloadedFile(downloadInput(fixture))).rejects.toThrow("simulated unlink refusal");
    expect(await readFile(outsideTargetPath, "utf8")).toBe("outside");
    await expect(access(join(originalTargetDirectory, "Björk - Jóga.flac"))).rejects.toThrow();
    expect(await readFile(fixture.sourcePath, "utf8")).toBe("music");
  });

  it("unlinks the verified source through its original directory after a pathname swap", async () => {
    const fixture = await fileFixture();
    const originalSourceDirectory = `${fixture.sourceDirectory}.original`;
    const outsideDirectory = join(fixture.rootDirectory, "outside-source");
    const outsideSourcePath = join(outsideDirectory, "Jóga.flac");

    await mkdir(outsideDirectory);
    await writeFile(outsideSourcePath, "outside");
    fileRace.beforeUnlink.set(1, async () => {
      await rename(fixture.sourceDirectory, originalSourceDirectory);
      await symlink(outsideDirectory, fixture.sourceDirectory);
    });

    await expect(moveDownloadedFile(downloadInput(fixture))).resolves.toBe(fixture.targetPath);
    expect(await readFile(outsideSourcePath, "utf8")).toBe("outside");
    await expect(access(join(originalSourceDirectory, "Jóga.flac"))).rejects.toThrow();
  });

  it("does not remove a slskd-owned parent directory that is swapped before cleanup", async () => {
    const fixture = await fileFixture();
    const originalSourceDirectory = `${fixture.sourceDirectory}.original`;
    const attackerDirectory = join(fixture.rootDirectory, "attacker-directory");

    await mkdir(attackerDirectory);
    fileRace.beforeRmdir = async () => {
      await rename(fixture.sourceDirectory, originalSourceDirectory);
      await rename(attackerDirectory, fixture.sourceDirectory);
    };

    await expect(moveDownloadedFile(downloadInput(fixture))).resolves.toBe(fixture.targetPath);
    expect(fileRace.rmdirCalls).toBe(0);
    await expect(access(fixture.sourceDirectory)).resolves.toBeUndefined();
  });
});
