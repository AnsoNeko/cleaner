const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { JsonStore } = require("../dist-electron/lib/storage/store");
const { AnnouncementService } = require("../dist-electron/lib/announcement");
const { CleanupManager } = require("../dist-electron/lib/cleaner/cleanup");
const { stageFileTransfer, finishFileTransfer } = require("../dist-electron/lib/cleaner/file-transfer");
const transfer = require("../dist-electron/lib/cleaner/file-transfer");
const atomic = require("../dist-electron/lib/storage/atomic-file");
const windows = require("../dist-electron/lib/scanner/windows-discovery");
const { ScanManager } = require("../dist-electron/lib/scanner/scanner");
const { defaultSettings } = require("../dist-electron/lib/storage/store");

test("可靠性修复（仅使用专门构造目录）", async (t) => {
  const parent = path.resolve(__dirname, "../.test-fixtures");
  const base = path.join(parent, randomUUID());
  const other = await fs.mkdtemp(path.join(os.tmpdir(), "cleaner-cross-volume-test-"));
  await fs.mkdir(base, { recursive: true });
  const originalQuery = windows.readWindowsJson;
  windows.readWindowsJson = async () => ({ documents: base, saved: [] });
  async function create(name, content = name) {
    const file = path.join(base, name);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, content);
    return file;
  }
  async function finding(file) {
    const stat = await fs.stat(file);
    return { id: randomUUID(), path: file, size: stat.size, modifiedAt: stat.mtime.toISOString(), category: "large_files", risk: "review", reason: "test fixture", recommendedAction: "review" };
  }
  async function quarantine(manager, item) {
    return manager.cleanup({ scanId: "fixture", findingIds: [item.id], mode: "quarantine" }, [item], false);
  }
  try {
    await t.test("同一路径多个 Store 并发更新和扫描记录不会相互覆盖", async () => {
      const data = path.join(base, "store");
      const first = new JsonStore(data);
      const second = new JsonStore(data);
      const operations = [];
      for (let i = 0; i < 50; i++) {
        operations.push(first.updateSettings({ expiredDays: i + 1 }));
        operations.push(second.addScan({ scanId: `scan-${i}`, totalFiles: 0, totalBytes: 0, findings: [], startedAt: "2026-10-08T00:00:00Z" }));
      }
      operations.push(second.updateSettings({ wechatScanPaths: ["D:\\wechat-test"], chatExpiredDays: 40 }));
      await Promise.all(operations);
      const result = await first.read();
      assert.equal(result.settings.expiredDays, 50);
      assert.equal(result.settings.chatExpiredDays, 40);
      assert.deepEqual(result.settings.wechatScanPaths, ["D:\\wechat-test"]);
      assert.equal(result.scans.length, 20);
      assert.equal(result.scans[0].scanId, "scan-49");
      assert.equal(result.scans[19].scanId, "scan-30");
      assert.deepEqual(await fs.readdir(data), ["cleaner-store.json"]);
    });
    await t.test("原子替换失败保持旧文件，写入队列后续仍能继续", async () => {
      const data = path.join(base, "failed-write");
      const store = new JsonStore(data);
      await store.updateSettings({ expiredDays: 99 });
      const rename = fs.rename;
      fs.rename = async (from, to) => {
        if (to === path.join(data, "cleaner-store.json")) throw Object.assign(new Error("replacement denied"), { code: "EACCES" });
        return rename(from, to);
      };
      try { await assert.rejects(store.updateSettings({ expiredDays: 1 }), /replacement denied/); }
      finally { fs.rename = rename; }
      assert.equal((await store.getSettings()).expiredDays, 99);
      assert.deepEqual(await fs.readdir(data), ["cleaner-store.json"]);
      await store.updateSettings({ chatExpiredDays: 42 });
      assert.equal((await store.getSettings()).chatExpiredDays, 42);
    });
    await t.test("损坏的存储和隔离清单不会被静默重写", async () => {
      const data = path.join(base, "corrupt");
      await fs.mkdir(path.join(data, "quarantine"), { recursive: true });
      await fs.writeFile(path.join(data, "cleaner-store.json"), "invalid JSON");
      await fs.writeFile(path.join(data, "quarantine/manifest.json"), "invalid JSON");
      await assert.rejects(new JsonStore(data).updateSettings({ expiredDays: 10 }));
      const source = await create("corrupt-source.txt");
      await assert.rejects(quarantine(new CleanupManager(data), await finding(source)));
      await fs.access(source);
      assert.equal(await fs.readFile(path.join(data, "cleaner-store.json"), "utf8"), "invalid JSON");
    });
    await t.test("公告并发合并、缓存过期刷新、失败保留旧公告并稍后重试", async () => {
      let now = 0;
      let calls = 0;
      let failure = false;
      const service = new AnnouncementService("https://fixture/announcement", { now: () => now, ttlMs: 100, retryMs: 30, timeoutMs: 1000, fetch: async () => { calls++; if (failure) throw new Error("offline"); return new Response(`公告 ${calls}`); } });
      const first = await Promise.all(Array.from({ length: 20 }, () => service.get()));
      assert.equal(calls, 1);
      assert(first.every((item) => item.content === "公告 1"));
      now = 99;
      assert.equal((await service.get()).content, "公告 1");
      assert.equal(calls, 1);
      now = 100;
      assert.equal((await service.get()).content, "公告 2");
      now = 200;
      failure = true;
      const stale = await service.get();
      assert(stale.content.includes("公告 2") && stale.content.includes("缓存"));
      assert.equal(stale.fetchedAt, new Date(100).toISOString());
      await service.get();
      assert.equal(calls, 3);
      now = 230;
      failure = false;
      assert.equal((await service.get()).content, "公告 4");
    });
    await t.test("公告超时覆盖响应正文阶段，终止请求并允许重试", async () => {
      let signal;
      let calls = 0;
      let now = 0;
      const service = new AnnouncementService("https://fixture/slow", { now: () => now, timeoutMs: 20, retryMs: 5, fetch: async (_url, options) => { calls++; signal = options.signal; return { ok: true, text: () => new Promise(() => {}) }; } });
      assert((await service.get()).content.includes("超时"));
      assert.equal(signal.aborted, true);
      now = 5;
      assert((await service.get()).content.includes("超时"));
      assert.equal(calls, 2);
    });
    await t.test("跨盘隔离和恢复保持内容、修改时间，原文件只在校验后移除", async () => {
      if ((await fs.stat(base)).dev === (await fs.stat(other)).dev) return t.skip("测试目录不在不同卷，另有复制回退故障测试");
      const file = await create("cross-volume/中文附件.bin", Buffer.alloc(1024 * 1024, 71));
      const old = new Date("2025-01-02T03:04:05Z");
      await fs.utimes(file, old, old);
      const manager = new CleanupManager(other);
      const item = await finding(file);
      const result = await quarantine(manager, item);
      assert.equal(result.cleanedFiles, 1);
      assert.deepEqual(result.failed, []);
      await assert.rejects(fs.access(file), { code: "ENOENT" });
      const manifest = JSON.parse(await fs.readFile(path.join(other, "quarantine/manifest.json"), "utf8"));
      assert.equal(manifest[0].state, "quarantined");
      assert.equal((await fs.stat(manifest[0].quarantinePath)).mtime.toISOString(), old.toISOString());
      assert.equal(await manager.restoreFromQuarantine(manifest[0].id), true);
      assert.deepEqual(await fs.readFile(file), Buffer.alloc(1024 * 1024, 71));
      assert.equal((await fs.stat(file)).mtime.toISOString(), old.toISOString());
      assert.deepEqual(JSON.parse(await fs.readFile(path.join(other, "quarantine/manifest.json"), "utf8")), []);
    });
    await t.test("复制回退失败保留原文件并清除自己的不完整副本", async () => {
      const source = await create("failed-copy/source.bin", "original");
      const destination = path.join(base, "failed-copy/copy.bin");
      const link = fs.link;
      const copy = fs.copyFile;
      fs.link = async () => { throw Object.assign(new Error("cross volume"), { code: "EXDEV" }); };
      fs.copyFile = async (from, to, mode) => { await copy(from, to, mode); await fs.writeFile(to, "corrupted"); };
      try { await assert.rejects(stageFileTransfer(source, destination), /校验失败/); }
      finally { fs.link = link; fs.copyFile = copy; }
      assert.equal(await fs.readFile(source, "utf8"), "original");
      await assert.rejects(fs.access(destination), { code: "ENOENT" });
    });
    await t.test("移动和恢复都不覆盖已有目标文件", async () => {
      const source = await create("collision/source.bin", "original");
      const existing = await create("collision/destination.bin", "new user data");
      await assert.rejects(stageFileTransfer(source, existing), { code: "EEXIST" });
      assert.equal(await fs.readFile(existing, "utf8"), "new user data");
      const manager = new CleanupManager(path.join(base, "collision-data"));
      assert.equal((await quarantine(manager, await finding(source))).cleanedFiles, 1);
      const manifest = JSON.parse(await fs.readFile(path.join(base, "collision-data/quarantine/manifest.json"), "utf8"));
      await fs.writeFile(source, "replacement");
      await assert.rejects(manager.restoreFromQuarantine(manifest[0].id), /目标已存在/);
      assert.equal(await fs.readFile(source, "utf8"), "replacement");
      assert.equal(await fs.readFile(manifest[0].quarantinePath, "utf8"), "original");
    });
    await t.test("清单写入失败前不会移除原文件，已有准备记录可恢复", async () => {
      const data = path.join(base, "journal-data");
      const source = await create("journal/source.bin", "recoverable");
      const manager = new CleanupManager(data);
      const write = atomic.writeJsonAtomically;
      let calls = 0;
      atomic.writeJsonAtomically = async (...args) => { if (++calls === 2) throw new Error("journal disk full"); return write(...args); };
      try { await assert.rejects(quarantine(manager, await finding(source)), /journal disk full/); }
      finally { atomic.writeJsonAtomically = write; }
      assert.equal(await fs.readFile(source, "utf8"), "recoverable");
      const manifest = JSON.parse(await fs.readFile(path.join(data, "quarantine/manifest.json"), "utf8"));
      assert.equal(manifest[0].state, "pending");
      assert.equal(await fs.readFile(manifest[0].quarantinePath, "utf8"), "recoverable");
    });
    await t.test("恢复已完成但清单未更新时，重试可完成记录清理", async () => {
      const data = path.join(base, "restore-journal");
      const source = await create("restore/source.bin", "recoverable restore");
      const manager = new CleanupManager(data);
      await quarantine(manager, await finding(source));
      const manifest = JSON.parse(await fs.readFile(path.join(data, "quarantine/manifest.json"), "utf8"));
      const write = atomic.writeJsonAtomically;
      let calls = 0;
      atomic.writeJsonAtomically = async (...args) => { if (++calls === 2) throw new Error("final journal failed"); return write(...args); };
      try { await assert.rejects(manager.restoreFromQuarantine(manifest[0].id), /final journal failed/); }
      finally { atomic.writeJsonAtomically = write; }
      assert.equal(await fs.readFile(source, "utf8"), "recoverable restore");
      assert.equal(await manager.restoreFromQuarantine(manifest[0].id), true);
      assert.deepEqual(JSON.parse(await fs.readFile(path.join(data, "quarantine/manifest.json"), "utf8")), []);
    });
    await t.test("恢复校验时发现外部修改，不删除目标或隔离副本", async () => {
      const data = path.join(base, "changed-restore");
      const source = await create("changed-restore-source.bin", "snapshot");
      const manager = new CleanupManager(data);
      await quarantine(manager, await finding(source));
      const manifest = JSON.parse(await fs.readFile(path.join(data, "quarantine/manifest.json"), "utf8"));
      const stage = transfer.stageFileTransfer;
      transfer.stageFileTransfer = async (...args) => { const expected = await stage(...args); await fs.writeFile(args[1], "external modification"); return expected; };
      try { await assert.rejects(manager.restoreFromQuarantine(manifest[0].id), /均已保留/); }
      finally { transfer.stageFileTransfer = stage; }
      assert.equal(await fs.readFile(source, "utf8"), "external modification");
      await fs.access(manifest[0].quarantinePath);
    });
    await t.test("多个管理器并发隔离保留所有记录，变化源文件不能移除", async () => {
      const data = path.join(base, "parallel-quarantine");
      const first = new CleanupManager(data);
      const second = new CleanupManager(data);
      const files = await Promise.all(Array.from({ length: 10 }, (_, i) => create(`parallel/file-${i}.bin`)));
      const results = await Promise.all(files.map(async (file, i) => quarantine(i % 2 ? first : second, await finding(file))));
      assert(results.every((result) => result.cleanedFiles === 1));
      const manifest = JSON.parse(await fs.readFile(path.join(data, "quarantine/manifest.json"), "utf8"));
      assert.equal(manifest.length, files.length);
      const original = await create("changed/source.bin", "old");
      const destination = path.join(base, "changed/destination.bin");
      const expected = await stageFileTransfer(original, destination);
      await fs.writeFile(original, "new content");
      await assert.rejects(finishFileTransfer(original, expected), /已改变/);
      await fs.access(original);
    });
    await t.test("流式扫描超过 12000 文件仍完整，并可在遍历中取消", async () => {
      const directory = path.join(base, "mass-files");
      await fs.mkdir(directory);
      const count = 12051;
      for (let start = 0; start < count; start += 64) await Promise.all(Array.from({ length: Math.min(64, count - start) }, (_, offset) => fs.writeFile(path.join(directory, `${start + offset}.txt`), "fixture")));
      const scanner = new ScanManager();
      const id = scanner.startScan([{ category: "large_files", paths: [directory], largeFileSizeMb: 0 }], defaultSettings);
      const result = await scanner.whenComplete(id);
      assert.equal(result.totalFiles, count);
      assert.equal(result.totalBytes, count * 7);
      assert.deepEqual(result.warnings, []);
      const cancelId = scanner.startScan([{ category: "large_files", paths: [directory], largeFileSizeMb: 0 }], defaultSettings);
      while (scanner.getProgress(cancelId).status === "running" && scanner.getProgress(cancelId).scannedFiles < 300) await new Promise((resolve) => setImmediate(resolve));
      scanner.cancel(cancelId);
      const cancelled = await scanner.whenComplete(cancelId);
      assert.equal(scanner.getProgress(cancelId).status, "cancelled");
      assert(cancelled.totalFiles < count);
      assert(scanner.getProgress(cancelId).scannedFiles >= 300);
    });
    await t.test("单分类 130000 结果不会因数组展开触发调用栈溢出", async () => {
      const directory = path.join(base, "virtual-large-directory");
      await fs.mkdir(directory);
      const opendir = fs.opendir;
      const lstat = fs.lstat;
      const count = 130000;
      const stamp = new Date("2025-01-01T00:00:00Z");
      fs.opendir = async (value, options) => {
        if (value !== directory) return opendir(value, options);
        return { async *[Symbol.asyncIterator]() { for (let i = 0; i < count; i++) yield { name: `${i}.txt`, isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false }; } };
      };
      fs.lstat = async (value, options) => path.dirname(value) === directory ? { size: 1, mtime: stamp, atime: stamp, isFile: () => true, isSymbolicLink: () => false } : lstat(value, options);
      try {
        const scanner = new ScanManager();
        const id = scanner.startScan([{ category: "large_files", paths: [directory], largeFileSizeMb: 0 }], defaultSettings);
        const result = await scanner.whenComplete(id);
        assert.equal(result.totalFiles, count);
        assert.equal(result.totalBytes, count);
        assert.equal(scanner.getProgress(id).status, "completed");
      } finally { fs.opendir = opendir; fs.lstat = lstat; }
    });
  } finally {
    windows.readWindowsJson = originalQuery;
    assert(path.resolve(base).startsWith(parent + path.sep));
    assert(path.dirname(other) === path.resolve(os.tmpdir()) && path.basename(other).startsWith("cleaner-cross-volume-test-"));
    await fs.rm(base, { recursive: true, force: true });
    await fs.rm(other, { recursive: true, force: true });
  }
});
