import { INVARIANTS } from "./invariants.ts";

export interface ChartEdge {
  from: string;
  to: string;
  label: string;
}

export function readChartLines(tlaSource: string): ChartEdge[] {
  const edges: ChartEdge[] = [];
  for (const line of tlaSource.split("\n")) {
    const match = line.match(/\\\*\s+CHART\s+(\w+)\s+(\w+)\s+(\w+)/);
    if (!match || !match[1] || !match[2] || !match[3]) continue;
    edges.push({ from: match[1], to: match[2], label: match[3] });
  }
  return edges;
}

export function mermaidFromChartLines(edges: readonly ChartEdge[]): string {
  const lines = ["stateDiagram-v2", "  direction TB", "  [*] --> raw"];
  for (const edge of edges) {
    lines.push(`  ${edge.from} --> ${edge.to}: ${edge.label.replaceAll("_", " ")}`);
  }
  return `${lines.join("\n")}\n`;
}

export function chartDocument(tlaSource: string): { mermaid: string; edges: ChartEdge[]; invariants: readonly string[] } {
  const edges = readChartLines(tlaSource);
  return { mermaid: mermaidFromChartLines(edges), edges, invariants: INVARIANTS };
}
