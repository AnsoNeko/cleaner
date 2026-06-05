"use client";

import { useEffect, useMemo, useState } from "react";
import type { ChangeEvent, ElementType } from "react";
import {
  AlertTriangle,
  ArchiveRestore,
  CheckCircle2,
  ChevronRight,
  Database,
  Eraser,
  FileClock,
  Files,
  FolderSearch,
  Globe2,
  HardDrive,
  Loader2,
  MessageCircle,
  RefreshCw,
  Settings,
  ShieldCheck,
  Trash2
} from "lucide-react";
import type {
  CleanerSettings,
  CleanupRequest,
  CleanupResult,
  FileFinding,
  ScanCategory,
  ScanProgress,
  ScanSummary,
  ScanTarget
} from "@/types/cleaner";

type ViewMode = "overview" | "category" | "settings";

const categoryMeta: Record<ScanCategory, { label: string; short: string; icon: ElementType; description: string }> = {
  system_cache: { label: "系统缓存", short: "系统", icon: Database, description: "Windows 临时文件、日志、WER、.NET 和 VS 缓存" },
  browser_cache: { label: "浏览器缓存", short: "浏览器", icon: Globe2, description: "Chrome、Edge、Firefox 等缓存和 GPU 缓存" },
  wechat_cache: { label: "微信缓存", short: "微信", icon: MessageCircle, description: "图片、视频、日志和过期聊天附件" },
  qq_cache: { label: "QQ 缓存", short: "QQ", icon: MessageCircle, description: "Tencent Files 中的缓存和过期附件" },
  duplicates: { label: "重复文件", short: "重复", icon: Files, description: "按大小与哈希识别相同内容" },
  expired_files: { label: "过期文件", short: "过期", icon: FileClock, description: "长期未修改的用户文件" },
  large_files: { label: "大文件", short: "大文件", icon: HardDrive, description: "超过阈值的文件，适合人工复核" }
};

const categoryOrder = Object.keys(categoryMeta) as ScanCategory[];
const defaultTargets: ScanTarget[] = categoryOrder.map((category) => ({ category }));

const fallbackSettings: CleanerSettings = {
  expiredDays: 180,
  chatExpiredDays: 30,
  largeFileSizeMb: 100,
  cleanupMode: "trash",
  customScanPaths: [],
  allowPermanentDelete: false
};

