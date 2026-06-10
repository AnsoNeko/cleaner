import fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { CleanerSettings, FileFinding, ScanCategory, ScanProgress, ScanSummary, ScanTarget } from "../../types/cleaner";
import { hashFile } from "./hash";
import {
  browserCachePaths,
  chatCachePaths,
  existingUserPaths,
  isProtectedChatFile,
  isProtectedPath,
  isUserContentFile,
  looksLikeBrowserCacheFile,
  looksLikeCacheFile,
  requiresAdminForCleanup,
  systemCachePaths
} from "./path-rules";

interface FileCandidate {
  path: string;
  size: number;
  modifiedAt: Date;
  accessedAt?: Date;
}

interface ScanTask {
  cancelled: boolean;
  progress: ScanProgress;
  summary?: ScanSummary;
  promise: Promise<ScanSummary>;
}

const maxFilesPerRoot = 12000;
const yieldEveryFiles = 150;

export class ScanManager {
  private tasks = new Map<string, ScanTask>();

  startScan(targets: ScanTarget[], settings: CleanerSettings) {
    const scanId = randomUUID();
    const progress: ScanProgress = {
      scanId,
      status: "running",
      currentPath: "",
      scannedFiles: 0,
      foundFiles: 0,
      foundBytes: 0,
      message: "正在准备扫描"
    };

    const task: ScanTask = {
      cancelled: false,
      progress,
      promise: Promise.resolve(null as never)
    };

    this.tasks.set(scanId, task);
    task.promise = this.runScan(scanId, targets, settings);
    return scanId;
  }

  whenComplete(scanId: string) {
    return this.tasks.get(scanId)?.promise;
  }

  cancel(scanId: string) {
    const task = this.tasks.get(scanId);
    if (!task) return false;
    task.cancelled = true;
    task.progress.status = "cancelled";
    task.progress.message = "正在取消扫描";
    return true;
  }

  getProgress(scanId: string) {
    return this.tasks.get(scanId)?.progress ?? null;
  }

  getSummary(scanId: string) {
    return this.tasks.get(scanId)?.summary ?? null;
  }

  private async runScan(scanId: string, targets: ScanTarget[], settings: CleanerSettings) {
    const task = this.tasks.get(scanId);
    if (!task) throw new Error("扫描任务不存在");

    const startedAt = new Date().toISOString();
    const findings: FileFinding[] = [];

    try {
      for (const target of targets) {
        if (task.cancelled) break;
        task.progress.message = `正在扫描 ${categoryLabel(target.category)}`;
        const partial = await this.scanTarget(scanId, target, settings);
        findings.push(...partial);
      }

      const summary: ScanSummary = {
        scanId,
        totalFiles: findings.length,
        totalBytes: findings.reduce((sum, item) => sum + item.size, 0),
        findings,
        startedAt,
        finishedAt: new Date().toISOString()
      };

      task.summary = summary;
      task.progress.status = task.cancelled ? "cancelled" : "completed";
      task.progress.foundFiles = summary.totalFiles;
      task.progress.foundBytes = summary.totalBytes;
      task.progress.message = task.cancelled ? "扫描已取消" : "扫描完成";
      return summary;
    } catch (error) {
      task.progress.status = "failed";
      task.progress.message = error instanceof Error ? error.message : "扫描失败";
      throw error;
    }
  }

  private async scanTarget(scanId: string, target: ScanTarget, settings: CleanerSettings) {
    if (target.category === "duplicates") {
      return this.scanDuplicates(scanId, target.paths ?? existingUserPaths(settings.customScanPaths));
    }

    const roots = this.rootsForTarget(target, settings);
    const candidates: FileCandidate[] = [];

    for (const root of roots) {
      candidates.push(
        ...(await this.walk(root, scanId, {
          allowProtectedRoot: target.category === "system_cache" || target.category === "admin_required",
          maxFiles: maxFilesPerRoot
        }))
      );
    }

    return candidates
      .map((file) => this.toFinding(file, target.category, target, settings))
      .filter((item): item is FileFinding => Boolean(item));
  }

