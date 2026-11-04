import fc from "fast-check";
import { describe, expect, test } from "vitest";
import { parseTitle } from "../src/domain.js";
import { runPipeline } from "../scripts/pipeline.js";

const FLAG = "\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}";

function withoutFlagTags(title: string): string {
  return title.replace(/\u{1F3F4}[\u{E0061}-\u{E007A}]{2,}\u{E007F}/gu, "");
}

describe("pass 11", () => {
  test("stray tag characters are rejected and a subdivision flag is a title", () => {
    expect(() => parseTitle("ab\u{E0041}\u{E0042}cd")).toThrow(/tag|control/);
    expect(() => parseTitle("hello\u{E0069}\u{E0067}nore")).toThrow(/tag|control/);
    expect(() => parseTitle("flag\u{E007F}end")).toThrow(/tag|control/);
    expect(parseTitle(`${FLAG} planner`)).toBe(`${FLAG} planner`);
  });

  test("an accepted title has no controls, bidi marks, or stray tags", () => {
    const marked = fc.constantFrom(
      "\u0000",
      "\u0007",
      "\u001B",
      "\u007F",
      "\u0085",
      "\u009F",
      "\u202E",
      "\u2067",
      "\u{E0041}",
      "\u{E0067}",
      "\u{E007F}",
      FLAG,
    );
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 24 }), marked, fc.boolean(), (body, mark, after) => {
        const raw = after ? `${body}${mark}` : `${mark}${body}`;
        let title: string;
        try {
          title = parseTitle(raw);
        } catch {
          return;
        }
        expect(title).not.toMatch(/\p{Cc}/u);
        expect(title).not.toMatch(/[\u202A-\u202E\u2066-\u2069]/);
        expect(withoutFlagTags(title)).not.toMatch(/[\u{E0020}-\u{E007F}]/u);
      }),
      { numRuns: 200 },
    );
  });

  test("a virama may be followed by ZWNJ in an Indic word", () => {
    expect(parseTitle("क्\u200Cष planner")).toBe("क्\u200Cष planner");
    expect(() => parseTitle("x\u200Cy")).toThrow(/zero-width|control|bidi/);
  });

  test("the pipeline demo dispatches when a live probe would report 99 drafts", () => {
    const demo = runPipeline({ probe: () => ({ ok: true, drafts: 99 }) });
    expect(demo.ok).toBe(true);
    if (!demo.ok) return;
    expect(demo.draftDay.status).toBe("intake");
    const live = runPipeline({ live: true, probe: () => ({ ok: true, drafts: 99 }) });
    expect(live.ok).toBe(false);
    if (live.ok) return;
    expect(live.error).toBe("draft_backlog");
  }, 180_000);
});
