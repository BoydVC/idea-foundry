import { createServer, type Server } from "node:http";

export type Advisory = { status: "skipped"; reason: string } | { status: "note"; text: string };

export async function probePeerReview(url: string, timeoutMs: number): Promise<Advisory> {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: "idea-foundry" }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return { status: "skipped", reason: `peer review arena returned ${response.status}` };
    const text = await response.text();
    return { status: "note", text: text.slice(0, 500) };
  } catch {
    return { status: "skipped", reason: "peer review arena is not reachable" };
  }
}

export function startReviewStub(): Promise<{ url: string; close: () => Promise<void> }> {
  const server: Server = createServer((req, res) => {
    if (req.method !== "POST" || req.url !== "/review") {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false }));
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ note: "Synthetic review. The spec stays on sample data." }));
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = address && typeof address === "object" ? address.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}/review`,
        close: () =>
          new Promise((done) => {
            server.close(() => done());
          }),
      });
    });
  });
}
