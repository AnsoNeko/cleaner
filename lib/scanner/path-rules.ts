import os from "node:os";
import path from "node:path";

const protectedRoots = [
  "C:\\Windows",
  "C:\\Program Files",
  "C:\\Program Files (x86)",
  "C:\\ProgramData"
].map(normalizePath);

const protectedExtensions = new Set([
  ".db",
  ".sqlite",
  ".sqlite3",
  ".dat",
  ".ini",
  ".config",
  ".json",
  ".key",
  ".ldb",
  ".log1",
  ".log2"
]);

const cacheExtensions = new Set([
  ".tmp",
  ".temp",
  ".cache",
  ".log",
  ".dmp",
  ".old",
  ".bak",
  ".chk",
  ".thumb",
  ".etl"
]);

const mediaExtensions = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
  ".bmp",
  ".mp4",
  ".mov",
  ".avi",
  ".mkv",
  ".zip",
  ".rar",
  ".7z",
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx"
]);

export function normalizePath(value: string) {
  return path.resolve(value).replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();
}

export function isProtectedPath(value: string) {
  const normalized = normalizePath(value);
  return protectedRoots.some((root) => normalized === root || normalized.startsWith(`${root}\\`));
}

export function isProtectedChatFile(value: string) {
  const ext = path.extname(value).toLowerCase();
  const normalized = normalizePath(value);
  return (
    protectedExtensions.has(ext) ||
    normalized.includes("\\msg\\") ||
    normalized.includes("\\db\\") ||
    normalized.includes("\\config\\") ||
    normalized.includes("\\account\\") ||
    normalized.includes("\\all users\\")
  );
}

export function looksLikeCacheFile(value: string) {
  const ext = path.extname(value).toLowerCase();
  const lower = value.toLowerCase();
  return (
    cacheExtensions.has(ext) ||
    lower.includes("cache") ||
    lower.includes("temp") ||
    lower.includes("thumb") ||
    lower.includes("log")
  );
}

export function isUserContentFile(value: string) {
  return mediaExtensions.has(path.extname(value).toLowerCase());
}

export function existingUserPaths(customPaths: string[] = []) {
  const home = os.homedir();
  return [
    path.join(home, "Downloads"),
    path.join(home, "Desktop"),
    path.join(home, "Documents"),
    path.join(home, "Pictures"),
    path.join(home, "Videos"),
    ...customPaths
  ];
}

export function systemCachePaths() {
  const env = process.env;
  return [
    env.TEMP,
    env.TMP,
    env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, "Temp") : undefined,
    "C:\\Windows\\Temp",
    env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, "Microsoft", "Windows", "INetCache") : undefined,
    env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, "Microsoft", "Windows", "Explorer") : undefined,
    env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, "D3DSCache") : undefined
  ].filter(Boolean) as string[];
}

export function chatCachePaths(kind: "wechat" | "qq") {
  const env = process.env;
  const documents = path.join(os.homedir(), "Documents");
  if (kind === "wechat") {
    return [
      path.join(documents, "WeChat Files"),
      env.APPDATA ? path.join(env.APPDATA, "Tencent", "WeChat") : undefined,
      env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, "Tencent", "WeChat") : undefined
    ].filter(Boolean) as string[];
  }

  return [
    path.join(documents, "Tencent Files"),
    env.APPDATA ? path.join(env.APPDATA, "Tencent") : undefined,
    env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, "Tencent") : undefined
  ].filter(Boolean) as string[];
}
