import { constants } from "node:fs";
import type { Stats } from "node:fs";
import { lstat, mkdir, open, readdir, realpath, unlink } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
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

type OwnedDirectory = {
  handle: FileHandle;
  path: string;
  stats: Stats;
};

type OwnedFile = {
  handle: FileHandle;
  name: string;
  parent: OwnedDirectory;
  stats: Stats;
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

  const downloadsRoot = await openOwnedRoot(input.downloadsDir, "SOULSEEK_DIR");
  let singlesRoot: OwnedDirectory | null = null;
  let sourceFile: OwnedFile | null = null;
  let destinationDirectory: OwnedDirectory | null = null;
  let existingTargetFile: OwnedFile | null = null;

  try {
    singlesRoot = await openOwnedRoot(input.singlesDir, "SINGLES_DIR");
    sourceFile = await getDownloadedSource(downloadsRoot, input.pick.file);
    const targetPath = singlePath(singlesRoot.path, input.song, input.pick.file);
    const targetName = basename(targetPath);

    destinationDirectory = await prepareDestinationDirectory(singlesRoot, dirname(targetPath));

    const descriptorTargetPath = pathThroughDirectory(destinationDirectory, targetName);
    const existingTargetStats = await getFileStats(descriptorTargetPath);

    if (existingTargetStats) {
      if (!existingTargetStats.isFile() || existingTargetStats.isSymbolicLink()) {
        throw new Error(`The destination ${targetName} already exists`);
      }

      existingTargetFile = await openOwnedFile(destinationDirectory, targetName, existingTargetStats, "destination");

      if (!(await haveSameContents(sourceFile, existingTargetFile))) {
        throw new Error(`The destination ${targetName} already exists`);
      }

      await assertOwnedDirectoryPath(singlesRoot, "SINGLES_DIR");
      await assertOwnedDirectoryPath(destinationDirectory, "destination directory");
      await assertOwnedFilePath(existingTargetFile, "destination");
      await deleteOwnedSource(sourceFile);

      return targetPath;
    }

    const targetFile = await copyOwnedFile(sourceFile, targetPath, targetName, destinationDirectory, singlesRoot);

    try {
      await assertOwnedDirectoryPath(singlesRoot, "SINGLES_DIR");
      await assertOwnedDirectoryPath(destinationDirectory, "destination directory");
      await assertOwnedFilePath(targetFile, "copied file");
      await deleteOwnedSource(sourceFile);
    } catch (error: unknown) {
      await deleteOwnedFile(targetFile).catch(() => undefined);

      throw error;
    }

    await targetFile.handle.close().catch(() => undefined);

    return targetPath;
  } finally {
    await existingTargetFile?.handle.close().catch(() => undefined);
    await sourceFile?.handle.close().catch(() => undefined);
    await sourceFile?.parent.handle.close().catch(() => undefined);
    await destinationDirectory?.handle.close().catch(() => undefined);
    await singlesRoot?.handle.close().catch(() => undefined);
    await downloadsRoot.handle.close().catch(() => undefined);
  }
}

async function openOwnedFile(
  parentDirectory: OwnedDirectory,
  fileName: string,
  expectedStats: Stats,
  fileNameForError: string,
): Promise<OwnedFile> {
  const fileHandle = await open(
    pathThroughDirectory(parentDirectory, fileName),
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );

  try {
    const openedFileStats = await fileHandle.stat();

    assertSameFile(openedFileStats, expectedStats, `The ${fileNameForError} changed before it could be opened`);

    return {
      handle: fileHandle,
      name: fileName,
      parent: parentDirectory,
      stats: openedFileStats,
    };
  } catch (error: unknown) {
    await fileHandle.close().catch(() => undefined);

    throw error;
  }
}

