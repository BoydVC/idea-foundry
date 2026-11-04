import { createRequire } from "node:module";
import { posix } from "node:path";
import ts from "typescript";
import type { Finding, GateResult, ProofLevel, Sketch, Spec, SpecId } from "./domain.js";

export const PYRAMID: Record<"G0" | "G1" | "G2" | "G3", string> = {
  G0: "architecture",
  G1: "static",
  G2: "skills",
  G3: "human",
};

const CORE_FILES = new Set(["src/store.ts", "src/domain.ts"]);

const VAGUE = /\b(improve|enhance|optimize|leverage|streamline|handle|manage)\b/i;
const RUNNABLE = /^(node|npm|npx|tsc)(\s+\S+)+$/;
const SHELL = /[;&|`$<>(){}!\n\r]/;
const MERGE_ORDER = /\byou may merge\b|\bauto-merge\b|\bmerge the pull request\b/i;
const NON_ASCII_MARK = /[\p{Cc}\p{Cf}\p{Zs}]/u;
const NPM_SCRIPTS = new Set(["test", "start", "run", "run-script"]);
const NPX_VALUE_FLAGS = new Set(["--call", "-c", "--npm", "--node-options", "--node-arg", "-n", "--cache", "--userconfig", "--registry", "--loglevel"]);

type Manifest = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

function declaredPackages(): ReadonlySet<string> {
  const manifest = createRequire(import.meta.url)("../package.json") as Manifest;
  return new Set([...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.devDependencies ?? {})]);
}

const DECLARED_PACKAGES = declaredPackages();

type TouchInspect = { kind: "ok"; path: string } | { kind: "invalid" } | { kind: "escape" };

function pathTextInvalid(value: string): boolean {
  if (value.normalize("NFC") !== value || value !== value.trim()) return true;
  for (const segment of value.split(/[\\/]/)) {
    if (segment !== segment.trim()) return true;
    for (const char of segment) {
      const point = char.codePointAt(0) ?? 0;
      if (point <= 0x7f) continue;
      if (NON_ASCII_MARK.test(char)) return true;
    }
  }
  return false;
}

function inspectTouch(file: string): TouchInspect {
  if (file.length === 0 || file.includes("\0")) return { kind: "escape" };
  if (pathTextInvalid(file)) return { kind: "invalid" };
  const slashed = file.replace(/\\/g, "/").normalize("NFKC");
  if (pathTextInvalid(slashed)) return { kind: "invalid" };
  if (/^[A-Za-z]:/.test(slashed) || slashed.startsWith("//")) return { kind: "escape" };
  let decoded = slashed;
  for (let pass = 0; pass < 3; pass += 1) {
    let next: string;
    try {
      next = decodeURIComponent(decoded);
    } catch {
      return { kind: "escape" };
    }
    if (next === decoded) break;
    if (next.includes("\0")) return { kind: "escape" };
    if (pathTextInvalid(next)) return { kind: "invalid" };
    decoded = next.normalize("NFKC");
    if (pathTextInvalid(decoded)) return { kind: "invalid" };
  }
  if (decoded.includes("\0")) return { kind: "escape" };
  const normalized = posix.normalize(decoded);
  if (
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.startsWith("/") ||
    posix.isAbsolute(normalized) ||
    normalized.split("/").includes("..")
  ) {
    return { kind: "escape" };
  }
  const trimmed = normalized.replace(/\/+$/, "");
  if (trimmed.length === 0) return { kind: "escape" };
  if (pathTextInvalid(trimmed)) return { kind: "invalid" };
  return { kind: "ok", path: trimmed };
}

export function canonicalTouch(file: string): string | null {
  const found = inspectTouch(file);
  return found.kind === "ok" ? found.path : null;
}

function result(gate: GateResult["gate"], findings: Finding[]): GateResult {
  return { gate, pass: findings.length === 0, findings };
}

function npxFlagBanned(arg: string): boolean {
  if (arg === "--yes" || arg === "-y" || arg === "-p" || arg === "--package") return true;
  if (arg.startsWith("--yes=") || arg.startsWith("--package=")) return true;
  return /^-[yqpchnv]+$/.test(arg) && /[yp]/.test(arg);
}

function npxPackageName(token: string): string {
  if (token.startsWith("@")) {
    const slash = token.indexOf("/");
    if (slash < 0) return token;
    const versionAt = token.indexOf("@", slash + 1);
    return versionAt === -1 ? token : token.slice(0, versionAt);
  }
  const versionAt = token.indexOf("@");
  return versionAt === -1 ? token : token.slice(0, versionAt);
}

function npxAllowed(command: string): boolean {
  const args = command.trim().split(/\s+/).slice(1);
  if (args.some((arg) => npxFlagBanned(arg))) return false;
  let packageName: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? "";
    if (arg === "--") break;
    if (arg.startsWith("-")) {
      if (!arg.includes("=") && NPX_VALUE_FLAGS.has(arg)) index += 1;
      continue;
    }
    packageName = npxPackageName(arg);
    break;
  }
  return packageName !== undefined && DECLARED_PACKAGES.has(packageName);
}

function blocksAcceptance(command: string): boolean {
  if (SHELL.test(command)) return true;
  return command.trim().split(/\s+/)[0] === "npx" && !npxAllowed(command);
}

export function isRunnable(command: string): boolean {
  if (!RUNNABLE.test(command) || SHELL.test(command)) return false;
  return command.trim().split(/\s+/)[0] !== "npx" || npxAllowed(command);
}

function isLocalProof(command: string): boolean {
  if (!isRunnable(command)) return false;
  const parts = command.trim().split(/\s+/);
  const bin = parts[0];
  if (bin === "node" || bin === "tsc") return true;
  if (bin === "npm") return NPM_SCRIPTS.has(parts[1] ?? "");
  return false;
}

export function acceptanceProof(acceptance: readonly string[]): ProofLevel {
  return acceptance.some((command) => isLocalProof(command)) ? 4 : 1;
}

export function touchesCore(touch: readonly string[]): boolean {
  return touch.some((file) => {
    const canon = canonicalTouch(file);
    return canon !== null && CORE_FILES.has(canon.toLowerCase());
  });
}

const sketchCache = new Map<string, { ok: boolean; detail: string }>();

const sketchOptions: ts.CompilerOptions = {
  strict: true,
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ES2022,
  noEmit: true,
  skipLibCheck: true,
};

export function typecheckSketch(source: string): { ok: boolean; detail: string } {
  const cached = sketchCache.get(source);
  if (cached) return cached;
  const fileName = "sketch.ts";
  const host = ts.createCompilerHost(sketchOptions);
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (name, languageVersion, onError, shouldCreate) => {
    if (name === fileName) return ts.createSourceFile(name, source, languageVersion, true);
    return getSourceFile(name, languageVersion, onError, shouldCreate);
  };
  const program = ts.createProgram([fileName], sketchOptions, host);
  const diagnostics = ts.getPreEmitDiagnostics(program).filter((item) => !item.file || item.file.fileName.endsWith("sketch.ts"));
  const checked =
    diagnostics.length === 0
      ? { ok: true, detail: "" }
      : { ok: false, detail: ts.formatDiagnostics(diagnostics, host).split("\n")[0] ?? "sketch failed to typecheck" };
  sketchCache.set(source, checked);
  return checked;
}

export function sketchSource(sketch: Sketch): string {
  return `${sketch.types}\n${sketch.signatures.join("\n")}\n`;
}

export function checkG0(spec: { sketch?: Sketch }): GateResult {
  const findings: Finding[] = [];
  if (!spec.sketch || spec.sketch.types.trim() === "" || spec.sketch.signatures.length === 0) {
    findings.push({ key: "g0:sketch", detail: "Add an architect sketch with types and signatures.", proof: 1 });
    return result("G0", findings);
  }
  const source = sketchSource(spec.sketch);
  if (!source.includes("not implemented")) {
    findings.push({
      key: "g0:sketch",
      detail: "Sketch signatures must keep not implemented bodies until the runner fills them in.",
      proof: 1,
    });
    return result("G0", findings);
  }
  const checked = typecheckSketch(source);
  if (!checked.ok) {
    findings.push({
      key: "g0:sketch",
      detail: `The sketch does not typecheck. ${checked.detail}`.trim(),
      proof: 4,
    });
  }
  return result("G0", findings);
}

export function checkG1(spec: Pick<Spec, "acceptance" | "touch" | "maxLines">): GateResult {
  const findings: Finding[] = [];
  const runnable = spec.acceptance.some((command) => isRunnable(command));
  if (!runnable || spec.acceptance.some((command) => blocksAcceptance(command))) {
    findings.push({
      key: "g1:acceptance",
      detail:
        "Add one acceptance command that starts with node, npm, npx, or tsc and does not chain a shell. npx may only run a dependency or devDependency, and --yes, -y, and -p are forbidden.",
      proof: 1,
    });
  }
  if (spec.touch.length === 0) {
    findings.push({ key: "g1:touch", detail: "Add a touch map of the files this spec may change.", proof: 1 });
  }
  let invalid = false;
  let escape = false;
  for (const path of spec.touch) {
    const found = inspectTouch(path);
    if (found.kind === "invalid") invalid = true;
    else if (found.kind === "escape") escape = true;
  }
  if (invalid) {
    findings.push({
      key: "g1:touch-invalid",
      detail: "Keep every touch path in NFC, with no whitespace at either end and no Unicode control, space, or format character.",
      proof: 2,
    });
  }
  if (escape) {
    findings.push({ key: "g1:touch-escape", detail: "Keep every touch path inside the repo.", proof: 2 });
  }
  if (spec.maxLines > 400) {
    findings.push({ key: "g1:size", detail: "Keep the change at or under 400 lines.", proof: 2 });
  }
  if (touchesCore(spec.touch) && acceptanceProof(spec.acceptance) < 4) {
    findings.push({
      key: "g1:proof",
      detail: "A spec that touches src/store.ts or src/domain.ts needs a local bin or an npm script (proof level 4).",
      proof: 1,
    });
  }
  return result("G1", findings);
}

export function checkG2(spec: Pick<Spec, "body">): GateResult {
  const findings: Finding[] = [];
  if (!spec.body.includes("Done when:")) {
    findings.push({ key: "g2:done-when", detail: "Add a Done when: line.", proof: 1 });
  }
  if (!spec.body.includes("PII clause:")) {
    findings.push({ key: "g2:pii", detail: "Add a PII clause: line that limits the spec to synthetic data.", proof: 1 });
  }
  const vague = spec.body.match(VAGUE);
  const word = vague?.[1];
  if (word) {
    findings.push({ key: "g2:vague-verb", detail: `Replace the vague verb "${word}".`, proof: 1 });
  }
  return result("G2", findings);
}

export function checkG3(
  spec: { body: string; index: number; landsAfter: string | null; id: string },
  siblings: readonly { id: string; index: number }[],
): GateResult {
  const findings: Finding[] = [];
  if (!spec.body.includes("Merge is forbidden.")) {
    findings.push({ key: "g3:no-merge", detail: "State that merge is forbidden.", proof: 1 });
  }
  if (!/draft PR/i.test(spec.body)) {
    findings.push({ key: "g3:draft", detail: "State that the proof is a draft PR.", proof: 1 });
  }
  if (MERGE_ORDER.test(spec.body)) {
    findings.push({ key: "g3:merge-instruction", detail: "Remove the instruction to merge.", proof: 1 });
  }
  if (spec.index > 1) {
    const below = siblings.find((item) => item.index === spec.index - 1);
    if (!below || spec.landsAfter !== below.id) {
      findings.push({
        key: "g3:stack-order",
        detail: "Point landsAfter at the spec directly below this one.",
        proof: 2,
      });
    }
  }
  return result("G3", findings);
}

export function sharedTouchFindings(
  spec: { id: string; touch: readonly string[] },
  siblings: readonly { id: string; touch: readonly string[] }[],
): Finding[] {
  const findings: Finding[] = [];
  const seen = new Set<string>();
  for (const file of spec.touch) {
    const canon = canonicalTouch(file);
    if (canon === null) continue;
    for (const other of siblings) {
      if (other.id === spec.id) continue;
      if (!other.touch.some((item) => canonicalTouch(item) === canon)) continue;
      const detail = `${canon} is also touched by ${other.id}.`;
      if (seen.has(detail)) continue;
      seen.add(detail);
      findings.push({ key: "g1:blast", detail, proof: 2 });
    }
  }
  return findings;
}

export function checkSpec(spec: Spec, siblings: readonly Spec[]): GateResult[] {
  const base = checkG1(spec);
  return [
    checkG0(spec),
    result("G1", [...base.findings, ...sharedTouchFindings(spec, siblings)]),
    checkG2(spec),
    checkG3(spec, siblings),
  ];
}

export function passed(gates: readonly GateResult[]): boolean {
  return (
    gates.length === 4 &&
    gates[0]?.gate === "G0" &&
    gates[1]?.gate === "G1" &&
    gates[2]?.gate === "G2" &&
    gates[3]?.gate === "G3" &&
    gates.every((gate) => gate.pass)
  );
}

export function siblingId(siblings: readonly Spec[], index: number): SpecId | null {
  return siblings.find((item) => item.index === index)?.id ?? null;
}
