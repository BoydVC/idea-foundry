import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { edgesOfTransition } from "../src/domain.js";
import { edgeKey, edgesFromTla, mermaid } from "../src/statechart.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const tla = readFileSync(join(root, "model", "foundry.tla"), "utf8");
const chart = readFileSync(join(root, "model", "statechart.mmd"), "utf8");
const fromModel = edgesFromTla(tla);
const fromCode = edgesOfTransition();
const modelKeys = new Set(fromModel.map(edgeKey));
const codeKeys = new Set(fromCode.map(edgeKey));
const missing = [...codeKeys].filter((key) => !modelKeys.has(key));
const extra = [...modelKeys].filter((key) => !codeKeys.has(key));
const rendered = mermaid(fromModel);
const cfg = readFileSync(join(root, "model", "foundry.cfg"), "utf8");
const page = readFileSync(join(root, "public", "index.html"), "utf8");
const invariantNames = ["NoMergeState", "VerifiedImpliesDraftPR", "StackLandsBottomUp", "CASNoLostUpdate", "DispatchRequiresGate", "VerifiedIdeaNeedsSpecs", "VerifiedIsFinal"];
const missingInvariants = invariantNames.filter((name) => !tla.includes(name) || !cfg.includes(`INVARIANT ${name}`) || !page.includes(name));
if (missing.length > 0 || extra.length > 0 || rendered !== chart || missingInvariants.length > 0) {
  process.stderr.write(`${JSON.stringify({ missing, extra, missingInvariants, rendered }, null, 2)}\n`);
  process.exit(1);
}
process.stdout.write(`statechart edges ${codeKeys.size}\n`);
