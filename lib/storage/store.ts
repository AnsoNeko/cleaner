import fs from "node:fs/promises";
import path from "node:path";
import type { CleanerSettings, ScanSummary } from "../../types/cleaner";

export const defaultSettings: CleanerSettings = {
  expiredDays: 180,
  chatExpiredDays: 30,
  largeFileSizeMb: 100,
  cleanupMode: "trash",
  customScanPaths: [],
  allowPermanentDelete: false
};

interface PersistedData {
  settings: CleanerSettings;
  scans: ScanSummary[];
  cleanups: unknown[];
}

export class JsonStore {
  private filePath: string;

  constructor(userDataPath: string) {
    this.filePath = path.join(userDataPath, "cleaner-store.json");
  }

  async read(): Promise<PersistedData> {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<PersistedData>;
      return {
        settings: { ...defaultSettings, ...parsed.settings },
        scans: parsed.scans ?? [],
        cleanups: parsed.cleanups ?? []
      };
    } catch {
      return { settings: defaultSettings, scans: [], cleanups: [] };
    }
  }

  async getSettings() {
    return (await this.read()).settings;
  }

  async updateSettings(settings: Partial<CleanerSettings>) {
    const data = await this.read();
    data.settings = { ...data.settings, ...settings };
    await this.write(data);
    return data.settings;
  }

  async addScan(scan: ScanSummary) {
    const data = await this.read();
    data.scans = [scan, ...data.scans].slice(0, 20);
    await this.write(data);
  }

  private async write(data: PersistedData) {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(data, null, 2), "utf8");
  }
}
