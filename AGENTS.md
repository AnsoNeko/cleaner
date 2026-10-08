# 轻净清理项目交接

本文件用于新会话接手项目，适用于整个仓库。先核对实际源码、Git 状态和用户最新需求；文档中的版本和历史验证记录不能替代当前检查。更新功能或发布流程后同步维护本文件。

## 项目概况

- 工作目录：`D:\devs\cleaner`，主要开发环境为 Windows PowerShell。
- 产品：轻净清理，面向 Windows 10/11 的桌面磁盘清理工具，界面使用中文。
- 架构：Electron + Next.js App Router + TypeScript；Tailwind CSS 4、lucide-react。
- 当前源码版本：`1.0.3`，版本标签 `v1.0.3` 指向功能/打包提交 `903a8c0`；后续文档和验证脚本提交不改变安装包。实际状态仍需通过 Git 标签核对。
- 2026-10-08 的 1.0.3 包含微信识别、旧附件复核、软件缓存/疑似卸载残留与可靠性修复；详见 `docs/review-2026-10-08.md` 和 `docs/release-1.0.3.md`。发布状态需查询 GitHub，历史 1.0.2 不包含这些改动。
- 远端：`https://github.com/AnsoNeko/cleaner.git`，当前分支为 `master`。
- 已发布 `v1.0.0`、`v1.0.1`、`v1.0.2`、`v1.0.3`；2026-10-08 已验证 1.0.3 为 Latest，四个公开下载资产逐字节一致，正式包公告和检查更新接口通过。尚未执行真实 NSIS 安装/旧版升级验收，不能据此声称升级数据保持已验证。远端状态需在新发布任务中重新查询。
- MIT 许可证；中文 README 为默认，英文文档为 `README.en.md`。
- 关于窗口保留开发者安索、支持邮箱 `ansuo1557@qq.com`、版本号和居中大 Logo。README 简介不展示开发者和邮箱。

## 代码入口

| 文件 | 职责 |
| --- | --- |
| `app/page.tsx` | 概览卡片、分类明细、设置、清理确认、关于和公告栏，目前主要 UI 集中于此 |
| `app/globals.css` | 全局样式及按钮样式 |
| `electron/main.ts` | 窗口、IPC 注册、扫描和清理调度、更新和公告请求 |
| `electron/preload.ts` | 通过 `window.cleaner` 暴露本地 API |
| `types/cleaner.ts`、`types/global.d.ts` | 共享类型、Renderer API 声明 |
| `lib/scanner/scanner.ts` | 扫描任务、进度、取消、文件分类、重复分组 |
| `lib/scanner/path-rules.ts` | 扫描路径、保护规则、文件类型和管理员权限判断 |
| `lib/scanner/hash.ts` | 文件哈希 |
| `lib/scanner/wechat.ts` | 两代微信存储路径发现、缓存/媒体分类与隐私目录保护 |
| `lib/scanner/software.ts` | 指定软件缓存、疑似卸载残留证据和清理前复查 |
| `lib/scanner/windows-discovery.ts` | 有超时的只读 Windows 配置/安装记录查询 |
| `lib/selection.ts` | 默认选择与可选择规则，复核项不默认勾选 |
| `lib/cleaner/cleanup.ts` | 批量回收站、隔离区、永久删除、失败记录及恢复 |
| `lib/storage/store.ts` | 本地 JSON 设置和扫描记录 |
| `lib/storage/atomic-file.ts` | 同路径串行队列与临时文件 flush/原子替换 |
| `lib/cleaner/file-transfer.ts` | 不覆盖目标的同卷/跨卷暂存、SHA-256 校验及源文件移除 |
| `lib/announcement.ts` | 公告超时、缓存期限、失败重试与并发请求合并 |
| `scripts/after-pack-icon.cjs` | 用 rcedit 设置 Windows EXE 图标、文件和产品版本 |
| `announcement.md` | 公告正文，同时作为 Release 资产及说明来源 |

## 交互约定

