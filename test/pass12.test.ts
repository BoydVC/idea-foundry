import { describe, expect, test } from "vitest";
import { acceptanceProof, canonicalTouch, checkG1, isRunnable, touchesCore } from "../src/gates.js";

const good = {
  acceptance: ["node --test src/weather-widget/rules.test.ts"],
  touch: ["src/weather-widget/rules.ts"],
  maxLines: 120,
};

describe("pass 12", () => {
  test("SRC/store.ts counts as a core file", () => {
    expect(touchesCore(["SRC/store.ts"])).toBe(true);
    expect(touchesCore(["SRC/Store.TS"])).toBe(true);
    const weak = checkG1({ ...good, touch: ["SRC/store.ts"], acceptance: ["echo hi"] });
    expect(weak.findings.some((item) => item.key === "g1:proof")).toBe(true);
    const proved = checkG1({ ...good, touch: ["SRC/store.ts"] });
    expect(proved.findings.some((item) => item.key === "g1:proof")).toBe(false);
    expect(proved.pass).toBe(true);
  });

  test("a touch path with trailing whitespace is rejected", () => {
    const result = checkG1({ ...good, touch: ["src/store.ts "] });
    expect(canonicalTouch("src/store.ts ")).toBeNull();
    expect(result.pass).toBe(false);
    expect(result.findings.some((item) => item.key === "g1:touch-invalid")).toBe(true);
  });

  test("a touch path with a zero-width space is rejected", () => {
    const result = checkG1({ ...good, touch: ["src/store.ts\u200B"] });
    expect(canonicalTouch("src/store.ts\u200B")).toBeNull();
    expect(result.pass).toBe(false);
    expect(result.findings.some((item) => item.key === "g1:touch-invalid")).toBe(true);
  });

  test("npx --yes evil is not an acceptance command", () => {
    expect(isRunnable("npx --yes evil")).toBe(false);
    expect(acceptanceProof(["npx --yes evil"])).toBe(1);
    const result = checkG1({ ...good, acceptance: ["npx --yes evil"] });
    expect(result.pass).toBe(false);
    expect(result.findings.some((item) => item.key === "g1:acceptance")).toBe(true);
  });

  test("npx of a declared package is not proof level 4", () => {
    expect(isRunnable("npx vitest")).toBe(true);
    expect(isRunnable("npx -y vitest")).toBe(false);
    expect(isRunnable("npx -p typescript")).toBe(false);
    expect(acceptanceProof(["npx vitest"])).toBe(1);
    expect(acceptanceProof(["node --test src/weather-widget/rules.test.ts"])).toBe(4);
    expect(acceptanceProof(["npm test"])).toBe(4);
    expect(acceptanceProof(["tsc --noEmit"])).toBe(4);
    const core = checkG1({ ...good, acceptance: ["npx vitest"], touch: ["src/domain.ts"] });
    expect(core.findings.some((item) => item.key === "g1:acceptance")).toBe(false);
    expect(core.findings.some((item) => item.key === "g1:proof")).toBe(true);
  });

  test("a non-NFC touch path is rejected", () => {
    expect(canonicalTouch("src/cafe\u0301.ts")).toBeNull();
    const result = checkG1({ ...good, touch: ["src/cafe\u0301.ts"] });
    expect(result.findings.some((item) => item.key === "g1:touch-invalid")).toBe(true);
  });
});
