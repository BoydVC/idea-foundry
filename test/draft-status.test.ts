import { describe, expect, test } from "vitest";
import {
  API_FAILURE_WARNING,
  interpretGithubProbe,
  lookupGithubDraft,
  NOT_GITHUB_WARNING,
  OFFLINE_WARNING,
  parsePullStatus,
  RATE_LIMIT_WARNING,
  resolveDraftStatus,
} from "../src/draft-status.js";

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

  test("a closed pull request counts as closed even when the draft flag is still true", () => {
    expect(parsePullStatus(JSON.stringify({ draft: true, state: "closed" }))).toEqual({ ok: true, draft: true, closed: true });
    const decided = resolveDraftStatus(true, "https://github.com/example-org/demo-board/pull/4", () => ({
      ok: true,
      draft: true,
      closed: true,
    }));
    expect(decided.closed).toBe(true);
    expect(decided.draft).toBe(false);
    expect(decided.warning).toBeUndefined();
    expect(decided.message).toMatch(/closed/);
  });

  test("a rate limit is not treated as an offline report", () => {
    const limited = interpretGithubProbe({ status: 1, stdout: "", stderr: "gh: API rate limit exceeded (HTTP 403)" });
    expect(limited).toEqual({ ok: false, warning: RATE_LIMIT_WARNING, trustReport: false });
    const offline = interpretGithubProbe({ status: null, stdout: "", stderr: "dial tcp: lookup api.github.com", errorCode: "ETIMEDOUT" });
    expect(offline).toEqual({ ok: false, warning: OFFLINE_WARNING });
    const rejected = interpretGithubProbe({ status: 1, stdout: "", stderr: "HTTP 500" });
    expect(rejected).toEqual({ ok: false, warning: API_FAILURE_WARNING, trustReport: false });
    const missing = interpretGithubProbe({
      status: 1,
      stdout: "{\"message\":\"Not Found\",\"status\":\"404\"}",
      stderr: "gh: Not Found (HTTP 404)",
    });
    expect(missing).toEqual({ ok: false, warning: OFFLINE_WARNING });
    const decided = resolveDraftStatus(true, "https://github.com/example-org/demo-board/pull/4", () => limited);
    expect(decided.withheld).toBe(true);
    expect(decided.draft).toBe(false);
  });
});
