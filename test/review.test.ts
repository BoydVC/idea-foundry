import { describe, expect, test } from "vitest";
import { probePeerReview, startReviewStub } from "../src/review.js";

describe("peer review adapter", () => {
  test("a closed port degrades to a skipped note", async () => {
    const result = await probePeerReview("http://127.0.0.1:1/review", 200);
    expect(result.status).toBe("skipped");
  });

  test("the stub returns a synthetic note", async () => {
    const stub = await startReviewStub();
    try {
      const result = await probePeerReview(stub.url, 1000);
      expect(result.status).toBe("note");
      if (result.status === "note") expect(result.text).toMatch(/Synthetic review/);
    } finally {
      await stub.close();
    }
  });
});