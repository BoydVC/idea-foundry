import type { Packet, Spec, SpecId } from "./domain.ts";

export function buildPacket(spec: Spec, stack: readonly Spec[]): Packet {
  const ordered = [...stack].sort((a, b) => a.order - b.order);
  const below = ordered.find((item) => item.order === spec.order - 1) ?? null;
  return {
    protocol: "dd.intake/v1",
    op: "intake",
    id: spec.id,
    ideaId: spec.ideaId,
    title: spec.title,
    order: spec.order,
    dependsOn: below ? below.id : null,
    stack: ordered.map((item) => item.id),
    specMarkdown: spec.body,
    acceptance: spec.acceptance,
    touchMap: spec.touchMap,
    maxChangedLines: spec.maxChangedLines,
    piiClause: spec.piiClause,
    doneWhen: spec.doneWhen,
    constraints: { draftOnly: true, noMerge: true, noDeploy: true },
  };
}

export function packetReady(specId: SpecId, packets: readonly Packet[]): Packet | null {
  return packets.find((packet) => packet.id === specId) ?? null;
}
