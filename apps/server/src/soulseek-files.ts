import { constants } from "node:fs";
import type { Stats } from "node:fs";
import { lstat, mkdir, open, readdir, realpath, rmdir, unlink } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";
import type { SongCandidate } from "@needle/shared";

export type SoulseekFileMetadata = { filename: string; size: number; extension?: string };

type SoulseekFilePick = { username: string; file: SoulseekFileMetadata };

type CompletedTransfer = {
  username: string;
  filename: string;
  state: string;
  size: number;
};

type MoveDownloadedFileInput = {
  downloadsDir: string;
  singlesDir: string;
  song: Pick<SongCandidate, "title" | "artist">;
  pick: SoulseekFilePick;
  transfer: CompletedTransfer;
};

type OwnedFile = {
  path: string;
  stats: Stats;
  parentPath: string;
  parentStats: Stats;
};

const AUDIO_EXTENSIONS = new Set(["flac", "mp3", "m4a", "ogg", "opus", "wav"]);

export function isSoulseekAudioExtension(extension: string): boolean {
  return AUDIO_EXTENSIONS.has(extension);
}

export function getRemotePathSegments(filename: string): string[] | null {
  if (
    !filename ||
    filename.includes("\0") ||
    filename.startsWith("/") ||
    filename.startsWith("\\") ||
    /^[A-Za-z]:[\\/]/u.test(filename)
  )
    return null;

  const filenameSegments = filename.split(/[\\/]/u);

  if (
    filenameSegments.some(
      (filenameSegment) =>
        !filenameSegment || filenameSegment === "." || filenameSegment === ".." || /^[A-Za-z]:$/u.test(filenameSegment),
    )
  )
    return null;

  return filenameSegments;
}

export function singlePath(
  directory: string,
  song: Pick<SongCandidate, "title" | "artist">,
  file: SoulseekFileMetadata,
): string {
  const rootDirectory = resolve(directory);
  const artist = safePathSegment(song.artist);
  const title = safePathSegment(song.title);
  const targetPath = resolve(rootDirectory, artist, `${artist} - ${title}.${targetExtension(file)}`);

  assertBelowRoot(rootDirectory, targetPath, "SINGLES_DIR");

  return targetPath;
}

export async function moveDownloadedFile(input: MoveDownloadedFileInput): Promise<string> {
  assertTransferMetadata(input.pick, input.transfer);

  const downloadsRoot = await getRealDirectoryPath(input.downloadsDir, "SOULSEEK_DIR");
  const singlesRoot = await getRealDirectoryPath(input.singlesDir, "SINGLES_DIR");
  const sourceFile = await getDownloadedSource(downloadsRoot, input.pick.file);
  const targetPath = singlePath(singlesRoot, input.song, input.pick.file);

  await prepareDestinationDirectory(singlesRoot, dirname(targetPath));

  const existingTarget = await getFileStats(targetPath);
  if (existingTarget) throw new Error(`The destination ${basename(targetPath)} already exists`);

  const targetStats = await copyOwnedFile(sourceFile, targetPath, singlesRoot);

  try {
    await deleteOwnedSource(sourceFile, downloadsRoot);
  } catch (error: unknown) {
    await deleteOwnedFile(targetPath, targetStats, singlesRoot).catch(() => undefined);

    throw error;
  }

  await removeOwnedSourceDirectory(sourceFile, downloadsRoot);

  return targetPath;
}

