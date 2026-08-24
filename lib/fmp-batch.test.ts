import assert from "node:assert/strict";
import test from "node:test";
import { withFmpBatch, getBatchedFmpPrice, type BatchedPrice } from "./fmp-batch.ts";

function fixture(symbol: string): BatchedPrice {
  return { price: 123.45, date: "2026-08-20", source: "fmp-batch", symbol };
}

test("a symbol prefetched into the batch is found by getBatchedFmpPrice inside withFmpBatch", async () => {
  const batch = new Map([["AAPL", fixture("AAPL")]]);
  await withFmpBatch(batch, async () => {
    const found = getBatchedFmpPrice("AAPL");
    assert.ok(found);
    assert.equal(found!.price, 123.45);
  });
});

test("lookup is case-insensitive (symbols are matched uppercased)", async () => {
  const batch = new Map([["MSFT", fixture("MSFT")]]);
  await withFmpBatch(batch, async () => {
    assert.ok(getBatchedFmpPrice("msft"), "lowercase lookup should still hit the uppercased key");
  });
});

test("a symbol not in the batch reports undefined, so callers fall through to the normal race", async () => {
  const batch = new Map([["AAPL", fixture("AAPL")]]);
  await withFmpBatch(batch, async () => {
    assert.equal(getBatchedFmpPrice("TSLA"), undefined);
  });
});

test("outside any withFmpBatch scope, lookups are always undefined (no cross-request leakage)", () => {
  assert.equal(getBatchedFmpPrice("AAPL"), undefined);
});

test("two concurrent withFmpBatch scopes don't see each other's batch (AsyncLocalStorage isolation)", async () => {
  const batchA = new Map([["AAPL", fixture("AAPL")]]);
  const batchB = new Map([["MSFT", fixture("MSFT")]]);

  const [resultA, resultB] = await Promise.all([
    withFmpBatch(batchA, async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return { aapl: Boolean(getBatchedFmpPrice("AAPL")), msft: Boolean(getBatchedFmpPrice("MSFT")) };
    }),
    withFmpBatch(batchB, async () => {
      return { aapl: Boolean(getBatchedFmpPrice("AAPL")), msft: Boolean(getBatchedFmpPrice("MSFT")) };
    }),
  ]);

  assert.deepEqual(resultA, { aapl: true, msft: false }, "scope A should only see its own batch");
  assert.deepEqual(resultB, { aapl: false, msft: true }, "scope B should only see its own batch, even though it resolved while A was still pending");
});