  private rootsForTarget(target: ScanTarget, settings: CleanerSettings) {
    if (target.paths?.length) return target.paths;
    if (target.category === "system_cache" || target.category === "admin_required") return systemCachePaths();
    if (target.category === "browser_cache") return browserCachePaths();
    if (target.category === "wechat_cache") return chatCachePaths("wechat");
    if (target.category === "qq_cache") return chatCachePaths("qq");
    return existingUserPaths(settings.customScanPaths);
  }

  private async scanDuplicates(scanId: string, roots: string[]) {
    const files: FileCandidate[] = [];
    const task = this.tasks.get(scanId);

    for (const root of roots) {
      files.push(...(await this.walk(root, scanId, { allowProtectedRoot: false, maxFiles: maxFilesPerRoot })));
    }

    const bySize = new Map<number, FileCandidate[]>();
    for (const file of files.filter((item) => item.size > 0)) {
      bySize.set(file.size, [...(bySize.get(file.size) ?? []), file]);
    }

    const findings: FileFinding[] = [];
    let groupNumber = 0;
    for (const sameSize of bySize.values()) {
      if (task?.cancelled) break;
      if (sameSize.length < 2) continue;
      task!.progress.message = "正在计算重复文件哈希";
      const quickHashGroups = await this.groupByHash(scanId, sameSize, 1024 * 1024);

      for (const quickGroup of quickHashGroups.values()) {
        if (quickGroup.length < 2) continue;
        const fullHashGroups = await this.groupByHash(scanId, quickGroup);

        for (const duplicateGroup of fullHashGroups.values()) {
          if (duplicateGroup.length < 2) continue;
          groupNumber += 1;
          const groupId = `dup-${groupNumber}`;
          const keepPath = chooseDuplicateKeeper(duplicateGroup).path;

          for (const file of duplicateGroup) {
            findings.push({
              id: randomUUID(),
              path: file.path,
              size: file.size,
              modifiedAt: file.modifiedAt.toISOString(),
              accessedAt: file.accessedAt?.toISOString(),
              category: "duplicates",
              risk: file.path === keepPath ? "review" : "safe",
              reason: file.path === keepPath ? "重复组建议保留项" : `与重复组 ${groupNumber} 中其他文件内容一致`,
              duplicateGroupId: groupId,
              recommendedAction: file.path === keepPath ? "keep" : "delete"
            });
          }
        }
      }
    }

    return findings;
  }

  private async groupByHash(scanId: string, files: FileCandidate[], bytes?: number) {
    const groups = new Map<string, FileCandidate[]>();
    const task = this.tasks.get(scanId);

    for (const file of files) {
      if (task?.cancelled) break;
      try {
        task!.progress.currentPath = file.path;
        const digest = await hashFile(file.path, bytes);
        groups.set(digest, [...(groups.get(digest) ?? []), file]);
      } catch {
        continue;
      }
      await yieldToEventLoop();
    }

    return groups;
  }

  private toFinding(
    file: FileCandidate,
    category: ScanCategory,
    target: ScanTarget,
    settings: CleanerSettings
  ): FileFinding | null {
    const ageMs = Date.now() - file.modifiedAt.getTime();
    const ageDays = ageMs / 1000 / 60 / 60 / 24;
    const largeBytes = (target.largeFileSizeMb ?? settings.largeFileSizeMb) * 1024 * 1024;

    if (category === "large_files" && file.size < largeBytes) return null;
    if (category === "expired_files" && ageDays < (target.maxAgeDays ?? settings.expiredDays)) return null;
    if (category === "expired_files" && !isUserContentFile(file.path)) return null;

    if ((category === "wechat_cache" || category === "qq_cache") && isProtectedChatFile(file.path)) {
      return null;
    }

    if ((category === "wechat_cache" || category === "qq_cache") && ageDays < (target.maxAgeDays ?? settings.chatExpiredDays)) {
      return null;
    }

    if ((category === "system_cache" || category === "admin_required") && !looksLikeCacheFile(file.path)) {
      return null;
    }

    if (category === "browser_cache" && !looksLikeBrowserCacheFile(file.path)) {
      return null;
    }

    const requiresAdmin = (category === "system_cache" || category === "admin_required") && requiresAdminForCleanup(file.path);
    if (category === "system_cache" && requiresAdmin) return null;
    if (category === "admin_required" && !requiresAdmin) return null;
    const reviewOnly = category === "large_files" || category === "expired_files" || requiresAdmin;
    const safeCache = category === "wechat_cache" || category === "qq_cache" || category === "browser_cache" || category === "system_cache";

    const reason = requiresAdmin ? `需要管理员权限：${reasonFor(category, file, settings)}` : reasonFor(category, file, settings);

    return {
      id: randomUUID(),
      path: file.path,
      size: file.size,
      modifiedAt: file.modifiedAt.toISOString(),
      accessedAt: file.accessedAt?.toISOString(),
      category,
      risk: reviewOnly ? "review" : "safe",
      reason,
      requiresAdmin,
      recommendedAction: reviewOnly ? "review" : safeCache ? "delete" : "review"
    };
  }

