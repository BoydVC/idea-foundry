import { describe, expect, it } from "vitest";
import { EVENT_TYPES, NEXT, STATES, edges, transition, type State } from "../src/domain.ts";

describe("transition", () => {
  it("walks a raw idea to a verified spec state", () => {
    const steps = [
      "restate",
      "approve",
      "decompose",
      "gate_pass",
      "dispatch",
      "verify_draft",
    ] as const;
    let state: State = "raw";
    const seen = ["raw"];
    for (const type of steps) {
      const moved = transition(state, { type });
      expect(moved.ok, type).toBe(true);
      if (moved.ok) {
        state = moved.state;
        seen.push(state);
      }
    }
    expect(seen).toEqual(["raw", "restated", "approved", "specced", "gated", "dispatched", "verified"]);
  });

  it("tells you the next command when the event is illegal", () => {
    const moved = transition("raw", { type: "approve" });
    expect(moved.ok).toBe(false);
    if (!moved.ok) expect(moved.next).toContain("restate");
  });

  it("sends a failed gate back to specced", () => {
    const moved = transition("gated", { type: "gate_fail" });
    expect(moved).toEqual({ ok: true, state: "specced" });
  });

  it("has a row for every state and event and no merge state", () => {
    expect(STATES).not.toContain("merged");
    expect(EVENT_TYPES).not.toContain("merge");
    for (const state of STATES) {
      for (const type of EVENT_TYPES) {
        expect(NEXT[state][type] === null || STATES.includes(NEXT[state][type])).toBe(true);
        expect(transition(state, { type }).ok).toBe(NEXT[state][type] !== null);
      }
    }
    expect(edges().length).toBeGreaterThan(10);
  });
});
