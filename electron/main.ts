import path from "node:path";
import { app, BrowserWindow, ipcMain, shell } from "electron";
import { autoUpdater } from "electron-updater";
import type { Announcement, CleanupRequest, ScanTarget, UpdateStatus } from "../types/cleaner";
import { CleanupManager } from "../lib/cleaner/cleanup";
import { ScanManager } from "../lib/scanner/scanner";
import { JsonStore } from "../lib/storage/store";

let mainWindow: BrowserWindow | null = null;
let store: JsonStore;
let scanner: ScanManager;
let cleaner: CleanupManager;
let announcementCache: Announcement | null = null;
let updateStatus: UpdateStatus = {
  status: "idle",
  message: "尚未检查更新"
};
const announcementUrl = "https://github.com/AnsoNeko/cleaner/releases/latest/download/announcement.md";

function getIconPath() {
  if (app.isPackaged) {
    return path.join(app.getAppPath(), "256x256.ico");
  }

  return path.join(process.cwd(), "256x256.ico");
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1024,
    minHeight: 680,
    title: "轻净清理",
    icon: getIconPath(),
    backgroundColor: "#f6f8f7",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  const devUrl = process.env.ELECTRON_START_URL;
  if (devUrl) {
    void mainWindow.loadURL(devUrl);
  } else {
    void mainWindow.loadFile(path.join(app.getAppPath(), "out", "index.html"));
  }
}

function setUpdateStatus(status: UpdateStatus) {
  updateStatus = status;
  mainWindow?.webContents.send("cleaner:updateStatus", status);
}

function configureAutoUpdater() {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("checking-for-update", () => {
    setUpdateStatus({ status: "checking", message: "正在检查更新" });
  });

  autoUpdater.on("update-available", (info) => {
    setUpdateStatus({
      status: "available",
      message: `发现新版本 ${info.version}，正在下载`,
      version: info.version
    });
  });

  autoUpdater.on("update-not-available", (info) => {
    setUpdateStatus({
      status: "not_available",
      message: "当前已是最新版本",
      version: info.version
    });
  });

  autoUpdater.on("download-progress", (progress) => {
    setUpdateStatus({
      status: "downloading",
      message: `正在下载更新 ${Math.round(progress.percent)}%`,
      percent: progress.percent,
      downloadedBytes: progress.transferred,
      totalBytes: progress.total
    });
  });

  autoUpdater.on("update-downloaded", (info) => {
    setUpdateStatus({
      status: "downloaded",
      message: `新版本 ${info.version} 已下载，重启后安装`,
      version: info.version
    });
  });

  autoUpdater.on("error", (error) => {
    setUpdateStatus({
      status: "error",
      message: error instanceof Error ? error.message : "检查更新失败"
    });
  });
}

async function checkForUpdates() {
  if (!app.isPackaged) {
    setUpdateStatus({
      status: "not_available",
      message: "开发模式下不检查在线更新"
    });
    return updateStatus;
  }

  setUpdateStatus({ status: "checking", message: "正在检查更新" });
  try {
    await autoUpdater.checkForUpdates();
  } catch (error) {
    setUpdateStatus({
      status: "error",
      message: error instanceof Error ? error.message : "检查更新失败"
    });
  }

  return updateStatus;
}

async function getAnnouncement(): Promise<Announcement> {
  if (announcementCache) return announcementCache;

  try {
    const response = await fetch(announcementUrl);
    if (!response.ok) throw new Error(`公告读取失败：HTTP ${response.status}`);
    const content = (await response.text()).trim();
    announcementCache = {
      content: content || "暂无公告。",
      source: announcementUrl,
      fetchedAt: new Date().toISOString()
    };
    return announcementCache;
  } catch (error) {
    return {
      content: error instanceof Error ? error.message : "公告读取失败",
      source: announcementUrl,
      fetchedAt: new Date().toISOString()
    };
  }
}

function registerIpc() {
  ipcMain.handle("cleaner:startScan", async (_event, targets: ScanTarget[]) => {
    const settings = await store.getSettings();
    const scanId = scanner.startScan(targets, settings);
    void scanner.whenComplete(scanId)?.then((summary) => store.addScan(summary)).catch(() => undefined);
    return { scanId };
  });

  ipcMain.handle("cleaner:cancelScan", (_event, scanId: string) => scanner.cancel(scanId));
  ipcMain.handle("cleaner:getScanProgress", (_event, scanId: string) => scanner.getProgress(scanId));
  ipcMain.handle("cleaner:getScanSummary", (_event, scanId: string) => scanner.getSummary(scanId));

  ipcMain.handle("cleaner:cleanup", async (_event, request: CleanupRequest) => {
    const summary = scanner.getSummary(request.scanId);
    if (!summary) throw new Error("未找到扫描结果，请重新扫描");
    const settings = await store.getSettings();
    return cleaner.cleanup(request, summary.findings, settings.allowPermanentDelete);
  });

  ipcMain.handle("cleaner:getSettings", () => store.getSettings());
  ipcMain.handle("cleaner:updateSettings", (_event, settings) => store.updateSettings(settings));

  ipcMain.handle("cleaner:openPathInExplorer", async (_event, targetPath: string) => {
    shell.showItemInFolder(targetPath);
    return true;
  });

  ipcMain.handle("cleaner:restoreFromQuarantine", (_event, itemId: string) => cleaner.restoreFromQuarantine(itemId));
  ipcMain.handle("cleaner:checkForUpdates", () => checkForUpdates());
  ipcMain.handle("cleaner:getAnnouncement", () => getAnnouncement());
  ipcMain.handle("cleaner:installUpdate", () => {
    if (updateStatus.status !== "downloaded") return false;
    autoUpdater.quitAndInstall(false, true);
    return true;
  });
}

void app.whenReady().then(() => {
  store = new JsonStore(app.getPath("userData"));
  scanner = new ScanManager();
  cleaner = new CleanupManager(app.getPath("userData"));
  configureAutoUpdater();
  registerIpc();
  createWindow();
  mainWindow?.webContents.once("did-finish-load", () => {
    mainWindow?.webContents.send("cleaner:updateStatus", updateStatus);
  });
  if (app.isPackaged) {
    setTimeout(() => {
      void checkForUpdates();
    }, 3000);
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
