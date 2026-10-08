import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import type { Stats } from "node:fs";
import type { CleanupRequest, CleanupResult, FileFinding } from "../../types/cleaner";
import { isAllowedSystemCacheFile, isProtectedChatFile, isProtectedPath, normalizePath } from "../scanner/path-rules";
import { classifyWechatFile, looksLikeChatStorage } from "../scanner/wechat";
import { isProtectedSoftwareFile, isSoftwareRunning, matchSoftwareRoot, readSoftwareInventory, softwareCacheRoots, suspectedResidualRoots } from "../scanner/software";
import { fileQueue, writeJsonAtomically, type SerialQueue } from "../storage/atomic-file";
import { stageFileTransfer, finishFileTransfer } from "./file-transfer";
import { hashFile } from "../scanner/hash";

interface QuarantineRecord {
  id: string;
  originalPath: string;
  quarantinePath: string;
  size: number;
  createdAt: string;
  modifiedAt?: string;
  state?: "pending" | "ready" | "quarantined" | "restoring";
  restoreHash?: string;
}

interface DirectoryTrashTarget {
  path: string;
  items: FileFinding[];
}

export class CleanupManager {
  private quarantineDir: string;
  private manifestPath: string;
  private trashTempDir: string;
  private queue: SerialQueue;
  private readonly fileOperationConcurrency = 32;
  private readonly trashBatchSize = 8000;

  constructor(userDataPath: string) {
    this.quarantineDir = path.join(userDataPath, "quarantine");
    this.manifestPath = path.join(this.quarantineDir, "manifest.json");
    this.trashTempDir = path.join(userDataPath, "trash-batches");
    this.queue = fileQueue(this.manifestPath);
  }

  async cleanup(request: CleanupRequest, findings: FileFinding[], allowPermanentDelete: boolean): Promise<CleanupResult> {
    return this.queue.run(() => this.cleanupCurrent(request, findings, allowPermanentDelete));
  }

  private async cleanupCurrent(request: CleanupRequest, findings: FileFinding[], allowPermanentDelete: boolean): Promise<CleanupResult> {
    if (!["trash", "quarantine", "delete"].includes(request.mode)) throw new Error("无效的清理模式");
    const selected = new Set(request.findingIds);
    const targets = [...new Map(findings.filter((item) => selected.has(item.id) && item.recommendedAction !== "keep" && item.risk !== "danger").map((item) => [normalizePath(item.path), item])).values()];
    const result: CleanupResult = { cleanedFiles: 0, cleanedBytes: 0, failed: [] };
    const safeTargets: FileFinding[] = [];
    const hasSoftware = targets.some((item) => item.category === "software_residuals" || item.category === "software_cache");
    const inventory = hasSoftware ? await readSoftwareInventory() : null;
    const residualRoots = hasSoftware ? await suspectedResidualRoots(inventory) : [];

    await runConcurrent(targets, this.fileOperationConcurrency, async (item) => {
      try {
        const system = item.category === "system_cache" || item.category === "admin_required";
        if (system && !isAllowedSystemCacheFile(item.path)) throw new Error("不在允许的系统缓存路径内");
        if (isProtectedPath(item.path) && !system) {
          throw new Error("受保护目录不允许清理");
        }
        if (item.category === "wechat_cache" || item.category === "wechat_attachments") {
          if (classifyWechatFile(item.path) !== (item.category === "wechat_cache" ? "cache" : "attachment")) throw new Error("微信数据库、配置或未知文件不允许清理");
        } else if (item.category === "qq_cache") {
          if (isProtectedChatFile(item.path)) throw new Error("聊天数据文件不允许清理");
        } else if (!system && looksLikeChatStorage(item.path)) {
          throw new Error("聊天目录只能通过专用分类清理");
        }
        if (item.category === "software_cache" || item.category === "software_residuals") {
          const root = matchSoftwareRoot(item.path, item.category === "software_residuals" ? residualRoots : softwareCacheRoots());
          if (!inventory || !root || root.softwareId !== item.softwareId || isProtectedSoftwareFile(item.path)) throw new Error("软件状态已改变或无法确认，请重新扫描");
          if (isSoftwareRunning(root.softwareId, inventory)) throw new Error("软件正在运行，请退出后重新扫描");
        }

        if (request.mode === "delete" && !allowPermanentDelete) {
          throw new Error("永久删除未在设置中启用");
        }

        const stat = await fs.lstat(item.path);
        if (!stat.isFile() || stat.isSymbolicLink() || normalizePath(await fs.realpath(item.path)) !== normalizePath(item.path)) throw new Error("文件路径已改变或包含链接，请重新扫描");
        if (stat.size !== item.size || stat.mtime.toISOString() !== item.modifiedAt) throw new Error("文件自扫描后已改变，请重新扫描");

        safeTargets.push(item);
      } catch (error) {
        result.failed.push({
          path: item.path,
          reason: error instanceof Error ? error.message : "清理失败"
        });
      }
    });

    if (request.mode === "trash") {
      await this.moveToTrashInBatches(safeTargets, result);
    } else if (request.mode === "quarantine") {
      await this.moveToQuarantine(safeTargets, result);
    } else {
      await runConcurrent(safeTargets, this.fileOperationConcurrency, async (item) => {
        try {
          await fs.rm(item.path, { force: true, recursive: false });

          result.cleanedFiles += 1;
          result.cleanedBytes += item.size;
        } catch (error) {
          result.failed.push({
            path: item.path,
            reason: error instanceof Error ? error.message : "清理失败"
          });
        }
      });
    }

    return result;
  }

