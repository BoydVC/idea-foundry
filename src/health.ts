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
  meanMinutesSpecToVerified: number | null;
  specsVerified: number;
  specsRejected: number;
  ideasInProgress: number;
  lessonsPromoted: number;
};

function emptyRate(): GateRate {
  return { pass: 0, total: 0, rate: null };
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export function pipelineHealth(snap: {
  ideas: readonly { id?: string; state: Phase; createdAt: string; updatedAt: string }[];
  specs: readonly { ideaId?: string; state?: string; createdAt?: string; updatedAt?: string; gates: readonly { gate: GateId; pass: boolean }[] }[];
  lessons: readonly unknown[];
}): PipelineHealth {
  const ideasByState = Object.fromEntries(PHASES.map((phase) => [phase, 0])) as Record<Phase, number>;
  for (const idea of snap.ideas) ideasByState[idea.state] += 1;

  const gatePassRates: Record<GateId, GateRate> = { G0: emptyRate(), G1: emptyRate(), G2: emptyRate(), G3: emptyRate() };
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

  let specsVerified = 0;
  let specsRejected = 0;
  const specMinutes: number[] = [];
  for (const spec of snap.specs) {
    if (spec.state === "verified") specsVerified += 1;
    if (spec.state === "rejected") specsRejected += 1;
    if (spec.state !== "verified" || spec.createdAt === undefined || spec.updatedAt === undefined) continue;
    const start = Date.parse(spec.createdAt);
    const end = Date.parse(spec.updatedAt);
    if (Number.isNaN(start) || Number.isNaN(end)) continue;
    specMinutes.push((end - start) / 60000);
  }
  const meanMinutesSpecToVerified =
    specMinutes.length === 0 ? null : round1(specMinutes.reduce((sum, value) => sum + value, 0) / specMinutes.length);

  let ideasInProgress = 0;
  for (const idea of snap.ideas) {
    if (idea.state !== "gated" || !idea.id) continue;
    const family = snap.specs.filter((spec) => spec.ideaId === idea.id);
    if (family.length === 0) continue;
    const moving = family.some((spec) => spec.state === "verified" || spec.state === "dispatched");
    const settled = family.every((spec) => spec.state === "verified");
    if (moving && !settled) ideasInProgress += 1;
  }

  return {
    ideasByState,
    gatePassRates,
    meanMinutesIdeaToVerified,
    meanMinutesSpecToVerified,
    specsVerified,
    specsRejected,
    ideasInProgress,
    lessonsPromoted: snap.lessons.length,
  };
}

export type WeeklyReport = {
  since: string;
  ideasMoved: number;
  specsVerified: number;
  localDraftPrs: number;
  targetOpenDrafts: number | null;
  staleDispatched: number;
};

const DAY_MS = 86_400_000;

export function weeklyDigest(
  snap: {
    ideas: readonly { state: string; createdAt: string; updatedAt: string }[];
    specs: readonly { state: string; updatedAt: string; draft?: boolean }[];
  },
  since: string,
  targetOpenDrafts: number | null = null,
): WeeklyReport {
  const start = Date.parse(`${since}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(since) || Number.isNaN(start)) {
    throw new Error(`Bad since date ${since}.`);
  }
  const staleBefore = start - 7 * DAY_MS;
  let ideasMoved = 0;
  for (const idea of snap.ideas) {
    const updated = Date.parse(idea.updatedAt);
    if (idea.state !== "raw" && !Number.isNaN(updated) && updated >= start) ideasMoved += 1;
  }
  let specsVerified = 0;
  let localDraftPrs = 0;
  let staleDispatched = 0;
  for (const spec of snap.specs) {
    const updated = Date.parse(spec.updatedAt);
    if (spec.state === "verified" && spec.draft === true) localDraftPrs += 1;
    if (spec.state === "verified" && !Number.isNaN(updated) && updated >= start) specsVerified += 1;
    if (spec.state === "dispatched" && !Number.isNaN(updated) && updated < staleBefore) staleDispatched += 1;
  }
  return { since, ideasMoved, specsVerified, localDraftPrs, targetOpenDrafts, staleDispatched };
}
