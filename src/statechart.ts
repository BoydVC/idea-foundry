import { EVENTS, PHASES, type Edge, type EventName, type Phase } from "./domain.js";
import { READER_STATE, readerStep } from "../model/statechart-view.js";

const PHASE_SET = new Set<string>(PHASES);
const EVENT_SET = new Set<string>(EVENTS);

function isPhase(value: string): value is Phase {
  return PHASE_SET.has(value);
}

function isEvent(value: string): value is EventName {
  return EVENT_SET.has(value);
}

export function edgesFromTla(source: string): Edge[] {
  const found = new Map<string, Edge>();
  const lines = source.split(/\r?\n/);
  let pending: EventName | null = null;
  let current: EventName | null = null;
  let body: string[] = [];
  let inAction = false;

  const finish = () => {
    if (inAction && current) collect(current, body.join("\n"), found);
    body = [];
    inAction = false;
    current = null;
  };

  for (const line of lines) {
    const marked = line.match(/\\\*\s*event:\s*([a-z_]+)\s*$/);
    if (marked) {
      finish();
      const name = marked[1] ?? "";
      pending = isEvent(name) ? name : null;
      continue;
    }
    if (/^[A-Za-z][A-Za-z0-9]*\s*==/.test(line)) {
      finish();
      inAction = true;
      current = pending;
      pending = null;
      body = [line];
      continue;
    }
    if (inAction) body.push(line);
    else if (line.trim() !== "") pending = null;
  }
  finish();
  return [...found.values()];
}

function collect(event: EventName, body: string, found: Map<string, Edge>): void {
  const from = new Map<string, string>();
  const to = new Map<string, string>();
  for (const match of body.matchAll(/(^|[^\w])([A-Za-z][A-Za-z0-9]*)\s*=\s*"([a-z_]+)"/g)) {
    const name = match[2];
    const value = match[3];
    if (name && value) from.set(name, value);
  }
  for (const match of body.matchAll(/([A-Za-z][A-Za-z0-9]*)'\s*=\s*"([a-z_]+)"/g)) {
    const name = match[1];
    const value = match[2];
    if (name && value) to.set(name, value);
  }
  for (const [name, target] of to) {
    const source = from.get(name);
    if (!source || !isPhase(source) || !isPhase(target)) continue;
    const edge: Edge = { from: source, event, to: target };
    found.set(`${edge.from}|${edge.event}|${edge.to}`, edge);
  }
}

export function mermaid(edges: readonly Edge[]): string {
  const lines = ["stateDiagram-v2", "  [*] --> raw"];
  for (const phase of PHASES) lines.push(`  state "${READER_STATE[phase]}" as ${phase}`);
  const sorted = [...edges].sort((a, b) => `${a.from} ${a.event} ${a.to}`.localeCompare(`${b.from} ${b.event} ${b.to}`));
  for (const edge of sorted) {
    const label = readerStep(edge.event);
    if (!label) continue;
    lines.push(`  ${edge.from} --> ${edge.to}: ${label}`);
  }
  return `${lines.join("\n")}\n`;
}

export function edgeKey(edge: Edge): string {
  return `${edge.from} ${edge.event} ${edge.to}`;
}