  async restoreFromQuarantine(itemId: string) {
    return this.queue.run(() => this.restoreCurrent(itemId));
  }

  private async restoreCurrent(itemId: string) {
    const manifest = await this.readManifest();
    const item = manifest.find((record) => record.id === itemId);
    if (!item) return false;
    if (normalizePath(path.dirname(item.quarantinePath)) !== normalizePath(this.quarantineDir)) throw new Error("无效的隔离区路径");

    if (await pathExists(item.originalPath)) {
      // A previous restore may have finished moving bytes but not updating the JSON.
      if (item.state !== "restoring" || !item.restoreHash || await hashFile(item.originalPath) !== item.restoreHash) throw new Error("恢复目标已存在，为避免覆盖请先移走该文件");
      const original = await fs.lstat(item.originalPath);
      if (!original.isFile() || original.isSymbolicLink() || normalizePath(await fs.realpath(item.originalPath)) !== normalizePath(item.originalPath)) throw new Error("恢复目标包含链接");
      if (await pathExists(item.quarantinePath)) {
        if (await hashFile(item.quarantinePath) !== item.restoreHash) throw new Error("隔离文件已改变，请保留并人工检查");
        const expected = await fs.lstat(item.quarantinePath);
        await finishFileTransfer(item.quarantinePath, expected);
      }
      await this.writeManifest(manifest.filter((record) => record.id !== itemId));
      return true;
    }

    await fs.mkdir(path.dirname(item.originalPath), { recursive: true });
    const stat = await fs.lstat(item.quarantinePath);
    if (stat.size !== item.size) throw new Error("隔离文件大小已改变，请人工检查");
    const digest = await hashFile(item.quarantinePath);
    if (item.restoreHash && item.restoreHash !== digest) throw new Error("隔离文件已改变，请人工检查");
    item.restoreHash = digest;
    item.state = "restoring";
    await this.writeManifest(manifest);
    const expected = await stageFileTransfer(item.quarantinePath, item.originalPath);
    if (await hashFile(item.originalPath) !== digest) {
      throw new Error("恢复校验失败，目标文件与隔离副本均已保留，请人工检查");
    }
    await finishFileTransfer(item.quarantinePath, expected);
    await this.writeManifest(manifest.filter((record) => record.id !== itemId));
    return true;
  }

