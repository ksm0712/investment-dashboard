// A fully self-contained fetch replacement for scripts/chaos-bench.ts. It never touches the
// real network — every request is answered locally, either with a minimal-but-valid success
// body for the providers this repo's parsers understand (Yahoo chart, FMP quote, Nasdaq quote,
// the Yahoo-fallback proxy), or a 429. This keeps the chaos test fast, deterministic, and
// independent of any real provider's live quota (relevant: FMP's free-tier quota was exhausted
// mid-session — see ENGINEERING_LOG.md Phase 2/3).

// Mulberry32 PRNG — deterministic and seedable, so a chaos-bench run is reproducible.
function mulberry32(seed: number) {
  let state = seed;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function symbolFromUrl(url: string): string {
  const match = url.match(/quote\/([^/?]+)\/(info|summary)/) || url.match(/[?&]symbol=([^&]+)/) || url.match(/chart\/([^?]+)/);
  return match ? decodeURIComponent(match[1]).split(",")[0] : "MOCK";
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function failureResponse(status: number, retryAfterSeconds?: number) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (retryAfterSeconds !== undefined) headers["retry-after"] = String(retryAfterSeconds);
  return new Response(JSON.stringify({ error: "Too Many Requests" }), { status, headers });
}

function yahooChartBody(symbol: string) {
  const now = Math.floor(Date.now() / 1000);
  return {
    chart: {
      result: [{
        meta: { regularMarketPrice: 123.45, regularMarketTime: now, fiftyTwoWeekLow: 100, fiftyTwoWeekHigh: 150, chartPreviousClose: 120 },
        timestamp: [now],
        indicators: { quote: [{ close: [123.45] }] },
      }],
    },
    _symbol: symbol,
  };
}

function fmpQuoteBody(symbol: string) {
  return [{ symbol, price: 123.45, timestamp: Math.floor(Date.now() / 1000), yearLow: 100, yearHigh: 150 }];
}

function nasdaqQuoteBody() {
  return { data: { primaryData: { lastSalePrice: "$123.45", lastTradeTimestamp: new Date().toISOString(), percentageChange: "1.23%" } } };
}

export type ChaosStats = { total: number; failed: number };

/**
 * Installs the mock globalThis.fetch for the duration of the process, failing `failureRate`
 * of requests with a 429 (matching spec §3.4's "return 429 for 30% of requests"). Returns a
 * restore function and a live stats object the caller can read at any time.
 */
export function installChaosFetch(failureRate = 0.3, seed = 42): { restore: () => void; stats: ChaosStats } {
  const realFetch = globalThis.fetch;
  const random = mulberry32(seed);
  const stats: ChaosStats = { total: 0, failed: 0 };

  globalThis.fetch = (async (input: any, init?: any) => {
    const url = typeof input === "string" ? input : input?.url || String(input);

    // Never chaos-inject the local Turso dev DB — this mock is only for the external
    // market-data providers refreshPrices() calls, not the database layer underneath it.
    if (url.includes("127.0.0.1") || url.includes("localhost")) return realFetch(input, init);

    stats.total += 1;

    if (random() < failureRate) {
      stats.failed += 1;
      return failureResponse(429);
    }

    const symbol = symbolFromUrl(url);
    if (url.includes("financialmodelingprep.com")) return jsonResponse(fmpQuoteBody(symbol));
    if (url.includes("api.nasdaq.com")) return jsonResponse(nasdaqQuoteBody());
    if (url.includes("query1.finance.yahoo.com") || url.includes("r.jina.ai")) return jsonResponse(yahooChartBody(symbol));
    // Unrecognized domain (e.g. yahoo-finance2's internal client, Alpha Vantage, Twelve Data,
    // exchangerate-api for FX) — always fail. The chaos test only needs the providers above to
    // have a real chance to succeed; the others failing deterministically is a safe default,
    // not a gap, since the real per-symbol race already tolerates individual providers failing.
    stats.failed += 1;
    return failureResponse(503);
  }) as typeof fetch;

  return {
    restore: () => {
      globalThis.fetch = realFetch;
    },
    stats,
  };
}
