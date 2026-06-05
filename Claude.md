# 轻净清理项目说明

## 项目概况

本项目是面向 Windows 10/11 的磁盘清理桌面工具，基于 **Electron + Next.js + TypeScript** 实现。

- Next.js 负责中文桌面工具界面。
- Electron 主进程负责本地扫描、重复文件识别、清理执行、隔离区恢复和权限边界。
- Renderer 只能通过 `window.cleaner` 调用 preload 暴露的 IPC API，不直接访问 Node 文件系统。
- 当前版本号：`1.0.0`
- 开发者：安索
- 支持邮箱：`ansuo1557@qq.com`

## 当前功能

- 概览页展示分类卡片、任务状态、扫描进度和可清理容量。
- 任务状态已上移到概览页顶部，扫描路径使用单行截断，避免长路径撑开窗口。
- 分类卡片支持勾选整类，也支持点击进入二级明细页。
- 侧边栏分类入口与分类卡片一致，进入对应分类明细页。
- 设置按钮进入独立设置页，不再滚动到下方区域。
- 关于弹窗展示大 logo、开发者、支持邮箱和版本号。
- 支持扫描：
  - Windows 系统缓存
  - 微信缓存
  - QQ 缓存
  - C 盘用户目录重复文件
  - 过期文件
  - 大文件
- 支持扫描进度轮询，扫描在主进程后台执行，避免 Renderer 长时间卡住。
- 支持按当前分类明细显示文件，明细页顶部展示当前显示数量/容量和本页已选数量/容量。
- 清理前展示确认摘要，默认移入回收站或隔离区。

## 安全策略

- 默认禁止泛扫描和清理系统关键目录：
  - `C:\Windows`
  - `C:\Program Files`
  - `C:\Program Files (x86)`
  - `C:\ProgramData`
- 微信/QQ 数据库、配置、账号数据列入保护规则，不自动删除。
- 系统缓存只处理看起来像缓存、临时、日志、缩略图的文件。
- 过期文件扫描已收紧为用户内容类文件，不包含快捷方式、配置文件、静态库、可执行文件、脚本、数据库等高风险文件。
- 大文件和过期文件默认标记为 `review`，需要用户确认。
- 删除失败不会中断整个清理任务，会记录失败原因。

## 目录结构

- `app/`：Next App Router 主页面和界面交互。
- `electron/`：Electron main、preload 和 IPC 注册。
- `lib/scanner/`：扫描引擎、路径规则、哈希识别。
- `lib/cleaner/`：清理执行、回收站/隔离区、恢复。
- `lib/storage/`：本地设置、扫描历史和清理历史。
- `types/`：Renderer 与 Electron 共享类型。
- `public/`：Next 静态资源。
- `scripts/after-pack-icon.cjs`：打包后使用 `rcedit` 写入 Windows exe 图标。

## 打包说明

项目使用 `electron-builder` 生成 Windows NSIS 安装包。

关键配置：

- `next.config.ts` 使用 `output: "export"` 和 `assetPrefix: "./"`，确保 Electron `file://` 加载时 CSS/JS 生效。
- `BrowserWindow` 使用 `256x256.ico` 作为窗口图标。
- `build.win.icon`、`nsis.installerIcon`、`nsis.uninstallerIcon` 指向 `256x256.ico`。
- 因当前 Windows 用户权限无法解压 `winCodeSign` 中的符号链接，`signAndEditExecutable` 保持 `false`。
- 为保证安装后的 `Cleaner.exe` 使用项目 logo，`afterPack` 阶段通过 `scripts/after-pack-icon.cjs` 调用 `rcedit` 写入 exe 图标资源。

常用打包环境变量：

```powershell
$env:ELECTRON_MIRROR='https://npmmirror.com/mirrors/electron/'
$env:ELECTRON_BUILDER_BINARIES_MIRROR='https://npmmirror.com/mirrors/electron-builder-binaries/'
$env:CSC_IDENTITY_AUTO_DISCOVERY='false'
```

常用命令：

```powershell
npm run typecheck
npm run build
npm run package
```

打包输出：

- `release\Cleaner Setup 1.0.0.exe`
- `release\win-unpacked\Cleaner.exe`

这些输出属于构建产物，不提交到 git。

## 验证记录

当前实现已通过：

- `npm run typecheck`
- `npm run build`
- `npm run package`
- 本地静态页面验证：设置页切换、分类明细切换、任务状态上移、明细页统计文案。
- 打包后冒烟测试：`release\win-unpacked\Cleaner.exe` 可启动。
- 图标验证：从 `Cleaner.exe` 和安装包中提取的关联图标为项目彩色 logo。

## Git 提交范围

只提交项目源码、配置、图标和锁文件。

不提交：

- `node_modules/`
- `.next/`
- `out/`
- `dist-electron/`
- `release/`
- `*.tsbuildinfo`
- 日志和本地环境变量文件。
