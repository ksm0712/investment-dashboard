import assert from "node:assert/strict";
import test from "node:test";
import { buildDecisionMap, defaultScenario, evaluateScenario } from "./scenario-lab.ts";
import type { Security } from "./types.ts";

const security = {
  id: 1, latestPrice: 100, targetPrice: 130, week52Low: 80, week52High: 140, allocation: 2_000,
  lots: [{ id: 1, securityId: 1, quantity: 10, costPrice: 90, fees: 0, purchaseDate: null }],
} as Security;

test("scenario defaults mirror the holding inputs", () => {
  assert.deepEqual(defaultScenario(security), { currentPrice: 100, targetPrice: 130, week52High: 140, allocation: 2_000 });
});

test("scenario evaluation reuses the portfolio decision engine without mutating the holding", () => {
  const result = evaluateScenario(security, { currentPrice: 70 });
  assert.equal(result.action, "Buy");
  assert.equal(result.marketValue, 700);
  assert.deepEqual(result.changedFields, ["currentPrice"]);
  assert.equal(security.latestPrice, 100);
});

test("invalid scenario values fall back to safe baseline inputs", () => {
  const result = evaluateScenario(security, { currentPrice: -1, targetPrice: Number.NaN, allocation: -5 });
  assert.equal(result.overrides.currentPrice, 100);
  assert.equal(result.overrides.targetPrice, 130);
  assert.equal(result.overrides.allocation, null);
});

test("decision map exposes the price regions where the recommendation changes", () => {
  const map = buildDecisionMap(security);
  assert.ok(map.ranges.some((range) => range.action === "Buy"));
  assert.ok(map.ranges.some((range) => range.action === "Sell"));
  assert.equal(map.ranges[0].from, map.minPrice);
  assert.equal(map.ranges.at(-1)?.to, map.maxPrice);
  map.ranges.slice(1).forEach((range, index) => assert.equal(range.from, map.ranges[index].to));
});