  private async moveToTrashInBatches(items: FileFinding[], result: CleanupResult) {
    const compacted = await collectDirectoryTrashTargets(items);
    const remainingFiles = [...compacted.files];

    for (let start = 0; start < compacted.directories.length; start += this.trashBatchSize) {
      const batch = compacted.directories.slice(start, start + this.trashBatchSize);
      try {
        await movePathsToRecycleBin(batch.map((item) => item.path), this.trashTempDir);
      } catch {
        // Existing directories are expanded back to files below.
      }

      await runConcurrent(batch, this.fileOperationConcurrency, async (item) => {
        if (await pathExists(item.path)) {
          remainingFiles.push(...item.items);
          return;
        }

        result.cleanedFiles += item.items.length;
        result.cleanedBytes += item.items.reduce((sum, finding) => sum + finding.size, 0);
      });
    }

    for (let start = 0; start < remainingFiles.length; start += this.trashBatchSize) {
      const batch = remainingFiles.slice(start, start + this.trashBatchSize);
      try {
        await movePathsToRecycleBin(batch.map((item) => item.path), this.trashTempDir);
      } catch {
        await this.moveRemainingToTrashIndividually(batch);
      }

      await runConcurrent(batch, this.fileOperationConcurrency, async (item) => {
        if (await pathExists(item.path)) {
          result.failed.push({
            path: item.path,
            reason: "移入回收站失败"
          });
          return;
        }

        result.cleanedFiles += 1;
        result.cleanedBytes += item.size;
      });
    }
  }

  private async moveRemainingToTrashIndividually(items: FileFinding[]) {
    const { shell } = await import("electron");
    const remaining = [];
    for (const item of items) {
      if (await pathExists(item.path)) remaining.push(item);
    }

    await runConcurrent(remaining, 8, async (item) => {
      try {
        await shell.trashItem(item.path);
      } catch {
        // The caller records remaining paths as failed after this fallback.
      }
    });
  }

  private async moveToQuarantine(items: FileFinding[], result: CleanupResult) {
    if (!items.length) return;
    await fs.mkdir(this.quarantineDir, { recursive: true });
    const previous = await this.readManifest();
    const planned: QuarantineRecord[] = items.map((item) => {
      const id = randomUUID();
      return { id, originalPath: item.path, quarantinePath: path.join(this.quarantineDir, `${id}-${path.basename(item.path)}`), size: item.size, modifiedAt: item.modifiedAt, createdAt: new Date().toISOString(), state: "pending" };
    });
    // Journal the batch before creating copies. Never delete originals before the ready journal.
    await this.writeManifest([...previous, ...planned]);
    const staged = new Map<string, Stats>();
    await runConcurrent(planned, this.fileOperationConcurrency, async (record) => {
      try {
        const expected = await stageFileTransfer(record.originalPath, record.quarantinePath);
        if (expected.size !== record.size || expected.mtime.toISOString() !== record.modifiedAt) {
          await fs.rm(record.quarantinePath, { force: true });
          throw new Error("文件自扫描后已改变，原文件已保留");
        }
        staged.set(record.id, expected);
        record.state = "ready";
      } catch (error) {
        result.failed.push({ path: record.originalPath, reason: error instanceof Error ? error.message : "隔离失败，原文件已保留" });
      }
    });
    const recoverable: QuarantineRecord[] = [];
    for (const record of planned) if (await pathExists(record.quarantinePath)) recoverable.push(record);
    await this.writeManifest([...previous, ...recoverable]);
    await runConcurrent(recoverable, this.fileOperationConcurrency, async (record) => {
      const expected = staged.get(record.id);
      if (!expected) return;
      try {
        await finishFileTransfer(record.originalPath, expected);
        record.state = "quarantined";
        result.cleanedFiles += 1;
        result.cleanedBytes += record.size;
      } catch (error) {
        result.failed.push({ path: record.originalPath, reason: error instanceof Error ? error.message : "移除原文件失败，隔离副本已保留" });
      }
    });
    await this.writeManifest([...previous, ...recoverable]);
  }

  private async readManifest(): Promise<QuarantineRecord[]> {
    try {
      return JSON.parse(await fs.readFile(this.manifestPath, "utf8")) as QuarantineRecord[];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  private async writeManifest(records: QuarantineRecord[]) {
    await writeJsonAtomically(this.manifestPath, records);
  }
}

async function runConcurrent<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>) {
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const item = items[nextIndex];
      nextIndex += 1;
      await worker(item);
    }
  });

  await Promise.all(workers);
}

