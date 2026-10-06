import assert from "node:assert/strict";
import test from "node:test";
import type { Security } from "./types";
import { portfolioCsv } from "./portfolio-export";

test("exports decision-ready portfolio fields and escapes CSV content", () => {
  const security = {
    name: 'Acme, "Global"',
    priceSymbol: "ACME",
    ticker: "ACME",
    assetType: "Stock",
    country: "United States",
    currency: "USD",
    sharesHeld: 4,
    latestPrice: 25,
    marketValue: 100,
    investedCost: 80,
    gainLoss: 20,
    gainPct: 0.25,
    action: "Continue to Monitor",
    marketDataAsOn: "2026-10-06",
  } as Security;
  const csv = portfolioCsv([security]);
  assert.match(csv, /^Name,Ticker,Asset type/);
  assert.match(csv, /"Acme, ""Global"""/);
  assert.match(csv, /,25,100,80,20,25,Continue to Monitor,2026-10-06$/);
});

test("exports a header-only file for an empty portfolio", () => {
  assert.equal(portfolioCsv([]).split("\n").length, 1);
});
