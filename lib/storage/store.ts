import fs from "node:fs/promises";
import path from "node:path";
import type { CleanerSettings, ScanSummary } from "../../types/cleaner";
import { fileQueue, writeJsonAtomically, type SerialQueue } from "./atomic-file";

export const defaultSettings: CleanerSettings = {
  expiredDays: 180,
  chatExpiredDays: 30,
  largeFileSizeMb: 100,
  cleanupMode: "trash",
  customScanPaths: [],
  wechatScanPaths: [],
  allowPermanentDelete: false
};

interface PersistedData {
  settings: CleanerSettings;
  scans: ScanSummary[];
  cleanups: unknown[];
}

export class JsonStore {
  private filePath: string;
  private queue: SerialQueue;

  constructor(userDataPath: string) {
    this.filePath = path.join(userDataPath, "cleaner-store.json");
    this.queue = fileQueue(this.filePath);
  }

  async read(): Promise<PersistedData> {
    await this.queue.idle();
    return this.readCurrent();
  }

  private async readCurrent(): Promise<PersistedData> {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<PersistedData>;
      return {
        settings: { ...defaultSettings, ...parsed.settings },
        scans: parsed.scans ?? [],
        cleanups: parsed.cleanups ?? []
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      return { settings: { ...defaultSettings, customScanPaths: [], wechatScanPaths: [] }, scans: [], cleanups: [] };
    }
  }

  async getSettings() {
    return (await this.read()).settings;
  }

  async updateSettings(settings: Partial<CleanerSettings>) {
    return this.queue.run(async () => {
      const data = await this.readCurrent();
      data.settings = { ...data.settings, ...settings };
      await this.write(data);
      return data.settings;
    });
  }

  async addScan(scan: ScanSummary) {
    return this.queue.run(async () => {
      const data = await this.readCurrent();
      data.scans = [scan, ...data.scans].slice(0, 20);
      await this.write(data);
    });
  }

  private async write(data: PersistedData) {
    await writeJsonAtomically(this.filePath, data);
  }
}
