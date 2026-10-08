// Local static preview only; no Electron filesystem API is exposed here.
const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const root = path.resolve(__dirname, "../out");
const mime = { ".html": "text/html; charset=utf-8", ".js": "application/javascript", ".css": "text/css", ".png": "image/png", ".ico": "image/x-icon" };
http.createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    const file = path.resolve(root, "." + (pathname === "/" ? "/index.html" : pathname));
    if (!file.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
    const data = await fs.readFile(file);
    res.writeHead(200, { "Content-Type": mime[path.extname(file)] ?? "application/octet-stream" });
    res.end(data);
  } catch { res.writeHead(404); res.end(); }
}).listen(4187, "127.0.0.1", () => console.log("Cleaner UI preview: http://127.0.0.1:4187"));
