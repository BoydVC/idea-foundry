import type { AcceptanceCheck, IdeaId, SpecId } from "./domain.ts";

export type PlannedSpec = {
  order: number;
  id: SpecId;
  title: string;
  doneWhen: string;
  body: string;
  acceptance: AcceptanceCheck[];
  touchMap: string[];
  maxChangedLines: number;
  piiClause: string;
};

export type Restatement = {
  restatement: string;
  questions: [string, string, string];
};

export type Planner = {
  restate(title: string): Restatement;
  decompose(title: string, ideaId: IdeaId): PlannedSpec[];
};

const PII = "Synthetic data only. No personal names, contact details, or locations.";

type SeedSpec = {
  title: string;
  doneWhen: string;
  summary: string;
  command: string;
  description: string;
  touch: string[];
  lines: number;
};

const SEEDS: Record<string, SeedSpec[]> = {
  "habit tracker export": [
    {
      title: "Read the fixture log",
      doneWhen: "the reader returns three synthetic habit rows from the fixture file.",
      summary: "Add a reader that loads the checked-in habit fixture.",
      command: "node -e \"process.exit(0)\"",
      description: "The reader exits 0 on the fixture log.",
      touch: ["src/habits/read.ts"],
      lines: 80,
    },
    {
      title: "Write the export file",
      doneWhen: "the writer saves a JSON export with one object per fixture row.",
      summary: "Add a writer that stores the export next to the fixture.",
      command: "node -e \"process.exit(0)\"",
      description: "The writer exits 0 after saving the export.",
      touch: ["src/habits/write.ts"],
      lines: 90,
    },
    {
      title: "Show the export summary",
      doneWhen: "the summary command prints the row count from the export file.",
      summary: "Add a command that prints the export count.",
      command: "node -e \"process.exit(0)\"",
      description: "The summary command exits 0.",
      touch: ["src/habits/summary.ts"],
      lines: 70,
    },
  ],
  "weather widget": [
    {
      title: "Load the sample forecast",
      doneWhen: "the loader returns the synthetic forecast fixture for one place label.",
      summary: "Add a loader for the forecast fixture.",
      command: "node -e \"process.exit(0)\"",
      description: "The loader exits 0 on the fixture.",
      touch: ["src/weather/load.ts"],
      lines: 80,
    },
    {
      title: "Render the forecast card",
      doneWhen: "the card shows the fixture temperature and the sample condition word.",
      summary: "Add a card renderer for the forecast fixture.",
      command: "node -e \"process.exit(0)\"",
      description: "The renderer exits 0.",
      touch: ["public/weather-card.ts"],
      lines: 120,
    },
    {
      title: "Refresh from the fixture",
      doneWhen: "a second load returns the same fixture values as the first load.",
      summary: "Add a refresh path that reloads the fixture.",
      command: "node -e \"process.exit(0)\"",
      description: "The refresh check exits 0.",
      touch: ["src/weather/refresh.ts"],
      lines: 60,
    },
  ],
  "trivia scoring": [
    {
      title: "Score one answer",
      doneWhen: "a matching answer adds one point and a miss adds zero.",
      summary: "Add a scorer for a single synthetic question.",
      command: "node -e \"process.exit(0)\"",
      description: "The scorer exits 0.",
      touch: ["src/trivia/score.ts"],
      lines: 70,
    },
    {
      title: "Total a round",
      doneWhen: "the round total equals the sum of the per-answer points.",
      summary: "Add a round total over the fixture answers.",
      command: "node -e \"process.exit(0)\"",
      description: "The round check exits 0.",
      touch: ["src/trivia/round.ts"],
      lines: 80,
    },
    {
      title: "Sort the score list",
      doneWhen: "the score list is ordered from the highest total to the lowest.",
      summary: "Add a sort over synthetic player labels.",
      command: "node -e \"process.exit(0)\"",
      description: "The sort check exits 0.",
      touch: ["src/trivia/sort.ts"],
      lines: 50,
    },
  ],
  "markdown note export": [
    {
      title: "Parse the note fixture",
      doneWhen: "the parser returns the heading and body from the fixture note.",
      summary: "Add a parser for one synthetic markdown note.",
      command: "node -e \"process.exit(0)\"",
      description: "The parser exits 0.",
      touch: ["src/notes/parse.ts"],
      lines: 90,
    },
    {
      title: "List note headings",
      doneWhen: "the list command prints each fixture heading on its own line.",
      summary: "Add a heading list for the fixture notes.",
      command: "node -e \"process.exit(0)\"",
      description: "The list command exits 0.",
      touch: ["src/notes/list.ts"],
      lines: 60,
    },
    {
      title: "Write the note bundle",
      doneWhen: "the bundle file contains every fixture note in list order.",
      summary: "Add a writer that stores the note bundle.",
      command: "node -e \"process.exit(0)\"",
      description: "The bundle writer exits 0.",
      touch: ["src/notes/bundle.ts"],
      lines: 100,
    },
  ],
  "kitchen timer": [
    {
      title: "Store a timer preset",
      doneWhen: "saving a preset returns the same minute count on the next read.",
      summary: "Add storage for one synthetic timer preset.",
      command: "node -e \"process.exit(0)\"",
      description: "The preset check exits 0.",
      touch: ["src/timer/preset.ts"],
      lines: 70,
    },
    {
      title: "Count down a preset",
      doneWhen: "the countdown reaches zero and prints a single done line.",
      summary: "Add a countdown that uses the stored preset.",
      command: "node -e \"process.exit(0)\"",
      description: "The countdown check exits 0.",
      touch: ["src/timer/count.ts"],
      lines: 80,
    },
  ],
};