export default function Home() {
  const [settings, setSettings] = useState<CleanerSettings>(fallbackSettings);
  const [summary, setSummary] = useState<ScanSummary | null>(null);
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [view, setView] = useState<ViewMode>("overview");
  const [activeCategory, setActiveCategory] = useState<ScanCategory>("system_cache");
  const [query, setQuery] = useState("");
  const [isScanning, setIsScanning] = useState(false);
  const [isCleaning, setIsCleaning] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [cleanupResult, setCleanupResult] = useState<CleanupResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void window.cleaner?.getSettings().then(setSettings).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!progress?.scanId || progress.status !== "running") return;

    const timer = window.setInterval(async () => {
      const next = await window.cleaner?.getScanProgress(progress.scanId);
      if (!next) return;
      setProgress(next);

      if (next.status === "completed") {
        const nextSummary = await window.cleaner?.getScanSummary(next.scanId);
        if (nextSummary) {
          setSummary(nextSummary);
          setSelected(new Set(nextSummary.findings.filter(isSelectableFinding).map((item) => item.id)));
        }
        setIsScanning(false);
      }

      if (next.status === "cancelled" || next.status === "failed") {
        setIsScanning(false);
      }
    }, 500);

    return () => window.clearInterval(timer);
  }, [progress?.scanId, progress?.status]);

  const findings = summary?.findings ?? [];
  const selectedItems = findings.filter((item) => selected.has(item.id));
  const selectedBytes = selectedItems.reduce((sum, item) => sum + item.size, 0);
  const safeBytes = findings.filter((item) => item.recommendedAction === "delete" && item.risk === "safe").reduce((sum, item) => sum + item.size, 0);

  const detailFindings = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return findings.filter((item) => {
      const categoryMatch = item.category === activeCategory;
      const queryMatch = !keyword || item.path.toLowerCase().includes(keyword) || item.reason.toLowerCase().includes(keyword);
      return categoryMatch && queryMatch;
    });
  }, [activeCategory, findings, query]);

  async function startScan() {
    if (!window.cleaner) {
      setError("当前页面未连接 Electron 本地服务，请通过桌面应用启动。");
      return;
    }

    setError(null);
    setCleanupResult(null);
    setSummary(null);
    setSelected(new Set());
    setIsScanning(true);
    setView("overview");
    setProgress({
      scanId: "pending",
      status: "running",
      currentPath: "",
      scannedFiles: 0,
      foundFiles: 0,
      foundBytes: 0,
      message: "正在启动扫描"
    });

    try {
      const started = await window.cleaner.startScan(defaultTargets);
      setProgress({
        scanId: started.scanId,
        status: "running",
        currentPath: "",
        scannedFiles: 0,
        foundFiles: 0,
        foundBytes: 0,
        message: "扫描任务已启动"
      });
    } catch (scanError) {
      setError(scanError instanceof Error ? scanError.message : "扫描失败");
      setIsScanning(false);
    }
  }

  async function cleanup() {
    if (!summary || selected.size === 0 || !window.cleaner) return;
    setIsCleaning(true);
    setError(null);
    try {
      const result = await window.cleaner.cleanup({
        scanId: summary.scanId,
        findingIds: [...selected],
        mode: settings.cleanupMode
      });
      setCleanupResult(result);
      setShowConfirm(false);
      setSelected(new Set());
    } catch (cleanupError) {
      setError(cleanupError instanceof Error ? cleanupError.message : "清理失败");
    } finally {
      setIsCleaning(false);
    }
  }

  async function saveSettings(next: Partial<CleanerSettings>) {
    setSettings((current) => ({ ...current, ...next }));
    await window.cleaner?.updateSettings(next);
  }

  function openCategory(category: ScanCategory) {
    setActiveCategory(category);
    setQuery("");
    setView("category");
  }

  function selectableByCategory(category: ScanCategory) {
    return findings.filter((item) => item.category === category && isSelectableFinding(item));
  }

  function isCategoryFullySelected(category: ScanCategory) {
    const selectable = selectableByCategory(category);
    return selectable.length > 0 && selectable.every((item) => selected.has(item.id));
  }

  function toggleCategory(category: ScanCategory, checked: boolean) {
    const next = new Set(selected);
    for (const item of selectableByCategory(category)) {
      if (checked) next.add(item.id);
      else next.delete(item.id);
    }
    setSelected(next);
  }

  function toggleAllVisible(checked: boolean) {
    const next = new Set(selected);
    detailFindings.filter(isSelectableFinding).forEach((item) => {
      if (checked) next.add(item.id);
      else next.delete(item.id);
    });
    setSelected(next);
  }

  return (
    <main className="min-h-screen p-4 text-[#17201c] lg:p-6">
      <div className="mx-auto grid max-w-[1480px] grid-cols-1 gap-4 lg:grid-cols-[248px_minmax(0,1fr)]">
        <aside className="rounded-[8px] border border-[#dfe7e2] bg-white/88 p-3 shadow-sm backdrop-blur">
          <div className="mb-5 flex items-center gap-3 px-2 py-2">
            <div className="grid h-10 w-10 overflow-hidden rounded-[8px] bg-[#15806f]">
              <img src="./logo.png" alt="轻净清理" className="h-full w-full object-cover" />
            </div>
            <div>
              <h1 className="text-lg font-semibold">轻净清理</h1>
              <p className="text-xs text-[#66736d]">Windows 磁盘清理</p>
            </div>
          </div>

          <nav className="space-y-1">
            <NavButton active={view === "overview"} icon={FolderSearch} label="概览" onClick={() => setView("overview")} />
            {categoryOrder.map((category) => (
              <NavButton
                key={category}
                active={view === "category" && activeCategory === category}
                icon={categoryMeta[category].icon}
                label={categoryMeta[category].label}
                count={findings.filter((item) => item.category === category).length}
                onClick={() => openCategory(category)}
              />
            ))}
            <NavButton active={view === "settings"} icon={Settings} label="设置" onClick={() => setView("settings")} />
          </nav>

          <div className="mt-4">
            <NavButton active={false} icon={Settings} label="关于" onClick={() => setShowAbout(true)} />
          </div>

          <div className="mt-5 rounded-[8px] border border-[#dfe7e2] bg-[#f6faf8] p-3">
            <div className="mb-2 flex items-center gap-2 text-sm font-medium">
              <ShieldCheck size={16} className="text-[#15806f]" />
              安全策略
            </div>
            <p className="text-xs leading-5 text-[#66736d]">默认进入{modeLabel(settings.cleanupMode)}，保护系统目录和聊天数据库。</p>
          </div>
        </aside>

        <section className="min-w-0 space-y-4">
          <header className="rounded-[8px] border border-[#dfe7e2] bg-white/88 p-4 shadow-sm backdrop-blur">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div>
                <p className="mb-1 text-sm font-medium text-[#15806f]">{eyebrowForView(view, activeCategory)}</p>
                <h2 className="text-2xl font-semibold tracking-normal">{titleForView(view, activeCategory)}</h2>
                <p className="mt-1 text-sm text-[#66736d]">{subtitleForView(view, safeBytes)}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button className="secondary-button" onClick={() => saveSettings({ cleanupMode: settings.cleanupMode === "trash" ? "quarantine" : "trash" })}>
                  <ArchiveRestore size={17} />
                  {modeLabel(settings.cleanupMode)}
                </button>
                <button className="secondary-button" onClick={() => setView("settings")}>
                  <Settings size={17} />
                  设置
                </button>
                <button className="primary-button" disabled={isScanning} onClick={startScan}>
                  {isScanning ? <Loader2 className="animate-spin" size={18} /> : <RefreshCw size={18} />}
                  {isScanning ? "扫描中" : "开始扫描"}
                </button>
                <button className="danger-button" disabled={!summary || selected.size === 0 || isCleaning} onClick={() => setShowConfirm(true)}>
                  <Trash2 size={18} />
                  一键清理
                </button>
              </div>
            </div>
          </header>

          {error && (
            <div className="flex items-center gap-2 rounded-[8px] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              <AlertTriangle size={17} />
              {error}
            </div>
          )}

          {cleanupResult && (
            <div className="flex flex-wrap items-center gap-3 rounded-[8px] border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
              <CheckCircle2 size={17} />
              已清理 {cleanupResult.cleanedFiles} 个文件，释放 {formatBytes(cleanupResult.cleanedBytes)}
              {cleanupResult.failed.length > 0 && <span className="text-amber-800">，{cleanupResult.failed.length} 项失败</span>}
            </div>
          )}

          {view === "overview" && (
            <OverviewPage
              findings={findings}
              isCategorySelected={isCategoryFullySelected}
              onOpenCategory={openCategory}
              onToggleCategory={toggleCategory}
              progress={progress}
              summary={summary}
            />
          )}

          {view === "category" && (
            <CategoryDetailPage
              activeCategory={activeCategory}
              findings={detailFindings}
              query={query}
              selected={selected}
              isScanning={isScanning}
              onQueryChange={setQuery}
              onToggleAllVisible={toggleAllVisible}
              onToggleFinding={(item, checked) => {
                const next = new Set(selected);
                if (checked) next.add(item.id);
                else next.delete(item.id);
                setSelected(next);
              }}
            />
          )}

          {view === "settings" && <SettingsPage settings={settings} onChange={saveSettings} />}
        </section>
      </div>

      {showConfirm && (
        <ConfirmDialog
          isCleaning={isCleaning}
          mode={settings.cleanupMode}
          selectedBytes={selectedBytes}
          selectedCount={selected.size}
          onCancel={() => setShowConfirm(false)}
          onConfirm={cleanup}
        />
      )}

      {showAbout && <AboutDialog onClose={() => setShowAbout(false)} />}
    </main>
  );
}

