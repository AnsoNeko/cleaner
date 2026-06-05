# Qingjing Cleaner

> A Windows disk cleaner built with Electron + Next.js.  
> 中文文档：[README.md](./README.md)

![Qingjing Cleaner screenshot](./screenshot.png)

## Overview

Qingjing Cleaner is a desktop disk cleanup tool for Windows 10/11. It scans system caches, browser caches, chat app caches, duplicate files, expired files, and large files. Before cleanup, it shows detailed results and a confirmation summary to reduce the risk of accidental deletion.

Current version: `1.0.0`

Developer: Anso  
Support email: ansuo1557@qq.com

## Features

- Windows system cache scanning and cleanup
- Browser cache scanning and cleanup
- WeChat and QQ cache scanning and cleanup
- Duplicate file detection in common C drive user folders
- Expired file and large file filtering
- Category cards with quick selection and detail views
- Cleanup confirmation summary
- Trash-first cleanup mode by default
- Auto update checks through GitHub Releases

## Safety

- Files are not permanently deleted by default
- Critical system directories are protected from scanning and deletion
- WeChat and QQ databases, account files, and configuration files are protected
- Risky expired file types are skipped, including shortcuts, configuration files, and static libraries
- Cleanup failures do not stop the whole task; failed items are recorded with reasons

## Download

Download the Windows installer from GitHub Releases:

[Download Qingjing Cleaner 1.0.0](https://github.com/AnsoNeko/cleaner/releases/tag/v1.0.0)

## Tech Stack

- Electron
- Next.js App Router
- TypeScript
- Tailwind CSS
- lucide-react
- electron-builder
- electron-updater

## Local Development

```powershell
npm install
npm run dev
```

## Type Check and Build

```powershell
npm run typecheck
npm run build
```

## Package for Windows

```powershell
npm run package
```

The installer is generated at:

```text
release/Cleaner-Setup-1.0.0.exe
```

## Auto Update Release Notes

Auto updates are served through GitHub Releases. To publish a new version:

1. Bump the `version` field in `package.json`
2. Run `npm run package`
3. Upload the installer, `.blockmap`, and `latest.yml` to the matching Release

The updater will not treat the same version as a newer release. Use a higher version number when publishing updates.

## License

No open-source license has been declared yet. Commercial redistribution is not permitted without explicit permission.
