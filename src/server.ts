import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";
import {
  approve,
  createIdea,
  decompose,
  dispatch,
  gate,
  ingest,
  park,
  probePeerReview,
  restate,
  seedDemo,
  type CommandResult,
} from "./commands.js";
import { DomainError, prUrl } from "./domain.js";
import { pipelineHealth } from "./health.js";
import { foundryPort } from "./port.js";
import { selectPlanner } from "./planners/llm.js";
import { renderReport } from "./packet.js";
import { Store } from "./store.js";
import { mermaid, edgesFromTla } from "./statechart.js";

const BLOCKED = new Set(["merge", "deploy", "send", "ship", "email", "slack", "publish"]);

type Body = Record<string, unknown>;

function suppliedVersion(body: Body): number | undefined {
  if (!("recordVersion" in body) && !("version" in body)) return undefined;
  const raw = "recordVersion" in body ? body.recordVersion : body.version;
  if (typeof raw === "number" && Number.isInteger(raw) && raw >= 0) return raw;
  throw new DomainError("bad_version", "Version must be a non-negative integer.", "Re-read the record and send that version.");
}

function send(res: ServerResponse, status: number, payload: unknown, type = "application/json; charset=utf-8"): void {
  const recorded =
    type.startsWith("application/json") && payload && typeof payload === "object" && "ok" in payload && payload.ok === false && "status" in payload
      ? Number(payload.status)
      : status;
  const body = type.startsWith("application/json") ? JSON.stringify(payload) : String(payload);
  res.writeHead(recorded, { "content-type": type, "cache-control": "no-store" });
  res.end(body);
}

function forbidden(): CommandResult {
  return {
    ok: false,
    status: 403,
    error: "forbidden",
    message: "This system cannot merge, deploy, or send.",
    next: "A person does that step outside this system.",
  };
}

async function readBody(req: IncomingMessage): Promise<Body> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buf.length;
    if (size > 1_000_000) {
      throw new Error("Request body is larger than 1 MB.");
    }
    chunks.push(buf);
  }
  if (chunks.length === 0) return {};
  const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
  return parsed as Body;
}

export type Running = { server: Server; port: number; url: string };

