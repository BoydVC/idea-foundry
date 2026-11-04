export const PHASES = [
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

export type Phase = (typeof PHASES)[number];

export const EVENTS = [
  "restate",
  "approve",
  "decompose",
  "gate_pass",
  "gate_fail",
  "dispatch",
  "verify",
  "unverify",
  "reopen",
  "reject",
  "park",
  "close",
] as const;

export type EventName = (typeof EVENTS)[number];

export const GATES = ["G1", "G2", "G3"] as const;
export type GateId = (typeof GATES)[number];

export const LAYERS = ["G0", "G1", "G2", "G3"] as const;
export type Layer = (typeof LAYERS)[number];

declare const ideaIdBrand: unique symbol;
declare const specIdBrand: unique symbol;
declare const stackIdBrand: unique symbol;
declare const lessonIdBrand: unique symbol;
declare const versionBrand: unique symbol;
declare const prUrlBrand: unique symbol;

export type IdeaId = string & { readonly [ideaIdBrand]: "IdeaId" };
export type SpecId = string & { readonly [specIdBrand]: "SpecId" };
export type StackId = string & { readonly [stackIdBrand]: "StackId" };
export type LessonId = string & { readonly [lessonIdBrand]: "LessonId" };
export type Version = number & { readonly [versionBrand]: "Version" };
export type PrUrl = string & { readonly [prUrlBrand]: "PrUrl" };

export class DomainError extends Error {
  readonly code: string;
  readonly next: string;

  constructor(code: string, message: string, next: string) {
    super(message);
    this.name = "DomainError";
    this.code = code;
    this.next = next;
  }
}

export class IllegalTransition extends DomainError {
  readonly from: Phase;
  readonly event: EventName;

  constructor(from: Phase, event: EventName) {
    super("illegal_transition", `Cannot ${event} from ${from}.`, hintFor(from));
    this.name = "IllegalTransition";
    this.from = from;
    this.event = event;
  }
}

const STATE_NEXT: Record<Phase, string> = {
  raw: "Run `foundry restate <id>`.",
  restated: "Run `foundry approve <id> --note \"...\"`.",
  approved: "Run `foundry decompose <id>`.",
  specced: "Run `foundry gate <id>`.",
  gated: "Run `foundry dispatch <spec-id>` on a gated spec.",
  dispatched: "Run `foundry ingest <spec-id> --report <file> --pr <url>` with a draft pull request.",
  verified: "Re-ingest the spec. A closed or published pull request leaves verified.",
  rejected: "Nothing to run. This record is rejected.",
  parked: "Nothing to run. This record is parked.",
};

function hintFor(from: Phase): string {
  return STATE_NEXT[from];
}

function assertNever(value: never): never {
  throw new DomainError("unhandled", `Unhandled variant ${JSON.stringify(value)}.`, "This is a bug in transition().");
}

export function transition(state: Phase, event: EventName): Phase {
  switch (event) {
    case "restate":
      switch (state) {
        case "raw":
          return "restated";
        case "restated":
        case "approved":
        case "specced":
        case "gated":
        case "dispatched":
        case "verified":
        case "rejected":
        case "parked":
          throw new IllegalTransition(state, event);
        default:
          return assertNever(state);
      }
    case "approve":
      switch (state) {
        case "restated":
          return "approved";
        case "raw":
        case "approved":
        case "specced":
        case "gated":
        case "dispatched":
        case "verified":
        case "rejected":
        case "parked":
          throw new IllegalTransition(state, event);
        default:
          return assertNever(state);
      }
    case "decompose":
      switch (state) {
        case "approved":
          return "specced";
        case "raw":
        case "restated":
        case "specced":
        case "gated":
        case "dispatched":
        case "verified":
        case "rejected":
        case "parked":
          throw new IllegalTransition(state, event);
        default:
          return assertNever(state);
      }
    case "gate_pass":
      switch (state) {
        case "specced":
          return "gated";
        case "raw":
        case "restated":
        case "approved":
        case "gated":
        case "dispatched":
        case "verified":
        case "rejected":
        case "parked":
          throw new IllegalTransition(state, event);
        default:
          return assertNever(state);
      }
    case "gate_fail":
      switch (state) {
        case "gated":
          return "specced";
        case "raw":
        case "restated":
        case "approved":
        case "specced":
        case "dispatched":
        case "verified":
        case "rejected":
        case "parked":
          throw new IllegalTransition(state, event);
        default:
          return assertNever(state);
      }
    case "dispatch":
      switch (state) {
        case "gated":
          return "dispatched";
        case "raw":
        case "restated":
        case "approved":
        case "specced":
        case "dispatched":
        case "verified":
        case "rejected":
        case "parked":
          throw new IllegalTransition(state, event);
        default:
          return assertNever(state);
      }
    case "verify":
      switch (state) {
        case "dispatched":
          return "verified";
        case "raw":
        case "restated":
        case "approved":
        case "specced":
        case "gated":
        case "verified":
        case "rejected":
        case "parked":
          throw new IllegalTransition(state, event);
        default:
          return assertNever(state);
      }
    case "unverify":
      switch (state) {
        case "verified":
          return "dispatched";
        case "raw":
        case "restated":
        case "approved":
        case "specced":
        case "gated":
        case "dispatched":
        case "rejected":
        case "parked":
          throw new IllegalTransition(state, event);
        default:
          return assertNever(state);
      }
    case "reopen":
      switch (state) {
        case "verified":
          return "gated";
        case "raw":
        case "restated":
        case "approved":
        case "specced":
        case "gated":
        case "dispatched":
        case "rejected":
        case "parked":
          throw new IllegalTransition(state, event);
        default:
          return assertNever(state);
      }
    case "reject":
      switch (state) {
        case "dispatched":
          return "rejected";
        case "raw":
        case "restated":
        case "approved":
        case "specced":
        case "gated":
        case "verified":
        case "rejected":
        case "parked":
          throw new IllegalTransition(state, event);
        default:
          return assertNever(state);
      }
    case "park":
      switch (state) {
        case "raw":
        case "restated":
        case "approved":
        case "specced":
        case "gated":
        case "dispatched":
          return "parked";
        case "verified":
        case "rejected":
        case "parked":
          throw new IllegalTransition(state, event);
        default:
          return assertNever(state);
      }
    case "close":
      switch (state) {
        case "gated":
          return "verified";
        case "raw":
        case "restated":
        case "approved":
        case "specced":
        case "dispatched":
        case "verified":
        case "rejected":
        case "parked":
          throw new IllegalTransition(state, event);
        default:
          return assertNever(state);
      }
    default:
      return assertNever(event);
  }
}

export type Edge = { from: Phase; event: EventName; to: Phase };

export function edgesOfTransition(): Edge[] {
  const edges: Edge[] = [];
  for (const event of EVENTS) {
    for (const from of PHASES) {
      try {
        edges.push({ from, event, to: transition(from, event) });
      } catch (error) {
        if (!(error instanceof IllegalTransition)) throw error;
      }
    }
  }
  return edges;
}

export function pad4(n: number): string {
  if (!Number.isInteger(n) || n < 1 || n > 9999) {
    throw new DomainError("bad_counter", `Counter ${n} is outside 1..9999.`, "Start a new data directory.");
  }
  return String(n).padStart(4, "0");
}

export function ideaIdFromCounter(n: number): IdeaId {
  return ideaId(`i-${pad4(n)}`);
}

export function stackIdForIdea(id: IdeaId): StackId {
  return stackId(`k-${id.slice(2)}`);
}

export function specIdFor(id: IdeaId, index: number): SpecId {
  if (!Number.isInteger(index) || index < 1 || index > 6) {
    throw new DomainError("bad_index", "A stack holds between 1 and 6 specs.", "Ask the planner for 2 to 6 specs.");
  }
  return specId(`s-${id.slice(2)}-${index}`);
}

export function lessonIdFromCounter(n: number): LessonId {
  return lessonId(`l-${pad4(n)}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function ideaId(raw: string): IdeaId {
  if (!/^i-\d{4}$/.test(raw)) {
    throw new DomainError("bad_idea_id", `Bad idea id ${JSON.stringify(raw)}.`, "Use an id like i-0001.");
  }
  return raw as IdeaId;
}

export function specId(raw: string): SpecId {
  if (!/^s-\d{4}-[1-6]$/.test(raw)) {
    throw new DomainError("bad_spec_id", `Bad spec id ${JSON.stringify(raw)}.`, "Use an id like s-0001-1.");
  }
  return raw as SpecId;
}

export function stackId(raw: string): StackId {
  if (!/^k-\d{4}$/.test(raw)) {
    throw new DomainError("bad_stack_id", `Bad stack id ${JSON.stringify(raw)}.`, "Use an id like k-0001.");
  }
  return raw as StackId;
}

export function lessonId(raw: string): LessonId {
  if (!/^l-\d{4}$/.test(raw)) {
    throw new DomainError("bad_lesson_id", `Bad lesson id ${JSON.stringify(raw)}.`, "Use an id like l-0001.");
  }
  return raw as LessonId;
}

export function version(raw: number): Version {
  if (!Number.isInteger(raw) || raw < 0) {
    throw new DomainError("bad_version", "Version must be a non-negative integer.", "Re-read the record and retry.");
  }
  return raw as Version;
}

const GITHUB_PULL = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/\d+$/;

export function prUrl(raw: string): PrUrl {
  if (!GITHUB_PULL.test(raw)) {
    throw new DomainError(
      "bad_pr",
      "The pull request must be an https://github.com/<owner>/<repo>/pull/<number> URL.",
      "Pass --pr https://github.com/example-org/demo-board/pull/1.",
    );
  }
  return raw as PrUrl;
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

export function parseTitle(raw: unknown): string {
  if (typeof raw !== "string" || raw.trim().length === 0 || raw.length > 200 || /[\r\n]/.test(raw)) {
    throw new DomainError(
      "bad_title",
      "The title must be one non-empty line of at most 200 characters.",
      "Try `foundry idea \"habit tracker export\"`.",
    );
  }
  if (EMAIL.test(raw) || /\d{7,}/.test(raw)) {
    throw new DomainError(
      "pii_title",
      "The title looks like contact data.",
      "Use a generic product name such as \"weather widget\".",
    );
  }
  return raw.trim();
}