- 首屏是可操作的概览，不做营销落地页。
- 点击设置进入专门的设置视图；点击卡片或侧边栏分类进入对应明细视图，不用滚动到下方代替页面切换。
- 分类卡片有选择框，可批量选择或取消分类；明细页支持路径搜索、选择和取消当前显示项。
- 明细页统计针对当前分类和搜索结果，不能误用全局已选总数。
- 概览任务状态放在卡片上方；长路径必须截断显示，完整路径可用 title 查看，不能撑开窗口。
- 分类通过 `ScanCategory`、UI `categoryMeta` 和扫描器联动；增加分类时也要核对清理保护规则。

当前分类：`system_cache`、`admin_required`、`browser_cache`、`wechat_cache`、`wechat_attachments`、`qq_cache`、`software_cache`、`software_residuals`、`duplicates`、`expired_files`、`large_files`。

`wechat_attachments` 为旧图片、视频和实际附件（含已识别媒体目录的 `.dat`），默认不选中，确认框提示聊天原文件可能无法打开。数据库/配置/备份不允许清理。`software_cache`、`software_residuals` 和其他 review 项也默认不选中；只自动选择 safe+delete 且无需管理员权限的项目。

软件深度清理仅针对 `software.ts` 中支持的软件及指定缓存/日志根。疑似卸载残留缺少安装/进程/常见程序文件证据，但不构成卸载证明；执行前再次查询，信息读取失败或软件运行中则拒绝，不删注册表或任意应用配置目录。

`admin_required` 对应“需管理员权限”独立卡片。这些发现项设置 `requiresAdmin`，默认不选中，手动选择时提示管理员身份运行，明细页和清理确认也显示提示。当前只有路径判断和提示，没有自动提权或实际权限检测。

## 扫描与清理边界

- Renderer 不直接访问 Node 文件系统，保持 `contextIsolation: true`、`nodeIntegration: false`，本地操作通过 preload/IPC。
- 默认清理模式为回收站；可选隔离区；永久删除必须在设置中显式启用，清理前必须确认摘要。
- 默认阈值：过期文件 180 天、聊天缓存 30 天、大文件 100 MB。
- 过期文件目前按修改时间判断，并使用用户内容扩展名白名单。不要把桌面快捷方式、配置文件、静态库等重新纳入过期候选。
- 保护系统关键目录、聊天数据库、联系人/账号/配置数据；不能为修复权限问题而整体关闭保护。
- 系统扫描路径包含 Windows Temp/Logs/LiveKernelReports、.NET Temporary ASP.NET Files、WER、用户临时目录和部分框架缓存。普通用户内容扫描跳过受保护目录。
- 重复文件先按大小分组，再快速哈希及完整哈希；默认保留最新修改项，同时间优先短路径。
- 扫描通过 opendir 流式遍历，每次目录缓冲 128 项，已取消每根 12000 文件上限；每 150 项让出事件循环，可中途取消；UI 每 500ms 轮询。最终结果和重复哈希候选仍存于内存，不应宣称容量无限。
- 目录读取失败会写入 summary.warnings 并在概览显示；summary.wechatRoots 可核对自动发现的微信目录。微信缓存/附件共用遍历，系统分类在根路径层分流，扫描结果按规范化路径去重。通用内容扫描跳过聊天存储与指定软件缓存。
- 微信路径读取 Windows Documents、两代客户端的路径配置（旧 `All Users/config/3ebffe94.ini`；新 `config/51a1fffea11325a1e4104c6b3de47af7.ini`）及注册表，支持设置 `wechatScanPaths`，新版本未知布局仍需人工填写/复核。
- 清理前并发检查文件真实路径、类型、大小和修改时间；拒绝变化项与链接。受保护目录仅允许明确系统缓存白名单内的 system_cache/admin_required，不能靠修改分类绕过保护。
- 清理性能是用户重点：不要退回逐文件启动 PowerShell/逐文件写清单的方式。
- 当前回收站每批最多 8000 个目标，通过 PowerShell 调用 Windows `SHFileOperation`；失败有 Electron `shell.trashItem` 回退。一般文件操作并发为 32，逐项回收站回退并发为 8。
- 整目录回收仅在目录不受保护、没有子目录/其他非文件项且目录中全部文件都已选择时合并；保留这些检查。
- 测试清理必须使用专门构造的测试目录；不要用用户真实文件执行破坏性验证。

