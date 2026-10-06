import assert from "node:assert/strict";
import test from "node:test";
import { thesisQuality } from "./thesis-quality";

test("recognizes a decision-ready investment thesis", () => {
  const result = thesisQuality("Recurring revenue should grow over the next year while gross margin remains above 60%. The main risk is customer concentration.");
  assert.equal(result.score, 100);
  assert.equal(result.checks.every((check) => check.passed), true);
});

test("explains why a vague thesis is weak", () => {
  const result = thesisQuality("This is a great company with a strong future.");
  assert.equal(result.score, 0);
  assert.deepEqual(result.checks.filter((check) => !check.passed).map((check) => check.id), ["specific", "direction", "timeframe", "risk"]);
});

test("accepts explicit quarters and invalidation language", () => {
  const result = thesisQuality("EPS should improve in Q4 unless debt costs rise.");
  assert.equal(result.score, 100);
});
