import path from "node:path";

const WRITE_CALL = new RegExp(
  `\\b(${[
    ["write", "File"].join(""),
    ["write", "FileSync"].join(""),
    ["append", "File"].join(""),
    ["append", "FileSync"].join(""),
    ["create", "WriteStream"].join(""),
    ["rename", "Sync"].join(""),
    ["rm", "Sync"].join(""),
    ["unlink", "Sync"].join(""),
    ["copy", "FileSync"].join(""),
    ["mkdir", "Sync"].join(""),
    ["truncate", "Sync"].join(""),
    ["write", "Sync"].join(""),
    ["open", "Sync"].join(""),
  ].join("|")})\\b`,
);

export function writeViolations(files: readonly { path: string; text: string }[]): string[] {
  const hits: string[] = [];
  for (const file of files) {
    if (path.basename(file.path) === "store.ts") {
      continue;
    }
    if (WRITE_CALL.test(file.text)) {
      hits.push(file.path);
    }
  }
  return hits;
}

export function storeWritesState(storeText: string): boolean {
  const write = ["write", "FileSync"].join("");
  const rename = ["rename", "Sync"].join("");
  return storeText.includes(write) && storeText.includes(rename);
}
