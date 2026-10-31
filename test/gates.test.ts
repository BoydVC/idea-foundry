import { describe, expect, test } from "vitest";
import { checkG1, checkG2, checkG3 } from "../src/gates.js";

const good = {
  id: "s-0001-2" as const,
  index: 2,
  landsAfter: "s-0001-1" as const,
  maxLines: 120,
  acceptance: ["node --test src/weather-widget/rules.test.ts"],
  touch: ["src/weather-widget/rules.ts"],
  body: [
    "Write the decision rules for weather widget and return the computed result.",
    "Done when: the acceptance command exits 0.",
    "PII clause: synthetic data only.",
    "Merge is forbidden. The proof is a draft PR.",
  ].join("\n"),
};

const siblings = [
  { id: "s-0001-1" as const, index: 1 },
  { id: "s-0001-2" as const, index: 2 },
];

describe("gates", () => {
  test("G1 passes a runnable command, a touch map, and a small budget", () => {
    expect(checkG1(good).pass).toBe(true);
  });

  test("G1 fails when the acceptance command, touch map, or size is missing", () => {
    expect(checkG1({ ...good, acceptance: ["echo hi"] }).pass).toBe(false);
    expect(checkG1({ ...good, touch: [] }).pass).toBe(false);
    expect(checkG1({ ...good, maxLines: 401 }).pass).toBe(false);
  });

  test("G2 passes a spec with done-when, a concrete verb, and a PII clause", () => {
    expect(checkG2(good).pass).toBe(true);
  });

  test("G2 fails on a missing done-when, a vague verb, or a missing PII clause", () => {
    expect(checkG2({ body: good.body.replace("Done when:", "Later:") }).findings.some((item) => item.key === "g2:done-when")).toBe(true);
    expect(checkG2({ body: `${good.body}\nWe should improve the page.` }).findings.some((item) => item.key === "g2:vague-verb")).toBe(true);
    expect(checkG2({ body: good.body.replace("PII clause: synthetic data only.", "No privacy note.") }).findings.some((item) => item.key === "g2:pii")).toBe(true);
  });

  test("G3 passes a draft-only spec that names the spec below it", () => {
    expect(checkG3(good, siblings).pass).toBe(true);
  });

  test("G3 fails when the spec orders a merge or skips its predecessor", () => {
    expect(checkG3({ ...good, body: good.body.replace("Merge is forbidden.", "You may merge the pull request.") }, siblings).pass).toBe(false);
    expect(checkG3({ ...good, landsAfter: null }, siblings).pass).toBe(false);
  });
});
