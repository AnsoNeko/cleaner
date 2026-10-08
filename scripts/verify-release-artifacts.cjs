const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const zlib = require("node:zlib");
const assert = require("node:assert/strict");
const yaml = require("js-yaml");
const asar = require("@electron/asar");

const root = path.resolve(__dirname, "..");
const version = require("../package.json").version;
const name = `Cleaner-Setup-${version}.exe`;
const directory = path.join(root, "release");
const installer = fs.readFileSync(path.join(directory, name));
const sha512 = crypto.createHash("sha512").update(installer).digest("base64");
const meta = yaml.load(fs.readFileSync(path.join(directory, "latest.yml"), "utf8"));
assert.equal(meta.version, version);
assert.equal(meta.path, name);
assert.equal(meta.sha512, sha512);
assert.equal(meta.files.length, 1);
assert.equal(meta.files[0].url, name);
assert.equal(meta.files[0].size, installer.length);
assert.equal(meta.files[0].sha512, sha512);
const blockmap = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(directory, `${name}.blockmap`))));
assert(blockmap.files.length > 0);
const archive = path.join(directory, "win-unpacked/resources/app.asar");
const entries = asar.listPackage(archive).map((entry) => entry.replaceAll("\\", "/"));
for (const entry of [
  "/dist-electron/electron/main.js", "/dist-electron/electron/preload.js",
  "/dist-electron/lib/scanner/wechat.js", "/dist-electron/lib/scanner/software.js",
  "/dist-electron/lib/cleaner/file-transfer.js", "/dist-electron/lib/storage/atomic-file.js",
  "/node_modules/electron-updater/out/main.js", "/out/index.html", "/out/logo.png", "/256x256.ico"
]) assert(entries.includes(entry), `Missing packaged entry ${entry}`);
assert.equal(JSON.parse(asar.extractFile(archive, "package.json")).version, version);
const icon = fs.readFileSync(path.join(root, "256x256.ico"));
assert(icon.equals(asar.extractFile(archive, "256x256.ico")));
const executable = fs.readFileSync(path.join(directory, "win-unpacked/Cleaner.exe"));
assert.equal(icon.readUInt16LE(2), 1);
for (let index = 0; index < icon.readUInt16LE(4); index++) {
  const entry = 6 + index * 16;
  const size = icon.readUInt32LE(entry + 8);
  const offset = icon.readUInt32LE(entry + 12);
  assert(size > 0 && offset + size <= icon.length);
  const image = icon.subarray(offset, offset + size);
  assert(executable.includes(image), `EXE missing icon image ${index}`);
  assert(installer.includes(image), `Installer missing icon image ${index}`);
}
const announcement = fs.readFileSync(path.join(root, "announcement.md"), "utf8");
assert(announcement.includes(version) && announcement.includes("建议大家及时更新"));
console.log(JSON.stringify({ version, filename: name, size: installer.length, sha512,
  sha256: crypto.createHash("sha256").update(installer).digest("hex"),
  archiveEntries: entries.length, blockmapVersion: blockmap.version,
  updater: "included", icon: "source images embedded in EXE and installer", announcement: "UTF-8 verified" }, null, 2));
