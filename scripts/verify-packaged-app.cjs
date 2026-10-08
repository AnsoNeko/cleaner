// Run the actual packaged executable with an isolated profile, using its inspector
// to set userData before startup. No cleanup or user settings are changed.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { randomUUID } = require("node:crypto");

async function main() {
  const executable = path.resolve(process.argv[2] || "release/win-unpacked/Cleaner.exe");
  const version = process.argv[3] || require("../package.json").version;
  const parent = path.resolve(__dirname, "../.test-fixtures");
  const profile = path.join(parent, `packaged-smoke-${randomUUID()}`);
  await fs.mkdir(profile, { recursive: true });
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_START_URL;
  const child = spawn(executable, ["--inspect-brk=127.0.0.1:0"], { env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let socket;
  let stderr = "";
  let nextId = 0;
  const pending = new Map();
  let timedOut = false;
  const limit = setTimeout(() => {
    timedOut = true;
    child.kill();
    for (const request of pending.values()) request.reject(new Error("Packaged verification timed out"));
  }, 35000);
  const closed = new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal })));
  try {
    const url = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code) => reject(new Error(`Executable exited before inspector: ${code}\n${stderr}`)));
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
        const match = stderr.match(/ws:\/\/127\.0\.0\.1:\d+\/[^\s]+/);
        if (match) resolve(match[0]);
      });
    });
    socket = new WebSocket(url);
    await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
    let paused;
    const firstPause = new Promise((resolve) => { paused = resolve; });
    socket.addEventListener("message", ({ data }) => {
      const message = JSON.parse(data);
      if (message.method === "Debugger.paused") paused(message.params.callFrames[0]);
      if (message.id) {
        const request = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) request?.reject(new Error(JSON.stringify(message.error)));
        else request?.resolve(message.result);
      }
    });
    const call = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
    await call("Debugger.enable");
    await call("Runtime.runIfWaitingForDebugger");
    const frame = await firstPause;
    const setup = await call("Debugger.evaluateOnCallFrame", {
      callFrameId: frame.callFrameId,
      expression: `(() => {
        const electron = require('electron');
        electron.app.setPath('userData', ${JSON.stringify(profile)});
        electron.app.setPath('sessionData', ${JSON.stringify(path.join(profile, "session"))});
        const errors = [];
        electron.app.on('browser-window-created', (_event, window) => {
          window.hide();
          window.webContents.once('did-finish-load', () => { window.__cleanerPageLoaded = true; });
          window.webContents.on('did-fail-load', (_event, code, message, url, mainFrame) => { if (mainFrame) errors.push({code, message, url}); });
        });
        globalThis.__cleanerPackageProbe = async () => {
          const window = electron.BrowserWindow.getAllWindows()[0];
          if (!window || !window.__cleanerPageLoaded || window.webContents.isLoadingMainFrame()) return {pending: true};
          window.hide();
          const ui = await window.webContents.executeJavaScript(\`(async () => ({
            url: location.href, title: document.title,
            api: Object.keys(window.cleaner || {}),
            settings: await window.cleaner.getSettings(),
            logos: [...document.images].map(image => ({src: image.getAttribute('src'), loaded: image.complete && image.naturalWidth > 0})),
            css: [...document.styleSheets].map(sheet => sheet.href),
            width: innerWidth, documentWidth: document.documentElement.scrollWidth,
            text: document.body.innerText
          }))()\`);
          return {version: electron.app.getVersion(), packaged: electron.app.isPackaged, userData: electron.app.getPath('userData'), appPath: electron.app.getAppPath(), errors, ui};
        };
        globalThis.__cleanerPackageExit = () => { electron.BrowserWindow.getAllWindows().forEach(window => window.destroy()); electron.app.exit(0); };
        return electron.app.isPackaged;
      })()`, returnByValue: true
    });
    assert(!setup.exceptionDetails, JSON.stringify(setup.exceptionDetails));
    assert.equal(setup.result.value, true);
    await call("Debugger.resume");
    let result;
    for (let attempt = 0; attempt < 100; attempt++) {
      const response = await call("Runtime.evaluate", { expression: "globalThis.__cleanerPackagePromise = globalThis.__cleanerPackageProbe()", awaitPromise: true, returnByValue: true });
      assert(!response.exceptionDetails, JSON.stringify(response.exceptionDetails));
      result = response.result.value;
      if (!result.pending) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert(result && !result.pending, "Packaged page did not finish loading");
    assert.equal(result.version, version);
    assert.equal(result.packaged, true);
    assert.equal(result.userData, profile);
    assert(result.appPath.endsWith("app.asar"));
    assert.deepEqual(result.errors, []);
    assert(result.ui.url.startsWith("file:") && result.ui.url.includes("app.asar/out/index.html"));
    assert(result.ui.api.includes("cleanup") && result.ui.api.includes("startScan"));
    assert.equal(result.ui.settings.cleanupMode, "trash");
    assert.equal(result.ui.settings.allowPermanentDelete, false);
    assert(result.ui.logos.length && result.ui.logos.every((logo) => logo.src === "./logo.png" && logo.loaded));
    assert(result.ui.css.some((url) => url && url.includes("/_next/static/css/")));
    assert(result.ui.documentWidth <= result.ui.width);
    if (version === "1.0.3") {
      for (const name of ["微信旧附件", "软件缓存", "疑似卸载残留"]) assert(result.ui.text.includes(name), `Missing category ${name}`);
    }
    delete result.ui.text;
    console.log(JSON.stringify(result, null, 2));
    // Exiting over the inspector disconnects it before the command reply.
    socket.send(JSON.stringify({ id: ++nextId, method: "Runtime.evaluate", params: { expression: "globalThis.__cleanerPackageExit()" } }));
    socket.close();
    const exit = await closed;
    assert(!timedOut, "Packaged verification timed out during exit");
    assert.equal(exit.code, 0, `Packaged executable exited with ${JSON.stringify(exit)}`);
  } finally {
    clearTimeout(limit);
    socket?.close();
    if (child.exitCode === null) { child.kill(); await closed; }
    assert(profile.startsWith(parent + path.sep));
    await fs.rm(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 });
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