export function parsePhase(raw: unknown): Phase {
  if (typeof raw === "string" && (PHASES as readonly string[]).includes(raw)) return raw as Phase;
  throw new DomainError("bad_phase", "Unknown phase.", "Use a phase from the closed state union.");
}

function parseTime(raw: unknown): string {
  if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(raw)) {
    throw new DomainError("bad_time", "A timestamp must be an ISO string.", "Leave timestamps to the store.");
  }
  return raw;
}

function parseQuestions(raw: unknown): readonly [string, string, string] {
  if (!Array.isArray(raw) || raw.length !== 3 || raw.some((item) => typeof item !== "string" || item.trim() === "")) {
    throw new DomainError("bad_questions", "A restatement carries exactly 3 questions.", "Run `foundry restate <id>` again.");
  }
  const [a, b, c] = raw as [string, string, string];
  return [a, b, c];
}

function reqString(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new DomainError("bad_field", `Missing ${key}.`, "Fill the field before changing phase.");
  }
  return value;
}

function parseLabels(raw: unknown): readonly string[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.some((item) => typeof item !== "string")) {
    throw new DomainError("bad_labels", "Labels must be strings.", "Pass a list of short strings.");
  }
  return raw as string[];
}

export type Finding = { key: string; detail: string };

export type GateResult = {
  gate: GateId;
  pass: boolean;
  findings: readonly Finding[];
};

