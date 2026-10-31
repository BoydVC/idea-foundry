import type { EventName, Phase } from "../src/domain.js";

export const title = "An idea moving to a draft";

export const READER_STATE: Record<Phase, string> = {
  raw: "Raw idea",
  restated: "Restated in our words",
  approved: "Approved to build",
  specced: "Specs written",
  gated: "Gates passed",
  dispatched: "Sent to a runner",
  verified: "Draft verified",
  rejected: "Rejected",
  parked: "Parked",
};

const STEP: Record<EventName, string> = {
  restate: "you restate the idea",
  approve: "you approve the smallest slice",
  decompose: "the idea becomes specs",
  gate_pass: "the gates pass",
  gate_fail: "a gate fails",
  dispatch: "you send a draft packet",
  verify: "the draft checks out",
  unverify: "the draft is no longer a draft",
  reopen: "the idea opens again",
  reject: "the runner rejects it",
  park: "you park it",
  close: "every spec is verified",
};

export function state(vars: { idea?: string }): string {
  const idea = vars.idea ?? "raw";
  if (idea in READER_STATE) return READER_STATE[idea as Phase];
  return READER_STATE.raw;
}

export function readerStep(action: string): string | null {
  if (action === "done") return null;
  if (action in STEP) return STEP[action as EventName];
  return null;
}

export function step(action: string): string | null {
  return readerStep(action);
}
