export const STATES = [
  "raw",
  "restated",
  "approved",
  "specced",
  "gated",
  "dispatched",
  "verified",
  "rejected",
  "parked",
] as const;

export type State = (typeof STATES)[number];

export const EVENT_TYPES = [
  "restate",
  "approve",
  "decompose",
  "gate_pass",
  "gate_fail",
  "dispatch",
  "verify_draft",
  "reject_draft",
  "park",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export type Event = { readonly type: EventType };

export type IdeaId = string & { readonly __brand: "IdeaId" };
export type SpecId = string & { readonly __brand: "SpecId" };

type Row = { readonly [E in EventType]: State | null };

export const NEXT: { readonly [S in State]: Row } = {
  raw: {
    restate: "restated",
    approve: null,
    decompose: null,
    gate_pass: null,
    gate_fail: null,
    dispatch: null,
    verify_draft: null,
    reject_draft: null,
    park: "parked",
  },
  restated: {
    restate: null,
    approve: "approved",
    decompose: null,
    gate_pass: null,
    gate_fail: null,
    dispatch: null,
    verify_draft: null,
    reject_draft: null,
    park: "parked",
  },
  approved: {
    restate: null,
    approve: null,
    decompose: "specced",
    gate_pass: null,
    gate_fail: null,
    dispatch: null,
    verify_draft: null,
    reject_draft: null,
    park: "parked",
  },
  specced: {
    restate: null,
    approve: null,
    decompose: null,
    gate_pass: "gated",
    gate_fail: "specced",
    dispatch: null,
    verify_draft: null,
    reject_draft: null,
    park: "parked",
  },
  gated: {
    restate: null,
    approve: null,
    decompose: null,
    gate_pass: "gated",
    gate_fail: "specced",
    dispatch: "dispatched",
    verify_draft: null,
    reject_draft: null,
    park: "parked",
  },
  dispatched: {
    restate: null,
    approve: null,
    decompose: null,
    gate_pass: null,
    gate_fail: null,
    dispatch: null,
    verify_draft: "verified",
    reject_draft: "rejected",
    park: "parked",
  },
  verified: {
    restate: null,
    approve: null,
    decompose: null,
    gate_pass: null,
    gate_fail: null,
    dispatch: null,
    verify_draft: null,
    reject_draft: null,
    park: null,
  },
  rejected: {
    restate: null,
    approve: null,
    decompose: null,
    gate_pass: null,
    gate_fail: null,
    dispatch: null,
    verify_draft: null,
    reject_draft: null,
    park: null,
  },
  parked: {
    restate: null,
    approve: null,
    decompose: null,
    gate_pass: null,
    gate_fail: null,
    dispatch: null,
    verify_draft: null,
    reject_draft: null,
    park: null,
  },
};

const HINT: { readonly [S in State]: string } = {
  raw: "Run foundry restate <id>.",
  restated: "Run foundry approve <id> --note \"your decision\".",
  approved: "Run foundry decompose <id>.",
  specced: "Run foundry gate <id>.",
  gated: "Run foundry dispatch <spec-id>.",
  dispatched: "Run foundry ingest <spec-id> --report <file> --pr <draft-pr-url>.",
  verified: "This record is verified. Add a new idea for the next slice.",
  rejected: "This record is rejected. Add a new idea if you want another pass.",
  parked: "This record is parked. Add a new idea if you want to continue.",
};

export interface TransitionOk {
  ok: true;
  state: State;
}

export interface TransitionNo {
  ok: false;
  error: string;
  next: string;
  status: number;
}

export function transition(state: State, event: Event): TransitionOk | TransitionNo {
  const to = NEXT[state][event.type];
  if (to === null) {
    return {
      ok: false,
      error: `Cannot ${label(event.type)} from ${state}.`,
      next: HINT[state],
      status: 400,
    };
  }
  return { ok: true, state: to };
}

export function edges(): { from: State; to: State; label: EventType }[] {
  const out: { from: State; to: State; label: EventType }[] = [];
  for (const from of STATES) {
    for (const labelName of EVENT_TYPES) {
      const to = NEXT[from][labelName];
      if (to !== null) out.push({ from, to, label: labelName });
    }
  }
  return out;
}

export function isState(value: unknown): value is State {
  return typeof value === "string" && (STATES as readonly string[]).includes(value);
}

export function isIdeaId(value: unknown): value is IdeaId {
  return typeof value === "string" && /^i-\d{4}$/.test(value);
}

export function isSpecId(value: unknown): value is SpecId {
  return typeof value === "string" && /^s-\d{4}-\d+$/.test(value);
}

export function ideaId(n: number): IdeaId {
  if (!Number.isInteger(n) || n < 1 || n > 9999) {
    throw new Error(`Idea number ${n} is out of range.`);
  }
  return `i-${String(n).padStart(4, "0")}` as IdeaId;
}

export function specId(idea: IdeaId, index: number): SpecId {
  if (!Number.isInteger(index) || index < 1 || index > 6) {
    throw new Error(`Stack index ${index} must be from 1 to 6.`);
  }
  return `s-${idea.slice(2)}-${index}` as SpecId;
}

export function ideaNumber(id: IdeaId): number {
  return Number(id.slice(2));
}

function label(event: EventType): string {
  return event.replaceAll("_", " ");
}

export interface GateResult {
  gate: "G1" | "G2" | "G3";
  pass: boolean;
  reasons: string[];
  codes: string[];
  advisory?: string;
}

export interface Idea {
  id: IdeaId;
  version: number;
  state: State;
  title: string;
  restatement: string | null;
  questions: string[];
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Spec {
  id: SpecId;
  ideaId: IdeaId;
  index: number;
  version: number;
  state: State;
  title: string;
  summary: string;
  doneWhen: string;
  acceptance: string[];
  touch: string[];
  maxChangedLines: number;
  piiClause: string;
  body: string;
  gates: GateResult[];
  prUrl: string | null;
  draft: boolean | null;
}

export interface Lesson {
  id: string;
  version: number;
  code: string;
  detail: string;
  gate: "G1" | "G2" | "G3";
  check: string;
  count: number;
  createdAt: string;
}

export interface Finding {
  code: string;
  detail: string;
  at: string;
  specId: SpecId;
}

export interface Snapshot {
  version: number;
  ideas: Idea[];
  specs: Spec[];
  lessons: Lesson[];
  findings: Finding[];
}

export function emptySnapshot(): Snapshot {
  return { version: 0, ideas: [], specs: [], lessons: [], findings: [] };
}
