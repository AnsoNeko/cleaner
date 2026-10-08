import os from "node:os";
import path from "node:path";

const protectedRoots = [
  process.env.SystemRoot ?? "C:\\Windows",
  process.env.ProgramFiles ?? "C:\\Program Files",
  process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)",
  process.env.PROGRAMDATA ?? "C:\\ProgramData"
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
  ".etl",
  ".cab",
  ".wer"
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

export function requiresAdminForCleanup(value: string) {
  const normalized = normalizePath(value);
  return [process.env.SystemRoot ?? "C:\\Windows", process.env.PROGRAMDATA ?? "C:\\ProgramData"]
    .some((root) => normalized.startsWith(`${normalizePath(root)}\\`));
}

export function isWithinPath(value: string, root: string) {
  const candidate = normalizePath(value);
  const base = normalizePath(root);
  return candidate === base || candidate.startsWith(`${base}\\`);
}

export function isAllowedSystemCacheFile(value: string) {
  return systemCachePaths().some((root) => isWithinPath(value, root)) && looksLikeCacheFile(value);
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
  const segments = normalizePath(value).split("\\").slice(0, -1);
  return (
    cacheExtensions.has(ext) ||
    segments.some((segment) => ["cache", "temp", "tmp", "logs", "log", "thumbnails", "temporary asp.net files", "inetcache", "d3dscache", "v3-cache", "plugins-cache"].includes(segment))
  );
}

export function looksLikeBrowserCacheFile(value: string) {
  const normalized = normalizePath(value);
  const lower = value.toLowerCase();
  return (
    normalized.includes("\\cache\\") ||
    normalized.includes("\\cache2\\") ||
    normalized.includes("\\code cache\\") ||
    normalized.includes("\\gpucache\\") ||
    normalized.includes("\\shadercache\\") ||
    normalized.includes("\\grshadercache\\") ||
    normalized.includes("\\dawncache\\") ||
    normalized.includes("\\mediacache\\") ||
    normalized.includes("\\service worker\\cachestorage\\") ||
    normalized.includes("\\startupcache\\") ||
    normalized.includes("\\thumbnails\\") ||
    lower.endsWith(".tmp") ||
    lower.endsWith(".log")
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
  const windows = env.SystemRoot ?? "C:\\Windows";
  return uniquePaths([
    env.TEMP,
    env.TMP,
    env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, "Temp") : undefined,
    path.join(windows, "Temp"),
    path.join(windows, "Logs"),
    path.join(windows, "LiveKernelReports"),
    path.join(windows, "Microsoft.NET", "Framework", "v4.0.30319", "Temporary ASP.NET Files"),
    path.join(windows, "Microsoft.NET", "Framework64", "v4.0.30319", "Temporary ASP.NET Files"),
    env.PROGRAMDATA ? path.join(env.PROGRAMDATA, "Microsoft", "Windows", "WER") : undefined,
    env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, "Microsoft", "Windows", "INetCache") : undefined,
    env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, "Microsoft", "Windows", "Explorer") : undefined,
    env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, "Microsoft", "Windows", "WER") : undefined,
    env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, "D3DSCache") : undefined,
    env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, "NuGet", "v3-cache") : undefined,
    env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, "NuGet", "plugins-cache") : undefined,
    env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, "Microsoft", "VisualStudio") : undefined
  ]);
}

export function browserCachePaths() {
  const env = process.env;
  const local = env.LOCALAPPDATA;
  const roaming = env.APPDATA;
  const chromiumBases = [
    local ? path.join(local, "Google", "Chrome", "User Data") : undefined,
    local ? path.join(local, "Microsoft", "Edge", "User Data") : undefined,
    local ? path.join(local, "BraveSoftware", "Brave-Browser", "User Data") : undefined,
    local ? path.join(local, "Vivaldi", "User Data") : undefined,
    roaming ? path.join(roaming, "Opera Software", "Opera Stable") : undefined,
    roaming ? path.join(roaming, "Opera Software", "Opera GX Stable") : undefined
  ].filter(Boolean) as string[];

  const chromiumCacheDirs = [
    "Cache",
    "Code Cache",
    "GPUCache",
    "ShaderCache",
    "GrShaderCache",
    "DawnCache",
    "Media Cache",
    path.join("Service Worker", "CacheStorage")
  ];

  const output: string[] = [];
  for (const base of chromiumBases) {
    output.push(...chromiumCacheDirs.map((dir) => path.join(base, dir)));
    for (const profile of ["Default", "Profile 1", "Profile 2", "Profile 3", "Profile 4", "Profile 5"]) {
      output.push(...chromiumCacheDirs.map((dir) => path.join(base, profile, dir)));
    }
  }

  const firefoxProfiles = roaming ? path.join(roaming, "Mozilla", "Firefox", "Profiles") : undefined;
  const firefoxLocalProfiles = local ? path.join(local, "Mozilla", "Firefox", "Profiles") : undefined;
  if (firefoxProfiles) output.push(firefoxProfiles);
  if (firefoxLocalProfiles) output.push(firefoxLocalProfiles);

  return uniquePaths(output);
}

function uniquePaths(values: Array<string | undefined>) {
  const seen = new Set<string>();
  return values.filter((value): value is string => {
    if (!value) return false;
    const normalized = normalizePath(value);
    if (seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
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
    env.APPDATA ? path.join(env.APPDATA, "Tencent", "QQ") : undefined,
    env.APPDATA ? path.join(env.APPDATA, "Tencent", "QQNT") : undefined,
    env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, "Tencent", "QQ") : undefined,
    env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, "Tencent", "QQNT") : undefined
  ].filter(Boolean) as string[];
}
