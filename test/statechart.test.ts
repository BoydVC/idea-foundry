import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { edgesOfTransition } from "../src/domain.js";
import { edgeKey, edgesFromTla } from "../src/statechart.js";

describe("statechart", () => {
  test("the TLA actions and transition() name the same edges", () => {
    const model = edgesFromTla(readFileSync("model/foundry.tla", "utf8"));
    expect(new Set(model.map(edgeKey))).toEqual(new Set(edgesOfTransition().map(edgeKey)));
  });
});
