import fs from "node:fs/promises";
import path from "node:path";
import { isWithinPath, normalizePath } from "./path-rules";
import { readWindowsJson } from "./windows-discovery";

export interface SoftwareInventory {
  installed: Array<{ name: string; location: string }>;
  processes: string[];
}
interface SoftwareRule {
  id: string;
  label: string;
  installedName: RegExp;
  processes: string[];
  data: string[];
  executables: string[];
}
export interface SoftwareRoot { path: string; softwareId: string; label: string }

function softwareRules(): SoftwareRule[] {
  const local = process.env.LOCALAPPDATA;
  const roaming = process.env.APPDATA;
  const dirs = (base: string | undefined, ...values: string[]) => base ? values.map((value) => path.join(base, value)) : [];
  return [
    { id: "vscode", label: "Visual Studio Code", installedName: /visual studio code|^vs ?code$/i, processes: ["code"], data: dirs(roaming, "Code"), executables: dirs(local, "Programs/Microsoft VS Code/Code.exe") },
    { id: "discord", label: "Discord", installedName: /discord/i, processes: ["discord", "discordcanary", "discordptb"], data: dirs(roaming, "discord", "discordcanary", "discordptb"), executables: dirs(local, "Discord/Update.exe", "DiscordCanary/Update.exe", "DiscordPTB/Update.exe") },
    { id: "slack", label: "Slack", installedName: /slack/i, processes: ["slack"], data: dirs(roaming, "Slack"), executables: dirs(local, "slack/slack.exe", "slack/Update.exe") },
    { id: "spotify", label: "Spotify", installedName: /spotify/i, processes: ["spotify"], data: [...dirs(roaming, "Spotify"), ...dirs(local, "Spotify")], executables: dirs(roaming, "Spotify/Spotify.exe") },
    { id: "zoom", label: "Zoom", installedName: /\bzoom\b/i, processes: ["zoom"], data: dirs(roaming, "Zoom"), executables: dirs(roaming, "Zoom/bin/Zoom.exe") },
    { id: "teams", label: "Microsoft Teams（经典版）", installedName: /teams/i, processes: ["teams", "ms-teams"], data: dirs(roaming, "Microsoft/Teams"), executables: dirs(local, "Microsoft/Teams/current/Teams.exe", "Microsoft/Teams/Update.exe") }
  ];
}

const cacheDirs = ["Cache", "Code Cache", "GPUCache", "DawnCache", "GrShaderCache", "ShaderCache", "Service Worker/CacheStorage", "logs", "Log", "Crashpad/reports"];

export function softwareCacheRoots(): SoftwareRoot[] {
  const roots = softwareRules().flatMap((rule) => rule.data.flatMap((base) => cacheDirs.map((dir) => ({ path: path.join(base, dir), softwareId: rule.id, label: rule.label }))));
  if (process.env.LOCALAPPDATA) {
    for (const [id, label, dir] of [["npm", "npm", "npm-cache/_cacache"], ["pip", "pip", "pip/Cache"], ["uv", "uv", "uv/cache"]]) {
      roots.push({ path: path.join(process.env.LOCALAPPDATA, dir), softwareId: id, label });
    }
    roots.push({ path: path.join(process.env.LOCALAPPDATA, "Spotify", "Data"), softwareId: "spotify", label: "Spotify" });
  }
  return roots;
}

export async function readSoftwareInventory() {
  return readWindowsJson<SoftwareInventory>(`
    $installed = @();
    foreach ($key in @('HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall', 'HKCU:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall', 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall', 'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall')) {
      if (Test-Path -LiteralPath $key) {
        foreach ($child in Get-ChildItem -LiteralPath $key) {
          $v = Get-ItemProperty -LiteralPath $child.PSPath;
          if ($v.DisplayName) { $installed += @{ name = [string]$v.DisplayName; location = [string]$v.InstallLocation } }
        }
      }
    }
    # Store applications are also installation evidence; a failed query aborts residual detection.
    foreach ($pkg in Get-AppxPackage) { $installed += @{ name = [string]$pkg.Name; location = [string]$pkg.InstallLocation } }
    @{ installed = @($installed); processes = @(Get-Process | Select-Object -ExpandProperty ProcessName) } | ConvertTo-Json -Depth 4 -Compress
  `);
}

export async function suspectedResidualRoots(inventory: SoftwareInventory | null): Promise<SoftwareRoot[]> {
  if (!inventory || !Array.isArray(inventory.installed) || !Array.isArray(inventory.processes)) return [];
  const absent = new Set<string>();
  for (const rule of softwareRules()) {
    if (inventory.installed.some((app) => rule.installedName.test(app.name) || (app.location && rule.data.some((dir) => isWithinPath(dir, app.location))))) continue;
    if (inventory.processes.some((name) => rule.processes.includes(name.toLowerCase()))) continue;
    let binary = false;
    for (const exe of rule.executables) { try { await fs.access(exe); binary = true; break; } catch { /* Not installed at this marker. */ } }
    if (!binary) absent.add(rule.id);
  }
  return softwareCacheRoots().filter((root) => absent.has(root.softwareId));
}

const normalizedRootCache = new WeakMap<SoftwareRoot[], Array<{ root: SoftwareRoot; value: string }>>();
export function matchSoftwareRoot(value: string, roots: SoftwareRoot[]) {
  let cached = normalizedRootCache.get(roots);
  if (!cached) { cached = roots.map((root) => ({ root, value: normalizePath(root.path) })); normalizedRootCache.set(roots, cached); }
  const normalized = normalizePath(value);
  return cached.find((item) => normalized === item.value || normalized.startsWith(`${item.value}\\`))?.root;
}

export function isSoftwareRunning(id: string, inventory: SoftwareInventory) {
  const names = softwareRules().find((rule) => rule.id === id)?.processes ?? ({ npm: ["node", "npm"], pip: ["python", "pip"], uv: ["uv", "python"] }[id] ?? []);
  return inventory.processes.some((name) => names.includes(name.toLowerCase()));
}

export function isProtectedSoftwareFile(value: string) {
  return /\.(db|sqlite|sqlite3|ini|config|json|key|pem|exe|dll|msi|sys|node|lnk)(-wal|-shm)?$/i.test(value)
    || normalizePath(value).split("\\").some((part) => ["accounts", "config", "databases", "local storage", "session storage", "indexeddb"].includes(part));
}
