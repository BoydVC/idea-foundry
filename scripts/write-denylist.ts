import fs from "node:fs";
import path from "node:path";
import { builtinDenylist } from "../src/pii.ts";
import { packageRoot } from "../src/tlc.ts";

const dir = path.join(packageRoot(), ".local");
fs.mkdirSync(dir, { recursive: true });
const file = path.join(dir, "pii-denylist.txt");
fs.writeFileSync(file, `${builtinDenylist().join("\n")}\n`);
process.stdout.write(`wrote ${file}\n`);
