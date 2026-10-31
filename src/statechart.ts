import type { TableRow } from "./model-table.ts";

export function renderStatechart(rows: readonly TableRow[]): string {
  const lines = ["stateDiagram-v2", "  [*] --> raw"];
  for (const row of rows) {
    lines.push(`  ${row.from} --> ${row.to}: ${row.event}`);
  }
  lines.push("");
  return lines.join("\n");
}
