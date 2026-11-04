import { describe, expect, test } from "vitest";
import {
  API_FAILURE_WARNING,
  interpretGithubProbe,
  lookupGithubDraft,
  NOT_GITHUB_WARNING,
  OFFLINE_WARNING,
  PR_NOT_FOUND_WARNING,
  PROBE_AUTH_WARNING,
  PROBE_FORBIDDEN_WARNING,
  parsePullStatus,
  RATE_LIMIT_WARNING,
  resolveDraftStatus,
} from "../src/draft-status.js";

describe("draft status", () => {
  test("a non-github URL falls back without calling the API", () => {
    const result = lookupGithubDraft("https://example.com/demo/pull/1");
    expect(result).toEqual({ ok: false, warning: NOT_GITHUB_WARNING });
  });

  test("an offline probe does not keep the report line", () => {
    const offline = resolveDraftStatus(true, "https://github.com/example-org/demo-board/pull/3", () => ({
      ok: false,
      warning: "GitHub API was unreachable. The report line was not used.",
      trustReport: false,
      code: "offline" as const,
    }));
    expect(offline.draft).toBe(false);
    expect(offline.withheld).toBe(true);
    expect(offline.code).toBe("offline");
    const testMode = resolveDraftStatus(true, "https://github.com/example-org/demo-board/pull/3", () => ({
      ok: false,
      warning: "FOUNDRY_GITHUB_DRAFT=offline is test mode. Using the report line.",
      code: "offline" as const,
    }));
    expect(testMode.draft).toBe(true);
    expect(testMode.warning).toMatch(/test mode/);

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
    expect(limited).toEqual({ ok: false, warning: RATE_LIMIT_WARNING, trustReport: false, code: "rate_limit" });
    const offline = interpretGithubProbe({ status: null, stdout: "", stderr: "dial tcp: lookup api.github.com", errorCode: "ETIMEDOUT" });
    expect(offline).toEqual({ ok: false, warning: OFFLINE_WARNING, trustReport: false, code: "offline" });
    const rejected = interpretGithubProbe({ status: 1, stdout: "", stderr: "HTTP 500" });
    expect(rejected).toEqual({ ok: false, warning: API_FAILURE_WARNING, trustReport: false, code: "api_failure" });
    const decided = resolveDraftStatus(true, "https://github.com/example-org/demo-board/pull/4", () => limited);
    expect(decided.withheld).toBe(true);
    expect(decided.draft).toBe(false);
  });

  test("404, 401, and 403 do not trust the report line", () => {
    const missing = interpretGithubProbe({
      status: 1,
      stdout: "{\"message\":\"Not Found\",\"status\":\"404\"}",
      stderr: "gh: Not Found (HTTP 404)",
    });
    expect(missing).toEqual({ ok: false, warning: PR_NOT_FOUND_WARNING, trustReport: false, code: "pr_not_found" });
    const forbidden = interpretGithubProbe({ status: 1, stdout: "", stderr: "gh: Forbidden (HTTP 403)" });
    expect(forbidden).toEqual({ ok: false, warning: PROBE_FORBIDDEN_WARNING, trustReport: false, code: "probe_auth", httpStatus: 403 });
    const unauthorized = interpretGithubProbe({ status: 1, stdout: "", stderr: "HTTP 401" });
    expect(unauthorized).toEqual({ ok: false, warning: PROBE_AUTH_WARNING, trustReport: false, code: "probe_auth", httpStatus: 401 });
    for (const probe of [missing, forbidden, unauthorized]) {
      const decided = resolveDraftStatus(true, "https://github.com/example-org/demo-board/pull/1", () => probe);
      expect(decided.draft).toBe(false);
      expect(decided.withheld).toBe(true);
      expect(decided.warning ?? "").not.toMatch(/unreachable/);
    }
  });
});