export type IdeaBase = {
  id: IdeaId;
  version: Version;
  title: string;
  labels: readonly string[];
  createdAt: string;
  updatedAt: string;
};

export type Idea =
  | (IdeaBase & { state: "raw" })
  | (IdeaBase & { state: "restated"; restatement: string; questions: readonly [string, string, string] })
  | (IdeaBase & {
      state: "approved";
      restatement: string;
      questions: readonly [string, string, string];
      note: string;
    })
  | (IdeaBase & {
      state: "specced" | "gated";
      restatement: string;
      questions: readonly [string, string, string];
      note: string;
      stackId: StackId;
    })
  | (IdeaBase & {
      state: "verified";
      restatement: string;
      questions: readonly [string, string, string];
      note: string;
      stackId: StackId;
      draft: true;
    })
  | (IdeaBase & { state: "rejected"; reason: string })
  | (IdeaBase & { state: "dispatched"; packetPath: string })
  | (IdeaBase & { state: "parked"; parkedFrom: Exclude<Phase, "parked"> });

const SPEC_PHASES = ["specced", "gated", "dispatched", "verified", "rejected", "parked"] as const;
export type SpecPhase = (typeof SPEC_PHASES)[number];

function isSpecPhase(state: Phase): state is SpecPhase {
  return (SPEC_PHASES as readonly string[]).includes(state);
}

