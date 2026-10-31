import type { SpecText } from "./gates.ts";

export interface Restatement {
  restatement: string;
  questions: [string, string, string];
}

export interface SpecDraft extends SpecText {
  index: number;
}

export interface Planner {
  restate(title: string): Restatement;
  decompose(title: string, restatement: string): SpecDraft[];
}

interface Seed {
  title: string;
  restatement: string;
  questions: [string, string, string];
  specs: Array<Omit<SpecDraft, "body" | "piiClause" | "index"> & { vague?: boolean }>;
}

function bodyOf(draft: Omit<SpecText, "body">): string {
  return [
    `# ${draft.title}`,
    "",
    draft.summary,
    "",
    `Done when: ${draft.doneWhen}`,
    "",
    "Acceptance checks:",
    ...draft.acceptance.map((command) => `- \`${command}\``),
    "",
    "Touch map:",
    ...draft.touch.map((file) => `- ${file}`),
    "",
    `Size: at most ${draft.maxChangedLines} changed lines.`,
    "",
    `PII clause: ${draft.piiClause}`,
    "",
    "This spec does not merge. It opens a draft pull request only.",
    "",
  ].join("\n");
}

function finish(raw: Omit<SpecText, "body" | "piiClause"> & { piiClause?: string }, index: number): SpecDraft {
  const piiClause = raw.piiClause ?? "Synthetic data only. No personal data.";
  const text: Omit<SpecText, "body"> = { ...raw, piiClause };
  return { ...text, index, body: bodyOf(text) };
}

const PII = "Synthetic data only. No personal data.";

const SEEDS: Seed[] = [
  {
    title: "habit tracker export",
    restatement: "A person can export a habit log to a file and check that file with a command. Sample rows only.",
    questions: [
      "Which columns does the export include?",
      "Which command fails when a column is missing?",
      "Does the first slice include a chart?",
    ],
    specs: [
      {
        title: "Export the habit log",
        summary: "Write the sample habit log to a CSV file with a fixed header.",
        doneWhen: "the export command prints a CSV header and three sample rows.",
        acceptance: ["node scripts/export-habits.mjs"],
        touch: ["src/habits/export.ts"],
        maxChangedLines: 80,
      },
      {
        title: "Show the habit export on the screen",
        summary: "Add the export action to the habit screen and keep the sample rows visible.",
        doneWhen: "the habit screen shows the export action and the sample file name.",
        acceptance: ["npm test -- habit-export"],
        touch: ["src/habits/screen.ts"],
        maxChangedLines: 120,
      },
      {
        title: "Check the habit export",
        summary: "Add the acceptance command that fails when the CSV header drifts.",
        doneWhen: "the acceptance command fails if the header drops a column.",
        acceptance: ["npm test -- habit-accept"],
        touch: ["test/habit-export.test.ts"],
        maxChangedLines: 60,
      },
    ],
  },
  {
    title: "weather widget",
    restatement: "A weather widget shows sample readings on the dashboard. The first slice makes no live network call.",
    questions: [
      "Which sample station label stays generic?",
      "What does the widget show when the sample file is empty?",
      "Is a forecast in this stack or a later one?",
    ],
    specs: [
      {
        title: "Render the weather widget",
        summary: "Draw the widget from a sample readings file.",
        doneWhen: "the widget shows the sample temperature and the sample station label.",
        acceptance: ["npm test -- weather-render"],
        touch: ["src/weather/widget.ts"],
        maxChangedLines: 100,
      },
      {
        title: "Adjust weather widget spacing",
        summary: "Improve the weather widget spacing.",
        doneWhen: "the widget matches the spacing sample at 390 pixels wide.",
        acceptance: ["npm test -- weather-spacing"],
        touch: ["src/weather/spacing.ts"],
        maxChangedLines: 40,
      },
      {
        title: "Check the weather sample file",
        summary: "Keep the sample readings file small and generic.",
        doneWhen: "the sample file loads and contains no personal data.",
        acceptance: ["node scripts/check-weather-sample.mjs"],
        touch: ["data/weather-sample.json"],
        maxChangedLines: 30,
      },
    ],
  },
  {
    title: "trivia scoring",
    restatement: "Trivia scoring compares answers with a sample key and shows a count.",
    questions: [
      "How many sample questions are in the key?",
      "What does a wrong answer add to the score?",
      "Is a timer in this stack?",
    ],
    specs: [
      {
        title: "Score a trivia round",
        summary: "Compare a sample answer list with the sample key and return a count.",
        doneWhen: "the scorer returns 2 for the bundled sample round.",
        acceptance: ["npm test -- trivia-score"],
        touch: ["src/trivia/score.ts"],
        maxChangedLines: 90,
      },
      {
        title: "Show the trivia score",
        summary: "Place the score count on the trivia board.",
        doneWhen: "the board shows the sample score count.",
        acceptance: ["npm test -- trivia-board"],
        touch: ["src/trivia/board.ts"],
        maxChangedLines: 70,
      },
      {
        title: "Reject an unknown trivia answer",
        summary: "An answer that is not in the key does not add to the score.",
        doneWhen: "the acceptance command fails if an unknown answer increments the score.",
        acceptance: ["npm test -- trivia-reject"],
        touch: ["test/trivia-score.test.ts"],
        maxChangedLines: 50,
      },
    ],
  },
  {
    title: "reading list sync",
    restatement: "A reading list loads from a sample file and shows counts by status.",
    questions: [
      "Which statuses are in the sample?",
      "What does an empty file show?",
      "Is sharing in this stack?",
    ],
    specs: [
      {
        title: "Parse the reading list sample",
        summary: "Read the sample reading file into status rows.",
        doneWhen: "the parser returns one row per sample line.",
        acceptance: ["node scripts/parse-reading-list.mjs"],
        touch: ["src/reading/parse.ts"],
        maxChangedLines: 80,
      },
      {
        title: "Show reading status counts",
        summary: "Show how many sample rows are unread and how many are finished.",
        doneWhen: "the counts match the sample file.",
        acceptance: ["npm test -- reading-counts"],
        touch: ["src/reading/counts.ts"],
        maxChangedLines: 60,
      },
      {
        title: "Check the reading sample",
        summary: "The sample file stays generic.",
        doneWhen: "the acceptance command fails if the sample gains personal data.",
        acceptance: ["npm test -- reading-sample"],
        touch: ["test/reading-sample.test.ts"],
        maxChangedLines: 40,
      },
    ],
  },
  {
    title: "keyboard shortcut cheat sheet",
    restatement: "A cheat sheet lists sample keyboard shortcuts and stays readable at phone width.",
    questions: [
      "Which sample shortcuts are in the first slice?",
      "What is the acceptance command?",
      "Does this slice change the editor?",
    ],
    specs: [
      {
        title: "List sample keyboard shortcuts",
        summary: "Read the sample shortcut map into a list.",
        doneWhen: "the list contains every shortcut in the sample map.",
        acceptance: ["npm test -- shortcuts-list"],
        touch: ["src/shortcuts/list.ts"],
        maxChangedLines: 70,
      },
      {
        title: "Show the shortcut sheet at phone width",
        summary: "The sheet wraps on a 390 pixel screen without a page-level sideways scroll.",
        doneWhen: "the phone-width check reports no page overflow.",
        acceptance: ["npm test -- shortcuts-phone"],
        touch: ["src/shortcuts/sheet.ts"],
        maxChangedLines: 90,
      },
    ],
  },
];

