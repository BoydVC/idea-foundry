import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { CasConflict, CommandError } from "./domain.ts";
import { readModel } from "./model-table.ts";
import { renderStatechart } from "./statechart.ts";
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
  parkIdea,
  restateIdea,
  seedIfEmpty,
  showIdea,
} from "./service.ts";
import { checkModel, packageRoot } from "./tlc.ts";

const BLOCKED = new Set(["/api/merge", "/api/deploy", "/api/send", "/api/email", "/api/slack"]);

export type Running = {
  port: number;
  close: () => Promise<void>;
};

export function startServer(options: {
  port: number;
  dataDir: string;
  root?: string;
  now?: () => string;
}): Promise<Running> {
  const root = options.root ?? packageRoot();
  const now = options.now ?? (() => new Date().toISOString());
  let boundPort = options.port;
  const store = openStore(options.dataDir);
  const planner = defaultPlanner();
  seedIfEmpty(store, now());
  const publicDir = path.join(root, "public");

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const pathname = url.pathname;
      if (req.method === "POST" && BLOCKED.has(pathname)) {
        send(res, 403, {
          ok: false,
          error: "This server cannot merge, deploy, or send.",
          next: "A person reviews the draft pull request. Nothing here performs that step.",
        });
        return;
      }
      if (req.method === "GET" && pathname === "/api/health") {
        send(res, 200, { ok: true, ideas: listIdeas(store).length, port: boundPort });
        return;
      }
      if (req.method === "GET" && pathname === "/api/state") {
        const snap = store.read();
        send(res, 200, snap);
        return;
      }
      if (req.method === "GET" && pathname === "/api/statechart") {
        const model = readModel(path.join(root, "model", "foundry.tla"));
        send(res, 200, { mmd: renderStatechart(model.rows), rows: model.rows });
        return;
      }
      if (req.method === "POST" && pathname === "/api/idea") {
        const body = await readJson(req);
        const idea = createIdea(store, stringField(body, "title"), now());
        send(res, 201, { ok: true, idea });
        return;
      }
      const ideaAction = pathname.match(/^\/api\/idea\/([^/]+)\/(restate|approve|decompose|gate|park|show)$/);
      if (ideaAction && req.method === "POST") {
        const id = ideaId(decodeURIComponent(ideaAction[1] ?? ""));
        const action = ideaAction[2];
        if (action === "restate") {
          send(res, 200, { ok: true, idea: restateIdea(store, id, planner) });
          return;
        }
        if (action === "approve") {
          const body = await readJson(req);
          send(res, 200, { ok: true, idea: approveIdea(store, id, stringField(body, "note")) });
          return;
        }
        if (action === "decompose") {
          send(res, 200, { ok: true, specs: decomposeIdea(store, id, planner) });
          return;
        }
        if (action === "gate") {
          send(res, 200, {
            ok: true,
            ...gateIdea(store, id, () => checkModel("foundry.cfg", root), now()),
          });
          return;
        }
        if (action === "park") {
          send(res, 200, { ok: true, idea: parkIdea(store, id) });
          return;
        }
      }
      if (req.method === "GET" && ideaAction?.[2] === "show") {
        send(res, 200, { ok: true, ...showIdea(store, ideaId(decodeURIComponent(ideaAction[1] ?? ""))) });
        return;
      }
      const specAction = pathname.match(/^\/api\/spec\/([^/]+)\/(dispatch|ingest)$/);
      if (req.method === "POST" && specAction) {
        const id = specId(decodeURIComponent(specAction[1] ?? ""));
        if (specAction[2] === "dispatch") {
          send(res, 200, { ok: true, packet: dispatchSpec(store, id) });
          return;
        }
        const body = await readJson(req);
        const outcome = stringField(body, "outcome");
        if (outcome !== "verified" && outcome !== "rejected") {
          throw new CommandError("Outcome must be verified or rejected.", "Choose verified or rejected and retry.");
        }
        const spec = ingestSpec(store, id, {
          draft: booleanField(body, "draft"),
          outcome,
          prUrl: stringField(body, "prUrl"),
          reportText: stringField(body, "reportText"),
        });
        send(res, 200, { ok: true, spec });
        return;
      }
      if (req.method === "GET" && (pathname === "/" || pathname === "/index.html")) {
        sendFile(res, path.join(publicDir, "index.html"), "text/html; charset=utf-8");
        return;
      }
      if (req.method === "GET" && pathname === "/app.js") {
        sendFile(res, path.join(publicDir, "app.js"), "text/javascript; charset=utf-8");
        return;
      }
      if (req.method === "GET" && pathname === "/app.css") {
        sendFile(res, path.join(publicDir, "app.css"), "text/css; charset=utf-8");
        return;
      }
      send(res, 404, { ok: false, error: `No route ${pathname}.`, next: "Use the board at / or the listed API routes." });
    } catch (error) {
      if (error instanceof CommandError || error instanceof CasConflict) {
        send(res, error.status, { ok: false, error: error.message, next: error.next });
        return;
      }
      const message = error instanceof Error ? error.message : "Request failed.";
      send(res, 500, { ok: false, error: message, next: "Retry the action. If it keeps failing, check the server log." });
    }
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : options.port;
      boundPort = port;
      resolve({
        port,
        close: () =>
          new Promise((done, fail) => {
            server.close((error) => (error ? fail(error) : done()));
          }),
      });
    });
  });
}

function send(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
  });
  res.end(payload);
}

function sendFile(res: http.ServerResponse, file: string, type: string): void {
  const payload = fs.readFileSync(file);
  res.writeHead(200, { "content-type": type, "cache-control": "no-store" });
  res.end(payload);
}

async function readJson(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buf.length;
    if (size > 1_000_000) {
      throw new CommandError("Body is too large.", "Send a smaller JSON body.");
    }
    chunks.push(buf);
  }
  if (chunks.length === 0) {
    return {};
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new CommandError("Body is not JSON.", "Send a JSON object.");
  }
}

function stringField(body: unknown, key: string): string {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return "";
  }
  const value = (body as Record<string, unknown>)[key];
  return typeof value === "string" ? value : "";
}

function booleanField(body: unknown, key: string): boolean {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return false;
  }
  return (body as Record<string, unknown>)[key] === true;
}

const invoked = process.argv[1] ?? "";
if (invoked.endsWith(`${path.sep}server.ts`) || invoked.endsWith(`${path.sep}server.js`)) {
  const port = Number(process.env.PORT ?? 4440);
  const dataDir = process.env.FOUNDRY_DATA ?? path.join(packageRoot(), "data");
  startServer({ port, dataDir }).then((running) => {
    process.stdout.write(`Idea Foundry dashboard at http://127.0.0.1:${running.port}\n`);
  });
}
