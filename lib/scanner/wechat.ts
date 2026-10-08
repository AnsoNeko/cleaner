import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { isWithinPath, normalizePath } from "./path-rules";
import { readWindowsJson } from "./windows-discovery";

interface WechatLocations { documents: string; saved: string[] }

export function parseWechatSavePath(bytes: Buffer): string | null {
  if (bytes.length > 16384) return null;
  const text = bytes[0] === 0xff && bytes[1] === 0xfe
    ? bytes.subarray(2).toString("utf16le")
    : bytes[1] === 0 && bytes[3] === 0 ? bytes.toString("utf16le") : bytes.toString("utf8");
  const value = text.replace(/^\uFEFF/, "").replace(/\0+$/, "").trim().replace(/^"|"$/g, "");
  return path.isAbsolute(value) && !/[\r\n\0]/.test(value) && value !== path.parse(value).root ? value : null;
}

export async function discoverWechatRoots(customPaths: string[] = []) {
  const locations = await readWindowsJson<WechatLocations>(`
    $saved = @();
    foreach ($key in @('HKCU:\\Software\\Tencent\\WeChat', 'HKCU:\\Software\\Tencent\\Weixin')) {
      if (Test-Path -LiteralPath $key) { $v = (Get-ItemProperty -LiteralPath $key).FileSavePath; if ($v) { $saved += [string]$v } }
    }
    @{ documents = [Environment]::GetFolderPath('MyDocuments'); saved = @($saved) } | ConvertTo-Json -Compress
  `);
  const documents = locations?.documents || path.join(os.homedir(), "Documents");
  const bases = [documents, path.join(os.homedir(), "Documents"), ...customPaths, ...(locations?.saved ?? [])];
  for (const product of ["WeChat", "Weixin", "xwechat"]) {
    if (process.env.APPDATA) {
      const base = path.join(process.env.APPDATA, "Tencent", product);
      bases.push(base);
      for (const relative of [path.join("All Users", "config", "3ebffe94.ini"), path.join("config", "51a1fffea11325a1e4104c6b3de47af7.ini")]) {
        try {
          const config = path.join(base, relative);
          if ((await fs.stat(config)).size <= 16384) {
            const saved = parseWechatSavePath(await fs.readFile(config));
            if (saved) bases.push(saved);
          }
        } catch { /* The setting differs between client versions. */ }
      }
    }
    if (process.env.LOCALAPPDATA) bases.push(path.join(process.env.LOCALAPPDATA, "Tencent", product));
  }
  const roots: string[] = [];
  for (const base of bases) {
    // A user may choose the storage parent, the storage root, or an account folder.
    const children = [path.join(base, "WeChat Files"), path.join(base, "xwechat_files")];
    const name = path.basename(base).toLowerCase();
    if (["wechat files", "xwechat_files", "wechat", "weixin", "xwechat"].includes(name)) children.push(base);
    for (const marker of ["FileStorage", "msg", "db_storage"]) {
      try { if ((await fs.lstat(path.join(base, marker))).isDirectory()) { children.push(base); break; } } catch { /* Missing marker. */ }
    }
    for (const candidate of children) {
      try { if ((await fs.lstat(candidate)).isDirectory()) roots.push(candidate); } catch { /* Missing root. */ }
    }
  }
  return [...new Map(roots.map((root) => [normalizePath(root), root])).values()]
    .filter((root, _, all) => !all.some((parent) => normalizePath(parent) !== normalizePath(root) && isWithinPath(root, parent)));
}

const privateDirs = new Set(["db", "db_storage", "database", "databases", "config", "account", "accounts", "all users", "backup", "backupfiles", "backup_files", "bak", "contact", "contacts", "login", "session", "sessions"]);
const privateExts = new Set([".db", ".sqlite", ".sqlite3", ".ini", ".config", ".json", ".key", ".ldb", ".wal", ".shm", ".exe", ".dll", ".sys", ".msi", ".lnk", ".pak", ".node"]);

export function isPrivateWechatDirectory(value: string) {
  return privateDirs.has(path.basename(value).toLowerCase());
}

/** .dat is permitted only inside a known media layout, never in databases/configuration. */
export function classifyWechatFile(value: string): "cache" | "attachment" | null {
  const segments = normalizePath(value).split("\\");
  const storageStart = segments.findIndex((part) => ["wechat files", "xwechat_files", "wechat", "weixin", "xwechat"].includes(part));
  const relative = segments.slice(storageStart < 0 ? 0 : storageStart + 1);
  const dirs = relative.slice(0, -1);
  const ext = path.extname(value).toLowerCase();
  if (dirs.some((part) => privateDirs.has(part)) || privateExts.has(ext) || /\.(db|sqlite)(-wal|-shm)?$/.test(value.toLowerCase())) return null;
  const layout = dirs.join("/");
  const media = /(^|\/)filestorage\/(image|video|file|msgattach)(\/|$)/.test(layout)
    || /(^|\/)msg\/(attach|file|video|image)(\/|$)/.test(layout);
  if (media) return "attachment";
  if (ext === ".dat") return null;
  if (dirs.some((part) => ["cache", "temp", "tmp", "log", "logs", "gpucache", "code cache", "crash", "crashpad", "crashinfo"].includes(part))) return "cache";
  return null;
}

export function looksLikeChatStorage(value: string) {
  return normalizePath(value).split("\\").some((part) => ["wechat files", "xwechat_files", "wechat", "weixin", "xwechat", "tencent files"].includes(part));
}