## 本地数据

- 使用 `app.getPath("userData")`，不要硬编码用户配置目录。
- `cleaner-store.json` 保存设置和最近 20 次扫描记录。
- 新增设置 `wechatScanPaths`，旧设置通过 defaultSettings 合并兼容。同路径 JsonStore 共用串行队列，读改写后以同目录临时文件 flush + 原子替换保存；损坏 JSON 报错，不静默重写。
- `quarantine/manifest.json` 保存隔离区记录；`trash-batches` 存放批量回收临时清单。
- 隔离操作按清单路径串行，文件仍并发 32。同卷暂存硬链接，跨卷复制并 SHA-256 校验，记录准备状态后才移除原文件。清单按批次原子保存 pending/ready/quarantined/restoring 状态；恢复不覆盖已有目标，并可重试已移动但记录尚未更新的恢复。保持这些失败保全约束，不退回逐项写清单。
- 清理历史字段虽存在于存储结构，但当前没有完整历史页面与记录流程；隔离恢复有后端 API，不能据此声称已有完整恢复界面。

## 开发与验证

```powershell
npm ci
npm run dev
npm run typecheck
npm run lint
npm test
npm run build
npm run package
```

- `dev` 同时启动 Next、Electron TypeScript watch 和 Electron，开发 URL 为 `http://localhost:3000`。
- `build` 执行 Next 静态导出和 Electron 编译；产物分别在 `out/`、`dist-electron/`。
- `package` 会重新 build，再用 electron-builder 生成 Windows x64 NSIS 安装包。
- 历史构建出现过 Rushstack/ESLint “Failed to patch ESLint” 提示。2026-10-08 已改为 FlatCompat 与 Next 15 配置，显式声明 @eslint/eslintrc；lint 为 `eslint . --max-warnings=0`。历史退出码 0 不代表 lint 通过，之后仍需当前验证。
- 历史 1.0.2 已通过 typecheck、打包和进程存活冒烟检查。这不能证明真实清理、安装升级或所有 UI 流程正确。
- 核心变更用测试目录验证扫描分类、默认选择、保护路径、重复保留、失败处理；UI 变更检查小窗口布局和中文显示。

## Windows 打包经验

- `next.config.ts` 必须保留 `output: "export"`、`assetPrefix: "./"`、图片 `unoptimized: true`。
- Electron 正式版加载 `out/index.html`，CSS/JS/Logo 必须使用相对路径，例如 `./logo.png`。绝对 `/_next/...` 曾导致正式版样式失效。
- 根目录 `logo.png`、`64x64.ico`、`128x128.ico`、`256x256.ico` 是用户提供/已生成的品牌资源；UI Logo 位于 `public/logo.png`。
- Windows 图标使用 `256x256.ico`；窗口、安装器、卸载器和 EXE 图标都需核对。
- 保持 ASCII 打包产品名/EXE 名 `Cleaner`，中文用于 UI。
- 当前 `win.signAndEditExecutable` 为 false，但 afterPack 单独调用 rcedit 写入图标、FileVersion 和 ProductVersion。不要仅凭该开关判断 EXE 没有自定义图标。`verify-release-artifacts.cjs` 验证元数据/依赖/嵌入图标，`verify-packaged-app.cjs` 在独立 userData 中验证真实正式包启动；二者不代表 NSIS 安装升级验收。
- 必须包含主进程运行依赖：以前排除 `node_modules/**/*` 导致正式版找不到 `electron-updater`，已去除这条排除规则。
- 必要时使用下载镜像：`ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`、`ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/`。
- 清理旧输出前核对目标绝对路径确实为项目 `release/`，并检查是否有进程占用产物。
- 安装包未代码签名。发布时说明实际签名状态，不把打包成功等同于安装验证。

产物：`release/Cleaner-Setup-<version>.exe`、对应 `.exe.blockmap`、`release/latest.yml`；未安装的应用为 `release/win-unpacked/Cleaner.exe`。

## 自动更新、公告和发布

