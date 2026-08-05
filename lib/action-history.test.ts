import assert from "node:assert/strict";
import test from "node:test";
import { buildActionHistoryEntry } from "./action-history.ts";
import type { ActionHistoryEntry, Security } from "./types.ts";

const security = {
  id: 42,
  name: "Example Global Stock",
  action: "Review to Sell",
  actionReasons: ["Price is approaching the aggressive trigger."],
  latestPrice: 98,
  targetPrice: 105,
  marketDataSource: "yahoo-finance2",
  priceSource: null,
} as Security;

test("records the initial recommendation with its evidence", () => {
  const entry = buildActionHistoryEntry(security, undefined, "2026-08-05T02:00:00.000Z");
  assert.deepEqual(entry, {
    securityId: 42,
    securityName: "Example Global Stock",
    action: "Review to Sell",
    previousAction: null,
    currentPrice: 98,
    targetPrice: 105,
    source: "yahoo-finance2",
    reasons: ["Price is approaching the aggressive trigger."],
    recordedAt: "2026-08-05T02:00:00.000Z",
  });
});

test("does not create duplicate history while the action is unchanged", () => {
  const previous = { action: "Review to Sell" } as ActionHistoryEntry;
  assert.equal(buildActionHistoryEntry(security, previous), null);
});

test("records the previous action when a recommendation changes", () => {
  const previous = { action: "Continue to Monitor" } as ActionHistoryEntry;
  const entry = buildActionHistoryEntry(security, previous, "2026-08-05T02:00:00.000Z");
  assert.equal(entry?.previousAction, "Continue to Monitor");
  assert.equal(entry?.action, "Review to Sell");
});