export type SpecBase = {
  id: SpecId;
  ideaId: IdeaId;
  stackId: StackId;
  version: Version;
  index: number;
  title: string;
  body: string;
  acceptance: readonly string[];
  touch: readonly string[];
  maxLines: number;
  landsAfter: SpecId | null;
  gates: readonly GateResult[];
  createdAt: string;
  updatedAt: string;
};

export type Spec =
  | (SpecBase & { state: "specced" })
  | (SpecBase & { state: "gated" })
  | (SpecBase & { state: "dispatched"; packetPath: string })
  | (SpecBase & { state: "verified"; packetPath: string; prUrl: PrUrl; draft: true })
  | (SpecBase & { state: "rejected"; reason: string })
  | (SpecBase & { state: "parked"; parkedFrom: Exclude<SpecPhase, "parked"> });

export type Stack = {
  id: StackId;
  ideaId: IdeaId;
  version: Version;
  specIds: readonly SpecId[];
};

export type Lesson = {
  id: LessonId;
  version: Version;
  key: string;
  detail: string;
  count: number;
  promotedTo: Layer;
  createdAt: string;
};

export type Snapshot = {
  version: Version;
  nextIdea: number;
  nextLesson: number;
  ideas: Idea[];
  specs: Spec[];
  stacks: Stack[];
  lessons: Lesson[];
  findingCounts: Record<string, number>;
};

function parseGate(raw: unknown): GateResult {
  if (!isRecord(raw)) throw new DomainError("bad_gate", "A gate result must be an object.", "Re-run `foundry gate <id>`.");
  const gate = raw.gate;
  if (gate !== "G1" && gate !== "G2" && gate !== "G3") {
    throw new DomainError("bad_gate", "Gate id must be G1, G2, or G3.", "Re-run `foundry gate <id>`.");
  }
  if (typeof raw.pass !== "boolean" || !Array.isArray(raw.findings)) {
    throw new DomainError("bad_gate", "A gate result needs pass and findings.", "Re-run `foundry gate <id>`.");
  }
  const findings: Finding[] = [];
  for (const item of raw.findings) {
    if (!isRecord(item) || typeof item.key !== "string" || typeof item.detail !== "string") {
      throw new DomainError("bad_gate", "Each finding needs a key and a detail.", "Re-run `foundry gate <id>`.");
    }
    findings.push({ key: item.key, detail: item.detail });
  }
  const pass = findings.length === 0;
  if (raw.pass !== pass) {
    throw new DomainError("bad_gate", "A gate passes only when it has no findings.", "Re-run `foundry gate <id>`.");
  }
  return { gate, pass, findings };
}

function readyForLaterPhase(spec: SpecBase): void {
  if (spec.maxLines > 400) {
    throw new DomainError("oversize", "A gated spec must stay within 400 lines.", "Split the spec before gating it.");
  }
  if (spec.acceptance.length < 1 || spec.touch.length < 1) {
    throw new DomainError(
      "incomplete_spec",
      "A gated spec needs an acceptance command and a touch map.",
      "Add both, then run `foundry gate <id>`.",
    );
  }
  if (spec.gates.length !== 3 || spec.gates.some((gate) => !gate.pass)) {
    throw new DomainError("gates_red", "G1, G2, and G3 must all pass.", "Fix the findings, then run `foundry gate <id>`.");
  }
  const ids = spec.gates.map((gate) => gate.gate);
  if (ids[0] !== "G1" || ids[1] !== "G2" || ids[2] !== "G3") {
    throw new DomainError("gates_red", "Gate results must be G1 then G2 then G3.", "Re-run `foundry gate <id>`.");
  }
}

