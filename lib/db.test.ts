import assert from "node:assert/strict";
import test from "node:test";
import { addInvestment, getSecurities, updateSecurity } from "./db.ts";

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
