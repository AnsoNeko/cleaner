import { contextBridge, ipcRenderer } from "electron";
import type { CleanerApi, CleanupRequest, CleanerSettings, ScanTarget } from "../types/cleaner";

const api: CleanerApi = {
  startScan: (targets: ScanTarget[]) => ipcRenderer.invoke("cleaner:startScan", targets),
  cancelScan: (scanId: string) => ipcRenderer.invoke("cleaner:cancelScan", scanId),
  getScanProgress: (scanId: string) => ipcRenderer.invoke("cleaner:getScanProgress", scanId),
  getScanSummary: (scanId: string) => ipcRenderer.invoke("cleaner:getScanSummary", scanId),
  cleanup: (request: CleanupRequest) => ipcRenderer.invoke("cleaner:cleanup", request),
  getSettings: () => ipcRenderer.invoke("cleaner:getSettings"),
  updateSettings: (settings: Partial<CleanerSettings>) => ipcRenderer.invoke("cleaner:updateSettings", settings),
  openPathInExplorer: (targetPath: string) => ipcRenderer.invoke("cleaner:openPathInExplorer", targetPath),
  restoreFromQuarantine: (itemId: string) => ipcRenderer.invoke("cleaner:restoreFromQuarantine", itemId)
};

contextBridge.exposeInMainWorld("cleaner", api);