async function haveSameContents(firstFile: OwnedFile, secondFile: OwnedFile): Promise<boolean> {
  if (firstFile.stats.size !== secondFile.stats.size) return false;

  const firstBuffer = Buffer.allocUnsafe(1024 * 1024);
  const secondBuffer = Buffer.allocUnsafe(1024 * 1024);
  let readPosition = 0;

  while (readPosition < firstFile.stats.size) {
    const readLength = Math.min(firstBuffer.length, firstFile.stats.size - readPosition);
    const [firstRead, secondRead] = await Promise.all([
      firstFile.handle.read(firstBuffer, 0, readLength, readPosition),
      secondFile.handle.read(secondBuffer, 0, readLength, readPosition),
    ]);

    if (
      firstRead.bytesRead !== secondRead.bytesRead ||
      !firstBuffer.subarray(0, firstRead.bytesRead).equals(secondBuffer.subarray(0, secondRead.bytesRead))
    ) {
      return false;
    }
    if (!firstRead.bytesRead) return readPosition === firstFile.stats.size;

    readPosition += firstRead.bytesRead;
  }

  return true;
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

async function openOwnedRoot(directory: string, rootName: string): Promise<OwnedDirectory> {
  const realDirectoryPath = await realpath(directory);
  const directoryStats = await lstat(realDirectoryPath);

  if (!directoryStats.isDirectory() || directoryStats.isSymbolicLink())
    throw new Error(`${rootName} must be a directory`);

  const directoryHandle = await open(
    realDirectoryPath,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );

  try {
    const openedDirectoryStats = await directoryHandle.stat();

    assertSameDirectory(openedDirectoryStats, directoryStats, `${rootName} changed before it could be opened`);

    return { handle: directoryHandle, path: realDirectoryPath, stats: openedDirectoryStats };
  } catch (error: unknown) {
    await directoryHandle.close().catch(() => undefined);

    throw error;
  }
}

async function getFileStats(filePath: string): Promise<Stats | null> {
  return lstat(filePath).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;

    throw error;
  });
}

async function getOwnedSource(
  sourcePath: string,
  downloadsRoot: OwnedDirectory,
  expectedSize: number,
): Promise<OwnedFile | null> {
  assertBelowRoot(downloadsRoot.path, sourcePath, "SOULSEEK_DIR");

  const sourceName = basename(sourcePath);
  const parentPath = dirname(sourcePath);
  const parentRelativePath = relative(downloadsRoot.path, parentPath);

  if (parentRelativePath === ".." || parentRelativePath.startsWith(`..${sep}`) || parentRelativePath.includes(sep)) {
    throw new Error("The downloaded source directory must be directly inside SOULSEEK_DIR");
  }

  const parentStats = await getFileStats(parentPath);
  if (!parentStats) return null;

  const parentDirectory = await openOwnedChildDirectory(
    downloadsRoot,
    parentRelativePath || ".",
    parentPath,
    "downloaded source directory",
    "SOULSEEK_DIR",
  );
  const descriptorSourcePath = pathThroughDirectory(parentDirectory, sourceName);
  let sourceHandle: FileHandle | null = null;

  try {
    const namedSourceStats = await getFileStats(sourcePath);
    if (!namedSourceStats) {
      await parentDirectory.handle.close();

      return null;
    }
    if (!namedSourceStats.isFile() || namedSourceStats.isSymbolicLink()) {
      throw new Error("The downloaded source must be a regular file");
    }

    sourceHandle = await open(descriptorSourcePath, constants.O_RDONLY | constants.O_NOFOLLOW).catch(
      (error: unknown) => {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;

        throw error;
      },
    );

    if (!sourceHandle) {
      await parentDirectory.handle.close();

      return null;
    }

    const sourceStats = await sourceHandle.stat();

    if (!sourceStats.isFile() || sourceStats.isSymbolicLink())
      throw new Error("The downloaded source must be a regular file");

    const realSourcePath = await realpath(descriptorSourcePath);
    assertBelowRoot(downloadsRoot.path, realSourcePath, "SOULSEEK_DIR");

    if (realSourcePath !== sourcePath) throw new Error("The downloaded source must not use a symbolic link");
    if (sourceStats.size !== expectedSize) {
      await sourceHandle.close();
      await parentDirectory.handle.close();

      return null;
    }

    assertSameFile(namedSourceStats, sourceStats, "The downloaded source changed before it could be opened");

    return {
      handle: sourceHandle,
      name: sourceName,
      parent: parentDirectory,
      stats: sourceStats,
    };
  } catch (error: unknown) {
    await sourceHandle?.close().catch(() => undefined);
    await parentDirectory.handle.close().catch(() => undefined);

    throw error;
  }
}

