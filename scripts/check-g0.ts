import fs from "node:fs";
import path from "node:path";
import { storeWritesState, writeViolations } from "../src/g0.ts";
import { packageRoot } from "../src/tlc.ts";

const src = path.join(packageRoot(), "src");
const files = fs.readdirSync(src).filter((name) => name.endsWith(".ts")).map((name) => {
  const file = path.join(src, name);
  return { path: file, text: fs.readFileSync(file, "utf8") };
});
const hits = writeViolations(files);
const store = files.find((file) => file.path.endsWith(`${path.sep}store.ts`));
if (!store || !storeWritesState(store.text)) {
  process.stderr.write("store.ts does not own the state write.\n");
  process.exit(1);
}
if (hits.length > 0) {
  process.stderr.write(`Write calls outside store.ts:\n${hits.join("\n")}\n`);
  process.exit(1);
}
process.stdout.write(`G0 write check passed (${files.length} modules).\n`);