- `electron-updater` 指向 GitHub `AnsoNeko/cleaner` Releases；正式版启动后约 3 秒检查更新，发现新版自动下载，可在设置页重启安装；退出时也配置为自动安装已下载更新。
- 公告读取 `https://github.com/AnsoNeko/cleaner/releases/latest/download/announcement.md`，请求和正文读取共用 8 秒超时，成功缓存 5 分钟，失败重试间隔 30 秒，并发调用合并；过期刷新失败显示旧公告和时间。关于窗口打开时查询，不做窗口内定时刷新；当前按纯文本展示 Markdown。
- 发版同步 `package.json`、`package-lock.json` 根版本、`app/page.tsx` 的 `appVersion`、两份 README 和 `announcement.md`。
- 验证后提交并推送源码，Release tag 应指向对应提交；上传安装包、blockmap、latest.yml、announcement.md 四个资产。
- 检查 latest.yml 中版本、安装包文件名、大小和 SHA-512 与实际产物一致，再核对远端上传结果。
- 已安装同版本不会触发更新，正常更新发布必须提升版本。
- 中文编码曾出错：Windows PowerShell `Get-Content` 默认编码读 UTF-8 文件后经 `gh --notes` 发布产生乱码。读取中文要显式 `-Encoding UTF8`，优先 `gh release create/edit --notes-file announcement.md` 直接读取原文件，不通过未经验证编码的变量/管道传正文。
- 必须重新从远端读取说明核对中文；必要时用 Node `fs.readFileSync(..., "utf8")` + GitHub REST API JSON 写入并验证，曾用此方式修复乱码。不要输出认证 token。
- GitHub CLI 历史安装路径为 `C:\Program Files\GitHub CLI\gh.exe`，PATH 缺失时可核对后使用完整路径；认证状态每次发布任务重新检查。

## 修复状态与功能边界

以下来自当前工作区源码；状态和验证需在后续任务再次核对：

1. 2026-10-08 已修复 admin_required 被保护规则全部拒绝及 system_cache 过宽豁免；仅允许系统缓存白名单内匹配的文件。
2. 2026-10-08 已在系统扫描根路径层分流，并复用微信缓存/附件遍历；之后已取消 12000 文件上限、改为流式目录扫描并验证 12051 真实构造文件及 130000 模拟候选。
3. 管理员需求规则改为使用 SystemRoot/PROGRAMDATA 环境变量，仍不是真实 ACL/进程提权检测；不要声称自动处理了所有权限问题。
4. 公告已增加超时、缓存期限、失败重试和请求合并。
5. 隔离跨盘与恢复、JsonStore 并发与原子写入、Next 15/ESLint 9 配置均已修复，并有故障注入回归。没有完整恢复界面、真实 ACL 自动检测，未知微信布局和不支持的软件仍需后续扩展。

2026-10-08 初次改进构造目录 14 个测试节点通过，本机只读扫描发现 1049 个微信缓存和 290 个旧附件，UI 模拟验证通过。继续修复后 29 个测试节点全部通过（无跳过），lint 零警告、typecheck、build 通过，原 ESLint 错误消失；隐藏 Electron 的 file:// Logo/CSS 实测成功。真实跨盘测试只使用专门构造文件。没有用户真实文件清理、打包、安装升级、提交、推送或发版。详见审查报告，不得将这些事实替代下次验证。

## Git 与协作

- 开始工作先运行 `git status --short`，保留用户修改；此次创建文件前工作区干净。
- 只提交源码、配置、品牌资源、截图和项目文档，不提交 node_modules、.next、dist-electron、out、release、日志、tsbuildinfo 或凭据。
- `Claude.md` 已从远端跟踪移除并在 `.gitignore` 中忽略；本地可能仍有此文件，不要重新强制加入 Git。
- 提交、推送和发版依最新任务授权执行；2026-10-08 用户已明确授权 1.0.3 发布，验证记录见 `docs/release-1.0.3.md`，不代表未来任务自动获得发版授权。
- 使用 UTF-8 编辑中文文件，避免把终端显示乱码当成源文件损坏后重写。
