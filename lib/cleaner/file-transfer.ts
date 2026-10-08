import fs from "node:fs/promises";
import { constants, type Stats } from "node:fs";
import path from "node:path";
import { hashFile } from "../scanner/hash";
import { normalizePath } from "../scanner/path-rules";

function unchanged(a: Stats, b: Stats) {
  return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs && b.isFile() && !b.isSymbolicLink();
}

async function regularFile(filePath: string) {
  const stat = await fs.lstat(filePath);
  if (!stat.isFile() || stat.isSymbolicLink() || normalizePath(await fs.realpath(filePath)) !== normalizePath(filePath)) throw new Error("文件路径已改变或包含链接");
  return stat;
}

/** Stage a second copy without overwriting a destination or removing the source. */
export async function stageFileTransfer(source: string, destination: string) {
  const before = await regularFile(source);
  if (normalizePath(await fs.realpath(path.dirname(destination))) !== normalizePath(path.dirname(destination))) throw new Error("目标目录包含链接，不允许移动");
  let created = false;
  try {
    try {
      // Same-volume hard links preserve bytes/metadata and atomically reject an existing target.
      await fs.link(source, destination);
      created = true;
    } catch (error) {
      if (!["EXDEV", "EPERM", "ENOTSUP", "EACCES"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
      await fs.copyFile(source, destination, constants.COPYFILE_EXCL);
      created = true;
      const [sourceHash, destinationHash] = await Promise.all([hashFile(source), hashFile(destination)]);
      if (sourceHash !== destinationHash) throw new Error("跨盘复制校验失败，原文件已保留");
      await fs.utimes(destination, before.atime, before.mtime);
    }
    const staged = await regularFile(destination);
    if (staged.size !== before.size || !unchanged(before, await regularFile(source))) throw new Error("复制期间原文件已改变，原文件已保留");
    const handle = await fs.open(destination, "r+");
    try { await handle.sync(); } finally { await handle.close(); }
    return before;
  } catch (error) {
    if (created) await fs.rm(destination, { force: true });
    throw error;
  }
}

/** Only remove the source after its destination and recovery record are durable. */
export async function finishFileTransfer(source: string, expected: Stats) {
  if (!unchanged(expected, await regularFile(source))) throw new Error("文件在移动前已改变，原文件已保留");
  await fs.unlink(source);
}