async function pathExists(targetPath: string) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function collectDirectoryTrashTargets(items: FileFinding[]) {
  const groups = new Map<string, FileFinding[]>();
  const selectedPaths = new Set(items.map((item) => normalizeForCompare(item.path)));
  const directories: DirectoryTrashTarget[] = [];
  const compactedFileIds = new Set<string>();

  for (const item of items) {
    const parent = path.dirname(item.path);
    groups.set(parent, [...(groups.get(parent) ?? []), item]);
  }

  for (const [directoryPath, groupItems] of groups) {
    if (groupItems.length < 50) continue;
    if (isProtectedPath(directoryPath)) continue;
    if (!groupItems.every((item) => item.category === "system_cache" || item.category === "browser_cache" || item.category === "wechat_cache" || item.category === "qq_cache")) continue;

    let entries;
    try {
      entries = await fs.readdir(directoryPath, { withFileTypes: true });
    } catch {
      continue;
    }

    const fileEntries = entries.filter((entry) => entry.isFile());
    const hasNonFileEntry = entries.length !== fileEntries.length;
    if (hasNonFileEntry || fileEntries.length === 0) continue;

    const allFilesSelected = fileEntries.every((entry) => selectedPaths.has(normalizeForCompare(path.join(directoryPath, entry.name))));
    if (!allFilesSelected) continue;

    directories.push({ path: directoryPath, items: groupItems });
    for (const item of groupItems) compactedFileIds.add(item.id);
  }

  return {
    directories,
    files: items.filter((item) => !compactedFileIds.has(item.id))
  };
}

function normalizeForCompare(value: string) {
  return path.resolve(value).replace(/\//g, "\\").toLowerCase();
}

async function movePathsToRecycleBin(paths: string[], tempDir: string) {
  if (paths.length === 0) return;

  await fs.mkdir(tempDir, { recursive: true });
  const listPath = path.join(tempDir, `.cleaner-trash-${randomUUID()}.json`);
  await fs.writeFile(listPath, paths.join("\n"), "utf8");

  const command = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public class CleanerRecycleBin {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct SHFILEOPSTRUCT {
    public IntPtr hwnd;
    public UInt32 wFunc;
    [MarshalAs(UnmanagedType.LPWStr)]
    public string pFrom;
    [MarshalAs(UnmanagedType.LPWStr)]
    public string pTo;
    public UInt16 fFlags;
    public Int32 fAnyOperationsAborted;
    public IntPtr hNameMappings;
    [MarshalAs(UnmanagedType.LPWStr)]
    public string lpszProgressTitle;
  }

  [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
  public static extern int SHFileOperation(ref SHFILEOPSTRUCT fileOp);
}
"@

$paths = @(Get-Content -LiteralPath $env:CLEANER_TRASH_LIST -Encoding UTF8)
if ($paths.Count -eq 0) { exit 0 }
$separator = [string][char]0
$from = [string]::Join($separator, [string[]]$paths) + $separator + $separator
$operation = New-Object CleanerRecycleBin+SHFILEOPSTRUCT
$operation.wFunc = 3
$operation.pFrom = $from
$operation.fFlags = 0x654
$code = [CleanerRecycleBin]::SHFileOperation([ref]$operation)
if ($code -ne 0 -or $operation.fAnyOperationsAborted -ne 0) {
  throw "SHFileOperation failed with code $code, aborted $($operation.fAnyOperationsAborted)"
}
`;

  try {
    await runPowerShell(command, { CLEANER_TRASH_LIST: listPath });
  } finally {
    await fs.rm(listPath, { force: true });
  }
}

function runPowerShell(command: string, env: Record<string, string>) {
  const encodedCommand = Buffer.from(command, "utf16le").toString("base64");

  return new Promise<void>((resolve, reject) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encodedCommand], {
      env: { ...process.env, ...env },
      windowsHide: true
    });

    let stderr = "";
    let stdout = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr || stdout || `PowerShell exited with code ${code}`));
    });
  });
}