function generic(title: string): { restatement: Restatement; specs: SpecDraft[] } {
  const restatement: Restatement = {
    restatement: `${title} is a small slice with synthetic sample data and a draft pull request.`,
    questions: [
      `Which screen shows ${title} first?`,
      "What is the acceptance command?",
      "What should this idea leave untouched?",
    ],
  };
  const specs = [
    finish(
      {
        title: `Define the acceptance command for ${title}`,
        summary: `Name the command that proves ${title} with sample data.`,
        doneWhen: `the command exits 0 on the bundled sample for ${title}.`,
        acceptance: ["npm test -- sample-slice"],
        touch: ["src/sample/check.ts"],
        maxChangedLines: 80,
        piiClause: PII,
      },
      1,
    ),
    finish(
      {
        title: `Show ${title} on the board`,
        summary: `Place ${title} on the board using the sample only.`,
        doneWhen: `the board shows the sample label for ${title}.`,
        acceptance: ["npm test -- sample-board"],
        touch: ["src/sample/board.ts"],
        maxChangedLines: 100,
        piiClause: PII,
      },
      2,
    ),
  ];
  return { restatement, specs };
}

export class FixturePlanner implements Planner {
  restate(title: string): Restatement {
    const seed = SEEDS.find((item) => item.title === title);
    if (!seed) return generic(title).restatement;
    return { restatement: seed.restatement, questions: seed.questions };
  }

  decompose(title: string, _restatement = ""): SpecDraft[] {
    const seed = SEEDS.find((item) => item.title === title);
    if (!seed) return generic(title).specs;
    return seed.specs.map((spec, index) =>
      finish(
        {
          title: spec.title,
          summary: spec.summary,
          doneWhen: spec.doneWhen,
          acceptance: spec.acceptance,
          touch: spec.touch,
          maxChangedLines: spec.maxChangedLines,
          piiClause: PII,
        },
        index + 1,
      ),
    );
  }
}

export const SEED_TITLES = SEEDS.map((seed) => seed.title);

export function countSeedSpecs(): number {
  return SEEDS.reduce((sum, seed) => sum + seed.specs.length, 0);
}
