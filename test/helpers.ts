import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/store.js";

export function tempStore(): Store {
  return new Store(mkdtempSync(join(tmpdir(), "foundry-")), () => "2026-01-01T00:00:00.000Z");
}
