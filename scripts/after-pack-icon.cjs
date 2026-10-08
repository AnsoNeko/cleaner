const path = require("node:path");
const { spawnSync } = require("node:child_process");

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "win32") return;

  const exePath = path.join(context.appOutDir, "Cleaner.exe");
  const iconPath = path.join(context.packager.projectDir, "256x256.ico");
  const rceditPath = path.join(context.packager.projectDir, "node_modules", "rcedit", "bin", "rcedit-x64.exe");

  const version = context.packager.appInfo.version;
  const result = spawnSync(rceditPath, [
    exePath, "--set-icon", iconPath,
    "--set-file-version", version, "--set-product-version", version,
    "--set-version-string", "ProductName", "Cleaner",
    "--set-version-string", "FileDescription", "Cleaner"
  ], {
    encoding: "utf8",
    stdio: "pipe",
    windowsHide: true
  });

  if (result.status !== 0) {
    throw new Error(`Failed to apply Windows resources with rcedit: ${result.stderr || result.stdout || result.error?.message}`);
  }
};
