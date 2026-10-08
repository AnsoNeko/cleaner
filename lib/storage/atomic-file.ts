import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

/** The temporary file is on the same volume; a failed replacement preserves the old JSON. */
export async function writeJsonAtomically(filePath: string, value: unknown) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${randomUUID()}.tmp`;
  try {
    const handle = await fs.open(temporary, "wx");
    try {
      await handle.writeFile(JSON.stringify(value, null, 2), "utf8");
      await handle.sync();
    } finally { await handle.close(); }
    await fs.rename(temporary, filePath);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

export class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.tail.then(operation);
    this.tail = next.catch(() => undefined);
    return next;
  }

  async idle() { await this.tail; }
}

const queues = new Map<string, SerialQueue>();
export function fileQueue(filePath: string) {
  const key = path.resolve(filePath).toLowerCase();
  let queue = queues.get(key);
  if (!queue) { queue = new SerialQueue(); queues.set(key, queue); }
  return queue;
}
