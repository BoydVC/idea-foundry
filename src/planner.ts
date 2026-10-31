export type Restatement = {
  restatement: string;
  questions: readonly [string, string, string];
};

export type SpecDraft = {
  index: number;
  title: string;
  body: string;
  acceptance: readonly string[];
  touch: readonly string[];
  maxLines: number;
};

export interface Planner {
  restate(title: string): Restatement;
  decompose(title: string): readonly SpecDraft[];
}

export const SEED_TITLES = [
  "habit tracker export",
  "weather widget",
  "trivia scoring",
  "palette mixer",
  "outline export",
] as const;

export function slug(title: string): string {
  const value = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return value.length > 0 ? value : "slice";
}

export function specCount(title: string): number {
  let sum = 0;
  for (const char of title) sum += char.charCodeAt(0);
  return 3 + (sum % 2);
}

const SLICE_NAMES = ["records", "rules", "page", "export"] as const;

function sliceGoal(title: string, name: string): string {
  if (name === "records") return `Add a typed record for ${title} and return it from the parser.`;
  if (name === "rules") return `Write the decision rules for ${title} and return the computed result.`;
  if (name === "page") return `Show ${title} on one page and write the empty state.`;
  return `Add a file export for ${title} and return the written path.`;
}

export class FixturePlanner implements Planner {
  restate(title: string): Restatement {
    return {
      restatement: `In our own words: ship the smallest checkable slice of "${title}" with synthetic data, a draft proof, and no merge.`,
      questions: [
        `Which user action ships first for "${title}"?`,
        "Which existing module must stay unchanged?",
        "Which command shows that this slice is done?",
      ],
    };
  }

  decompose(title: string): readonly SpecDraft[] {
    const count = specCount(title);
    const base = slug(title);
    const drafts: SpecDraft[] = [];
    for (let index = 1; index <= count; index += 1) {
      const name = SLICE_NAMES[index - 1] ?? "export";
      const maxLines = 80 + index * 30;
      const file = `src/${base}/${name}.ts`;
      const test = `src/${base}/${name}.test.ts`;
      const landsAfter = index === 1 ? "none" : `slice ${index - 1}`;
      drafts.push({
        index,
        title: `${title}: ${name}`,
        maxLines,
        acceptance: [`node --test ${test}`],
        touch: [file, test],
        body: [
          `# ${title} / ${name}`,
          "",
          sliceGoal(title, name),
          `Write the tests in ${test}.`,
          "Return the typed value from the exported function.",
          "",
          "Done when: the acceptance command exits 0.",
          "PII clause: synthetic data only. Do not add personal names, phone numbers, street addresses, or email addresses.",
          "Merge is forbidden. The proof is a draft PR.",
          `Changed lines: ${maxLines}.`,
          `Lands after: ${landsAfter}.`,
        ].join("\n"),
      });
    }
    return drafts;
  }
}
