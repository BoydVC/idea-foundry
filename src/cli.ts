import { pathToFileURL } from "node:url";
import { createIdea, approve, decompose, dispatch, gate, ingest, park, probePeerReview, restate, seedDemo } from "./commands.js";
import { SEED_TITLES, FixturePlanner } from "./planner.js";
import { Store } from "./store.js";

type Flags = {
  dryRun: boolean;
  data: string;
  note?: string;
  report?: string;
  pr?: string;
  draft?: boolean;
  help: boolean;
};

function parseArgs(argv: string[]): { flags: Flags; rest: string[] } {
  const flags: Flags = { dryRun: false, data: process.env.FOUNDRY_DATA ?? "data", help: false };
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") flags.dryRun = true;
    else if (arg === "--help" || arg === "-h") flags.help = true;
    else if (arg === "--draft") flags.draft = true;
    else if (arg === "--no-draft") flags.draft = false;
    else if (arg === "--data" || arg === "--note" || arg === "--report" || arg === "--pr") {
      const value = argv[i + 1];
      if (!value) throw new Error(`Missing value for ${arg}.`);
      i += 1;
      if (arg === "--data") flags.data = value;
      if (arg === "--note") flags.note = value;
      if (arg === "--report") flags.report = value;
      if (arg === "--pr") flags.pr = value;
    } else if (arg !== undefined) rest.push(arg);
  }
  return { flags, rest };
}

const HELP = {
  ok: true,
  dryRun: false,
  data: {
    usage: [
      "foundry idea \"habit tracker export\"",
      "foundry restate i-0001",
      "foundry approve i-0001 --note \"Ship the smallest slice\"",
      "foundry decompose i-0001",
      "foundry gate i-0001",
      "foundry dispatch s-0001-1",
      "foundry ingest s-0001-1 --report report.md --pr https://example.com/demo/pull/1",
      "foundry park i-0001",
      "foundry seed",
      "foundry dashboard",
    ],
  },
};

export async function main(argv: string[]): Promise<number> {
  let flags: Flags;
  let rest: string[];
  try {
    const parsed = parseArgs(argv);
    flags = parsed.flags;
    rest = parsed.rest;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Bad arguments.";
    process.stdout.write(`${JSON.stringify({ ok: false, status: 400, error: "bad_args", message, next: "Run `foundry --help`." })}\n`);
    return 1;
  }
  if (flags.help || rest.length === 0) {
    process.stdout.write(`${JSON.stringify(HELP)}\n`);
    return flags.help || rest.length === 0 ? 0 : 1;
  }
  const [command, ...pos] = rest;
  const store = new Store(flags.data);
  const planner = new FixturePlanner();
  if (command === "dashboard") {
    const { startServer } = await import("./server.js");
    const port = Number(process.env.PORT ?? 4440);
    if (process.env.FOUNDRY_FRESH === "1") store.reset();
    const started = await startServer({ store, port, seed: process.env.FOUNDRY_SEED === "1" });
    process.stdout.write(`${JSON.stringify({ ok: true, dryRun: false, data: { url: started.url } })}\n`);
    await new Promise(() => {});
    return 0;
  }
  let result;
  try {
    switch (command) {
      case "idea":
        result = createIdea(store, pos.join(" "), flags.dryRun);
        break;
      case "restate":
        result = restate(store, pos[0] ?? "", planner, flags.dryRun);
        break;
      case "approve":
        result = approve(store, pos[0] ?? "", flags.note, flags.dryRun);
        break;
      case "decompose":
        result = decompose(store, pos[0] ?? "", planner, flags.dryRun);
        break;
      case "gate": {
        const advisory = await probePeerReview(process.env.FOUNDRY_REVIEW_URL ?? "http://127.0.0.1:4333/review", 150);
        result = gate(store, pos[0] ?? "", flags.dryRun, advisory);
        break;
      }
      case "dispatch":
        result = dispatch(store, pos[0] ?? "", flags.dryRun);
        break;
      case "ingest": {
        if (!flags.report) {
          result = { ok: false, status: 400, error: "missing_report", message: "Ingest needs a report file.", next: "Pass --report final.md." };
          break;
        }
        const text = store.readText(flags.report);
        result = ingest(store, pos[0] ?? "", text, { draft: flags.draft, pr: flags.pr }, flags.dryRun);
        break;
      }
      case "park":
        result = park(store, pos[0] ?? "", flags.dryRun);
        break;
      case "seed":
        if (flags.dryRun) {
          result = { ok: true, dryRun: true, data: { titles: SEED_TITLES } };
          break;
        }
        result = seedDemo(store, planner);
        break;
      default:
        result = { ok: false, status: 400, error: "unknown_command", message: `Unknown command ${command}.`, next: "Run `foundry --help`." };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Command failed.";
    result = { ok: false, status: 500, error: "internal", message, next: "Retry the command." };
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
  return result.ok ? 0 : 1;
}

const calledDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (calledDirectly) {
  main(process.argv.slice(2)).then((code) => {
    process.exit(code);
  });
}
