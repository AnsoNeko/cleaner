# 轻净清理

> Windows 磁盘清理工具，基于 Electron + Next.js 构建。  
> English documentation: [README.en.md](./README.en.md)

![轻净清理界面](./screenshot.png)

## 简介

轻净清理是一款面向 Windows 10/11 的桌面磁盘清理工具。它提供系统缓存、浏览器缓存、聊天软件缓存、重复文件、过期文件和大文件扫描能力，并在清理前展示明细与确认摘要，尽量降低误删风险。

当前版本：`1.0.3`

## 1.0.3 更新

- 微信自动识别旧版 `WeChat Files`、新版 `xwechat_files`、Windows 重定向文档路径，以及两代客户端的存储路径配置；也可在设置中填写微信存储位置。
- 微信缓存与旧附件分开展示，支持旧版 `FileStorage/MsgAttach` 和新版 `msg/attach` 下的媒体 `.dat`；图片、视频、附件默认不选中，数据库、配置和备份受到保护。
- 新增软件缓存分类，覆盖 VS Code、Discord、Slack、Spotify、Zoom、经典 Teams，以及 npm、pip、uv 的指定缓存目录。默认需人工选择，正在运行的软件会在清理前被拦截。
- 新增疑似卸载残留分类：结合卸载注册表、Store 安装记录、进程和常见程序文件判断，只列出上述桌面软件的指定缓存/日志。缺少安装记录不等于已卸载，便携版可能仍在使用，默认不选中，执行前再次核对。
- 人工复核项不再自动勾选；扫描结果按路径去重，目录读取失败时提示。清理前检查路径链接、文件大小和修改时间。
- 目录使用流式遍历，取消原 12000 文件上限；隔离区支持跨盘复制校验与恢复，不覆盖已有目标。设置和扫描记录使用串行、原子写入，公告提供超时与限时缓存。

详细审查和本次验证见 [审查报告](docs/review-2026-10-08.md)。深度清理不会批量删除任意 AppData、注册表项或 Windows Installer 缓存。

## 主要功能

- Windows 系统缓存扫描与清理
- 需要管理员权限的系统清理项独立展示
- 浏览器缓存扫描与清理
- 微信、QQ 缓存扫描与清理
- C 盘常见用户目录重复文件识别
- 过期文件和大文件筛选
- 分类卡片快速勾选与明细页查看
- 清理前确认摘要
- 默认移入回收站，避免直接永久删除
- GitHub Releases 自动更新检查

## 安全策略

- 默认不永久删除文件
- 系统关键目录默认禁止扫描和删除
- 微信、QQ 数据库、账号配置等敏感文件列入保护规则
- 高风险过期文件类型会被跳过，例如快捷方式、配置文件、静态库等
- 删除失败不会中断整个清理任务，会记录失败原因

## 下载

可在 GitHub Release 页面下载 Windows 安装包：

[下载轻净清理 1.0.3](https://github.com/AnsoNeko/cleaner/releases/tag/v1.0.3)

## 技术栈

- Electron
- Next.js App Router
- TypeScript
- Tailwind CSS
- lucide-react
- electron-builder
- electron-updater

## 本地开发

```powershell
npm install
npm run dev
```

## 类型检查与构建

```powershell
npm run typecheck
npm run lint
npm test
npm run build
```

## 打包 Windows 安装包

```powershell
npm run package
```

打包产物默认输出到：

```text
release/Cleaner-Setup-1.0.3.exe
```

## 使用注意事项

- 清理前请先查看明细，确认不需要的文件再执行清理。
- 默认会优先移入回收站或隔离区，不建议直接永久删除。
- Windows 日志、Windows 临时目录、.NET 临时文件等系统目录下的项目会归入“需管理员权限”分类。
- “需管理员权限”分类默认不会自动选中；如需清理，请右键以管理员身份运行程序。
- 微信、QQ 数据库和账号配置文件会被保护，不会作为普通缓存清理。

## 许可证

本项目使用 [MIT License](./LICENSE)。
