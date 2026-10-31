import { DomainError } from "../domain.js";
import { FixturePlanner, sketchFor, slug, type Planner, type Restatement, type SpecDraft } from "../planner.js";

export type RecordedResponse = {
  goal: string;
  problem: string;
  smallestChange: string;
  doneWhen: string;
  questions: readonly [string, string, string];
  slices: readonly string[];
};

export type RecordedBook = Record<string, RecordedResponse>;

function sliceFile(title: string, name: string): { file: string; test: string } {
  const base = slug(title);
  const safe = name.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "") || "slice";
  return { file: `src/${base}/${safe}.ts`, test: `src/${base}/${safe}.test.ts` };
}

export function recordedComplete(book: RecordedBook): (title: string) => RecordedResponse {
  return (title) => {
    const found = book[title];
    if (!found) {
      throw new DomainError("bad_plan", `No recorded plan for "${title}".`, "Add that title to the planner record, or use FOUNDRY_PLANNER=fixture.");
    }
    return found;
  };
}

export function composePlan(title: string): RecordedResponse {
  const words = title
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 2);
  const first = words[0] ?? "slice";
  const second = words[1] ?? "view";
  const third = words[2] ?? "check";
  return {
    goal: `Ship the smallest checkable slice of ${title}.`,
    problem: `${title} has no typed boundary a runner can implement.`,
    smallestChange: `Add the ${first} types and one ${second} behavior, with synthetic data only.`,
    doneWhen: `node --test exits 0 for the ${first} slice.`,
    questions: [
      `Which user action ships first for "${title}"?`,
      "Which existing module must stay unchanged?",
      "Which command shows that this slice is done?",
    ],
    slices: [`${first}-types`, `${second}-model`, `${third}-check`],
  };
}

export class AgentPlanner implements Planner {
  private readonly cache = new Map<string, RecordedResponse>();

  constructor(private readonly complete: (title: string) => RecordedResponse) {}

  private plan(title: string): RecordedResponse {
    const hit = this.cache.get(title);
    if (hit) return hit;
    const next = this.complete(title);
    if (next.questions.length !== 3) {
      throw new DomainError("bad_plan", "The planner must return 3 questions.", "Record goal, problem, and done-when with 3 questions.");
    }
    if (next.slices.length < 2 || next.slices.length > 6) {
      throw new DomainError("bad_plan", "The planner must return 2 to 6 slices.", "Record between 2 and 6 slice names.");
    }
    this.cache.set(title, next);
    return next;
  }

  restate(title: string): Restatement {
    const plan = this.plan(title);
    return {
      restatement: [
        `Goal: ${plan.goal}`,
        `Problem: ${plan.problem}`,
        `Smallest change: ${plan.smallestChange}`,
        `Done when: ${plan.doneWhen}`,
      ].join("\n"),
      questions: plan.questions,
    };
  }

  decompose(title: string): readonly SpecDraft[] {
    const plan = this.plan(title);
    return plan.slices.map((name, offset) => {
      const index = offset + 1;
      const paths = sliceFile(title, name);
      const maxLines = 80 + index * 30;
      const landsAfter = index === 1 ? "none" : `slice ${index - 1}`;
      return {
        index,
        title: `${title}: ${name}`,
        maxLines,
        acceptance: [`node --test ${paths.test}`],
        touch: [paths.file, paths.test],
        sketch: sketchFor(title, name),
        body: [
          `# ${title} / ${name}`,
          "",
          `Goal: ${plan.goal}`,
          `Problem: ${plan.problem}`,
          `Smallest change: ${plan.smallestChange}`,
          `Write the tests in ${paths.test}.`,
          "Return the typed value from the exported function.",
          "",
          "Done when: the acceptance command exits 0.",
          "PII clause: synthetic data only. Do not add personal names, phone numbers, street addresses, or email addresses.",
          "Merge is forbidden. The proof is a draft PR.",
          `Changed lines: ${maxLines}.`,
          `Lands after: ${landsAfter}.`,
        ].join("\n"),
      };
    });
  }
}

export function selectPlanner(env: NodeJS.ProcessEnv = process.env, readText?: (path: string) => string): Planner {
  const mode = env.FOUNDRY_PLANNER ?? "fixture";
  if (mode === "fixture" || mode === "") return new FixturePlanner();
  if (mode === "agent") {
    const record = env.FOUNDRY_PLANNER_RECORD;
    if (record && readText) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(readText(record));
      } catch {
        throw new DomainError("bad_plan", "The planner record is not JSON.", "Point FOUNDRY_PLANNER_RECORD at a JSON object of recorded responses.");
      }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new DomainError("bad_plan", "The planner record must be an object keyed by idea title.", "Use the fixtures/planner-records.json shape.");
      }
      return new AgentPlanner(recordedComplete(parsed as RecordedBook));
    }
    return new AgentPlanner(composePlan);
  }
  throw new DomainError("bad_planner", `Unknown FOUNDRY_PLANNER ${JSON.stringify(mode)}.`, "Set FOUNDRY_PLANNER to fixture or agent.");
}