function OverviewPage({
  findings,
  isCategorySelected,
  onOpenCategory,
  onToggleCategory,
  progress,
  summary
}: {
  findings: FileFinding[];
  isCategorySelected: (category: ScanCategory) => boolean;
  onOpenCategory: (category: ScanCategory) => void;
  onToggleCategory: (category: ScanCategory, checked: boolean) => void;
  progress: ScanProgress | null;
  summary: ScanSummary | null;
}) {
  return (
    <section className="min-w-0 space-y-4">
      <ProgressPanel progress={progress} summary={summary} />
      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="grid min-w-0 content-start gap-3 md:grid-cols-2 xl:grid-cols-3">
        {categoryOrder.map((category) => (
          <CategoryCard
            key={category}
            checked={isCategorySelected(category)}
            category={category}
            findings={findings.filter((item) => item.category === category)}
            onClick={() => onOpenCategory(category)}
            onToggle={(checked) => onToggleCategory(category, checked)}
          />
        ))}
        </div>
      <aside className="min-w-0">
        <OverviewHint />
      </aside>
      </div>
    </section>
  );
}

function CategoryDetailPage({
  activeCategory,
  findings,
  isScanning,
  onQueryChange,
  onToggleAllVisible,
  onToggleFinding,
  query,
  selected
}: {
  activeCategory: ScanCategory;
  findings: FileFinding[];
  isScanning: boolean;
  onQueryChange: (value: string) => void;
  onToggleAllVisible: (checked: boolean) => void;
  onToggleFinding: (item: FileFinding, checked: boolean) => void;
  query: string;
  selected: Set<string>;
}) {
  const visibleBytes = findings.reduce((sum, item) => sum + item.size, 0);
  const selectedVisible = findings.filter((item) => selected.has(item.id));
  const selectedVisibleBytes = selectedVisible.reduce((sum, item) => sum + item.size, 0);

  return (
    <div className="rounded-[8px] border border-[#dfe7e2] bg-white shadow-sm">
      <div className="flex flex-col gap-3 border-b border-[#dfe7e2] p-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h3 className="font-semibold">{categoryMeta[activeCategory].label}明细</h3>
          <p className="text-sm text-[#66736d]">
            当前显示 {findings.length} 项，共 {formatBytes(visibleBytes)}；本页已选 {selectedVisible.length} 项，共 {formatBytes(selectedVisibleBytes)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            className="h-10 min-w-[220px] rounded-[8px] border border-[#dfe7e2] bg-white px-3 text-sm outline-none transition focus:border-[#15806f] focus:ring-2 focus:ring-[#15806f]/15"
            placeholder="搜索路径或原因"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
          />
          <button className="secondary-button" onClick={() => onToggleAllVisible(true)}>全选本页</button>
          <button className="secondary-button" onClick={() => onToggleAllVisible(false)}>取消本页</button>
        </div>
      </div>

      <div className="max-h-[620px] overflow-auto">
        {findings.length === 0 ? (
          <EmptyState activeCategory={activeCategory} isScanning={isScanning} />
        ) : (
          <table className="w-full min-w-[860px] border-collapse text-sm">
            <thead className="sticky top-0 bg-[#f6faf8] text-left text-xs text-[#66736d]">
              <tr>
                <th className="w-12 px-4 py-3">选择</th>
                <th className="px-3 py-3">文件</th>
                <th className="px-3 py-3">大小</th>
                <th className="px-3 py-3">风险</th>
                <th className="px-3 py-3">建议</th>
              </tr>
            </thead>
            <tbody>
              {findings.map((item) => (
                <tr key={item.id} className="border-t border-[#edf2ef] transition hover:bg-[#f8fbfa]">
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      disabled={!isSelectableFinding(item)}
                      checked={selected.has(item.id)}
                      onChange={(event) => onToggleFinding(item, event.target.checked)}
                    />
                  </td>
                  <td className="max-w-[560px] px-3 py-3">
                    <button className="block max-w-full truncate text-left font-medium hover:text-[#0d5f54]" title={item.path} onClick={() => window.cleaner?.openPathInExplorer(item.path)}>
                      {item.path}
                    </button>
                    <p className="mt-1 truncate text-xs text-[#66736d]">{item.reason}</p>
                  </td>
                  <td className="px-3 py-3 font-medium">{formatBytes(item.size)}</td>
                  <td className="px-3 py-3"><RiskBadge risk={item.risk} /></td>
                  <td className="px-3 py-3">{actionLabel(item.recommendedAction)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function SettingsPage({ settings, onChange }: { settings: CleanerSettings; onChange: (settings: Partial<CleanerSettings>) => void }) {
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      <SettingsPanel settings={settings} onChange={onChange} />
      <section className="rounded-[8px] border border-[#dfe7e2] bg-white p-4 shadow-sm">
        <h3 className="font-semibold">设置说明</h3>
        <p className="mt-2 text-sm leading-6 text-[#66736d]">阈值会影响下一次扫描结果。永久删除需要显式启用，默认建议使用回收站或隔离区。</p>
      </section>
    </div>
  );
}

function NavButton({ active, icon: Icon, label, count, onClick }: { active: boolean; icon: ElementType; label: string; count?: number; onClick: () => void }) {
  return (
    <button
      className={`flex h-10 w-full items-center justify-between rounded-[8px] px-3 text-sm transition ${
        active ? "bg-[#e1f2ed] font-medium text-[#0d5f54]" : "text-[#4d5b55] hover:bg-[#f2f6f4]"
      }`}
      onClick={onClick}
    >
      <span className="flex items-center gap-2">
        <Icon size={17} />
        {label}
      </span>
      {typeof count === "number" && <span className="text-xs text-[#66736d]">{count}</span>}
    </button>
  );
}

function CategoryCard({
  category,
  checked,
  findings,
  onClick,
  onToggle
}: {
  category: ScanCategory;
  checked: boolean;
  findings: FileFinding[];
  onClick: () => void;
  onToggle: (checked: boolean) => void;
}) {
  const meta = categoryMeta[category];
  const Icon = meta.icon;
  const bytes = findings.reduce((sum, item) => sum + item.size, 0);
  const selectableCount = findings.filter(isSelectableFinding).length;

  function handleToggle(event: ChangeEvent<HTMLInputElement>) {
    event.stopPropagation();
    onToggle(event.currentTarget.checked);
  }

  return (
    <button className="rounded-[8px] border border-[#dfe7e2] bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-[#9fc8bd] hover:shadow-md" onClick={onClick}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="grid h-10 w-10 place-items-center rounded-[8px] bg-[#eef6f3] text-[#15806f]">
          <Icon size={20} />
        </div>
        <label className="flex items-center gap-2 rounded-full bg-[#f6faf8] px-2.5 py-1 text-xs text-[#4d5b55]" onClick={(event) => event.stopPropagation()}>
          <input type="checkbox" disabled={selectableCount === 0} checked={checked} onClick={(event) => event.stopPropagation()} onChange={handleToggle} />
          选择
        </label>
      </div>
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-semibold">{meta.label}</h3>
        <ChevronRight size={18} className="text-[#9aa8a2]" />
      </div>
      <p className="mt-1 min-h-10 text-sm leading-5 text-[#66736d]">{meta.description}</p>
      <div className="mt-4 flex items-end justify-between">
        <span className="text-2xl font-semibold">{formatBytes(bytes)}</span>
        <span className="rounded-full bg-[#f1f5f3] px-2.5 py-1 text-xs text-[#66736d]">{findings.length} 项</span>
      </div>
    </button>
  );
}

function ProgressPanel({ progress, summary }: { progress: ScanProgress | null; summary: ScanSummary | null }) {
  const running = progress?.status === "running";
  const width = running ? `${Math.min(92, 8 + ((progress?.scannedFiles ?? 0) % 5000) / 60)}%` : summary ? "100%" : "8%";
  return (
    <section className="min-w-0 rounded-[8px] border border-[#dfe7e2] bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-semibold">任务状态</h3>
        {running ? <Loader2 className="animate-spin text-[#15806f]" size={18} /> : <CheckCircle2 className="text-[#15806f]" size={18} />}
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-[#edf3f0]">
        <div className="h-full rounded-full bg-[#15806f] transition-all" style={{ width }} />
      </div>
      <div className="mt-3 min-w-0 space-y-2 text-sm text-[#66736d]">
        <p className="truncate">{progress?.message ?? "等待开始扫描"}</p>
        <p className="block max-w-full truncate rounded-[6px] bg-[#f6faf8] px-2 py-1 font-mono text-xs text-[#4d5b55]" dir="ltr" title={progress?.currentPath}>
          {progress?.currentPath || "尚未进入目录"}
        </p>
        <div className="grid grid-cols-2 gap-2 pt-1">
          <Metric label="已扫描" value={`${progress?.scannedFiles ?? 0} 项`} />
          <Metric label="发现容量" value={formatBytes(progress?.foundBytes ?? summary?.totalBytes ?? 0)} />
        </div>
      </div>
    </section>
  );
}

function OverviewHint() {
  return (
    <section className="rounded-[8px] border border-[#dfe7e2] bg-white p-4 shadow-sm">
      <h3 className="font-semibold">操作提示</h3>
      <p className="mt-2 text-sm leading-6 text-[#66736d]">在概览中勾选整个分类，点击卡片或侧边栏进入该分类明细页查看具体文件。</p>
    </section>
  );
}

function SettingsPanel({ settings, onChange }: { settings: CleanerSettings; onChange: (settings: Partial<CleanerSettings>) => void }) {
  return (
    <section className="rounded-[8px] border border-[#dfe7e2] bg-white p-4 shadow-sm">
      <h3 className="mb-3 font-semibold">设置</h3>
      <div className="grid gap-4 md:grid-cols-2">
        <LabeledInput label="过期文件天数" value={settings.expiredDays} onChange={(value) => onChange({ expiredDays: value })} />
        <LabeledInput label="聊天缓存天数" value={settings.chatExpiredDays} onChange={(value) => onChange({ chatExpiredDays: value })} />
        <LabeledInput label="大文件阈值 MB" value={settings.largeFileSizeMb} onChange={(value) => onChange({ largeFileSizeMb: value })} />
        <label className="block">
          <span className="mb-1 block text-sm text-[#66736d]">清理模式</span>
          <select className="h-10 w-full rounded-[8px] border border-[#dfe7e2] bg-white px-3 outline-none focus:border-[#15806f] focus:ring-2 focus:ring-[#15806f]/15" value={settings.cleanupMode} onChange={(event) => onChange({ cleanupMode: event.target.value as CleanupRequest["mode"] })}>
            <option value="trash">移入回收站</option>
            <option value="quarantine">移入隔离区</option>
            <option value="delete">永久删除</option>
          </select>
        </label>
        <label className="flex items-center justify-between gap-3 rounded-[8px] bg-[#f6faf8] px-3 py-2 md:col-span-2">
          <span className="text-sm text-[#4d5b55]">启用永久删除</span>
          <input type="checkbox" checked={settings.allowPermanentDelete} onChange={(event) => onChange({ allowPermanentDelete: event.target.checked })} />
        </label>
      </div>
    </section>
  );
}

function LabeledInput({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm text-[#66736d]">{label}</span>
      <input className="h-10 w-full rounded-[8px] border border-[#dfe7e2] bg-white px-3 outline-none focus:border-[#15806f] focus:ring-2 focus:ring-[#15806f]/15" type="number" min={1} value={value} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  );
}

function ConfirmDialog({ isCleaning, mode, onCancel, onConfirm, selectedBytes, selectedCount }: { isCleaning: boolean; mode: CleanupRequest["mode"]; onCancel: () => void; onConfirm: () => void; selectedBytes: number; selectedCount: number }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-[#17201c]/35 p-4 backdrop-blur-sm">
      <div className="w-full max-w-[520px] rounded-[8px] border border-[#dfe7e2] bg-white p-5 shadow-xl">
        <div className="mb-4 flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-[8px] bg-red-50 text-red-700">
            <Eraser size={20} />
          </div>
          <div>
            <h3 className="text-lg font-semibold">确认清理选中文件</h3>
            <p className="text-sm text-[#66736d]">将处理 {selectedCount} 项，预计释放 {formatBytes(selectedBytes)}</p>
          </div>
        </div>
        <div className="rounded-[8px] bg-[#f6faf8] p-3 text-sm text-[#4d5b55]">
          当前模式：{modeLabel(mode)}。系统关键目录、聊天数据库和建议保留项不会被清理。
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button className="secondary-button" onClick={onCancel}>取消</button>
          <button className="danger-button" disabled={isCleaning} onClick={onConfirm}>
            {isCleaning ? <Loader2 className="animate-spin" size={18} /> : <Trash2 size={18} />}
            确认清理
          </button>
        </div>
      </div>
    </div>
  );
}

function AboutDialog({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-[#17201c]/35 p-4 backdrop-blur-sm">
      <div className="w-full max-w-[420px] rounded-[8px] border border-[#dfe7e2] bg-white p-6 text-center shadow-xl">
        <div className="mx-auto mb-4 grid h-28 w-28 overflow-hidden rounded-[8px] bg-[#15806f]">
          <img src="./logo.png" alt="轻净清理 Logo" className="h-full w-full object-cover" />
        </div>
        <h3 className="text-xl font-semibold">轻净清理</h3>
        <p className="mt-1 text-sm text-[#66736d]">版本号 1.0.0</p>
        <div className="mt-5 rounded-[8px] bg-[#f6faf8] p-4 text-left text-sm leading-7 text-[#4d5b55]">
          <p><span className="text-[#66736d]">开发者：</span>安索</p>
          <p><span className="text-[#66736d]">支持邮箱：</span>ansuo1557@qq.com</p>
        </div>
        <div className="mt-5 flex justify-center">
          <button className="primary-button" onClick={onClose}>知道了</button>
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[8px] bg-[#f6faf8] p-3">
      <p className="text-xs text-[#66736d]">{label}</p>
      <p className="mt-1 font-semibold text-[#17201c]">{value}</p>
    </div>
  );
}

function EmptyState({ activeCategory, isScanning }: { activeCategory: ScanCategory; isScanning: boolean }) {
  return (
    <div className="grid min-h-[360px] place-items-center p-8 text-center">
      <div>
        <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-[8px] bg-[#eef6f3] text-[#15806f]">
          {isScanning ? <Loader2 className="animate-spin" size={22} /> : <FolderSearch size={22} />}
        </div>
        <h3 className="font-semibold">{isScanning ? "正在扫描，请稍候" : `暂无${categoryMeta[activeCategory].label}`}</h3>
        <p className="mt-1 text-sm text-[#66736d]">扫描完成后，这里会显示当前分类的具体文件。</p>
      </div>
    </div>
  );
}

function RiskBadge({ risk }: { risk: FileFinding["risk"] }) {
  const className = risk === "safe" ? "bg-emerald-50 text-emerald-700" : risk === "review" ? "bg-amber-50 text-amber-700" : "bg-red-50 text-red-700";
  return <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${className}`}>{risk === "safe" ? "安全" : risk === "review" ? "复核" : "危险"}</span>;
}

function actionLabel(action: FileFinding["recommendedAction"]) {
  if (action === "delete") return "建议清理";
  if (action === "keep") return "建议保留";
  return "人工复核";
}

function isSelectableFinding(item: FileFinding) {
  return item.recommendedAction !== "keep" && item.risk !== "danger";
}

function eyebrowForView(view: ViewMode, category: ScanCategory) {
  if (view === "overview") return "C 盘健康概览";
  if (view === "settings") return "清理偏好";
  return categoryMeta[category].label;
}

function titleForView(view: ViewMode, category: ScanCategory) {
  if (view === "overview") return "扫描缓存、重复项和过期文件";
  if (view === "settings") return "设置";
  return `${categoryMeta[category].label}明细`;
}

function subtitleForView(view: ViewMode, safeBytes: number) {
  if (view === "overview") return `先识别风险，再由你确认清理范围。当前估算可清理 ${formatBytes(safeBytes)}。`;
  if (view === "settings") return "调整过期阈值、清理模式和永久删除保护。";
  return "查看具体文件，勾选需要清理的项目。";
}

function modeLabel(mode: CleanupRequest["mode"]) {
  if (mode === "trash") return "移入回收站";
  if (mode === "quarantine") return "移入隔离区";
  return "永久删除";
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
}
