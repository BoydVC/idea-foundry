import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fail, FoundryError } from "./errors.ts";
import { packageRoot } from "./root.ts";
import { createFoundry, type CallOpts, type Result } from "./service.ts";

const BLOCKED = new Set(["/api/merge", "/api/deploy", "/api/send", "/api/email", "/api/slack"]);

const FILES: Record<string, { file: string; type: string }> = {
  "/": { file: "index.html", type: "text/html; charset=utf-8" },
  "/index.html": { file: "index.html", type: "text/html; charset=utf-8" },
  "/styles.css": { file: "styles.css", type: "text/css; charset=utf-8" },
  "/app.js": { file: "app.js", type: "text/javascript; charset=utf-8" },
};

export interface RunningServer {
  url: string;
  port: number;
  close: () => Promise<void>;
}

export function startServer(options: { dataDir: string; port?: number; reviewUrl?: string }): Promise<RunningServer> {
  const foundry = createFoundry(options.dataDir, { reviewUrl: options.reviewUrl });
  const runtime = { port: options.port ?? 0, dataDir: options.dataDir };
  const server = createServer((request, response) => {
    void handle(foundry, runtime, request, response).catch((error: unknown) => {
      if (error instanceof FoundryError) {
        send(response, error.status, fail(error));
        return;
      }
      const message = error instanceof Error ? error.message : "Request failed.";
      send(response, 500, { ok: false, error: message, next: "Retry the request.", status: 500 });
    });
  });
  const port = options.port ?? 0;
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const address = server.address();
      const bound = typeof address === "object" && address ? address.port : port;
      runtime.port = bound;
      resolve({
        url: `http://127.0.0.1:${bound}`,
        port: bound,
        close: () => new Promise((done, stop) => server.close((error) => (error ? stop(error) : done()))),
      });
    });
  });
}

async function handle(
  foundry: ReturnType<typeof createFoundry>,
  runtime: { port: number; dataDir: string },
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const url = new URL(request.url || "/", "http://127.0.0.1");
  const path = url.pathname;
  if (BLOCKED.has(path)) {
    send(response, 403, {
      ok: false,
      error: "That action is not available.",
      next: "Open a draft pull request and stop. A person merges.",
      status: 403,
    });
    return;
  }
  if (request.method === "GET" && path === "/api/health") {
    send(response, 200, { ok: true, service: "idea-foundry", dataDir: runtime.dataDir, port: runtime.port });
    return;
  }
  if (request.method === "GET" && path === "/api/state") {
    send(response, 200, { ok: true, ...(await foundry.state()) });
    return;
  }
  if (request.method === "GET" && path === "/api/statechart") {
    send(response, 200, { ok: true, ...(await foundry.chart()) });
    return;
  }
  const file = request.method === "GET" ? FILES[path] : undefined;
  if (file) {
    const body = await readFile(join(packageRoot(), "public", file.file));
    response.writeHead(200, { "content-type": file.type, "cache-control": "no-store" });
    response.end(body);
    return;
  }
  if (request.method !== "POST") {
    send(response, 404, { ok: false, error: `No route ${path}.`, next: "Use the board or foundry commands.", status: 404 });
    return;
  }
  const payload = await readJson(request);
  if (!payload.ok) {
    send(response, payload.status, payload);
    return;
  }
  const body = payload.value;
  const call: CallOpts = {
    ...(typeof body.version === "number" ? { expectedVersion: body.version } : {}),
    ...(typeof body.recordVersion === "number" ? { recordVersion: body.recordVersion } : {}),
  };
  let result: Result;
  if (path === "/api/idea") result = await foundry.idea(stringField(body, "title"), call);
  else if (path === "/api/restate") result = await foundry.restate(stringField(body, "id"), call);
  else if (path === "/api/approve") result = await foundry.approve(stringField(body, "id"), stringField(body, "note"), call);
  else if (path === "/api/decompose") result = await foundry.decompose(stringField(body, "id"), call);
  else if (path === "/api/gate") result = await foundry.gate(stringField(body, "id"), call);
  else if (path === "/api/dispatch") {
    result = await foundry.dispatch(stringField(body, "id"), {
      ...call,
      ...(typeof body.target === "string" ? { target: body.target } : {}),
    });
  } else if (path === "/api/ingest") {
    if (body.draft !== true) {
      send(response, 400, {
        ok: false,
        error: "This pull request is not a draft.",
        next: "Mark the pull request as a draft and run ingest again.",
        status: 400,
      });
      return;
    }
    result = await foundry.ingest(stringField(body, "id"), stringField(body, "report"), stringField(body, "pr"), call);
  } else if (path === "/api/park") result = await foundry.park(stringField(body, "id"), call);
  else if (path === "/api/seed") result = await foundry.seed(call);
  else {
    send(response, 404, { ok: false, error: `No route ${path}.`, next: "Use the board or foundry commands.", status: 404 });
    return;
  }
  send(response, result.ok ? 200 : result.status, result);
}

function stringField(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== "string") {
    throw new FoundryError(`Missing ${key}.`, 400, `Pass ${key} and retry.`);
  }
  return value;
}

async function readJson(
  request: IncomingMessage,
): Promise<{ ok: true; value: Record<string, unknown> } | ReturnType<typeof fail>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    size += buffer.length;
    if (size > 1_000_000) {
      return fail(new FoundryError("The request is too large.", 400, "Send a shorter body."));
    }
    chunks.push(buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text.trim()) return { ok: true, value: {} };
  try {
    const value = JSON.parse(text) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return fail(new FoundryError("The body must be an object.", 400, "Send JSON and retry."));
    }
    return { ok: true, value: value as Record<string, unknown> };
  } catch {
    return fail(new FoundryError("The body is not JSON.", 400, "Send JSON and retry."));
  }
}

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(body));
}