async function getDownloadedSource(downloadsRoot: OwnedDirectory, file: SoulseekFileMetadata): Promise<OwnedFile> {
  const filenameSegments = getRemotePathSegments(file.filename);
  if (!filenameSegments) throw new Error("The transfer has an unsafe remote filename");

  const filename = filenameSegments.at(-1) ?? "";
  const remoteParent = filenameSegments.at(-2);
  const expectedPath = resolve(downloadsRoot.path, ...(remoteParent ? [remoteParent, filename] : [filename]));
  const expectedSource = await getOwnedSource(expectedPath, downloadsRoot, file.size);

  if (expectedSource) return expectedSource;

  const matchingSources: OwnedFile[] = [];

  for (const directoryEntry of await readdir(pathThroughDirectory(downloadsRoot), { withFileTypes: true })) {
    if (!directoryEntry.isDirectory()) continue;

    const candidatePath = resolve(downloadsRoot.path, directoryEntry.name, filename);
    if (candidatePath === expectedPath) continue;

    const candidateSource = await getOwnedSource(candidatePath, downloadsRoot, file.size);
    if (candidateSource) matchingSources.push(candidateSource);
  }

  if (matchingSources.length > 1) {
    await Promise.all(
      matchingSources.flatMap((matchingSource) => [
        matchingSource.handle.close(),
        matchingSource.parent.handle.close(),
      ]),
    );

    throw new Error(`Found more than one downloaded file named ${basename(filename)}`);
  }

  const matchingSource = matchingSources[0];
  if (matchingSource) return matchingSource;

  throw new Error(`The downloaded file ${basename(filename)} wasn't found`);
}

async function prepareDestinationDirectory(
  singlesRoot: OwnedDirectory,
  destinationDirectory: string,
): Promise<OwnedDirectory> {
  assertBelowRoot(singlesRoot.path, destinationDirectory, "SINGLES_DIR");

  const relativeDestinationPath = relative(singlesRoot.path, destinationDirectory);
  if (!relativeDestinationPath || relativeDestinationPath.includes(sep)) {
    throw new Error("The destination directory must be directly inside SINGLES_DIR");
  }

  await mkdir(pathThroughDirectory(singlesRoot, relativeDestinationPath)).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  });

  return openOwnedChildDirectory(
    singlesRoot,
    relativeDestinationPath,
    destinationDirectory,
    "destination directory",
    "SINGLES_DIR",
  );
}