function safePathSegment(value: string): string {
  if (value.includes("\0") || /[\\/]/u.test(value)) throw new Error("The song contains an unsafe path segment");

  const normalizedValue = value.replace(/\s+/gu, " ").trim().slice(0, 120);

  if (!normalizedValue || normalizedValue === "." || normalizedValue === "..")
    throw new Error("The song contains an unsafe path segment");

  const safeValue = normalizedValue.replace(/[:*?"<>|]/gu, "_");

  if (safeValue === "." || safeValue === "..") throw new Error("The song contains an unsafe path segment");

  return safeValue;
}

function isBelowRoot(rootDirectory: string, targetPath: string): boolean {
  const relativePath = relative(rootDirectory, targetPath);

  return (
    Boolean(relativePath) && relativePath !== ".." && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath)
  );
}

function assertBelowRoot(rootDirectory: string, targetPath: string, rootName: string) {
  if (!isBelowRoot(rootDirectory, targetPath)) throw new Error(`The file is outside ${rootName}`);
}

function targetExtension(file: SoulseekFileMetadata): string {
  const extension = (file.extension ?? extname(file.filename).slice(1)).toLowerCase();

  if (!isSoulseekAudioExtension(extension)) throw new Error("The downloaded file has an unsafe extension");

  return extension;
}

function assertTransferMetadata(pick: SoulseekFilePick, transfer: CompletedTransfer) {
  if (
    transfer.username !== pick.username ||
    transfer.filename !== pick.file.filename ||
    transfer.size !== pick.file.size ||
    !transfer.state.startsWith("Completed") ||
    !transfer.state.includes("Succeeded")
  )
    throw new Error("The completed transfer metadata does not match the requested file");
}

async function getRealDirectoryPath(directory: string, rootName: string): Promise<string> {
  const realDirectoryPath = await realpath(directory);
  const directoryStats = await lstat(realDirectoryPath);

  if (!directoryStats.isDirectory() || directoryStats.isSymbolicLink())
    throw new Error(`${rootName} must be a directory`);

  return realDirectoryPath;
}

async function getFileStats(filePath: string): Promise<Stats | null> {
  return lstat(filePath).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;

    throw error;
  });
}

async function getOwnedSource(
  sourcePath: string,
  downloadsRoot: string,
  expectedSize: number,
): Promise<OwnedFile | null> {
  assertBelowRoot(downloadsRoot, sourcePath, "SOULSEEK_DIR");

  const sourceStats = await getFileStats(sourcePath);
  if (!sourceStats) return null;
  if (!sourceStats.isFile() || sourceStats.isSymbolicLink())
    throw new Error("The downloaded source must be a regular file");

  const realSourcePath = await realpath(sourcePath);
  assertBelowRoot(downloadsRoot, realSourcePath, "SOULSEEK_DIR");

  if (realSourcePath !== sourcePath) throw new Error("The downloaded source must not use a symbolic link");
  if (sourceStats.size !== expectedSize) return null;

  const parentPath = dirname(realSourcePath);
  const parentStats = await lstat(parentPath);

  if (!parentStats.isDirectory() || parentStats.isSymbolicLink())
    throw new Error("The downloaded source directory must be a regular directory");

  return { path: realSourcePath, stats: sourceStats, parentPath, parentStats };
}

async function getDownloadedSource(downloadsRoot: string, file: SoulseekFileMetadata): Promise<OwnedFile> {
  const filenameSegments = getRemotePathSegments(file.filename);
  if (!filenameSegments) throw new Error("The transfer has an unsafe remote filename");

  const filename = filenameSegments.at(-1) ?? "";
  const remoteParent = filenameSegments.at(-2);
  const expectedPath = resolve(downloadsRoot, ...(remoteParent ? [remoteParent, filename] : [filename]));
  const expectedSource = await getOwnedSource(expectedPath, downloadsRoot, file.size);

  if (expectedSource) return expectedSource;

  const matchingSources: OwnedFile[] = [];

  for (const directoryEntry of await readdir(downloadsRoot, { withFileTypes: true })) {
    if (!directoryEntry.isDirectory()) continue;

    const candidatePath = resolve(downloadsRoot, directoryEntry.name, filename);
    if (candidatePath === expectedPath) continue;

    const candidateSource = await getOwnedSource(candidatePath, downloadsRoot, file.size);
    if (candidateSource) matchingSources.push(candidateSource);
  }

  if (matchingSources.length > 1) throw new Error(`Found more than one downloaded file named ${basename(filename)}`);

  const matchingSource = matchingSources[0];
  if (matchingSource) return matchingSource;

  throw new Error(`The downloaded file ${basename(filename)} wasn't found`);
}

async function prepareDestinationDirectory(singlesRoot: string, destinationDirectory: string) {
  assertBelowRoot(singlesRoot, destinationDirectory, "SINGLES_DIR");

  await mkdir(destinationDirectory).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  });

  const destinationStats = await lstat(destinationDirectory);
  if (!destinationStats.isDirectory() || destinationStats.isSymbolicLink())
    throw new Error("The destination directory must be a regular directory");

  const realDestinationDirectory = await realpath(destinationDirectory);
  assertBelowRoot(singlesRoot, realDestinationDirectory, "SINGLES_DIR");

  if (realDestinationDirectory !== destinationDirectory)
    throw new Error("The destination directory must not be a symbolic link");
}

