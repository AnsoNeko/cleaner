import type { Announcement } from "../types/cleaner";

interface AnnouncementOptions {
  fetch?: typeof globalThis.fetch;
  now?: () => number;
  timeoutMs?: number;
  ttlMs?: number;
  retryMs?: number;
}

export class AnnouncementService {
  private cache: Announcement | null = null;
  private expiresAt = 0;
  private retryAt = 0;
  private inFlight: Promise<Announcement> | null = null;
  private fetcher: typeof globalThis.fetch;
  private now: () => number;
  private timeoutMs: number;
  private ttlMs: number;
  private retryMs: number;

  constructor(private url: string, options: AnnouncementOptions = {}) {
    this.fetcher = options.fetch ?? globalThis.fetch;
    this.now = options.now ?? Date.now;
    this.timeoutMs = options.timeoutMs ?? 8000;
    this.ttlMs = options.ttlMs ?? 5 * 60 * 1000;
    this.retryMs = options.retryMs ?? 30000;
  }

  get(): Promise<Announcement> {
    if (this.cache && this.now() < this.expiresAt) return Promise.resolve(this.cache);
    if (this.inFlight) return this.inFlight;
    if (this.now() < this.retryAt) return Promise.resolve(this.fallback("公告暂时无法刷新"));
    this.inFlight = this.load().finally(() => { this.inFlight = null; });
    return this.inFlight;
  }

  private fallback(message: string): Announcement {
    if (this.cache) return { ...this.cache, content: `${this.cache.content}\n\n（${message}；以上为此前缓存，时间：${this.cache.fetchedAt}）` };
    return { content: message, source: this.url, fetchedAt: new Date(this.now()).toISOString() };
  }

  private async load(): Promise<Announcement> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error("公告读取超时，请稍后重试")); }, this.timeoutMs);
    });
    try {
      const content = await Promise.race([
        (async () => {
          const response = await this.fetcher(this.url, { signal: controller.signal });
          if (!response.ok) throw new Error(`公告读取失败：HTTP ${response.status}`);
          return (await response.text()).trim();
        })(),
        timeout
      ]);
      this.cache = { content: content || "暂无公告。", source: this.url, fetchedAt: new Date(this.now()).toISOString() };
      this.expiresAt = this.now() + this.ttlMs;
      this.retryAt = 0;
      return this.cache;
    } catch (error) {
      this.retryAt = this.now() + this.retryMs;
      return this.fallback(error instanceof Error ? error.message : "公告读取失败");
    } finally { if (timer) clearTimeout(timer); }
  }
}
