import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import type { CleanupRequest, CleanupResult, FileFinding } from "../../types/cleaner";
import { isProtectedPath } from "../scanner/path-rules";

interface QuarantineRecord {
  id: string;
  originalPath: string;
  quarantinePath: string;
  size: number;
  createdAt: string;
}

interface DirectoryTrashTarget {
  path: string;
  items: FileFinding[];
}

export class CleanupManager {
  private quarantineDir: string;
  private manifestPath: string;
  private trashTempDir: string;
  private readonly fileOperationConcurrency = 32;
  private readonly trashBatchSize = 8000;

  constructor(userDataPath: string) {
    this.quarantineDir = path.join(userDataPath, "quarantine");
    this.manifestPath = path.join(this.quarantineDir, "manifest.json");
    this.trashTempDir = path.join(userDataPath, "trash-batches");
  }

  async cleanup(request: CleanupRequest, findings: FileFinding[], allowPermanentDelete: boolean): Promise<CleanupResult> {
    const selected = new Set(request.findingIds);
    const targets = findings.filter((item) => selected.has(item.id) && item.recommendedAction !== "keep" && item.risk !== "danger");
    const result: CleanupResult = { cleanedFiles: 0, cleanedBytes: 0, failed: [] };
    const quarantineManifest = request.mode === "quarantine" ? await this.readManifest() : null;
    const safeTargets: FileFinding[] = [];

    for (const item of targets) {
      try {
        if (isProtectedPath(item.path) && item.category !== "system_cache") {
          throw new Error("受保护目录不允许清理");
        }

        if (request.mode === "delete" && !allowPermanentDelete) {
          throw new Error("永久删除未在设置中启用");
        }

        safeTargets.push(item);
      } catch (error) {
        result.failed.push({
          path: item.path,
          reason: error instanceof Error ? error.message : "清理失败"
        });
      }
    }

    if (request.mode === "trash") {
      await this.moveToTrashInBatches(safeTargets, result);
    } else {
      await runConcurrent(safeTargets, this.fileOperationConcurrency, async (item) => {
        try {
          if (request.mode === "quarantine") {
            quarantineManifest!.push(await this.moveToQuarantine(item));
          } else {
            await fs.rm(item.path, { force: true, recursive: false });
          }

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

    if (quarantineManifest) {
      await this.writeManifest(quarantineManifest);
    }

    return result;
  }

  async restoreFromQuarantine(itemId: string) {
    const manifest = await this.readManifest();
    const item = manifest.find((record) => record.id === itemId);
    if (!item) return false;

    await fs.mkdir(path.dirname(item.originalPath), { recursive: true });
    await fs.rename(item.quarantinePath, item.originalPath);
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

  private async moveToQuarantine(item: FileFinding): Promise<QuarantineRecord> {
    await fs.mkdir(this.quarantineDir, { recursive: true });
    const id = randomUUID();
    const targetPath = path.join(this.quarantineDir, `${id}-${path.basename(item.path)}`);
    await fs.rename(item.path, targetPath);

    return {
      id,
      originalPath: item.path,
      quarantinePath: targetPath,
      size: item.size,
      createdAt: new Date().toISOString()
    };
  }

  private async readManifest(): Promise<QuarantineRecord[]> {
    try {
      return JSON.parse(await fs.readFile(this.manifestPath, "utf8")) as QuarantineRecord[];
    } catch {
      return [];
    }
  }

  private async writeManifest(records: QuarantineRecord[]) {
    await fs.mkdir(this.quarantineDir, { recursive: true });
    await fs.writeFile(this.manifestPath, JSON.stringify(records, null, 2), "utf8");
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
    if (!groupItems.every((item) => item.category === "system_cache" || item.category === "wechat_cache" || item.category === "qq_cache")) continue;

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
