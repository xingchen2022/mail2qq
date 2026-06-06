import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export class StateStore {
  constructor(filePath) {
    this.filePath = path.resolve(filePath);
  }

  async load() {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw);
      return {
        initialized: parsed.initialized === true,
        lastUid: Number.isFinite(parsed.lastUid) ? parsed.lastUid : 0,
        forwardedUids: Array.isArray(parsed.forwardedUids) ? parsed.forwardedUids : [],
      };
    } catch (error) {
      if (error.code === "ENOENT") {
        return { initialized: false, lastUid: 0, forwardedUids: [] };
      }
      throw error;
    }
  }

  async save(state) {
    const dir = path.dirname(this.filePath);
    await mkdir(dir, { recursive: true });
    const tmpPath = `${this.filePath}.tmp`;
    const data = JSON.stringify(
      {
        initialized: state.initialized === true,
        lastUid: state.lastUid,
        forwardedUids: [...new Set(state.forwardedUids)].sort((a, b) => a - b),
        updatedAt: new Date().toISOString(),
      },
      null,
      2,
    );
    await writeFile(tmpPath, `${data}\n`, "utf8");
    await rename(tmpPath, this.filePath);
  }
}
