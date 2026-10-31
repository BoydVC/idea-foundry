import fs from "node:fs";
import path from "node:path";
import { readModel } from "../src/model-table.ts";
import { renderStatechart } from "../src/statechart.ts";
import { packageRoot } from "../src/tlc.ts";

const root = packageRoot();
const model = readModel(path.join(root, "model", "foundry.tla"));
const text = renderStatechart(model.rows);
fs.writeFileSync(path.join(root, "statechart.mmd"), text);
process.stdout.write(`wrote statechart.mmd (${model.rows.length} rows)\n`);
