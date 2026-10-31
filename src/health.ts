import { PHASES, type GateId, type Phase } from "./domain.js";

export type GateRate = {
  pass: number;
  total: number;
  rate: number | null;
};

export type PipelineHealth = {
  ideasByState: Record<Phase, number>;
  gatePassRates: Record<GateId, GateRate>;
  meanMinutesIdeaToVerified: number | null;
  lessonsPromoted: number;
};

function emptyRate(): GateRate {
  return { pass: 0, total: 0, rate: null };
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export function pipelineHealth(snap: {
  ideas: readonly { state: Phase; createdAt: string; updatedAt: string }[];
  specs: readonly { gates: readonly { gate: GateId; pass: boolean }[] }[];
  lessons: readonly unknown[];
}): PipelineHealth {
  const ideasByState = Object.fromEntries(PHASES.map((phase) => [phase, 0])) as Record<Phase, number>;
  for (const idea of snap.ideas) ideasByState[idea.state] += 1;

  const gatePassRates: Record<GateId, GateRate> = { G1: emptyRate(), G2: emptyRate(), G3: emptyRate() };
  for (const spec of snap.specs) {
    for (const gate of spec.gates) {
      const slot = gatePassRates[gate.gate];
      slot.total += 1;
      if (gate.pass) slot.pass += 1;
    }
  }
  for (const slot of Object.values(gatePassRates)) {
    slot.rate = slot.total === 0 ? null : round1(slot.pass / slot.total);
  }

  const minutes: number[] = [];
  for (const idea of snap.ideas) {
    if (idea.state !== "verified") continue;
    const start = Date.parse(idea.createdAt);
    const end = Date.parse(idea.updatedAt);
    if (Number.isNaN(start) || Number.isNaN(end)) continue;
    minutes.push((end - start) / 60000);
  }
  const meanMinutesIdeaToVerified =
    minutes.length === 0 ? null : round1(minutes.reduce((sum, value) => sum + value, 0) / minutes.length);

  return {
    ideasByState,
    gatePassRates,
    meanMinutesIdeaToVerified,
    lessonsPromoted: snap.lessons.length,
  };
}
