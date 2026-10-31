import { describe, expect, test } from "vitest";
import { pipelineHealth } from "../src/health.js";

describe("pipeline health", () => {
  test("counts states, gate rates, mean time, and promoted lessons", () => {
    const health = pipelineHealth({
      ideas: [
        { state: "raw", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
        { state: "verified", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:30:00.000Z" },
        { state: "verified", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T01:00:00.000Z" },
      ],
      specs: [
        {
          gates: [
            { gate: "G1", pass: true },
            { gate: "G2", pass: false },
            { gate: "G3", pass: true },
          ],
        },
      ],
      lessons: [{ promotedTo: "G2" }, { promotedTo: "G1" }],
    });
    expect(health.ideasByState.raw).toBe(1);
    expect(health.ideasByState.verified).toBe(2);
    expect(health.ideasByState.parked).toBe(0);
    expect(health.gatePassRates.G1).toEqual({ pass: 1, total: 1, rate: 1 });
    expect(health.gatePassRates.G2).toEqual({ pass: 0, total: 1, rate: 0 });
    expect(health.gatePassRates.G3).toEqual({ pass: 1, total: 1, rate: 1 });
    expect(health.meanMinutesIdeaToVerified).toBe(45);
    expect(health.lessonsPromoted).toBe(2);
  });

  test("mean time and gate rates stay empty when nothing has finished", () => {
    const health = pipelineHealth({ ideas: [], specs: [], lessons: [] });
    expect(health.meanMinutesIdeaToVerified).toBeNull();
    expect(health.gatePassRates.G1.rate).toBeNull();
    expect(health.lessonsPromoted).toBe(0);
  });
});
