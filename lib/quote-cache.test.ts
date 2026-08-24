import assert from "node:assert/strict";
import test from "node:test";
import { execute, initDb } from "./db.ts";
import { getQuote, drainInFlightRefreshes, type CachedQuote } from "./quote-cache.ts";

async function reset(symbol: string) {
  await initDb();
  await execute("DELETE FROM quote_cache WHERE symbol=?", [symbol]);
}

function makeQuote(symbol: string, price: number): CachedQuote {
  return {
    symbol, price, changePercent: 1, week52High: 200, week52Low: 50, targetPrice: 180,
    trailingPe: 20, forwardPe: 18, pegRatio: 1.5, currency: "USD", exchange: "NASDAQ",
    priceDate: "2026-08-20", source: "test-provider", sector: "Technology", industry: "Software",
    targetSource: "test-provider", targetAsOn: "2026-08-20", fetchedAt: new Date().toISOString(),
  };
}

test("missing cache fetches synchronously and writes the row", async () => {
  const symbol = "QCTEST-MISS";
  await reset(symbol);
  let calls = 0;
  const { quote, stale } = await getQuote(symbol, "NASDAQ", async () => {
    calls += 1;
    return makeQuote(symbol, 100);
  });
  assert.equal(calls, 1);
  assert.equal(stale, false);
  assert.equal(quote.price, 100);

  const { rows } = await execute("SELECT price FROM quote_cache WHERE symbol=?", [symbol]);
  assert.equal(Number(rows[0]?.price), 100);
});

test("fresh cache hit never calls the fetcher", async () => {
  const symbol = "QCTEST-FRESH";
  await reset(symbol);
  await getQuote(symbol, "NASDAQ", async () => makeQuote(symbol, 100));

  let calls = 0;
  const { quote, stale } = await getQuote(symbol, "NASDAQ", async () => {
    calls += 1;
    return makeQuote(symbol, 999);
  });
  assert.equal(calls, 0, "a fresh cache read must not call the fetcher");
  assert.equal(stale, false);
  assert.equal(quote.price, 100);
});

test("stale cache serves the old value immediately and refreshes in the background", async () => {
  const symbol = "QCTEST-STALE";
  await reset(symbol);
  // "OTHER" isn't a mapped exchange, so market-status.ts always reports it "closed" regardless
  // of wall-clock time when this test runs — giving a deterministic 15-minute default TTL to
  // age the fixture row past, instead of a flaky test that depends on whether NASDAQ happens
  // to be open right now.
  const old = makeQuote(symbol, 100);
  old.exchange = "OTHER";
  old.fetchedAt = new Date(Date.now() - 20 * 60_000).toISOString();
  await execute(
    `INSERT INTO quote_cache (symbol, price, change_pct, high_52w, low_52w, analyst_target, pe, forward_pe, peg,
      currency, exchange, price_date, source, sector, industry, target_source, target_as_on, fetched_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [old.symbol, old.price, old.changePercent, old.week52High, old.week52Low, old.targetPrice, old.trailingPe,
      old.forwardPe, old.pegRatio, old.currency, old.exchange, old.priceDate, old.source, old.sector, old.industry,
      old.targetSource, old.targetAsOn, old.fetchedAt],
  );

  let calls = 0;
  const { quote, stale } = await getQuote(symbol, "OTHER", async () => {
    calls += 1;
    return makeQuote(symbol, 200);
  });
  assert.equal(stale, true, "a TTL-expired row should be reported stale");
  assert.equal(quote.price, 100, "the stale value should be served immediately, not blocked on refresh");

  await drainInFlightRefreshes();
  const { rows } = await execute("SELECT price FROM quote_cache WHERE symbol=?", [symbol]);
  assert.equal(calls, 1);
  assert.equal(Number(rows[0]?.price), 200, "the background refresh should have written the fresh price");
});

test("concurrent misses for the same symbol only fetch once (in-flight dedup)", async () => {
  const symbol = "QCTEST-DEDUP";
  await reset(symbol);
  let calls = 0;
  const fetcher = async () => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 20));
    return makeQuote(symbol, 150);
  };

  const [a, b, c] = await Promise.all([
    getQuote(symbol, "NASDAQ", fetcher),
    getQuote(symbol, "NASDAQ", fetcher),
    getQuote(symbol, "NASDAQ", fetcher),
  ]);
  assert.equal(calls, 1, "three concurrent misses for the same symbol should trigger exactly one fetch");
  assert.equal(a.quote.price, 150);
  assert.equal(b.quote.price, 150);
  assert.equal(c.quote.price, 150);
});
