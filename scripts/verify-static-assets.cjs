const { app, BrowserWindow } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const parent = path.resolve(__dirname, "../.test-fixtures");
const profile = path.join(parent, `electron-assets-${randomUUID()}`);
app.setPath("userData", profile);
app.disableHardwareAcceleration();
let window;
const timeout = setTimeout(() => { console.error("Static asset verification timed out"); app.exit(1); }, 20000);

app.whenReady().then(async () => {
  let exitCode = 0;
  try {
    window = new BrowserWindow({ show: false, width: 1024, height: 680, webPreferences: { contextIsolation: true, nodeIntegration: false } });
    await window.loadFile(path.resolve(__dirname, "../out/index.html"));
    const result = await window.webContents.executeJavaScript(`({
      url: location.href,
      title: document.title,
      logos: [...document.images].map(image => ({src: image.getAttribute('src'), loaded: image.complete && image.naturalWidth > 0})),
      stylesheets: [...document.styleSheets].map(sheet => sheet.href),
      bodyFont: getComputedStyle(document.body).fontFamily,
      width: innerWidth, documentWidth: document.documentElement.scrollWidth
    })`);
    assert(result.url.startsWith("file:"));
    assert(result.logos.length > 0 && result.logos.every((logo) => logo.src === "./logo.png" && logo.loaded));
    assert(result.stylesheets.some((href) => href && href.includes("/_next/static/css/")));
    assert(result.documentWidth <= result.width);
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(error);
    exitCode = 1;
  } finally {
    clearTimeout(timeout);
    if (window && !window.isDestroyed()) window.destroy();
    assert(path.resolve(profile).startsWith(parent + path.sep));
    try { await fs.rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
    catch (error) { console.error(error); exitCode = 1; }
    app.exit(exitCode);
  }
});
