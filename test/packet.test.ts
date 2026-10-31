import { describe, expect, test } from "vitest";
import { DomainError } from "../src/domain.js";
import { buildPacket, parsePacket } from "../src/packet.js";
import { FixturePlanner } from "../src/planner.js";
import { approve, createIdea, decompose, gate, restate } from "../src/commands.js";
import type { Spec } from "../src/domain.js";
import { tempStore } from "./helpers.js";

const planner = new FixturePlanner();

function gatedSpec(): Spec {
  const store = tempStore();
  const made = createIdea(store, "weather widget", false);
  if (!made.ok) throw new Error("create");
  const id = (made.data as { id: string }).id;
  restate(store, id, planner, false);
  approve(store, id, "Ship the smallest slice", false);
  decompose(store, id, planner, false);
  const gated = gate(store, id, false);
  if (!gated.ok) throw new Error(JSON.stringify(gated));
  const spec = store.load().specs.find((item) => item.ideaId === id && item.index === 1);
  if (!spec) throw new Error("missing spec");
  return spec;
}

describe("arena packet", () => {
  test("parsePacket throws when a packet has one runner", () => {
    const spec = gatedSpec();
    const packet = buildPacket(spec, "BoydVC/draft-day", "2026-01-01T00:00:00.000Z");
    const broken = { ...packet, runners: packet.runners.slice(0, 1), prompts: { ...packet.prompts, runners: packet.prompts.runners.slice(0, 1) } };
    expect(() => parsePacket(broken)).toThrow(DomainError);
    expect(() => parsePacket(broken)).toThrow(/at least 2 runner/);
  });

  test("buildPacket defaults to three seats and a grafting verifier", () => {
    const spec = gatedSpec();
    const packet = parsePacket(buildPacket(spec, "BoydVC/draft-day", "2026-01-01T00:00:00.000Z"));
    expect(packet.runners.map((runner) => runner.seat)).toEqual(["types-first", "model-first", "experience-first"]);
    expect(packet.verifier).toEqual({ base: "pick", graft: true });
    expect(packet.prompts.runners).toHaveLength(3);
    expect(packet.prompts.verifier).toContain("graft");
    expect(packet.prompts.runners[0]?.text).toContain("types-first");
  });
});
