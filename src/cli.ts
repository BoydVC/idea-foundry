#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createFoundry, type CallOpts, type Result } from "./service.ts";
import { startServer } from "./server.ts";

interface Flags {
  [key: string]: string | boolean;
}

const HELP = {
  ok: true,
  commands: [
    "idea <title>",
    "restate <id>",
    "approve <id> --note <text>",
    "decompose <id>",
    "gate <id>",
    "dispatch <spec-id> [--target owner/repo]",
    "ingest <spec-id> --report <file> --pr <url>",
    "park <id>",
    "seed",
    "state",
    "show <id>",
    "list",
    "serve [--port 4440]",
  ],
};

function parseArgs(argv: string[]): { positional: string[]; flags: Flags } {
  const positional: string[] = [];
  const flags: Flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg?.startsWith("--")) {
      if (arg) positional.push(arg);
      continue;
    }
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) flags[key] = true;
    else {
      flags[key] = next;
      index += 1;
    }
  }
  return { positional, flags };
}

function flag(flags: Flags, key: string): string | undefined {
  const value = flags[key];
  return typeof value === "string" ? value : undefined;
}

function opts(flags: Flags): CallOpts {
  const version = flag(flags, "version");
  const record = flag(flags, "record-version");
  return {
    dryRun: flags["dry-run"] === true,
    ...(version !== undefined ? { expectedVersion: Number(version) } : {}),
    ...(record !== undefined ? { recordVersion: Number(record) } : {}),
  };
}

function emit(result: Result | { ok: true; commands: string[] } | unknown): void {
  console.log(JSON.stringify(result));
}

async function main(): Promise<void> {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const command = positional[0];
  if (!command) {
    emit(HELP);
    return;
  }
  const dataDir = resolve(flag(flags, "data") || process.env.FOUNDRY_DATA_DIR || "data");
  const foundry = createFoundry(dataDir, { reviewUrl: process.env.FOUNDRY_REVIEW_URL });
  const call = opts(flags);
  if (command === "serve") {
    const port = Number(flag(flags, "port") || process.env.PORT || 4440);
    if (flags.seed === true) {
      const seeded = await foundry.seed();
      if (!seeded.ok) {
        emit(seeded);
        process.exitCode = 1;
        return;
      }
    }
    const running = await startServer({ dataDir, port, reviewUrl: process.env.FOUNDRY_REVIEW_URL });
    emit({ ok: true, url: running.url, port: running.port, dataDir });
    return;
  }
  const id = positional[1];
  let result: Result;
  if (command === "idea") {
    const title = positional.slice(1).join(" ").trim();
    if (!title) {
      emit({ ok: false, error: "Pass an idea title.", next: "Run foundry idea \"habit tracker export\".", status: 400 });
      process.exitCode = 1;
      return;
    }
    result = await foundry.idea(title, call);
  } else if (command === "restate") {
    if (!id) return missing("restate");
    result = await foundry.restate(id, call);
  } else if (command === "approve") {
    if (!id) return missing("approve");
    const note = flag(flags, "note");
    if (!note) {
      emit({ ok: false, error: "Approve needs a note.", next: "Run foundry approve <id> --note \"your decision\".", status: 400 });
      process.exitCode = 1;
      return;
    }
    result = await foundry.approve(id, note, call);
  } else if (command === "decompose") {
    if (!id) return missing("decompose");
    result = await foundry.decompose(id, call);
  } else if (command === "gate") {
    if (!id) return missing("gate");
    result = await foundry.gate(id, call);
  } else if (command === "dispatch") {
    if (!id) return missing("dispatch");
    result = await foundry.dispatch(id, { ...call, ...(flag(flags, "target") ? { target: flag(flags, "target") } : {}) });
  } else if (command === "ingest") {
    if (!id) return missing("ingest");
    const reportPath = flag(flags, "report");
    const pr = flag(flags, "pr");
    if (!reportPath || !pr) {
      emit({
        ok: false,
        error: "Ingest needs a report and a pull request URL.",
        next: "Run foundry ingest <spec-id> --report <file> --pr <draft-pr-url>.",
        status: 400,
      });
      process.exitCode = 1;
      return;
    }
    const report = await readFile(reportPath, "utf8");
    result = await foundry.ingest(id, report, pr, call);
  } else if (command === "park") {
    if (!id) return missing("park");
    result = await foundry.park(id, call);
  } else if (command === "seed") {
    result = await foundry.seed(call);
  } else if (command === "state" || command === "list") {
    emit({ ok: true, ...(await foundry.state()) });
    return;
  } else if (command === "show") {
    if (!id) return missing("show");
    const snapshot = await foundry.state();
    const idea = snapshot.ideas.find((item) => item.id === id);
    const spec = snapshot.specs.find((item) => item.id === id);
    if (!idea && !spec) {
      emit({ ok: false, error: `Unknown id ${id}.`, next: "Run foundry list.", status: 404 });
      process.exitCode = 1;
      return;
    }
    emit({
      ok: true,
      idea: idea ?? null,
      spec: spec ?? null,
      specs: idea ? snapshot.specs.filter((item) => item.ideaId === idea.id) : [],
    });
    return;
  } else {
    emit({ ok: false, error: `Unknown command ${command}.`, next: "Run foundry with no arguments to see commands.", status: 400 });
    process.exitCode = 1;
    return;
  }
  emit(result);
  if (!result.ok) process.exitCode = 1;
}

function missing(command: string): void {
  emit({ ok: false, error: `${command} needs an id.`, next: `Run foundry ${command} <id>.`, status: 400 });
  process.exitCode = 1;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Command failed.";
  emit({ ok: false, error: message, next: "Check the data directory and retry.", status: 500 });
  process.exitCode = 1;
});
