import type { State } from "./domain.ts";

export type Event =
  | { type: "restate" }
  | { type: "approve" }
  | { type: "decompose" }
  | { type: "gate_pass" }
  | { type: "gate_fail" }
  | { type: "dispatch" }
  | { type: "ingest_verified"; draft: boolean; belowVerified: boolean }
  | { type: "ingest_rejected" }
  | { type: "park" };

export type EventName = Event["type"];

export type TransitionResult =
  | { ok: true; state: State }
  | { ok: false; state: State; reason: string; next: string };

export function transition(state: State, event: Event): TransitionResult {
  coverEvent(event);
  const target = step(state, event.type);
  if (target === null) {
    return {
      ok: false,
      state,
      reason: `Cannot ${label(event.type)} from ${state}.`,
      next: hint(state),
    };
  }
  if (event.type === "ingest_verified") {
    if (!event.draft) {
      return {
        ok: false,
        state,
        reason: "Ingest refused because the PR is not a draft.",
        next: "Open a draft pull request and record it with draft: true. This program never merges.",
      };
    }
    if (!event.belowVerified) {
      return {
        ok: false,
        state,
        reason: "Ingest refused because a lower spec in the stack is not verified.",
        next: "Verify the spec below this one first. Stacks land from the bottom.",
      };
    }
  }
  return { ok: true, state: target };
}

function coverEvent(event: Event): void {
  switch (event.type) {
    case "restate":
    case "approve":
    case "decompose":
    case "gate_pass":
    case "gate_fail":
    case "dispatch":
    case "ingest_verified":
    case "ingest_rejected":
    case "park":
      return;
    default: {
      const neverEvent: never = event;
      throw new Error(`Unknown event ${String(neverEvent)}`);
    }
  }
}

function step(state: State, name: EventName): State | null {
  switch (state) {
    case "raw":
      switch (name) {
        case "restate":
          return "restated";
        case "park":
          return "parked";
        default:
          return null;
      }
    case "restated":
      switch (name) {
        case "approve":
          return "approved";
        case "park":
          return "parked";
        default:
          return null;
      }
    case "approved":
      switch (name) {
        case "decompose":
          return "specced";
        case "park":
          return "parked";
        default:
          return null;
      }
    case "specced":
      switch (name) {
        case "gate_pass":
          return "gated";
        case "park":
          return "parked";
        default:
          return null;
      }
    case "gated":
      switch (name) {
        case "gate_fail":
          return "specced";
        case "dispatch":
          return "dispatched";
        case "park":
          return "parked";
        default:
          return null;
      }
    case "dispatched":
      switch (name) {
        case "ingest_verified":
          return "verified";
        case "ingest_rejected":
          return "rejected";
        default:
          return null;
      }
    case "rejected":
      switch (name) {
        case "park":
          return "parked";
        default:
          return null;
      }
    case "verified":
      return null;
    case "parked":
      return null;
    default: {
      const neverState: never = state;
      return neverState;
    }
  }
}

function label(name: EventName): string {
  switch (name) {
    case "restate":
      return "restate";
    case "approve":
      return "approve";
    case "decompose":
      return "decompose";
    case "gate_pass":
      return "pass the gate";
    case "gate_fail":
      return "fail the gate";
    case "dispatch":
      return "dispatch";
    case "ingest_verified":
      return "record a verified pull request";
    case "ingest_rejected":
      return "record a rejected pull request";
    case "park":
      return "park";
    default: {
      const neverName: never = name;
      return neverName;
    }
  }
}

function hint(state: State): string {
  switch (state) {
    case "raw":
      return "Run foundry restate <id>.";
    case "restated":
      return 'Run foundry approve <id> --note "what to keep".';
    case "approved":
      return "Run foundry decompose <id>.";
    case "specced":
      return "Run foundry gate <id>.";
    case "gated":
      return "Run foundry dispatch <spec-id>.";
    case "dispatched":
      return "Run foundry ingest <spec-id> --report <file> --pr <draft-url>.";
    case "verified":
      return "This record is verified. Dispatch the next spec in the stack.";
    case "rejected":
      return "Leave the record rejected, or park it.";
    case "parked":
      return "Parked records stay parked. Create a new idea to continue.";
    default: {
      const neverState: never = state;
      return neverState;
    }
  }
}
