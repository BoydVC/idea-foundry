import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { packageRoot } from "../src/root.ts";

const WRITE = /\b(writeFile|writeFileSync|appendFile|appendFileSync|createWriteStream|copyFile|rename|renameSync|rmSync|truncateSync|mkdir|mkdirSync)\(/;

async function files(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const out: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await files(path)));
    else if (entry.name.endsWith(".ts")) out.push(path);
  }
  return out;
}

describe("G0 file writes", () => {
  it("lets only store.ts under src write files", async () => {
    const src = join(packageRoot(), "src");
    const offenders: string[] = [];
    for (const path of await files(src)) {
      if (path.endsWith("store.ts")) continue;
      const text = await readFile(path, "utf8");
      if (WRITE.test(text)) offenders.push(path);
    }
    expect(offenders).toEqual([]);
  });
});
