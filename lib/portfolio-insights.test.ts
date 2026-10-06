import assert from "node:assert/strict";
import test from "node:test";
import type { Security } from "./types";
import { isMarketDataStale, portfolioAttention, portfolioHealthScore } from "./portfolio-insights";

function security(overrides: Partial<Security>): Security {
  return {
    id: 1,
    portfolioId: 1,
    name: "Example",
    assetType: "Stock",
    currency: "USD",
    value: 100,
    valueInr: 8_300,
    annualIncome: null,
    returnPct: null,
    quantity: 1,
    ticker: "EX",
    isin: null,
    priceSource: "test",
    priceSymbol: "EX",
    latestPrice: 100,
    changePercent: 1,
    sector: null,
    industry: null,
    trailingPe: null,
    forwardPe: null,
    pegRatio: null,
    priceAsOn: "2026-10-05",
    latestValue: 100,
    latestValueInr: 8_300,
    refreshStatus: "updated",
    refreshNote: null,
    refreshedAt: "2026-10-05",
    country: "United States",
    pricingMode: "auto",
    exchange: "NASDAQ",
    costPrice: 90,
    purchaseDate: "2026-01-01",
    targetPrice: 120,
    secondaryTargetPrice: null,
    targetSource: "test",
    targetAsOn: "2026-10-05",
    week52Low: 70,
    week52High: 130,
    marketDataSource: "test",
    marketDataAsOn: "2026-10-05",
    allocation: 1_000,
    lots: [],
    action: "Continue to Monitor",
    source: "test",
    sharesHeld: 1,
    investedCost: 90,
    averagePurchasePrice: 90,
    lowestPurchasePrice: 90,
    marketValue: 100,
    gainLoss: 10,
    gainPct: 0.111,
    pctAbove52WeekLow: 0.42,
    pctBelow52WeekHigh: 0.23,
    priceToTarget: 0.16,
    pctAboveAveragePurchase: 0.1,
    pctAboveLowestPurchase: 0.1,
    allocationRemaining: 910,
    aggressiveSellTrigger: 130,
    pctAboveAggressiveTrigger: -0.3,
    conservativeSellTrigger: 120,
    pctAboveConservativeTrigger: -0.2,
    actionReasons: [],
    ...overrides,
  };
}

test("surfaces actionable, incomplete, stale, and concentrated positions", () => {
  const now = new Date("2026-10-06T12:00:00Z").getTime();
  const large = security({ id: 1, name: "Large", latestValueInr: 75_000, valueInr: 75_000, action: "Sell" });
  const incomplete = security({ id: 2, name: "Needs setup", latestValueInr: 25_000, valueInr: 25_000, allocation: null, targetPrice: null, action: "Insufficient Data", marketDataAsOn: "2026-09-01" });
  const result = portfolioAttention([large, incomplete], now);

  assert.deepEqual(result.actionable.map((item) => item.name), ["Large"]);
  assert.deepEqual(result.incomplete.map((item) => item.name), ["Needs setup"]);
  assert.deepEqual(result.stale.map((item) => item.name), ["Needs setup"]);
  assert.deepEqual(result.concentrated.map((item) => item.name), ["Large", "Needs setup"]);
  assert.equal(result.largestWeight, 0.75);
});

test("treats absent and older-than-seven-day market data as stale", () => {
  const now = new Date("2026-10-06T12:00:00Z").getTime();
  assert.equal(isMarketDataStale(security({ marketDataAsOn: null, priceAsOn: null, refreshedAt: null }), now), true);
  assert.equal(isMarketDataStale(security({ marketDataAsOn: "2026-09-28" }), now), true);
  assert.equal(isMarketDataStale(security({ marketDataAsOn: "2026-10-02" }), now), false);
});

test("health score rewards complete, fresh, diversified portfolios", () => {
  const now = new Date("2026-10-06T12:00:00Z").getTime();
  const healthy = [1, 2, 3, 4].map((id) => security({ id, latestValueInr: 25_000, valueInr: 25_000 }));
  const unhealthy = [
    security({ id: 1, latestValueInr: 80_000, valueInr: 80_000 }),
    security({ id: 2, latestValueInr: 20_000, valueInr: 20_000, allocation: null, targetPrice: null, marketDataAsOn: "2026-08-01" }),
  ];
  assert.equal(portfolioHealthScore(healthy, now), 100);
  assert.ok(portfolioHealthScore(unhealthy, now) < 70);
});
