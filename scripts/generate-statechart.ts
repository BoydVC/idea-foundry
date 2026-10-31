import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { packageRoot } from "../src/root.ts";
import { chartDocument } from "../src/statechart.ts";
import { writeStatechartFile } from "../src/store.ts";

const root = packageRoot();
const tla = await readFile(join(root, "model", "foundry.tla"), "utf8");
const chart = chartDocument(tla);
await writeStatechartFile(root, chart.mermaid);
console.log(`wrote statechart.mmd with ${chart.edges.length} edges`);
