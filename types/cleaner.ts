export type ScanCategory =
  | "system_cache"
  | "admin_required"
  | "browser_cache"
  | "wechat_cache"
  | "qq_cache"
  | "duplicates"
  | "expired_files"
  | "large_files";

export type RiskLevel = "safe" | "review" | "danger";

export interface ScanTarget {
  category: ScanCategory;
  paths?: string[];
  maxAgeDays?: number;
  largeFileSizeMb?: number;
}

export interface FileFinding {
  id: string;
  path: string;
  size: number;
  modifiedAt: string;
  accessedAt?: string;
  category: ScanCategory;
  risk: RiskLevel;
  reason: string;
  duplicateGroupId?: string;
  requiresAdmin?: boolean;
  recommendedAction: "delete" | "keep" | "review";
}

export interface ScanSummary {
  scanId: string;
  totalFiles: number;
  totalBytes: number;
  findings: FileFinding[];
  startedAt: string;
  finishedAt?: string;
}

export interface ScanStartResult {
  scanId: string;
}

export interface ScanProgress {
  scanId: string;
  status: "idle" | "running" | "completed" | "cancelled" | "failed";
  currentPath: string;
  scannedFiles: number;
  foundFiles: number;
  foundBytes: number;
  message?: string;
}

export interface CleanupRequest {
  scanId: string;
  findingIds: string[];
  mode: "trash" | "quarantine" | "delete";
}

export interface CleanupResult {
  cleanedFiles: number;
  cleanedBytes: number;
  failed: Array<{
    path: string;
    reason: string;
  }>;
}

export type UpdateStatusType =
  | "idle"
  | "checking"
  | "available"
  | "not_available"
  | "downloading"
  | "downloaded"
  | "error";

export interface UpdateStatus {
  status: UpdateStatusType;
  message: string;
  version?: string;
  percent?: number;
  downloadedBytes?: number;
  totalBytes?: number;
}

export interface Announcement {
  content: string;
  source: string;
  fetchedAt: string;
}

export interface CleanerSettings {
  expiredDays: number;
  chatExpiredDays: number;
  largeFileSizeMb: number;
  cleanupMode: CleanupRequest["mode"];
  customScanPaths: string[];
  allowPermanentDelete: boolean;
}

export interface CleanerApi {
  startScan(targets: ScanTarget[]): Promise<ScanStartResult>;
  cancelScan(scanId: string): Promise<boolean>;
  getScanProgress(scanId: string): Promise<ScanProgress | null>;
  getScanSummary(scanId: string): Promise<ScanSummary | null>;
  cleanup(request: CleanupRequest): Promise<CleanupResult>;
  getSettings(): Promise<CleanerSettings>;
  updateSettings(settings: Partial<CleanerSettings>): Promise<CleanerSettings>;
  openPathInExplorer(path: string): Promise<boolean>;
  restoreFromQuarantine(itemId: string): Promise<boolean>;
  checkForUpdates(): Promise<UpdateStatus>;
  installUpdate(): Promise<boolean>;
  onUpdateStatus(callback: (status: UpdateStatus) => void): () => void;
  getAnnouncement(): Promise<Announcement>;
}
