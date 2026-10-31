import type { Spec } from "./domain.ts";

export interface ArenaPacket {
  kind: "foundry.arena-packet";
  version: 1;
  specId: string;
  ideaId: string;
  intake: {
    ts: string;
    idea: string;
    source: "foundry";
    target: string;
    n: 3;
    offset: number;
  };
  spec: {
    title: string;
    body: string;
    acceptance: string[];
    touch: string[];
    maxChangedLines: number;
    doneWhen: string;
    piiClause: string;
    index: number;
  };
  draftOnly: true;
}

export interface InboxLine {
  ts: string;
  idea: string;
  source: "foundry";
  target: string;
  n: 3;
  offset: number;
}

const TARGET = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export function parseTarget(value: string): string | null {
  const target = value.trim();
  return TARGET.test(target) ? target : null;
}

export function buildPacket(spec: Spec, target: string, ts: string, offset: number): ArenaPacket {
  return {
    kind: "foundry.arena-packet",
    version: 1,
    specId: spec.id,
    ideaId: spec.ideaId,
    intake: {
      ts,
      idea: `${spec.title}. Done when: ${spec.doneWhen}`,
      source: "foundry",
      target,
      n: 3,
      offset,
    },
    spec: {
      title: spec.title,
      body: spec.body,
      acceptance: spec.acceptance,
      touch: spec.touch,
      maxChangedLines: spec.maxChangedLines,
      doneWhen: spec.doneWhen,
      piiClause: spec.piiClause,
      index: spec.index,
    },
    draftOnly: true,
  };
}

export function inboxLine(packet: ArenaPacket): InboxLine {
  return { ...packet.intake };
}

export function samePacket(left: ArenaPacket, right: ArenaPacket): boolean {
  return JSON.stringify({ ...left, intake: { ...left.intake, ts: "", offset: 0 } }) ===
    JSON.stringify({ ...right, intake: { ...right.intake, ts: "", offset: 0 } });
}
