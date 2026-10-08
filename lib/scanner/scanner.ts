import fs from "node:fs/promises";
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
  isAllowedSystemCacheFile,
  normalizePath,
  isUserContentFile,
  looksLikeBrowserCacheFile,
  requiresAdminForCleanup,
  systemCachePaths
} from "./path-rules";
import { classifyWechatFile, discoverWechatRoots, isPrivateWechatDirectory, looksLikeChatStorage } from "./wechat";
import { isProtectedSoftwareFile, matchSoftwareRoot, readSoftwareInventory, softwareCacheRoots, suspectedResidualRoots, type SoftwareRoot } from "./software";

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
  warnings: string[];
  wechatRoots: string[];
  residualRoots: SoftwareRoot[];
  softwareRoots: SoftwareRoot[];
  wechatCandidates?: FileCandidate[];
}

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
      warnings: [],
      wechatRoots: [],
      residualRoots: [],
      softwareRoots: softwareCacheRoots(),
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
      task.wechatRoots = await discoverWechatRoots(settings.wechatScanPaths ?? []);
      if (targets.some((target) => target.category.startsWith("wechat")) && !task.wechatRoots.length) {
        task.warnings.push("未找到微信存储目录，请在设置中填写微信文件管理显示的路径后重新扫描。");
      }
      if (targets.some((target) => target.category === "software_residuals")) {
        const inventory = await readSoftwareInventory();
        task.residualRoots = await suspectedResidualRoots(inventory);
        if (!inventory) task.warnings.push("无法完整读取软件安装与运行记录，已跳过疑似卸载残留检测。");
      }
      for (const target of targets) {
        if (task.cancelled) break;
        task.progress.message = `正在扫描 ${categoryLabel(target.category)}`;
        const partial = await this.scanTarget(scanId, target, settings);
        for (const item of partial) findings.push(item);
        task.progress.foundFiles = findings.length;
        task.progress.foundBytes = findings.reduce((sum, item) => sum + item.size, 0);
      }

      // Overlapping roots/categories must never count or delete a file twice.
      const unique = new Map<string, FileFinding>();
      for (const item of findings) {
        const key = normalizePath(item.path);
        const previous = unique.get(key);
        if (!previous || (item.risk === "review" && previous.risk === "safe") || item.category === "software_residuals") unique.set(key, item);
      }
      const uniqueFindings = [...unique.values()];
      task.wechatCandidates = undefined;

      const summary: ScanSummary = {
        scanId,
        totalFiles: uniqueFindings.length,
        totalBytes: uniqueFindings.reduce((sum, item) => sum + item.size, 0),
        findings: uniqueFindings,
        warnings: task.warnings,
        wechatRoots: task.wechatRoots,
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

    const task = this.tasks.get(scanId)!;
    const roots = this.rootsForTarget(target, settings, task);
    const reuseWechat = target.category.startsWith("wechat") && !target.paths?.length;
    const cached = reuseWechat ? task.wechatCandidates : undefined;
    if (reuseWechat && !cached) task.wechatCandidates = [];
    const findings: FileFinding[] = [];
    const consume = (file: FileCandidate) => {
      const item = this.toFinding(file, target.category, target, settings, task);
      if (item) {
        findings.push(item);
        task.progress.foundFiles += 1;
        task.progress.foundBytes += item.size;
      }
    };
    if (cached) {
      for (const [index, file] of cached.entries()) {
        if (task.cancelled) break;
        consume(file);
        if (index % yieldEveryFiles === 0) await yieldToEventLoop();
      }
    } else for (const root of roots) {
      for await (const file of this.walk(root, scanId, {
          allowProtectedRoot: target.category === "system_cache" || target.category === "admin_required",
          category: target.category
      })) {
        if (reuseWechat) task.wechatCandidates!.push(file);
        consume(file);
      }
    }
    return findings;
  }

  private rootsForTarget(target: ScanTarget, settings: CleanerSettings, task: ScanTask) {
    if (target.paths?.length) return target.paths;
    if (target.category === "system_cache" || target.category === "admin_required") return systemCachePaths().filter((root) => requiresAdminForCleanup(root) === (target.category === "admin_required"));
    if (target.category === "browser_cache") return browserCachePaths();
    if (target.category === "wechat_cache" || target.category === "wechat_attachments") return task.wechatRoots;
    if (target.category === "qq_cache") return chatCachePaths("qq");
    if (target.category === "software_cache") return task.softwareRoots.filter((root) => !matchSoftwareRoot(root.path, task.residualRoots)).map((root) => root.path);
    if (target.category === "software_residuals") return task.residualRoots.map((root) => root.path);
    return existingUserPaths(settings.customScanPaths);
  }

  private async scanDuplicates(scanId: string, roots: string[]) {
    const files: FileCandidate[] = [];
    const task = this.tasks.get(scanId);

    for (const root of roots) {
      for await (const file of this.walk(root, scanId, { allowProtectedRoot: false, category: "duplicates" })) files.push(file);
    }

    const bySize = new Map<number, FileCandidate[]>();
    for (const file of [...new Map(files.map((item) => [normalizePath(item.path), item])).values()].filter((item) => item.size > 0)) {
      const group = bySize.get(file.size);
      if (group) group.push(file);
      else bySize.set(file.size, [file]);
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
        const group = groups.get(digest);
        if (group) group.push(file);
        else groups.set(digest, [file]);
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
    settings: CleanerSettings,
    task: ScanTask
  ): FileFinding | null {
    const ageMs = Date.now() - file.modifiedAt.getTime();
    const ageDays = ageMs / 1000 / 60 / 60 / 24;
    const largeBytes = (target.largeFileSizeMb ?? settings.largeFileSizeMb) * 1024 * 1024;

    if (category === "large_files" && file.size < largeBytes) return null;
    if (category === "expired_files" && ageDays < (target.maxAgeDays ?? settings.expiredDays)) return null;
    if (category === "expired_files" && !isUserContentFile(file.path)) return null;

    const wechat = category === "wechat_cache" || category === "wechat_attachments";
    if (wechat && classifyWechatFile(file.path) !== (category === "wechat_cache" ? "cache" : "attachment")) return null;
    if (category === "qq_cache" && isProtectedChatFile(file.path)) {
      return null;
    }

    if ((wechat || category === "qq_cache") && ageDays < (target.maxAgeDays ?? settings.chatExpiredDays)) {
      return null;
    }

    if ((category === "system_cache" || category === "admin_required") && !isAllowedSystemCacheFile(file.path)) {
      return null;
    }

    if (category === "browser_cache" && !looksLikeBrowserCacheFile(file.path)) {
      return null;
    }

    const requiresAdmin = (category === "system_cache" || category === "admin_required") && requiresAdminForCleanup(file.path);
    if (category === "system_cache" && requiresAdmin) return null;
    if (category === "admin_required" && !requiresAdmin) return null;
    const software = category === "software_cache" || category === "software_residuals";
    const softwareRoot = software ? matchSoftwareRoot(file.path, category === "software_residuals" ? task.residualRoots : task.softwareRoots) : undefined;
    if (software && (!softwareRoot || isProtectedSoftwareFile(file.path))) return null;
    const reviewOnly = category === "large_files" || category === "expired_files" || category === "wechat_attachments" || category === "qq_cache" || software || requiresAdmin;
    const safeCache = category === "wechat_cache" || category === "qq_cache" || category === "browser_cache" || category === "system_cache";

    const detail = softwareRoot
      ? `${softwareRoot.label}：${category === "software_residuals" ? "未发现安装记录、运行进程及常见程序文件，疑似卸载残留；仅列出缓存/日志，请确认仍需使用的软件" : "缓存/日志，清理后可能需要重新下载或重建，请先退出软件"}`
      : reasonFor(category, file, settings, target);
    const reason = requiresAdmin ? `需要管理员权限：${detail}` : detail;

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
      softwareId: softwareRoot?.softwareId,
      recommendedAction: reviewOnly ? "review" : safeCache ? "delete" : "review"
    };
  }

  private async *walk(root: string, scanId: string, options: { allowProtectedRoot: boolean; category: ScanCategory }): AsyncGenerator<FileCandidate> {
    const task = this.tasks.get(scanId);
    if (!task) return;

    const normalizedRoot = path.resolve(root);
    if (!options.allowProtectedRoot && isProtectedPath(normalizedRoot)) return;
    const generic = ["duplicates", "expired_files", "large_files"].includes(options.category);
    const normalizedChatRoots = task.wechatRoots.map(normalizePath);
    const skipGeneric = (value: string) => {
      if (!generic) return false;
      const normalized = normalizePath(value);
      return looksLikeChatStorage(value) || normalizedChatRoots.some((chatRoot) => normalized === chatRoot || normalized.startsWith(`${chatRoot}\\`)) || Boolean(matchSoftwareRoot(value, task.softwareRoots));
    };
    if (skipGeneric(normalizedRoot)) return;

    try {
      const stat = await fs.lstat(normalizedRoot);
      if (!stat.isDirectory() || stat.isSymbolicLink() || normalizePath(await fs.realpath(normalizedRoot)) !== normalizePath(normalizedRoot)) return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") task.warnings.push(`目录无法读取：${normalizedRoot}`);
      return;
    }

    const stack = [normalizedRoot];
    while (stack.length && !task.cancelled) {
      const current = stack.pop()!;
      task.progress.currentPath = current;
      task.progress.message = "正在扫描文件";

      let directory;
      try {
        const stat = await fs.lstat(current);
        if (!stat.isDirectory() || stat.isSymbolicLink() || normalizePath(await fs.realpath(current)) !== normalizePath(current)) continue;
        directory = await fs.opendir(current, { bufferSize: 128 });
      } catch {
        task.warnings.push(`目录读取失败，已跳过：${current}`);
        continue;
      }

      try {
        for await (const entry of directory) {
        if (task.cancelled) break;
        const fullPath = path.join(current, entry.name);
        task.progress.scannedFiles += 1;
        if (task.progress.scannedFiles % yieldEveryFiles === 0) await yieldToEventLoop();
        if (entry.isSymbolicLink() || skipGeneric(fullPath)) continue;

        if (entry.isDirectory()) {
          if (!options.allowProtectedRoot && isProtectedPath(fullPath)) continue;
          if (entry.name.startsWith("$") || entry.name === "node_modules") continue;
          if (options.category.startsWith("wechat") && isPrivateWechatDirectory(fullPath)) continue;
          stack.push(fullPath);
          continue;
        }

        if (!entry.isFile()) continue;
        if (options.category.startsWith("wechat") && !classifyWechatFile(fullPath)) continue;
        try {
          const stat = await fs.lstat(fullPath);
          if (!stat.isFile() || stat.isSymbolicLink()) continue;
          yield {
            path: fullPath,
            size: stat.size,
            modifiedAt: stat.mtime,
            accessedAt: stat.atime
          };
        } catch {
          continue;
        }

      }
      } catch { task.warnings.push(`目录读取失败，结果可能不完整：${current}`); }
    }
  }
}

