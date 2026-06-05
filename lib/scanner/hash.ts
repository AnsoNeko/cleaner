import crypto from "node:crypto";
import fs from "node:fs";

export async function hashFile(filePath: string, bytes?: number) {
  const hash = crypto.createHash("sha256");
  const stream = fs.createReadStream(filePath, bytes ? { start: 0, end: Math.max(bytes - 1, 0) } : undefined);

  for await (const chunk of stream) {
    hash.update(chunk);
  }

  return hash.digest("hex");
}
