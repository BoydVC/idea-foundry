import { describe, expect, test } from "vitest";
import { lookupGithubDraft, NOT_GITHUB_WARNING, resolveDraftStatus } from "../src/draft-status.js";

describe("draft status", () => {
  test("a non-github URL falls back without calling the API", () => {
    const result = lookupGithubDraft("https://example.com/demo/pull/1");
    expect(result).toEqual({ ok: false, warning: NOT_GITHUB_WARNING });
  });

  test("an offline probe keeps the report line and a GitHub answer replaces it", () => {
    const offline = resolveDraftStatus(true, "https://example.com/demo/pull/1", () => ({
      ok: false,
      warning: "GitHub API was unreachable. Using the report line.",
    }));
    expect(offline.draft).toBe(true);
    expect(offline.warning).toMatch(/unreachable/);

    const published = resolveDraftStatus(true, "https://github.com/example-org/demo-board/pull/3", () => ({
      ok: true,
      draft: false,
    }));
    expect(published.draft).toBe(false);
    expect(published.warning).toBeUndefined();
    expect(published.message).toMatch(/GitHub says/);
  });
});
