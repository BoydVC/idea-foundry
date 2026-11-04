import { readFileSync, readdirSync, readFileSync as read } from "node:fs";
import { join } from "node:path";
import fc from "fast-check";
import { describe, expect, test } from "vitest";
import { parseIdea, type Idea } from "../src/domain.js";
import { createIdea } from "../src/commands.js";
import { tempStore } from "./helpers.js";

const writers = ["writeFile", "appendFile", "createWriteStream", "rmSync", "unlinkSync", "mkdirSync", "renameSync", "copyFile", "truncateSync", "openSync"];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (name.endsWith(".ts")) out.push(path);
  }
  return out;
}

describe("store", () => {
  test("only store.ts writes files", () => {
    const files = walk("src").filter((path) => !path.endsWith("store.ts"));
    for (const path of files) {
      const text = read(path, "utf8");
      for (const word of writers) expect(text.includes(word), `${path} contains ${word}`).toBe(false);
      expect(text.includes("node:fs"), path).toBe(false);
    }
  });

  test("a stale writer gets 409 and the first write stays", () => {
    const store = tempStore();
    const made = createIdea(store, "habit tracker export", false);
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    const idea = made.data as Idea;
    const attempt = (mark: string) =>
      store.transact({ ideas: [{ id: idea.id, version: idea.version }], specs: [] }, (snap) => {
        const current = snap.ideas.find((item) => item.id === idea.id);
        if (!current) return snap;
        const next = parseIdea({
          ...idea,
          labels: [...idea.labels, mark],
          version: idea.version + 1,
          updatedAt: store.now(),
        });
        return { ...snap, ideas: snap.ideas.map((item) => (item.id === next.id ? next : item)) };
      });
    const first = attempt("a");
    const second = attempt("b");
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.status).toBe(409);
    expect(second.next).toMatch(/Re-read/);
    const saved = store.findIdea(idea.id);
    expect(saved?.labels).toEqual(["a"]);
    expect(saved?.version).toBe(2);
  });

  test("retries converge without a lost update", async () => {
    const store = tempStore();
    const made = createIdea(store, "weather widget", false);
    if (!made.ok) throw new Error("create failed");
    const id = (made.data as Idea).id;
    await fc.assert(
      fc.asyncProperty(fc.uniqueArray(fc.integer({ min: 1, max: 5000 }), { minLength: 1, maxLength: 8 }), async (nums) => {
        const fresh = tempStore();
        const created = createIdea(fresh, "trivia scoring", false);
        if (!created.ok) throw new Error("create failed");
        const ideaId = (created.data as Idea).id;
        async function add(mark: string) {
          for (let n = 0; n < 30; n += 1) {
            const idea = fresh.findIdea(ideaId);
            if (!idea) throw new Error("missing");
            await new Promise((resolve) => setImmediate(resolve));
            const result = fresh.transact({ ideas: [{ id: idea.id, version: idea.version }], specs: [] }, (snap) => {
              const current = snap.ideas.find((item) => item.id === idea.id);
              if (!current) return snap;
              const next = parseIdea({
                ...idea,
                labels: [...idea.labels, mark],
                version: idea.version + 1,
                updatedAt: fresh.now(),
              });
              return { ...snap, ideas: snap.ideas.map((item) => (item.id === next.id ? next : item)) };
            });
            if (result.ok) return;
            if (!result.ok && result.status === 409) continue;
            throw new Error("unexpected");
          }
          throw new Error("retries exhausted");
        }
        await Promise.all(nums.map((num) => add(`m${num}`)));
        const saved = fresh.findIdea(ideaId);
        expect(saved?.version).toBe(1 + nums.length);
        expect(new Set(saved?.labels)).toEqual(new Set(nums.map((num) => `m${num}`)));
      }),
      { numRuns: 12 },
    );
    expect(id.startsWith("i-")).toBe(true);
  });

  test("appends ideas.jsonl when an idea is created", () => {
    const store = tempStore();
    createIdea(store, "palette mixer", false);
    const lines = readFileSync(join(store.root, "ideas.jsonl"), "utf8").trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "{}").title).toBe("palette mixer");
  });
});
