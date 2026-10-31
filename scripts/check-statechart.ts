import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { edges } from "../src/domain.ts";
import { INVARIANTS } from "../src/invariants.ts";
import { packageRoot } from "../src/root.ts";
import { chartDocument, mermaidFromChartLines } from "../src/statechart.ts";

const root = packageRoot();
const tla = await readFile(join(root, "model", "foundry.tla"), "utf8");
const cfg = await readFile(join(root, "model", "foundry.cfg"), "utf8");
const chart = chartDocument(tla);
const domainEdges = new Set(edges().map((edge) => `${edge.from} ${edge.to} ${edge.label}`));
const modelEdges = new Set(chart.edges.map((edge) => `${edge.from} ${edge.to} ${edge.label}`));
const missing = [...domainEdges].filter((edge) => !modelEdges.has(edge));
const extra = [...modelEdges].filter((edge) => !domainEdges.has(edge));
if (missing.length || extra.length) {
  console.error(JSON.stringify({ missing, extra }));
  process.exit(1);
}
const mermaid = await readFile(join(root, "statechart.mmd"), "utf8");
if (mermaid !== mermaidFromChartLines(chart.edges)) {
  console.error("statechart.mmd does not match model/foundry.tla");
  process.exit(1);
}
for (const name of INVARIANTS) {
  if (!tla.includes(name) || !cfg.includes(name)) {
    console.error(`missing invariant ${name}`);
    process.exit(1);
  }
}
console.log(`statechart matches ${domainEdges.size} edges`);