function chooseDuplicateKeeper(files: FileCandidate[]) {
  return [...files].sort((a, b) => {
    const dateDelta = b.modifiedAt.getTime() - a.modifiedAt.getTime();
    if (dateDelta !== 0) return dateDelta;
    return a.path.length - b.path.length;
  })[0];
}

function reasonFor(category: ScanCategory, file: FileCandidate, settings: CleanerSettings, target: ScanTarget) {
  const sizeMb = Math.max(0.1, file.size / 1024 / 1024).toFixed(1);
    switch (category) {
    case "admin_required":
      return "需要管理员权限的 Windows 日志、临时文件或框架缓存";
    case "system_cache":
      return "Windows 日志、临时文件或框架缓存";
    case "browser_cache":
      return "浏览器缓存、GPU 缓存或 Service Worker 缓存";
    case "wechat_cache":
      return `超过 ${target.maxAgeDays ?? settings.chatExpiredDays} 天的微信缓存/临时文件，请先退出微信`;
    case "wechat_attachments":
      return `超过 ${target.maxAgeDays ?? settings.chatExpiredDays} 天的微信图片、视频或附件；清理后聊天中的原文件可能无法打开，默认不选中`;
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
    case "wechat_attachments":
      return "微信旧附件";
    case "software_cache":
      return "软件缓存";
    case "software_residuals":
      return "疑似卸载残留";
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
