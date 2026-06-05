import path from "node:path";
import { app, BrowserWindow, ipcMain, shell } from "electron";
import type { CleanupRequest, ScanTarget } from "../types/cleaner";
import { CleanupManager } from "../lib/cleaner/cleanup";
import { ScanManager } from "../lib/scanner/scanner";
import { JsonStore } from "../lib/storage/store";

let mainWindow: BrowserWindow | null = null;
let store: JsonStore;
let scanner: ScanManager;
let cleaner: CleanupManager;

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
}

void app.whenReady().then(() => {
  store = new JsonStore(app.getPath("userData"));
  scanner = new ScanManager();
  cleaner = new CleanupManager(app.getPath("userData"));
  registerIpc();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
