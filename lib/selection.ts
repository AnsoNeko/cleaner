import type { FileFinding } from "../types/cleaner";

export function isSelectableFinding(item: FileFinding) {
  return item.recommendedAction !== "keep" && item.risk !== "danger";
}

export function isDefaultSelectedFinding(item: FileFinding) {
  return isSelectableFinding(item) && item.risk === "safe" && item.recommendedAction === "delete" && !item.requiresAdmin;
}
