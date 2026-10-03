import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { moveDownloadedFile, singlePath } from "../src/soulseek.ts";

const temporaryDirectories: string[] = [];

type FileFixture = Awaited<ReturnType<typeof fileFixture>>;

async function fileFixture() {
  const rootDirectory = await mkdtemp(join(tmpdir(), "needle-soulseek-"));
  const downloadsDirectory = join(rootDirectory, "downloads");
  const singlesDirectory = join(rootDirectory, "singles");

  temporaryDirectories.push(rootDirectory);

  await mkdir(downloadsDirectory);
  await mkdir(singlesDirectory);

  return { rootDirectory, downloadsDirectory, singlesDirectory };
}

function downloadInput(fileFixture: FileFixture, filename = "Collection\\Björk\\Jóga.flac", size = 5) {
  const file = { filename, size, extension: "flac" };

  return {
    downloadsDir: fileFixture.downloadsDirectory,
    singlesDir: fileFixture.singlesDirectory,
    song: { artist: "Björk", title: "Jóga" },
    pick: { username: "listener", file },
    transfer: {
      id: "transfer-1",
      username: "listener",
      filename,
      state: "Completed, Succeeded",
      percentComplete: 100,
      size,
    },
  };
}

async function sourceFile(fileFixture: FileFixture, directoryName = "Björk", filename = "Jóga.flac") {
  const sourceDirectory = join(fileFixture.downloadsDirectory, directoryName);
  const sourcePath = join(sourceDirectory, filename);

  await mkdir(sourceDirectory);
  await writeFile(sourcePath, "music");

  return sourcePath;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("Soulseek file paths", () => {
  it("moves a verified Unicode file into the artist folder", async () => {
    const fixture = await fileFixture();
    const sourcePath = await sourceFile(fixture);

    const targetPath = await moveDownloadedFile(downloadInput(fixture));

    expect(targetPath).toBe(join(fixture.singlesDirectory, "Björk", "Björk - Jóga.flac"));
    expect(await readFile(targetPath, "utf8")).toBe("music");
    await expect(access(sourcePath)).rejects.toThrow();
  });

  it.each([
    { artist: "..", title: "Jóga" },
    { artist: ".", title: "Jóga" },
    { artist: "/outside", title: "Jóga" },
    { artist: "Björk/Guest", title: "Jóga" },
    { artist: "Björk\\Guest", title: "Jóga" },
    { artist: "Björk", title: "../Jóga" },
    { artist: "Björk", title: "Disc/Jóga" },
    { artist: "Björk", title: "Disc\\Jóga" },
    { artist: `${"a".repeat(121)}/outside`, title: "Jóga" },
  ])("rejects unsafe request names: $artist - $title", ({ artist, title }) => {
    expect(() =>
      singlePath("/singles", { artist, title }, { filename: "Jóga.flac", size: 5, extension: "flac" }),
    ).toThrow("unsafe path segment");
  });

  it.each([
    "../outside.flac",
    "..\\outside.flac",
    "folder/../outside.flac",
    "folder/./outside.flac",
    "folder//outside.flac",
    "/tmp/outside.flac",
    "\\\\server\\outside.flac",
    "C:\\outside.flac",
  ])("rejects an unsafe remote filename: %s", async (filename) => {
    const fixture = await fileFixture();
    const outsidePath = join(fixture.rootDirectory, "outside.flac");

    await writeFile(outsidePath, "music");
    await expect(moveDownloadedFile(downloadInput(fixture, filename))).rejects.toThrow("unsafe remote filename");
    expect(await readFile(outsidePath, "utf8")).toBe("music");
  });

  it("refuses a symbolic-link source file", async () => {
    const fixture = await fileFixture();
    const outsidePath = join(fixture.rootDirectory, "outside.flac");
    const sourceDirectory = join(fixture.downloadsDirectory, "Björk");

    await writeFile(outsidePath, "music");
    await mkdir(sourceDirectory);
    await symlink(outsidePath, join(sourceDirectory, "Jóga.flac"));

    await expect(moveDownloadedFile(downloadInput(fixture))).rejects.toThrow("regular file");
    expect(await readFile(outsidePath, "utf8")).toBe("music");
  });

  it("refuses a source reached through a symbolic-link directory", async () => {
    const fixture = await fileFixture();
    const outsideDirectory = join(fixture.rootDirectory, "outside");

    await mkdir(outsideDirectory);
    await writeFile(join(outsideDirectory, "Jóga.flac"), "music");
    await symlink(outsideDirectory, join(fixture.downloadsDirectory, "Björk"));

    await expect(moveDownloadedFile(downloadInput(fixture))).rejects.toThrow("outside SOULSEEK_DIR");
    expect(await readFile(join(outsideDirectory, "Jóga.flac"), "utf8")).toBe("music");
  });

  it("refuses a source directory symbolic link that stays inside SOULSEEK_DIR", async () => {
    const fixture = await fileFixture();
    const actualDirectory = join(fixture.downloadsDirectory, "actual");

    await mkdir(actualDirectory);
    await writeFile(join(actualDirectory, "Jóga.flac"), "music");
    await symlink(actualDirectory, join(fixture.downloadsDirectory, "Björk"));

    await expect(moveDownloadedFile(downloadInput(fixture))).rejects.toThrow("symbolic link");
    expect(await readFile(join(actualDirectory, "Jóga.flac"), "utf8")).toBe("music");
  });

  it("refuses a non-regular source", async () => {
    const fixture = await fileFixture();

    await mkdir(join(fixture.downloadsDirectory, "Björk", "Jóga.flac"), { recursive: true });

    await expect(moveDownloadedFile(downloadInput(fixture))).rejects.toThrow("regular file");
  });

  it("refuses a symbolic-link destination directory", async () => {
    const fixture = await fileFixture();
    const outsideDirectory = join(fixture.rootDirectory, "outside");
    const sourcePath = await sourceFile(fixture);

    await mkdir(outsideDirectory);
    await symlink(outsideDirectory, join(fixture.singlesDirectory, "Björk"));

    await expect(moveDownloadedFile(downloadInput(fixture))).rejects.toThrow("destination directory");
    await expect(access(join(outsideDirectory, "Björk - Jóga.flac"))).rejects.toThrow();
    expect(await readFile(sourcePath, "utf8")).toBe("music");
  });

  it("refuses a symbolic-link destination file", async () => {
    const fixture = await fileFixture();
    const outsidePath = join(fixture.rootDirectory, "outside.flac");
    const sourcePath = await sourceFile(fixture);
    const targetDirectory = join(fixture.singlesDirectory, "Björk");

    await writeFile(outsidePath, "other");
    await mkdir(targetDirectory);
    await symlink(outsidePath, join(targetDirectory, "Björk - Jóga.flac"));

    await expect(moveDownloadedFile(downloadInput(fixture))).rejects.toThrow("already exists");
    expect(await readFile(outsidePath, "utf8")).toBe("other");
    expect(await readFile(sourcePath, "utf8")).toBe("music");
  });

  it("does not overwrite an unrelated destination", async () => {
    const fixture = await fileFixture();
    const sourcePath = await sourceFile(fixture);
    const targetDirectory = join(fixture.singlesDirectory, "Björk");
    const targetPath = join(targetDirectory, "Björk - Jóga.flac");

    await mkdir(targetDirectory);
    await writeFile(targetPath, "other");

    await expect(moveDownloadedFile(downloadInput(fixture))).rejects.toThrow("already exists");
    expect(await readFile(targetPath, "utf8")).toBe("other");
    expect(await readFile(sourcePath, "utf8")).toBe("music");
  });

  it.each([
    { transfer: { username: "someone-else" } },
    { transfer: { filename: "Collection\\Björk\\Other.flac" } },
    { transfer: { size: 4 } },
    { file: { size: 4 } },
  ])("requires the transfer and file metadata to agree before moving: %#", async (changes) => {
    const fixture = await fileFixture();
    const sourcePath = await sourceFile(fixture);
    const input = downloadInput(fixture);
    const transfer = { ...input.transfer, ...changes.transfer };
    const pick = { ...input.pick, file: { ...input.pick.file, ...changes.file } };

    await expect(moveDownloadedFile({ ...input, pick, transfer })).rejects.toThrow("transfer metadata");
    expect(await readFile(sourcePath, "utf8")).toBe("music");
    await expect(access(join(fixture.singlesDirectory, "Björk", "Björk - Jóga.flac"))).rejects.toThrow();
  });

  it("rejects an ambiguous fallback source", async () => {
    const fixture = await fileFixture();

    await sourceFile(fixture, "first");
    await sourceFile(fixture, "second");

    await expect(moveDownloadedFile(downloadInput(fixture))).rejects.toThrow("more than one downloaded file");
  });

  it("keeps the unique fallback lookup used by slskd download folders", async () => {
    const fixture = await fileFixture();
    const sourcePath = await sourceFile(fixture, "listener");

    const targetPath = await moveDownloadedFile(downloadInput(fixture));

    expect(await readFile(targetPath, "utf8")).toBe("music");
    await expect(access(sourcePath)).rejects.toThrow();
  });

  it("refuses a source whose size does not match the completed transfer", async () => {
    const fixture = await fileFixture();
    const sourcePath = await sourceFile(fixture);

    await writeFile(sourcePath, "different size");

    await expect(moveDownloadedFile(downloadInput(fixture))).rejects.toThrow("wasn't found");
    expect(await readFile(sourcePath, "utf8")).toBe("different size");
  });
});
