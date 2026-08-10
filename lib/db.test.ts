import assert from "node:assert/strict";
import test from "node:test";
import { addInvestment, getSecurities, updateRefreshFields, updateSecurity } from "./db.ts";

const userId = "db-test-user";

test("updateSecurity persists target price and 52-week range", async () => {
  await addInvestment(userId, {
    name: "Range Editor Test ETF",
    assetType: "ETF",
    country: "United States",
    currency: "USD",
    pricingMode: "manual",
    quantity: 5,
    costPrice: 100,
    currentPrice: 110,
    purchaseDate: "2026-01-01",
    allocation: 5000,
  });

  const created = (await getSecurities(userId)).find((s) => s.name === "Range Editor Test ETF");
  assert.ok(created, "security should exist after creation");
  assert.equal(created!.targetPrice, null, "ETFs commonly have no target at creation");
  assert.equal(created!.action, "Insufficient Data", "no target/range means the decision engine can't produce a signal");

  await updateSecurity(userId, created!.id, {
    targetPrice: 130,
    targetSource: "manual",
    targetAsOn: "2026-08-06",
    week52Low: 90,
    week52High: 120,
  });

  const updated = (await getSecurities(userId)).find((s) => s.id === created!.id);
  assert.equal(updated!.targetPrice, 130);
  assert.equal(updated!.week52Low, 90);
  assert.equal(updated!.week52High, 120);
  assert.notEqual(updated!.action, "Insufficient Data", "setting target and range should unblock a real recommendation");
});

test("updateRefreshFields on a partial payload preserves fields it doesn't mention", async () => {
  await addInvestment(userId, {
    name: "Partial Refresh Test Stock",
    assetType: "Stock",
    country: "United States",
    currency: "USD",
    pricingMode: "manual",
    quantity: 10,
    costPrice: 100,
    currentPrice: 100,
    purchaseDate: "2026-01-01",
    allocation: 10000,
    targetPrice: 150,
    targetSource: "manual",
    week52Low: 80,
    week52High: 200,
  });
  const created = (await getSecurities(userId)).find((s) => s.name === "Partial Refresh Test Stock");
  assert.ok(created, "security should exist after creation");

  // Simulate a refresh call that only reports a fresh price and change%, the
  // way a provider that doesn't return target/range data would.
  await updateRefreshFields(userId, created!.id, {
    latestPrice: 95,
    changePercent: -1.85,
    priceAsOn: "2026-08-07",
    priceSource: "manual-test",
  });

  const updated = (await getSecurities(userId)).find((s) => s.id === created!.id);
  assert.equal(updated!.latestPrice, 95);
  assert.equal(updated!.changePercent, -1.85);
  assert.equal(updated!.targetPrice, 150, "target should survive an update that didn't mention it");
  assert.equal(updated!.week52Low, 80, "52-week low should survive an update that didn't mention it");
  assert.equal(updated!.week52High, 200, "52-week high should survive an update that didn't mention it");
});