export const SEED_TITLES = Object.keys(SEEDS);

export const fixturePlanner: Planner = {
  restate(title: string): Restatement {
    const clean = title.trim();
    return {
      restatement: `Build ${clean} as a small offline tool that loads synthetic sample rows and prints a checkable result.`,
      questions: [
        `Which output file should ${clean} write?`,
        `Which sample rows should ${clean} load from the fixture?`,
        `Which command should prove ${clean} finished?`,
      ],
    };
  },
  decompose(title: string, idea: IdeaId): PlannedSpec[] {
    const seed = SEEDS[title.trim()] ?? genericSeed(title.trim());
    return seed.map((item, index) => materialize(item, idea, index + 1));
  },
};

function genericSeed(title: string): SeedSpec[] {
  return [
    {
      title: `Store sample rows for ${title}`,
      doneWhen: `the store returns the synthetic rows for ${title} after a reload.`,
      summary: `Add storage for the ${title} fixture rows.`,
      command: "node -e \"process.exit(0)\"",
      description: "The storage check exits 0.",
      touch: ["src/sample/store.ts"],
      lines: 90,
    },
    {
      title: `Print a summary for ${title}`,
      doneWhen: `the summary command prints the row count for ${title}.`,
      summary: `Add a summary command for ${title}.`,
      command: "node -e \"process.exit(0)\"",
      description: "The summary check exits 0.",
      touch: ["src/sample/summary.ts"],
      lines: 70,
    },
  ];
}

function materialize(item: SeedSpec, idea: IdeaId, order: number): PlannedSpec {
  const id = specIdFor(idea, order);
  const body = [item.summary, "", `This spec is done when ${item.doneWhen}`, "", PII].join("\n");
  return {
    order,
    id,
    title: item.title,
    doneWhen: item.doneWhen,
    body,
    acceptance: [{ command: item.command, description: item.description }],
    touchMap: item.touch,
    maxChangedLines: item.lines,
    piiClause: PII,
  };
}

export function specIdFor(idea: IdeaId, order: number): SpecId {
  return `s-${idea.slice(2)}-${order}` as SpecId;
}
