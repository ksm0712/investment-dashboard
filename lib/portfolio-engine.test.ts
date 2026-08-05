import assert from "node:assert/strict";
import test from "node:test";
import { calculateAsset } from "./portfolio-engine.ts";

test("consolidates lots into the weighted asset position", () => {
  const result = calculateAsset({
    currentPrice: 150,
    targetPrice: 180,
    week52Low: 80,
    week52High: 200,
    allocation: 5_000,
    lots: [
      { quantity: 10, costPrice: 100 },
      { quantity: 20, costPrice: 130 },
    ],
  });

  assert.equal(result.sharesHeld, 30);
  assert.equal(result.investedCost, 3_600);
  assert.equal(result.averagePurchasePrice, 120);
  assert.equal(result.lowestPurchasePrice, 100);
  assert.equal(result.pctAboveLowestPurchase, 0.5);
  assert.equal(result.marketValue, 4_500);
  assert.equal(result.gainLoss, 900);
  assert.equal(result.gainPct, 0.25);
  assert.equal(result.allocationRemaining, 1_400);
});

test("matches the spreadsheet sell hierarchy", () => {
  const sell = calculateAsset({
    currentPrice: 96,
    targetPrice: 100,
    week52Low: 60,
    week52High: 100,
    allocation: 10_000,
    lots: [{ quantity: 10, costPrice: 70 }],
  });
  assert.equal(sell.pctAboveAggressiveTrigger, -4 / 96);
  assert.equal(sell.action, "Sell");

  const review = calculateAsset({
    currentPrice: 92,
    targetPrice: 100,
    week52Low: 60,
    week52High: 100,
    allocation: 10_000,
    lots: [{ quantity: 10, costPrice: 70 }],
  });
  assert.equal(review.action, "Review to Sell");
});

test("requires every spreadsheet condition before returning Buy", () => {
  const result = calculateAsset({
    currentPrice: 70,
    targetPrice: 100,
    week52Low: 60,
    week52High: 100,
    allocation: 10_000,
    lots: [{ quantity: 10, costPrice: 75 }],
  });
  assert.equal(result.pctBelow52WeekHigh, 0.3);
  assert.equal(result.priceToTarget, 0.3);
  assert.equal(result.action, "Buy");

  const noAllocation = calculateAsset({
    currentPrice: 70,
    targetPrice: 100,
    week52Low: 60,
    week52High: 100,
    allocation: 700,
    lots: [{ quantity: 10, costPrice: 75 }],
  });
  assert.equal(noAllocation.action, "Continue to Monitor");
});

test("supports watchlist assets with no purchase lots", () => {
  const result = calculateAsset({
    currentPrice: 80,
    targetPrice: 100,
    week52Low: 70,
    week52High: 100,
    allocation: 5_000,
    lots: [],
  });
  assert.equal(result.sharesHeld, 0);
  assert.equal(result.lowestPurchasePrice, null);
  assert.equal(result.action, "Review to Buy");
});

test("does not invent an action when market or target data is missing", () => {
  const result = calculateAsset({
    currentPrice: 100,
    targetPrice: null,
    week52Low: 80,
    week52High: 120,
    allocation: 5_000,
    lots: [],
  });
  assert.equal(result.action, "Insufficient Data");
  assert.match(result.actionReasons.join(" "), /Target price/);
});
