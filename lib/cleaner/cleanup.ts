import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { CleanupRequest, CleanupResult, FileFinding } from "../../types/cleaner";
import { isProtectedPath } from "../scanner/path-rules";

interface QuarantineRecord {
  id: string;
  originalPath: string;
  quarantinePath: string;
  size: number;
  createdAt: string;
}

export class CleanupManager {
  private quarantineDir: string;
  private manifestPath: string;

  constructor(userDataPath: string) {
    this.quarantineDir = path.join(userDataPath, "quarantine");
    this.manifestPath = path.join(this.quarantineDir, "manifest.json");
  }

  async cleanup(request: CleanupRequest, findings: FileFinding[], allowPermanentDelete: boolean): Promise<CleanupResult> {
    const selected = new Set(request.findingIds);
    const targets = findings.filter((item) => selected.has(item.id) && item.recommendedAction !== "keep" && item.risk !== "danger");
    const result: CleanupResult = { cleanedFiles: 0, cleanedBytes: 0, failed: [] };

    for (const item of targets) {
      try {
        if (isProtectedPath(item.path) && item.category !== "system_cache") {
          throw new Error("受保护目录不允许清理");
        }

        if (request.mode === "delete" && !allowPermanentDelete) {
          throw new Error("永久删除未在设置中启用");
        }

        if (request.mode === "trash") {
          const { shell } = await import("electron");
          await shell.trashItem(item.path);
        } else if (request.mode === "quarantine") {
          await this.moveToQuarantine(item);
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

  private async moveToQuarantine(item: FileFinding) {
    await fs.mkdir(this.quarantineDir, { recursive: true });
    const id = randomUUID();
    const targetPath = path.join(this.quarantineDir, `${id}-${path.basename(item.path)}`);
    await fs.rename(item.path, targetPath);

    const manifest = await this.readManifest();
    manifest.push({
      id,
      originalPath: item.path,
      quarantinePath: targetPath,
      size: item.size,
      createdAt: new Date().toISOString()
    });
    await this.writeManifest(manifest);
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
