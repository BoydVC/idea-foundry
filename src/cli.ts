import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { CasConflict, CommandError } from "./domain.ts";
import { ideaId, openStore, specId } from "./store.ts";
import {
  approveIdea,
  createIdea,
  decomposeIdea,
  defaultPlanner,
  dispatchSpec,
  gateIdea,
  ingestSpec,
  listIdeas,
  nextPacket,
  parkIdea,
  parseReport,
  recordFinding,
  restateIdea,
  showIdea,
} from "./service.ts";
import { checkModel, packageRoot } from "./tlc.ts";

type Io = {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  env: NodeJS.ProcessEnv;
  cwd: string;
  now: () => string;
};

export function main(argv: string[], io: Io = realIo()): number {
  try {
    const parsed = parseArgs({
      args: argv,
      options: {
        "dry-run": { type: "boolean", default: false },
        note: { type: "string" },
        report: { type: "string" },
        pr: { type: "string" },
        data: { type: "string" },
        finding: { type: "string" },
      },
      allowPositionals: true,
      strict: true,
    });
    const command = parsed.positionals[0] ?? "help";
    if (command === "help" || command === "--help") {
      io.stdout(`${JSON.stringify({ ok: true, commands: helpCommands() }, null, 2)}\n`);
      return 0;
    }
    const dataDir = parsed.values.data ?? io.env.FOUNDRY_DATA ?? path.join(io.cwd, "data");
    const dryRun = parsed.values["dry-run"] === true;
    const store = openStore(dataDir);
    const planner = defaultPlanner();
    const now = io.now();
    if (command === "idea") {
      const title = parsed.positionals.slice(1).join(" ");
      const idea = createIdea(store, title, now, dryRun);
      emit(io, { ok: true, command, dryRun, idea });
      return 0;
    }
    if (command === "list") {
      emit(io, { ok: true, command, ideas: listIdeas(store) });
      return 0;
    }
    if (command === "show") {
      emit(io, { ok: true, command, ...showIdea(store, ideaId(required(parsed.positionals[1], "idea id"))) });
      return 0;
    }
    if (command === "restate") {
      const idea = restateIdea(store, ideaId(required(parsed.positionals[1], "idea id")), planner, dryRun);
      emit(io, { ok: true, command, dryRun, idea });
      return 0;
    }
    if (command === "approve") {
      const idea = approveIdea(
        store,
        ideaId(required(parsed.positionals[1], "idea id")),
        parsed.values.note ?? "",
        dryRun,
      );
      emit(io, { ok: true, command, dryRun, idea });
      return 0;
    }
    if (command === "decompose") {
      const specs = decomposeIdea(store, ideaId(required(parsed.positionals[1], "idea id")), planner, dryRun);
      emit(io, { ok: true, command, dryRun, specs });
      return 0;
    }
    if (command === "gate") {
      const gated = gateIdea(
        store,
        ideaId(required(parsed.positionals[1], "idea id")),
        () => checkModel("foundry.cfg", packageRoot()),
        now,
        dryRun,
      );
      emit(io, { ok: true, command, dryRun, ...gated });
      return 0;
    }
    if (command === "dispatch") {
      const packet = dispatchSpec(store, specId(required(parsed.positionals[1], "spec id")), dryRun);
      emit(io, { ok: true, command, dryRun, packet });
      return 0;
    }
    if (command === "next") {
      emit(io, { ok: true, command, packet: nextPacket(store) });
      return 0;
    }
    if (command === "ingest" || command === "record") {
      const reportPath = parsed.values.report;
      if (!reportPath) {
        throw new CommandError("Ingest needs --report.", "Pass --report path to a report file with draft and outcome lines.");
      }
      const text = fs.readFileSync(reportPath, "utf8");
      const report = parseReport(text);
      const spec = ingestSpec(
        store,
        specId(required(parsed.positionals[1], "spec id")),
        { ...report, prUrl: parsed.values.pr ?? "", reportText: text },
        dryRun,
      );
      emit(io, { ok: true, command, dryRun, spec });
      return 0;
    }
    if (command === "park") {
      const idea = parkIdea(store, ideaId(required(parsed.positionals[1], "idea id")), dryRun);
      emit(io, { ok: true, command, dryRun, idea });
      return 0;
    }
    if (command === "lesson") {
      const lesson = recordFinding(store, parsed.values.finding ?? "", now, dryRun);
      emit(io, { ok: true, command, dryRun, lesson });
      return 0;
    }
    throw new CommandError(`Unknown command ${command}.`, "Run foundry help to see commands.");
  } catch (error) {
    if (error instanceof CommandError || error instanceof CasConflict) {
      io.stderr(`${JSON.stringify({ ok: false, error: error.message, next: error.next, status: error.status }, null, 2)}\n`);
      return error.status === 409 ? 2 : 1;
    }
    if (error instanceof Error && error.message.includes("Unknown option")) {
      io.stderr(`${JSON.stringify({ ok: false, error: error.message, next: "Run foundry help to see flags." }, null, 2)}\n`);
      return 1;
    }
    const message = error instanceof Error ? error.message : "Command failed.";
    io.stderr(`${JSON.stringify({ ok: false, error: message, next: "Retry the command. If it keeps failing, check data/state.json." }, null, 2)}\n`);
    return 1;
  }
}

function emit(io: Io, payload: unknown): void {
  io.stdout(`${JSON.stringify(payload, null, 2)}\n`);
}

function required(value: string | undefined, label: string): string {
  if (!value) {
    throw new CommandError(`Missing ${label}.`, "Pass the id printed by foundry list or foundry show.");
  }
  return value;
}

function helpCommands(): string[] {
  return [
    "foundry idea <title>",
    "foundry restate <idea-id>",
    "foundry approve <idea-id> --note <text>",
    "foundry decompose <idea-id>",
    "foundry gate <idea-id>",
    "foundry dispatch <spec-id>",
    "foundry next",
    "foundry ingest <spec-id> --report <file> --pr <url>",
    "foundry record <spec-id> --report <file> --pr <url>",
    "foundry park <idea-id>",
    "foundry lesson --finding <text>",
    "foundry list",
    "foundry show <idea-id>",
  ];
}

function realIo(): Io {
  return {
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
    env: process.env,
    cwd: process.cwd(),
    now: () => new Date().toISOString(),
  };
}

const invoked = process.argv[1] ?? "";
if (invoked.endsWith(`${path.sep}cli.ts`) || invoked.endsWith(`${path.sep}cli.js`)) {
  process.exit(main(process.argv.slice(2)));
}