function parseSpecBase(source: Record<string, unknown>): SpecBase {
  const index = source.index;
  if (typeof index !== "number" || !Number.isInteger(index) || index < 1 || index > 6) {
    throw new DomainError("bad_index", "Spec index must be 1..6.", "Decompose the idea again.");
  }
  const maxLines = source.maxLines;
  if (typeof maxLines !== "number" || !Number.isInteger(maxLines) || maxLines < 1) {
    throw new DomainError("bad_size", "maxLines must be a positive integer.", "Set a line budget of at most 400.");
  }
  const acceptance = source.acceptance;
  const touch = source.touch;
  if (!Array.isArray(acceptance) || acceptance.some((item) => typeof item !== "string")) {
    throw new DomainError("bad_acceptance", "Acceptance checks must be strings.", "Add a command such as node --test src/widget/model.test.ts.");
  }
  if (!Array.isArray(touch) || touch.some((item) => typeof item !== "string")) {
    throw new DomainError("bad_touch", "The touch map must be a list of paths.", "List the files this spec may change.");
  }
  const landsRaw = source.landsAfter;
  const landsAfter = landsRaw === null || landsRaw === undefined ? null : specId(String(landsRaw));
  if (index === 1 && landsAfter !== null) {
    throw new DomainError("bad_stack", "The bottom spec has no predecessor.", "Set landsAfter to null on index 1.");
  }
  if (index > 1 && landsAfter === null) {
    throw new DomainError("bad_stack", "A higher spec must name the spec below it.", "Set landsAfter to the previous spec id.");
  }
  const gatesRaw = source.gates === undefined ? [] : source.gates;
  if (!Array.isArray(gatesRaw)) {
    throw new DomainError("bad_gate", "Gates must be a list.", "Re-run `foundry gate <id>`.");
  }
  return {
    id: specId(String(source.id)),
    ideaId: ideaId(String(source.ideaId)),
    stackId: stackId(String(source.stackId)),
    version: version(Number(source.version)),
    index,
    title: parseTitle(source.title),
    body: reqString(source, "body"),
    acceptance: acceptance as string[],
    touch: touch as string[],
    maxLines,
    landsAfter,
    gates: gatesRaw.map(parseGate),
    createdAt: parseTime(source.createdAt),
    updatedAt: parseTime(source.updatedAt),
  };
}

export function parseSpec(input: unknown): Spec {
  if (!isRecord(input)) throw new DomainError("bad_spec", "Spec must be an object.", "Re-read state.json.");
  const state = parsePhase(input.state);
  if (!isSpecPhase(state)) {
    throw new DomainError("bad_spec", `A spec cannot be ${state}.`, "Create specs with `foundry decompose <id>`.");
  }
  const base = parseSpecBase(input);
  switch (state) {
    case "specced":
      return { ...base, state };
    case "gated":
      readyForLaterPhase(base);
      return { ...base, state };
    case "dispatched":
      readyForLaterPhase(base);
      return { ...base, state, packetPath: reqString(input, "packetPath") };
    case "verified":
      readyForLaterPhase(base);
      if (input.draft !== true) {
        throw new DomainError(
          "not_draft",
          "A verified spec must record draft: true.",
          "Open the pull request as a draft, then ingest again.",
        );
      }
      return {
        ...base,
        state,
        packetPath: reqString(input, "packetPath"),
        prUrl: prUrl(reqString(input, "prUrl")),
        draft: true,
      };
    case "rejected":
      return { ...base, state, reason: reqString(input, "reason") };
    case "parked": {
      const parkedFrom = parsePhase(input.parkedFrom);
      if (parkedFrom === "parked" || !(SPEC_PHASES as readonly string[]).includes(parkedFrom)) {
        throw new DomainError("bad_park", "parkedFrom must be a spec phase.", "Park the spec from its current phase.");
      }
      return { ...base, state, parkedFrom: parkedFrom as Exclude<SpecPhase, "parked"> };
    }
    default:
      return assertNever(state);
  }
}

function ideaStory(source: Record<string, unknown>): {
  restatement: string;
  questions: readonly [string, string, string];
} {
  return { restatement: reqString(source, "restatement"), questions: parseQuestions(source.questions) };
}

export function parseIdea(input: unknown): Idea {
  if (!isRecord(input)) throw new DomainError("bad_idea", "Idea must be an object.", "Re-read state.json.");
  const base: IdeaBase = {
    id: ideaId(String(input.id)),
    version: version(Number(input.version)),
    title: parseTitle(input.title),
    labels: parseLabels(input.labels),
    createdAt: parseTime(input.createdAt),
    updatedAt: parseTime(input.updatedAt),
  };
  const state = parsePhase(input.state);
  switch (state) {
    case "raw":
      return { ...base, state };
    case "restated":
      return { ...base, state, ...ideaStory(input) };
    case "approved":
      return { ...base, state, ...ideaStory(input), note: reqString(input, "note") };
    case "specced":
    case "gated":
      return { ...base, state, ...ideaStory(input), note: reqString(input, "note"), stackId: stackId(String(input.stackId)) };
    case "verified":
      if (input.draft !== true) {
        throw new DomainError(
          "not_draft",
          "A verified idea must record draft: true.",
          "Verify only draft pull requests, then close the idea.",
        );
      }
      return {
        ...base,
        state,
        ...ideaStory(input),
        note: reqString(input, "note"),
        stackId: stackId(String(input.stackId)),
        draft: true,
      };
    case "rejected":
      return { ...base, state, reason: reqString(input, "reason") };
    case "dispatched":
      return { ...base, state, packetPath: reqString(input, "packetPath") };
    case "parked": {
      const parkedFrom = parsePhase(input.parkedFrom);
      if (parkedFrom === "parked") {
        throw new DomainError("bad_park", "parkedFrom cannot be parked.", "Park the record from its current phase.");
      }
      return { ...base, state, parkedFrom };
    }
    default:
      return assertNever(state);
  }
}

