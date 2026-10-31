import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { builtinDenylist, scanText, scanTree } from "../src/pii.ts";

test("the scanner flags a denylist term, an email, and a phone number", () => {
  const term = builtinDenylist()[0] ?? "missing";
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-pii-"));
  const email = ["person", "example.com"].join("@");
  const phone = ["415", "555", "0100"].join("-");
  fs.writeFileSync(path.join(dir, "note.txt"), `hello ${term} ${email} ${phone}`);
  const hits = scanTree(dir, [term]);
  expect(hits.length).toBeGreaterThanOrEqual(3);
  expect(scanText("clean.txt", "habit tracker export", [term])).toEqual([]);
});
