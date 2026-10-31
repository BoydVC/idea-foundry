import path from "node:path";
import { loadDenylist, scanTree } from "../src/pii.ts";
import { packageRoot } from "../src/tlc.ts";

const root = packageRoot();
const file = process.env.FOUNDRY_PII_DENYLIST ?? path.join(root, ".local", "pii-denylist.txt");
const hits = scanTree(root, loadDenylist(file));
if (hits.length > 0) {
  process.stderr.write(`${hits.join("\n")}\n`);
  process.exit(1);
}
process.stdout.write("PII scan passed.\n");