  private async walk(root: string, scanId: string, options: { allowProtectedRoot: boolean; maxFiles: number }) {
    const task = this.tasks.get(scanId);
    if (!task) return [];

    const output: FileCandidate[] = [];
    const normalizedRoot = path.resolve(root);
    if (!options.allowProtectedRoot && isProtectedPath(normalizedRoot)) return output;

    try {
      const stat = await fs.stat(normalizedRoot);
      if (!stat.isDirectory()) return output;
    } catch {
      return output;
    }

    const stack = [normalizedRoot];
    while (stack.length && !task.cancelled && output.length < options.maxFiles) {
      const current = stack.pop()!;
      task.progress.currentPath = current;
      task.progress.message = "正在扫描文件";

      let entries: Dirent[];
      try {
        entries = await fs.readdir(current, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const entry of entries) {
        if (task.cancelled || output.length >= options.maxFiles) break;
        const fullPath = path.join(current, entry.name);
        task.progress.scannedFiles += 1;

        if (entry.isDirectory()) {
          if (!options.allowProtectedRoot && isProtectedPath(fullPath)) continue;
          if (entry.name.startsWith("$") || entry.name === "node_modules") continue;
          stack.push(fullPath);
          continue;
        }

        if (!entry.isFile()) continue;
        try {
          const stat = await fs.stat(fullPath);
          output.push({
            path: fullPath,
            size: stat.size,
            modifiedAt: stat.mtime,
            accessedAt: stat.atime
          });
          task.progress.foundFiles += 1;
          task.progress.foundBytes += stat.size;
        } catch {
          continue;
        }

        if (task.progress.scannedFiles % yieldEveryFiles === 0) {
          await yieldToEventLoop();
        }
      }
    }

    return output;
  }
}

function chooseDuplicateKeeper(files: FileCandidate[]) {
  return [...files].sort((a, b) => {
    const dateDelta = b.modifiedAt.getTime() - a.modifiedAt.getTime();
    if (dateDelta !== 0) return dateDelta;
    return a.path.length - b.path.length;
  })[0];
}

function reasonFor(category: ScanCategory, file: FileCandidate, settings: CleanerSettings) {
  const sizeMb = Math.max(0.1, file.size / 1024 / 1024).toFixed(1);
    switch (category) {
    case "admin_required":
      return "需要管理员权限的 Windows 日志、临时文件或框架缓存";
    case "system_cache":
      return "Windows 日志、临时文件或框架缓存";
    case "browser_cache":
      return "浏览器缓存、GPU 缓存或 Service Worker 缓存";
    case "wechat_cache":
      return `微信缓存或超过 ${settings.chatExpiredDays} 天的聊天附件`;
    case "qq_cache":
      return `QQ 缓存或超过 ${settings.chatExpiredDays} 天的聊天附件`;
    case "expired_files":
      return `超过 ${settings.expiredDays} 天未修改`;
    case "large_files":
      return `大文件，约 ${sizeMb} MB`;
    default:
      return "可清理文件";
  }
}

function categoryLabel(category: ScanCategory) {
  switch (category) {
    case "admin_required":
      return "管理员权限清理";
    case "system_cache":
      return "系统缓存";
    case "browser_cache":
      return "浏览器缓存";
    case "wechat_cache":
      return "微信缓存";
    case "qq_cache":
      return "QQ 缓存";
    case "duplicates":
      return "重复文件";
    case "expired_files":
      return "过期文件";
    case "large_files":
      return "大文件";
  }
}

function yieldToEventLoop() {
  return new Promise((resolve) => setImmediate(resolve));
}