async function copyOwnedFile(sourceFile: OwnedFile, targetPath: string, singlesRoot: string): Promise<Stats> {
  const sourceHandle = await open(sourceFile.path, constants.O_RDONLY | constants.O_NOFOLLOW);
  let targetHandle: Awaited<ReturnType<typeof open>> | null = null;

  try {
    const openedSourceStats = await sourceHandle.stat();
    assertSameFile(openedSourceStats, sourceFile.stats, "The downloaded source changed before it could be moved");

    targetHandle = await open(
      targetPath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      openedSourceStats.mode,
    );

    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let readPosition = 0;

    for (;;) {
      const { bytesRead } = await sourceHandle.read(buffer, 0, buffer.length, readPosition);
      if (!bytesRead) break;

      let writtenBytes = 0;

      while (writtenBytes < bytesRead) {
        const { bytesWritten } = await targetHandle.write(
          buffer,
          writtenBytes,
          bytesRead - writtenBytes,
          readPosition + writtenBytes,
        );

        if (!bytesWritten) throw new Error("The downloaded file could not be copied safely");

        writtenBytes += bytesWritten;
      }

      readPosition += bytesRead;
    }

    await targetHandle.sync();

    const targetStats = await targetHandle.stat();
    if (!targetStats.isFile() || targetStats.size !== sourceFile.stats.size)
      throw new Error("The downloaded file could not be copied safely");

    const realTargetPath = await realpath(targetPath);
    assertBelowRoot(singlesRoot, realTargetPath, "SINGLES_DIR");

    const currentTargetStats = await lstat(targetPath);
    assertSameFile(currentTargetStats, targetStats, "The copied file changed before the source could be removed");

    return targetStats;
  } catch (error: unknown) {
    if (targetHandle) {
      const targetStats = await targetHandle.stat().catch(() => null);

      await targetHandle.close().catch(() => undefined);
      targetHandle = null;

      if (targetStats) await deleteOwnedFile(targetPath, targetStats, singlesRoot).catch(() => undefined);
    }

    throw error;
  } finally {
    await sourceHandle.close().catch(() => undefined);
    if (targetHandle) await targetHandle.close().catch(() => undefined);
  }
}

function assertSameFile(actualStats: Stats, expectedStats: Stats, message: string) {
  if (
    !actualStats.isFile() ||
    actualStats.isSymbolicLink() ||
    actualStats.dev !== expectedStats.dev ||
    actualStats.ino !== expectedStats.ino ||
    actualStats.size !== expectedStats.size
  )
    throw new Error(message);
}

async function deleteOwnedSource(sourceFile: OwnedFile, downloadsRoot: string) {
  const currentSourceStats = await lstat(sourceFile.path);
  assertSameFile(currentSourceStats, sourceFile.stats, "The downloaded source changed before it could be removed");

  const realSourcePath = await realpath(sourceFile.path);
  assertBelowRoot(downloadsRoot, realSourcePath, "SOULSEEK_DIR");

  await unlink(sourceFile.path);
}

async function deleteOwnedFile(filePath: string, expectedStats: Stats, rootDirectory: string) {
  const currentStats = await lstat(filePath);
  assertSameFile(currentStats, expectedStats, "The copied file changed before it could be removed");

  const realFilePath = await realpath(filePath);
  assertBelowRoot(rootDirectory, realFilePath, "SINGLES_DIR");

  await unlink(filePath);
}

async function removeOwnedSourceDirectory(sourceFile: OwnedFile, downloadsRoot: string) {
  if (sourceFile.parentPath === downloadsRoot) return;

  assertBelowRoot(downloadsRoot, sourceFile.parentPath, "SOULSEEK_DIR");

  const relativeParentPath = relative(downloadsRoot, sourceFile.parentPath);
  if (relativeParentPath.includes(sep)) return;

  const currentParentStats = await lstat(sourceFile.parentPath);

  if (
    !currentParentStats.isDirectory() ||
    currentParentStats.isSymbolicLink() ||
    currentParentStats.dev !== sourceFile.parentStats.dev ||
    currentParentStats.ino !== sourceFile.parentStats.ino
  )
    throw new Error("The downloaded source directory changed before cleanup");

  const realParentPath = await realpath(sourceFile.parentPath);
  assertBelowRoot(downloadsRoot, realParentPath, "SOULSEEK_DIR");

  await rmdir(sourceFile.parentPath).catch((error: unknown) => {
    const errorCode = (error as NodeJS.ErrnoException).code;
    if (errorCode !== "ENOENT" && errorCode !== "ENOTEMPTY") throw error;
  });
}