export async function startServer(options: { store: Store; port: number; seed?: boolean; host?: string }): Promise<Running> {
  const store = options.store;
  const planner = selectPlanner(process.env, (path) => store.readText(path));
  const host = options.host ?? "127.0.0.1";
  if (options.seed && store.load().ideas.length === 0) seedDemo(store, planner);

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${host}`);
      const parts = url.pathname.split("/").filter(Boolean);
      if (req.method === "POST" && parts[0] === "api" && parts[1] && BLOCKED.has(parts[1])) {
        send(res, 403, forbidden());
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/health") {
        const address = server.address();
        const port = address && typeof address === "object" ? address.port : options.port;
        const snap = store.load();
        send(res, 200, {
          ok: true,
          service: "idea-foundry",
          port,
          ideas: snap.ideas.length,
          pipeline: pipelineHealth(snap),
        });
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/state") {
        send(res, 200, { ok: true, ...store.load() });
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/statechart") {
        const chart = mermaid(edgesFromTla(store.readModel("foundry.tla")));
        send(res, 200, chart, "text/plain; charset=utf-8");
        return;
      }
      if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
        send(res, 200, store.readStatic("index.html"), "text/html; charset=utf-8");
        return;
      }
      if (req.method === "GET" && url.pathname === "/app.js") {
        send(res, 200, store.readStatic("app.js"), "text/javascript; charset=utf-8");
        return;
      }
      if (req.method === "GET" && url.pathname === "/app.css") {
        send(res, 200, store.readStatic("app.css"), "text/css; charset=utf-8");
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/idea") {
        const body = await readBody(req);
        const unknown = Object.keys(body).filter((key) => key !== "title" && key !== "allowDuplicate");
        if (unknown.length > 0) {
          send(res, 400, {
            ok: false,
            status: 400,
            error: "bad_request",
            message: "The request has an unknown field.",
            next: "Send a JSON object with a title.",
          });
          return;
        }
        if (typeof body.title !== "string") {
          send(res, 400, {
            ok: false,
            status: 400,
            error: "bad_title",
            message: "The title must be a string.",
            next: "Send {\"title\":\"habit tracker export\"}.",
          });
          return;
        }
        send(res, 200, createIdea(store, body.title, false, { allowDuplicate: body.allowDuplicate === true }));
        return;
      }
      const ideaAction = url.pathname.match(/^\/api\/idea\/(i-\d{4,})\/(restate|approve|decompose|gate|park)$/);
      if (req.method === "POST" && ideaAction) {
        const id = ideaAction[1] ?? "";
        const action = ideaAction[2];
        const body = await readBody(req);
        const version = suppliedVersion(body);
        if (action === "restate") return send(res, 200, restate(store, id, planner, false, version));
        if (action === "approve") return send(res, 200, approve(store, id, typeof body.note === "string" ? body.note : undefined, false, version));
        if (action === "decompose") return send(res, 200, decompose(store, id, planner, false, version));
        if (action === "gate") {
          const advisory = await probePeerReview(process.env.FOUNDRY_REVIEW_URL ?? "http://127.0.0.1:4333/review", 150);
          return send(res, 200, gate(store, id, false, advisory, version));
        }
        return send(res, 200, park(store, id, false, version));
      }
      const specAction = url.pathname.match(/^\/api\/spec\/(s-\d{4,}-[1-6])\/(dispatch|ingest)$/);
      if (req.method === "POST" && specAction) {
        const id = specAction[1] ?? "";
        const action = specAction[2];
        const body = await readBody(req);
        const version = suppliedVersion(body);
        if (action === "dispatch") return send(res, 200, dispatch(store, id, false, version));
        if (typeof body.draft !== "boolean") {
          return send(res, 400, {
            ok: false,
            status: 400,
            error: "missing_draft",
            message: "Say whether the pull request is a draft.",
            next: "Send draft: true or draft: false with a github.com pull request URL.",
          });
        }
        if (typeof body.pr !== "string") {
          return send(res, 400, {
            ok: false,
            status: 400,
            error: "missing_pr",
            message: "Ingest needs a pull request URL.",
            next: "Pass pr as https://github.com/<owner>/<repo>/pull/<number>.",
          });
        }
        try {
          prUrl(body.pr);
        } catch (error) {
          const message = error instanceof DomainError ? error.message : "The pull request URL is not a github.com pull request.";
          const next = error instanceof DomainError ? error.next : "Pass an https://github.com/<owner>/<repo>/pull/<number> URL.";
          return send(res, 400, { ok: false, status: 400, error: "bad_pr", message, next });
        }
        const spec = store.findSpec(id);
        const title = spec?.title ?? id;
        const verdict = body.verdict === "rejected" ? "rejected" : "verified";
        const report = renderReport({ verdict, draft: body.draft, pr: body.pr, title });
        return send(res, 200, ingest(store, id, report, { draft: body.draft, pr: body.pr, expectedVersion: version }, false));
      }
      send(res, 404, { ok: false, status: 404, error: "not_found", message: "No such route.", next: "Use /api/state, /api/statechart, or /api/idea." });
    } catch (error) {
      const message = error instanceof SyntaxError ? "The request body is not valid JSON." : error instanceof Error ? error.message : "Request failed.";
      send(res, 400, { ok: false, status: 400, error: "bad_request", message, next: "Send a JSON object and retry." });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, host, () => resolve());
  });
  const address = server.address();
  const port = address && typeof address === "object" ? address.port : options.port;
  return { server, port, url: `http://${host}:${port}` };
}

const calledDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (calledDirectly) {
  const store = new Store(process.env.FOUNDRY_DATA ?? "data");
  if (process.env.FOUNDRY_FRESH === "1") store.reset();
  const running = await startServer({
    store,
    port: foundryPort(),
    seed: process.env.FOUNDRY_SEED === "1",
  });
  process.stdout.write(`${JSON.stringify({ ok: true, data: { url: running.url } })}\n`);
}