async function copyOwnedFile(
  sourceFile: OwnedFile,
  targetPath: string,
  targetName: string,
  destinationDirectory: OwnedDirectory,
  singlesRoot: OwnedDirectory,
): Promise<OwnedFile> {
  let targetHandle: Awaited<ReturnType<typeof open>> | null = null;

  try {
    const openedSourceStats = await sourceFile.handle.stat();
    assertSameFile(openedSourceStats, sourceFile.stats, "The downloaded source changed before it could be moved");

    targetHandle = await open(
      pathThroughDirectory(destinationDirectory, targetName),
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      openedSourceStats.mode,
    );

    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let readPosition = 0;

    for (;;) {
      const { bytesRead } = await sourceFile.handle.read(buffer, 0, buffer.length, readPosition);
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

    const descriptorTargetPath = pathThroughDirectory(destinationDirectory, targetName);
    const realTargetPath = await realpath(descriptorTargetPath);
    assertBelowRoot(singlesRoot.path, realTargetPath, "SINGLES_DIR");

    if (realTargetPath !== targetPath) throw new Error("The destination directory changed while copying the file");

    const currentTargetStats = await lstat(descriptorTargetPath);
    assertSameFile(currentTargetStats, targetStats, "The copied file changed before the source could be removed");

    const targetFile = {
      handle: targetHandle,
      name: targetName,
      parent: destinationDirectory,
      stats: targetStats,
    };

    targetHandle = null;

    return targetFile;
  } catch (error: unknown) {
    if (targetHandle) {
      const targetStats = await targetHandle.stat().catch(() => null);

      if (targetStats) {
        await deleteOwnedFile({
          handle: targetHandle,
          name: targetName,
          parent: destinationDirectory,
          stats: targetStats,
        }).catch(() => undefined);
      } else {
        await targetHandle.close().catch(() => undefined);
      }

      targetHandle = null;
    }

    throw error;
  } finally {
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

function assertSameDirectory(actualStats: Stats, expectedStats: Stats, message: string) {
  if (
    !actualStats.isDirectory() ||
    actualStats.isSymbolicLink() ||
    actualStats.dev !== expectedStats.dev ||
    actualStats.ino !== expectedStats.ino
  )
    throw new Error(message);
}

async function openOwnedChildDirectory(
  rootDirectory: OwnedDirectory,
  relativeDirectoryPath: string,
  expectedDirectoryPath: string,
  directoryName: string,
  rootName: string,
): Promise<OwnedDirectory> {
  const namedDirectoryStats = await lstat(expectedDirectoryPath);

  if (namedDirectoryStats.isSymbolicLink()) {
    if (rootName === "SOULSEEK_DIR") {
      const linkedDirectoryPath = await realpath(expectedDirectoryPath);

      assertBelowRoot(rootDirectory.path, linkedDirectoryPath, rootName);
    }

    throw new Error(`The ${directoryName} must not be a symbolic link`);
  }
  if (!namedDirectoryStats.isDirectory()) throw new Error(`The ${directoryName} must be a regular directory`);

  const directoryHandle = await open(
    pathThroughDirectory(rootDirectory, relativeDirectoryPath),
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );

  try {
    const directoryStats = await directoryHandle.stat();

    if (!directoryStats.isDirectory() || directoryStats.isSymbolicLink()) {
      throw new Error(`The ${directoryName} must be a regular directory`);
    }

    const realDirectoryPath = await realpath(pathThroughHandle(directoryHandle));

    if (realDirectoryPath !== expectedDirectoryPath) {
      throw new Error(`The ${directoryName} must not be a symbolic link`);
    }

    const currentNamedDirectoryStats = await lstat(expectedDirectoryPath);
    assertSameDirectory(
      currentNamedDirectoryStats,
      directoryStats,
      `The ${directoryName} changed before it could be used`,
    );

    return { handle: directoryHandle, path: expectedDirectoryPath, stats: directoryStats };
  } catch (error: unknown) {
    await directoryHandle.close().catch(() => undefined);

    throw error;
  }
}

async function assertOwnedDirectoryPath(directory: OwnedDirectory, directoryName: string): Promise<void> {
  const currentDirectoryStats = await lstat(directory.path);

  assertSameDirectory(currentDirectoryStats, directory.stats, `The ${directoryName} changed while moving the file`);

  const currentRealPath = await realpath(directory.path);
  if (currentRealPath !== directory.path) throw new Error(`The ${directoryName} changed while moving the file`);
}

async function assertOwnedFilePath(file: OwnedFile, fileName: string): Promise<void> {
  const currentFileStats = await lstat(pathThroughDirectory(file.parent, file.name));

  assertSameFile(currentFileStats, file.stats, `The ${fileName} changed while moving the file`);
}

function pathThroughHandle(handle: FileHandle): string {
  return `/proc/self/fd/${handle.fd}`;
}

function pathThroughDirectory(directory: OwnedDirectory, fileName?: string): string {
  const directoryPath = pathThroughHandle(directory.handle);

  return fileName ? `${directoryPath}/${fileName}` : directoryPath;
}

async function deleteOwnedSource(sourceFile: OwnedFile) {
  const currentSourceStats = await sourceFile.handle.stat();
  assertSameFile(currentSourceStats, sourceFile.stats, "The downloaded source changed before it could be removed");

  const descriptorSourcePath = pathThroughDirectory(sourceFile.parent, sourceFile.name);
  const namedSourceStats = await lstat(descriptorSourcePath);
  assertSameFile(namedSourceStats, sourceFile.stats, "The downloaded source changed before it could be removed");

  await unlink(descriptorSourcePath);
}

async function deleteOwnedFile(file: OwnedFile) {
  try {
    const currentHandleStats = await file.handle.stat();
    assertSameFile(currentHandleStats, file.stats, "The copied file changed before it could be removed");

    const descriptorFilePath = pathThroughDirectory(file.parent, file.name);
    const currentStats = await lstat(descriptorFilePath);
    assertSameFile(currentStats, file.stats, "The copied file changed before it could be removed");

    await unlink(descriptorFilePath);
  } finally {
    await file.handle.close().catch(() => undefined);
  }
}
