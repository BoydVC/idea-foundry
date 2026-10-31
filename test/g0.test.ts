import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { storeWritesState, writeViolations } from "../src/g0.ts";

const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src");

test("only store.ts writes files", () => {
  const files = fs.readdirSync(src).filter((name) => name.endsWith(".ts")).map((name) => {
    const file = path.join(src, name);
    return { path: file, text: fs.readFileSync(file, "utf8") };
  });
  expect(writeViolations(files)).toEqual([]);
  const store = files.find((file) => file.path.endsWith(`${path.sep}store.ts`));
  expect(store && storeWritesState(store.text)).toBe(true);
});
