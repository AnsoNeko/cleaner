import { execFile } from "node:child_process";

/** One bounded, read-only Windows query per scan. Failure must not imply an uninstall. */
export function readWindowsJson<T>(script: string): Promise<T | null> {
  if (process.platform !== "win32") return Promise.resolve(null);
  const encoded = Buffer.from(`$ErrorActionPreference = 'Stop'; [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new(); ${script}`, "utf16le").toString("base64");
  return new Promise((resolve) => {
    execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
      { windowsHide: true, timeout: 10000, maxBuffer: 4 * 1024 * 1024, encoding: "utf8" },
      (error, stdout) => {
        if (error) return resolve(null);
        try { resolve(JSON.parse(stdout.replace(/^\uFEFF/, "").trim()) as T); }
        catch { resolve(null); }
      });
  });
}
