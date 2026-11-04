import { DomainError } from "./domain.js";

export function foundryPort(env: NodeJS.ProcessEnv = process.env, fallback = 4440): number {
  const raw = env.FOUNDRY_PORT ?? env.PORT ?? String(fallback);
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new DomainError("bad_port", `Bad port ${JSON.stringify(raw)}.`, "Set FOUNDRY_PORT to an integer from 0 to 65535.");
  }
  return port;
}