export function parseStack(input: unknown): Stack {
  if (!isRecord(input) || !Array.isArray(input.specIds)) {
    throw new DomainError("bad_stack", "Stack must list spec ids.", "Run `foundry decompose <id>`.");
  }
  const specIds = input.specIds.map((item) => specId(String(item)));
  if (specIds.length < 2 || specIds.length > 6) {
    throw new DomainError("bad_stack", "A stack holds 2 to 6 specs.", "Ask the planner for 2 to 6 specs.");
  }
  return {
    id: stackId(String(input.id)),
    ideaId: ideaId(String(input.ideaId)),
    version: version(Number(input.version)),
    specIds,
  };
}

export function promote(key: string): Layer {
  if (key.startsWith("g0:")) return "G0";
  if (key.startsWith("g1:")) return "G1";
  if (key.startsWith("g2:")) return "G2";
  if (key.startsWith("g3:")) return "G3";
  throw new DomainError("bad_finding", `No gate owns ${key}.`, "Use a g0, g1, g2, or g3 finding key.");
}

export function parseLesson(input: unknown): Lesson {
  if (!isRecord(input)) throw new DomainError("bad_lesson", "Lesson must be an object.", "Record the finding twice.");
  const count = input.count;
  if (typeof count !== "number" || count < 2) {
    throw new DomainError("bad_lesson", "A lesson is recorded only after a finding repeats.", "Wait for the second occurrence.");
  }
  const key = reqString(input, "key");
  const layer = promote(key);
  if (input.promotedTo !== layer) {
    throw new DomainError("bad_lesson", "promotedTo must match the finding key.", "Promote g2 findings to G2, and the same for G0, G1, and G3.");
  }
  return {
    id: lessonId(String(input.id)),
    version: version(Number(input.version)),
    key,
    detail: reqString(input, "detail"),
    count,
    promotedTo: layer,
    createdAt: parseTime(input.createdAt),
  };
}

export function emptySnapshot(): Snapshot {
  return {
    version: version(0),
    nextIdea: 1,
    nextLesson: 1,
    ideas: [],
    specs: [],
    stacks: [],
    lessons: [],
    findingCounts: {},
  };
}

export function parseSnapshot(input: unknown): Snapshot {
  if (!isRecord(input)) throw new DomainError("bad_state", "state.json must be an object.", "Delete the data directory and start again.");
  const counts: Record<string, number> = {};
  if (input.findingCounts !== undefined) {
    if (!isRecord(input.findingCounts)) {
      throw new DomainError("bad_state", "findingCounts must be an object.", "Delete the data directory and start again.");
    }
    for (const [key, value] of Object.entries(input.findingCounts)) {
      if (typeof value !== "number" || value < 1) {
        throw new DomainError("bad_state", "finding counts must be positive integers.", "Delete the data directory and start again.");
      }
      counts[key] = value;
    }
  }
  const ideas = Array.isArray(input.ideas) ? input.ideas.map(parseIdea) : [];
  const specs = Array.isArray(input.specs) ? input.specs.map(parseSpec) : [];
  const stacks = Array.isArray(input.stacks) ? input.stacks.map(parseStack) : [];
  const lessons = Array.isArray(input.lessons) ? input.lessons.map(parseLesson) : [];
  return {
    version: version(Number(input.version ?? 0)),
    nextIdea: typeof input.nextIdea === "number" ? input.nextIdea : ideas.length + 1,
    nextLesson: typeof input.nextLesson === "number" ? input.nextLesson : lessons.length + 1,
    ideas,
    specs,
    stacks,
    lessons,
    findingCounts: counts,
  };
}

export function hasRestatement(idea: Idea): idea is Extract<Idea, { restatement: string }> {
  return idea.state === "restated" || idea.state === "approved" || idea.state === "specced" || idea.state === "gated" || idea.state === "verified";
}
