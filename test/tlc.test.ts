import { expect, test } from "vitest";
import { checkModel } from "../src/tlc.ts";

test("TLC passes the four invariants and the skip-gate mutation fails", () => {
  const honest = checkModel("foundry.cfg");
  expect(honest.ok, honest.detail).toBe(true);
  expect(honest.detail).toMatch(/No error has been found/);
  const mutated = checkModel("foundry_skip_gate.cfg");
  expect(mutated.ok).toBe(false);
  expect(mutated.detail).toMatch(/DispatchRequiresGate is violated/);
  expect(mutated.detail).toMatch(/SkipGateDispatch/);
});
