import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, createWriteStream } from "node:fs";
import { get } from "node:https";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const jar = join(root, "tools", "tla2tools.jar");
const url = "https://github.com/tlaplus/tlaplus/releases/download/v1.7.4/tla2tools.jar";

function download(target) {
  mkdirSync(dirname(target), { recursive: true });
  return new Promise((resolve, reject) => {
    const file = createWriteStream(target);
    const request = (next) => {
      get(next, (response) => {
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          response.resume();
          request(response.headers.location);
          return;
        }
        if (response.statusCode !== 200) {
          reject(new Error(`download failed: ${response.statusCode}`));
          return;
        }
        response.pipe(file);
        file.on("finish", () => file.close(() => resolve()));
      }).on("error", reject);
    };
    request(url);
  });
}

const model = process.argv[2] ?? "foundry";
if (!existsSync(jar)) await download(jar);
const result = spawnSync(
  "java",
  ["-XX:+UseParallelGC", "-Xmx512m", "-jar", jar, "-workers", "1", "-config", `${model}.cfg`, `${model}.tla`],
  { cwd: join(root, "model"), encoding: "utf8" },
);
process.stdout.write(result.stdout ?? "");
process.stderr.write(result.stderr ?? "");
process.exit(result.status ?? 1);
