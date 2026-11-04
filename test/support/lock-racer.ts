import { parseIdea } from "../../src/domain.js";
import { Store } from "../../src/store.js";

const dir = process.argv[2];
const mark = process.argv[3];
const holdMs = Number(process.argv[4] ?? 0);
const id = process.argv[5] ?? "i-0001";

if (!dir || !mark || !Number.isFinite(holdMs)) {
  process.stderr.write("usage: lock-racer.ts <dir> <mark> <holdMs> <id>\n");
  process.exit(2);
}

const store = new Store(dir, () => "2026-01-01T00:00:00.000Z");

for (let attempt = 0; attempt < 6; attempt += 1) {
  const idea = store.findIdea(id);
  if (!idea) {
    process.stderr.write("missing idea\n");
    process.exit(2);
  }
  const result = store.transact({ ideas: [{ id: idea.id, version: idea.version }], specs: [] }, (snap) => {
    if (attempt === 0 && holdMs > 0) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, holdMs);
    }
    const current = snap.ideas.find((item) => item.id === idea.id);
    if (!current) return snap;
    const next = parseIdea({
      ...current,
      labels: [...current.labels, mark],
      version: current.version + 1,
      updatedAt: store.now(),
    });
    return { ...snap, ideas: snap.ideas.map((item) => (item.id === next.id ? next : item)) };
  });
  if (result.ok) {
    process.stdout.write(`${JSON.stringify({ ok: true, mark })}\n`);
    process.exit(0);
  }
  if (result.status !== 409) {
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exit(1);
  }
}

process.stderr.write("retries exhausted\n");
process.exit(1);
