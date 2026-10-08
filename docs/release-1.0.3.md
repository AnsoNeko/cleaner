# 轻净清理 1.0.3 发布验证

2026-10-08，用户授权提交、推送及发布新版本。本次基于 `master` 的 1.0.2，新增功能详见 `announcement.md` 和 `review-2026-10-08.md`。版本已同步至 package、lockfile、UI 和两份 README。

## 本地验证

- `npm run lint` 零警告、`npm run typecheck` 通过。
- `npm test`：29/29 通过，没有跳过；清理测试只操作专门构造目录。
- `npm run package -- --publish never`：Next 静态导出、Electron 编译、Windows x64 NSIS 打包成功。
- `node scripts/verify-release-artifacts.cjs`：安装包文件名、大小和 SHA-512 与 `latest.yml` 一致；blockmap 可解压读取；ASAR 包含新扫描/清理模块、preload 和 `electron-updater`；源图标图片确实嵌入 EXE 和安装器。
- `node scripts/verify-packaged-app.cjs`：真实 `win-unpacked/Cleaner.exe` 在独立测试 userData 中运行，`app.isPackaged` 为 true，版本 1.0.3；正式 `app.asar/out/index.html`、Logo、CSS、本地 IPC 和新增中文分类正常，无主页面加载失败和横向溢出。未执行用户真实文件清理。验证器仅临时连接本机 inspector，并关闭进程、移除自己的测试配置。
- `after-pack-icon.cjs` 同步写入 EXE FileVersion/ProductVersion；Windows 属性实测均为 1.0.3。
- 安装包和 EXE 未代码签名。本次尚未执行 NSIS 安装、旧版真实升级和用户数据保持的端到端验证；正式包运行冒烟不等于安装升级验收。

## 产物

- `Cleaner-Setup-1.0.3.exe`：153923580 字节。
- SHA-256：`38e1c6202fe40aec179cb434a5576445217d5bdd50e3a3c7b0329b4a7d880367`。
- SHA-512（Base64）：`XALwmHEblmO35t29rpC3p9kEpJWNfvETiAP+uM/8a+B3YvgCmqz4tn39y8wZ1Z+J+Zt16xbPqMluuYknXuAViA==`。
- 配套资产：`Cleaner-Setup-1.0.3.exe.blockmap`、`latest.yml`、UTF-8 `announcement.md`。

## 远端发布

上传四个资产至草稿后，重新下载并逐字节核对；确认 Release 中文正文与公告一致后才发布 Latest。远端发布完成记录将在验证后补充。
