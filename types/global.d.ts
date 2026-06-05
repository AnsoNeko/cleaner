import type { CleanerApi } from "./cleaner";

declare global {
  interface Window {
    cleaner?: CleanerApi;
  }
}

export {};
