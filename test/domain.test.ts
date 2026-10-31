import { describe, expect, test } from "vitest";
import {
  EVENTS,
  IllegalTransition,
  PHASES,
  edgesOfTransition,
  ideaId,
  parseIdea,
  parseSpec,
  prUrl,
  specId,
  transition,
} from "../src/domain.js";

describe("transition", () => {
  test("allows only the closed set of edges", () => {
    const keys = edgesOfTransition().map((edge) => `${edge.from} ${edge.event} ${edge.to}`).sort();
    expect(keys).toEqual([
      "approved decompose specced",
      "approved park parked",
      "dispatched park parked",
      "dispatched reject rejected",
      "dispatched verify verified",
      "gated close verified",
      "gated dispatch dispatched",
      "gated gate_fail specced",
      "gated park parked",
      "raw park parked",
      "raw restate restated",
      "restated approve approved",
      "restated park parked",
      "specced gate_pass gated",
      "specced park parked",
      "verified reopen gated",
      "verified unverify dispatched",
    ]);
  });

  test("every illegal pair names the next command", () => {
    for (const state of PHASES) {
      for (const event of EVENTS) {
        try {
          transition(state, event);
        } catch (error) {
          expect(error).toBeInstanceOf(IllegalTransition);
          const illegal = error as IllegalTransition;
          expect(illegal.next.length).toBeGreaterThan(0);
          expect(illegal.message).toContain(state);
        }
      }
    }
  });

  test("rejects a verified spec that is not a draft", () => {
    expect(() =>
      parseSpec({
        id: "s-0001-1",
        ideaId: "i-0001",
        stackId: "k-0001",
        version: 2,
        index: 1,
        title: "habit tracker export: records",
        body: "Done when: the command exits 0.",
        acceptance: ["node --test src/habit-tracker-export/records.test.ts"],
        touch: ["src/habit-tracker-export/records.ts"],
        maxLines: 80,
        landsAfter: null,
        gates: [
          { gate: "G1", pass: true, findings: [] },
          { gate: "G2", pass: true, findings: [] },
          { gate: "G3", pass: true, findings: [] },
        ],
        state: "verified",
        packetPath: "packets/s-0001-1.json",
        prUrl: "https://github.com/example-org/demo-board/pull/1",
        draft: false,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      }),
    ).toThrow(/draft/);
  });

  test("brands ids and rejects a swapped kind", () => {
    expect(ideaId("i-0007")).toBe("i-0007");
    expect(() => ideaId("s-0007-1")).toThrow(/idea id/);
    expect(() => specId("i-0007")).toThrow(/spec id/);
    expect(prUrl("https://github.com/example-org/demo-board/pull/4")).toContain("github.com");
    expect(() => prUrl("https://example.com/demo/pull/4")).toThrow(/github.com/);
    expect(() => prUrl("http://github.com/example-org/demo-board/pull/4")).toThrow(/github.com/);
  });

  test("rejects a title that looks like contact data", () => {
    const title = ["demo", "@", "example.com"].join("");
    expect(() =>
      parseIdea({
        id: "i-0001",
        version: 1,
        title,
        labels: [],
        state: "raw",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      }),
    ).toThrow(/contact/);
  });
});
