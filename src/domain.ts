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

declare const ideaBrand: unique symbol;
declare const specBrand: unique symbol;

export type IdeaId = string & { readonly [ideaBrand]: "IdeaId" };
export type SpecId = string & { readonly [specBrand]: "SpecId" };

export type AcceptanceCheck = {
  command: string;
  description: string;
};

export type Idea = {
  kind: "idea";
  id: IdeaId;
  version: number;
  state: State;
  title: string;
  restatement: string | null;
  questions: [string, string, string] | null;
  note: string | null;
  createdAt: string;
};

export type Spec = {
  kind: "spec";
  id: SpecId;
  ideaId: IdeaId;
  version: number;
  state: State;
  order: number;
  title: string;
  doneWhen: string;
  body: string;
  acceptance: AcceptanceCheck[];
  touchMap: string[];
  maxChangedLines: number;
  piiClause: string;
  draftPr: boolean | null;
  prUrl: string | null;
  reportExcerpt: string | null;
};

export type GateId = "G1" | "G2" | "G3";

export type GateResult = {
  specId: SpecId;
  gate: GateId;
  pass: boolean;
  reasons: string[];
  at: string;
};

export type Lesson = {
  id: string;
  finding: string;
  count: number;
  encodedAs: "G2";
  at: string;
};

export type Finding = {
  text: string;
  count: number;
};

export type Packet = {
  protocol: "dd.intake/v1";
  op: "intake";
  id: SpecId;
  ideaId: IdeaId;
  title: string;
  order: number;
  dependsOn: SpecId | null;
  stack: SpecId[];
  specMarkdown: string;
  acceptance: AcceptanceCheck[];
  touchMap: string[];
  maxChangedLines: number;
  piiClause: string;
  doneWhen: string;
  constraints: {
    draftOnly: true;
    noMerge: true;
    noDeploy: true;
  };
};

export type TlcCache = {
  ok: boolean;
  detail: string;
  at: string;
};

export type Snapshot = {
  version: number;
  nextIdea: number;
  ideas: Idea[];
  specs: Spec[];
  gates: GateResult[];
  lessons: Lesson[];
  findings: Finding[];
  bannedPhrases: string[];
  packets: Packet[];
  tlc: TlcCache | null;
};

export function emptySnapshot(): Snapshot {
  return {
    version: 0,
    nextIdea: 1,
    ideas: [],
    specs: [],
    gates: [],
    lessons: [],
    findings: [],
    bannedPhrases: [],
    packets: [],
    tlc: null,
  };
}

export class CommandError extends Error {
  readonly name = "CommandError";
  readonly next: string;
  readonly status: number;

  constructor(message: string, next: string, status = 400) {
    super(message);
    this.next = next;
    this.status = status;
  }
}

export class CasConflict extends Error {
  readonly name = "CasConflict";
  readonly status = 409;
  readonly next = "Re-read state and retry the command with the current version.";
  readonly expected: number;
  readonly actual: number;

  constructor(expected: number, actual: number) {
    super(`Compare-and-swap failed. Expected version ${expected}, current version is ${actual}.`);
    this.expected = expected;
    this.actual = actual;
  }
}
