import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeMutationModel } from "../src/store.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(join(root, "model", "foundry.tla"), "utf8");
const skip = `
SkipGate ==
  /\\ phase = "flow"
  /\\ s2 = "specced"
  /\\ s1 # "verified"
  /\\ s2' = "verified"
  /\\ d2' = FALSE
  /\\ ver' = ver + 1
  /\\ UNCHANGED <<phase, idea, s1, d1, g1, g2, aRead, bRead, aDone, bDone, casValue>>

`;
if (!source.includes("Next == LifeNext")) {
  throw new Error("foundry.tla no longer ends Next with LifeNext.");
}
const mutated = source
  .replace("MODULE foundry", "MODULE foundry_skip_gate")
  .replace("Next == LifeNext", `${skip}Next == LifeNext \\/ SkipGate`);
await writeMutationModel(root, mutated);
