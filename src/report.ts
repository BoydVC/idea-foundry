const PR = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/\d+$/;

export interface ParsedReport {
  ok: true;
  draft: boolean;
  verdict: "verified" | "rejected";
  body: string;
}

export interface ReportError {
  ok: false;
  error: string;
  next: string;
  status: number;
}

export function parsePrUrl(value: string): string | null {
  const url = value.trim();
  return PR.test(url) ? url : null;
}

export function parseReport(text: string): ParsedReport | ReportError {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match || match[1] === undefined || match[2] === undefined) {
    return {
      ok: false,
      error: "The report is missing a header.",
      next: "Start the report with draft: true and verdict: verified, then a body.",
      status: 400,
    };
  }
  const header = match[1];
  const draftLine = header.match(/^draft:\s*(true|false)\s*$/m);
  const verdictLine = header.match(/^verdict:\s*(verified|rejected)\s*$/m);
  if (!draftLine || draftLine[1] !== "true") {
    return {
      ok: false,
      error: "This pull request is not a draft.",
      next: "Mark the pull request as a draft and run ingest again.",
      status: 400,
    };
  }
  if (!verdictLine || (verdictLine[1] !== "verified" && verdictLine[1] !== "rejected")) {
    return {
      ok: false,
      error: "The report needs a verdict.",
      next: "Set verdict: verified or verdict: rejected in the report header.",
      status: 400,
    };
  }
  return {
    ok: true,
    draft: true,
    verdict: verdictLine[1],
    body: match[2].trim(),
  };
}
