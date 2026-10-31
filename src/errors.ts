export class FoundryError extends Error {
  readonly status: number;
  readonly next: string;

  constructor(message: string, status: number, next: string) {
    super(message);
    this.name = "FoundryError";
    this.status = status;
    this.next = next;
  }
}

export interface Fail {
  ok: false;
  error: string;
  next: string;
  status: number;
}

export function fail(error: FoundryError): Fail {
  return { ok: false, error: error.message, next: error.next, status: error.status };
}
