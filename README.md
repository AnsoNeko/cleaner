# 轻净清理

> Windows 磁盘清理工具，基于 Electron + Next.js 构建。  
> English documentation: [README.en.md](./README.en.md)

![轻净清理界面](./screenshot.png)

## 简介

轻净清理是一款面向 Windows 10/11 的桌面磁盘清理工具。它提供系统缓存、浏览器缓存、聊天软件缓存、重复文件、过期文件和大文件扫描能力，并在清理前展示明细与确认摘要，尽量降低误删风险。

当前版本：`1.0.0`

开发者：安索  
支持邮箱：ansuo1557@qq.com

## 主要功能

- Windows 系统缓存扫描与清理
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

[下载轻净清理 1.0.0](https://github.com/AnsoNeko/cleaner/releases/tag/v1.0.0)

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
npm run build
```

## 打包 Windows 安装包

```powershell
npm run package
```

打包产物默认输出到：

```text
release/Cleaner-Setup-1.0.0.exe
```

## 自动更新发布说明

自动更新通过 GitHub Releases 提供更新源。发布新版本时需要：

1. 提升 `package.json` 中的 `version`
2. 执行 `npm run package`
3. 将安装包、`.blockmap` 和 `latest.yml` 上传到对应 Release

同版本号不会触发更新检测，发布更新时请使用更高版本号。

## 许可证

当前项目暂未声明开源许可证。未经许可，请勿用于商业分发。
