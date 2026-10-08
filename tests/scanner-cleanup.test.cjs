const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

test("扫描和清理安全回归（仅使用构造目录）", async (t) => {
  const fixtureParent = path.resolve(__dirname, "../.test-fixtures");
  const base = path.join(fixtureParent, randomUUID());
  const previousEnv = { ...process.env };
  for (const [key, dir] of Object.entries({ APPDATA: "Roaming", LOCALAPPDATA: "Local", SystemRoot: "Windows", PROGRAMDATA: "ProgramData", ProgramFiles: "Program Files", "ProgramFiles(x86)": "Program Files (x86)", TEMP: "Temp", TMP: "Temp" })) process.env[key] = path.join(base, dir);
  const compiled = "../dist-electron/lib/";
  const windows = require(compiled + "scanner/windows-discovery.js");
  const originalQuery = windows.readWindowsJson;
  let inventory = { installed: [], processes: [] };
  const documents = path.join(base, "redirected-documents");
  let saved = [];
  windows.readWindowsJson = async (script) => script.includes("Get-AppxPackage") ? inventory : { documents, saved };
  const wx = require(compiled + "scanner/wechat.js");
  const software = require(compiled + "scanner/software.js");
  const rules = require(compiled + "scanner/path-rules.js");
  const { ScanManager } = require(compiled + "scanner/scanner.js");
  const { CleanupManager } = require(compiled + "cleaner/cleanup.js");
  const { defaultSettings } = require(compiled + "storage/store.js");
  const { isDefaultSelectedFinding } = require(compiled + "selection.js");
  const old = new Date(Date.now() - 200 * 86400000);
  async function create(relative, contents = relative, aged = true) {
    const file = path.join(base, relative);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, contents);
    if (aged) await fs.utimes(file, old, old);
    return file;
  }
  async function scan(targets, settings = {}) {
    const manager = new ScanManager();
    const id = manager.startScan(targets, { ...defaultSettings, ...settings });
    return { manager, summary: await manager.whenComplete(id) };
  }
  async function finding(file, category, extras = {}) {
    const stat = await fs.stat(file);
    return { id: randomUUID(), path: file, size: stat.size, modifiedAt: stat.mtime.toISOString(), category, risk: "review", reason: "test", recommendedAction: "review", ...extras };
  }
  const cleaner = new CleanupManager(path.join(base, "cleaner-data"));
  async function clean(items, mode = "quarantine", permanent = false) {
    return cleaner.cleanup({ scanId: "test", findingIds: items.map((item) => item.id), mode }, items, permanent);
  }
  try {
    await t.test("识别新版与旧版媒体，但保护数据库、配置、备份和未知 dat", () => {
      assert.equal(wx.classifyWechatFile("D:/xwechat_files/wxid_a/msg/attach/hash/2025-01/Img/image.dat"), "attachment");
      assert.equal(wx.classifyWechatFile("D:/WeChat Files/wxid_a/FileStorage/MsgAttach/hash/Image/photo.dat"), "attachment");
      assert.equal(wx.classifyWechatFile("D:/WeChat Files/wxid_a/FileStorage/Temp/work.tmp"), "cache");
      for (const value of ["D:/xwechat_files/wxid_a/db_storage/message/message_0.db", "D:/xwechat_files/wxid_a/msg/config/account.json", "D:/WeChat Files/wxid_a/BackupFiles/FileStorage/Image/image.dat", "D:/xwechat_files/wxid_a/unknown.dat", "D:/xwechat_files/wxid_a/msg/attach/message.db-wal", "D:/Tencent/xwechat/radium/crashpad/crashpad_handler.exe"]) assert.equal(wx.classifyWechatFile(value), null, value);
    });
    await t.test("读取 UTF8/UTF16 自定义路径并拒绝多行内容", () => {
      assert.equal(wx.parseWechatSavePath(Buffer.from("D:\\微信数据")), "D:\\微信数据");
      assert.equal(wx.parseWechatSavePath(Buffer.from("D:\\微信数据\0")), "D:\\微信数据");
      assert.equal(wx.parseWechatSavePath(Buffer.concat([Buffer.from([255, 254]), Buffer.from("D:\\微信数据", "utf16le")])), "D:\\微信数据");
      assert.equal(wx.parseWechatSavePath(Buffer.from("D:\\one\nD:\\two")), null);
      assert.equal(wx.parseWechatSavePath(Buffer.from("MyDocument:")), null);
    });
    const cache = await create("redirected-documents/xwechat_files/wxid_test/cache/cache.tmp");
    const media = await create("redirected-documents/xwechat_files/wxid_test/msg/attach/hash/2025-01/Img/picture.dat");
    const video = await create("custom/WeChat Files/wxid_test/FileStorage/Video/2025-01/video.mp4");
    const newVideo = await create("new-custom/xwechat_files/wxid_test/msg/video/video.mp4");
    const privateDb = await create("redirected-documents/xwechat_files/wxid_test/db_storage/message/cache.db");
    const privateConfig = await create("redirected-documents/xwechat_files/wxid_test/config/settings.json");
    await create("redirected-documents/xwechat_files/wxid_test/BackupFiles/FileStorage/Image/saved.dat");
    await create("redirected-documents/xwechat_files/wxid_test/cache/recent.tmp", "recent", false);
    let wxSummary;
    await t.test("发现重定向文档、旧配置、自定义路径，并对重叠根去重", async () => {
      await create("Roaming/Tencent/WeChat/All Users/config/3ebffe94.ini", path.join(base, "custom"));
      await create("Roaming/Tencent/xwechat/config/51a1fffea11325a1e4104c6b3de47af7.ini", path.join(base, "new-custom"));
      saved = [path.join(base, "custom")];
      const roots = await wx.discoverWechatRoots([path.join(base, "custom"), path.join(base, "custom/WeChat Files")]);
      assert.equal(roots.filter((root) => rules.normalizePath(root) === rules.normalizePath(path.join(base, "custom/WeChat Files"))).length, 1);
      assert(roots.includes(path.join(documents, "xwechat_files")));
      assert(roots.includes(path.join(base, "custom/WeChat Files")));
      assert(roots.includes(path.join(base, "new-custom/xwechat_files")));
    });
    await t.test("扫描能找到微信 dat/视频；附件默认不选、近期文件与数据库不出现", async () => {
      const { summary } = await scan([{ category: "wechat_cache" }, { category: "wechat_attachments" }, { category: "large_files", paths: [documents, path.join(base, "custom")], largeFileSizeMb: 0 }]);
      wxSummary = summary;
      for (const file of [cache, media, video, newVideo]) assert.equal(summary.findings.filter((item) => item.path === file).length, 1);
      const attachment = summary.findings.find((item) => item.path === media);
      assert.equal(attachment.category, "wechat_attachments");
      assert.equal(isDefaultSelectedFinding(attachment), false);
      assert.equal(isDefaultSelectedFinding(summary.findings.find((item) => item.path === cache)), true);
      assert(!summary.findings.some((item) => item.path === privateDb || item.path === privateConfig || item.path.endsWith("recent.tmp") || item.path.endsWith("saved.dat")));
    });
    await t.test("人工复核的大文件、过期文件和管理员文件默认不勾选", async () => {
      for (const category of ["large_files", "expired_files", "admin_required", "software_residuals", "software_cache", "wechat_attachments"]) assert.equal(isDefaultSelectedFinding({ category, risk: "review", recommendedAction: "review" }), false);
    });
    const slackCache = await create("Roaming/Slack/Cache/item.bin");
    const account = await create("Roaming/Slack/Cache/account.json");
    let residualFinding;
    await t.test("疑似残留仅匹配已支持缓存，不包含账号配置", async () => {
      inventory = { installed: [], processes: [] };
      const { summary } = await scan([{ category: "software_cache" }, { category: "software_residuals" }]);
      residualFinding = summary.findings.find((item) => item.path === slackCache);
      assert.equal(residualFinding.category, "software_residuals");
      assert.equal(isDefaultSelectedFinding(residualFinding), false);
      assert(!summary.findings.some((item) => item.path === account));
    });
    await t.test("安装记录、进程或程序文件任一存在时不认作卸载残留；读取失败关闭检测", async () => {
      for (const evidence of [{ installed: [{ name: "Slack", location: "" }], processes: [] }, { installed: [], processes: ["slack"] }]) assert(!(await software.suspectedResidualRoots(evidence)).some((root) => root.softwareId === "slack"));
      await create("Local/slack/Update.exe");
      assert(!(await software.suspectedResidualRoots({ installed: [], processes: [] })).some((root) => root.softwareId === "slack"));
      assert.deepEqual(await software.suspectedResidualRoots(null), []);
      inventory = null;
      const { summary } = await scan([{ category: "software_residuals" }]);
      assert.equal(summary.findings.length, 0);
      assert(summary.warnings.some((warning) => warning.includes("跳过疑似卸载残留")));
    });
    await t.test("清理前重新核对残留状态，拒绝重新安装/运行或信息读取失败", async () => {
      for (const changed of [{ installed: [{ name: "Slack", location: "" }], processes: [] }, { installed: [], processes: ["slack"] }, null]) {
        inventory = changed;
        const result = await clean([residualFinding]);
        assert.equal(result.cleanedFiles, 0);
        assert.equal(result.failed.length, 1);
        await fs.access(slackCache);
      }
    });
    await t.test("软件缓存退出后可隔离，保留账号文件", async () => {
      inventory = { installed: [{ name: "Slack", location: "" }], processes: [] };
      const item = await finding(slackCache, "software_cache", { softwareId: "slack" });
      inventory.processes = ["slack"];
      assert.equal((await clean([item])).cleanedFiles, 0);
      inventory.processes = [];
      assert.equal((await clean([item])).cleanedFiles, 1);
      await fs.access(account);
    });
    await t.test("管理员缓存仅允许明确缓存目录，拒绝 Windows 其他目录", async () => {
      const allowed = await create("Windows/Temp/old.tmp");
      const denied = await create("Windows/System32/old.tmp");
      const result = await clean([await finding(allowed, "admin_required"), await finding(denied, "system_cache")]);
      assert.equal(result.cleanedFiles, 1);
      assert.equal(result.failed.length, 1);
      await fs.access(denied);
    });
    await t.test("清理保护微信数据库/配置，拒绝跨分类绕过；已选择的旧附件可隔离", async () => {
      const result = await clean([await finding(privateDb, "wechat_attachments"), await finding(privateConfig, "wechat_cache"), await finding(media, "large_files")]);
      assert.equal(result.cleanedFiles, 0);
      assert.equal(result.failed.length, 3);
      const selected = wxSummary.findings.find((item) => item.path === media);
      assert.equal((await clean([selected])).cleanedFiles, 1);
      await fs.access(privateDb);
      await fs.access(privateConfig);
    });
    await t.test("扫描后被修改的文件、目录链接及未启用永久删除都不能清理", async () => {
      const changed = await create("ordinary/changed.txt");
      const item = await finding(changed, "large_files");
      await fs.writeFile(changed, "new content");
      assert.equal((await clean([item])).cleanedFiles, 0);
      const target = await create("ordinary/target.txt");
      const linked = path.join(base, "junction");
      await fs.symlink(path.dirname(target), linked, "junction");
      assert.equal((await clean([await finding(path.join(linked, "target.txt"), "large_files")])).cleanedFiles, 0);
      assert.equal((await clean([await finding(target, "large_files")], "delete")).cleanedFiles, 0);
      await fs.access(target);
    });
    await t.test("重复根不形成虚假重复项，链接目录不遍历，取消扫描可结束", async () => {
      const single = await create("single/only.txt", "unique");
      const { summary } = await scan([{ category: "duplicates", paths: [path.dirname(single), path.dirname(single)] }]);
      assert.equal(summary.findings.length, 0);
      const linked = await scan([{ category: "large_files", paths: [path.join(base, "junction")], largeFileSizeMb: 0 }]);
      assert.equal(linked.summary.findings.length, 0);
      const manager = new ScanManager();
      const id = manager.startScan([{ category: "wechat_cache" }], defaultSettings);
      manager.cancel(id);
      await manager.whenComplete(id);
      assert.equal(manager.getProgress(id).status, "cancelled");
    });
  } finally {
    windows.readWindowsJson = originalQuery;
    for (const key of Object.keys(process.env)) if (!(key in previousEnv)) delete process.env[key];
    Object.assign(process.env, previousEnv);
    // Delete only the dedicated, randomly named fixture within this repository.
    assert(path.resolve(base).startsWith(fixtureParent + path.sep));
    await fs.rm(base, { recursive: true, force: true });
  }
});
