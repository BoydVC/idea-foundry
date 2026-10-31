import { describe, expect, test } from "vitest";
import { builtinTerms, scanText } from "../src/pii.js";

describe("pii scan", () => {
  test("flags a builtin term without storing that term in the assertion text", () => {
    const term = builtinTerms()[0] ?? "";
    expect(term.length).toBeGreaterThan(0);
    const hits = scanText("scratch.txt", `see ${term} here`, []);
    expect(hits).toHaveLength(1);
    expect(scanText("scratch.txt", "habit tracker export", []).length).toBe(0);
  });

  test("flags an address-shaped token", () => {
    const address = ["person", "@", "example.com"].join("");
    expect(scanText("scratch.txt", address, []).some((hit) => hit.term === "email-address")).toBe(true);
  });
});