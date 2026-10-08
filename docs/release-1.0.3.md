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

- 源码提交：`903a8c01cc35a6157f6d8835992780f8e0d0e4b2`，已推送至 `origin/master`；已推送的注解标签 `v1.0.3` 指向该提交。
- 草稿 Release 的四个资产均处于 uploaded 状态，大小和 GitHub SHA-256 digest 与本地一致；再次下载四个文件逐字节比较全部一致。中文 Release 正文与 UTF-8 公告完全一致。
- 2026-10-08 06:26:37 UTC（北京时间 14:26:37）发布为 Latest，非草稿、非预发布：[轻净清理 1.0.3](https://github.com/AnsoNeko/cleaner/releases/tag/v1.0.3)。
- 发布后从公开、未认证的 `releases/latest/download/` 地址再次下载四个资产，HTTP 200，全部与本地逐字节一致；公开 `latest.yml` 的 1.0.3 版本、安装包大小及 SHA-512 均正确。
- 真实正式包联网冒烟：公告 IPC 读取本次完整中文公告；`electron-updater` 通过 IPC 返回 `not_available`、版本 1.0.3，确认当前已是最新版本。测试使用独立配置，没有触发更新安装或清理用户文件。
- 验证器退出流程说明：早期联网验证已完成接口检查，但在调试连接与进程同时关闭时观察到 0xC0000005。验证器改为先收到退出调度确认、断开 inspector，再正常退出后，最终联网冒烟退出码 0。仅修改验证脚本，没有修改或替换已发布的产品代码/资产。
- 后续补充验证脚本及本记录的提交属于开发验证和文档，不包含产品运行代码变更；发布标签保留在上述源码提交。
