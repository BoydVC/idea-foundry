import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { edgesOfTransition } from "../src/domain.js";
import { edgeKey, edgesFromTla } from "../src/statechart.js";

describe("statechart", () => {
  test("the TLA actions and transition() name the same edges", () => {
    const model = edgesFromTla(readFileSync("model/foundry.tla", "utf8"));
    expect(new Set(model.map(edgeKey))).toEqual(new Set(edgesOfTransition().map(edgeKey)));
  });

  test("either spec can fail a gate and a verified idea cannot outlive its specs", () => {
    const tla = readFileSync("model/foundry.tla", "utf8");
    const cfg = readFileSync("model/foundry.cfg", "utf8");
    expect(tla).toContain("GateFail2");
    expect(tla).toContain("FailIdea");
    expect(tla).toContain("VerifiedIdeaNeedsSpecs");
    expect(cfg).toContain("INVARIANT VerifiedIdeaNeedsSpecs");
    expect(tla).toMatch(/Unverify1 ==[\s\S]*?idea' = IF idea = "verified" THEN "gated" ELSE idea/);
    expect(tla).toMatch(/Unverify2 ==[\s\S]*?idea' = IF idea = "verified" THEN "gated" ELSE idea/);
  });
});
