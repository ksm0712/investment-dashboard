import { execute } from "./db.ts";
import { marketPhase } from "./market-status.ts";
import { recordCache } from "./instrumented-fetch.ts";

export type CachedQuote = {
  symbol: string;
  price: number | null;
  changePercent: number | null;
  week52High: number | null;
  week52Low: number | null;
  targetPrice: number | null;
  trailingPe: number | null;
  forwardPe: number | null;
  pegRatio: number | null;
  currency: string | null;
  exchange: string | null;
  priceDate: string | null;
  source: string | null;
  sector: string | null;
  industry: string | null;
  targetSource: string | null;
  targetAsOn: string | null;
  fetchedAt: string;
};

function ttlMsFor(exchange: string | null | undefined, now: Date) {
  const phase = marketPhase(exchange, now);
  if (phase === "open") return Number(process.env.CACHE_TTL_OPEN_MS || 60_000);
  if (phase === "closed") return Number(process.env.CACHE_TTL_CLOSED_MS || 15 * 60_000);
  return Number(process.env.CACHE_TTL_WEEKEND_MS || 12 * 60 * 60_000);
}

function mapRow(row: Record<string, unknown>): CachedQuote {
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  const str = (v: unknown) => (v === null || v === undefined ? null : String(v));
  return {
    symbol: String(row.symbol),
    price: num(row.price),
    changePercent: num(row.change_pct),
    week52High: num(row.high_52w),
    week52Low: num(row.low_52w),
    targetPrice: num(row.analyst_target),
    trailingPe: num(row.pe),
    forwardPe: num(row.forward_pe),
    pegRatio: num(row.peg),
    currency: str(row.currency),
    exchange: str(row.exchange),
    priceDate: str(row.price_date),
    source: str(row.source),
    sector: str(row.sector),
    industry: str(row.industry),
    targetSource: str(row.target_source),
    targetAsOn: str(row.target_as_on),
    fetchedAt: String(row.fetched_at),
  };
}

async function readCache(symbol: string): Promise<CachedQuote | null> {
  const { rows } = await execute("SELECT * FROM quote_cache WHERE symbol=?", [symbol]);
  return rows[0] ? mapRow(rows[0]) : null;
}

async function writeCache(quote: CachedQuote) {
  await execute(
    `INSERT INTO quote_cache
      (symbol, price, change_pct, high_52w, low_52w, analyst_target, pe, forward_pe, peg,
       currency, exchange, price_date, source, sector, industry, target_source, target_as_on, fetched_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(symbol) DO UPDATE SET
       price=excluded.price, change_pct=excluded.change_pct, high_52w=excluded.high_52w, low_52w=excluded.low_52w,
       analyst_target=excluded.analyst_target, pe=excluded.pe, forward_pe=excluded.forward_pe, peg=excluded.peg,
       currency=excluded.currency, exchange=excluded.exchange, price_date=excluded.price_date,
       source=excluded.source, sector=excluded.sector, industry=excluded.industry,
       target_source=excluded.target_source, target_as_on=excluded.target_as_on, fetched_at=excluded.fetched_at`,
    [
      quote.symbol, quote.price, quote.changePercent, quote.week52High, quote.week52Low, quote.targetPrice,
      quote.trailingPe, quote.forwardPe, quote.pegRatio, quote.currency, quote.exchange, quote.priceDate,
      quote.source, quote.sector, quote.industry, quote.targetSource, quote.targetAsOn, quote.fetchedAt,
    ],
  );
}

// In-flight dedup: concurrent stale/missing reads for the same symbol join one fetch instead
// of each starting their own. Keyed by symbol only (the cache is intentionally global across
// users — two users both holding AAPL should share one fetch, not duplicate it).
const inFlight = new Map<string, Promise<CachedQuote>>();

function startOrJoinRefresh(symbol: string, fetcher: () => Promise<CachedQuote>): Promise<CachedQuote> {
  let refresh = inFlight.get(symbol);
  if (!refresh) {
    refresh = fetcher()
      .then(async (fresh) => {
        await writeCache(fresh);
        return fresh;
      })
      .finally(() => inFlight.delete(symbol));
    inFlight.set(symbol, refresh);
  }
  return refresh;
}

/** Best-effort wait for any background refreshes still in flight — see ENGINEERING_LOG.md Phase 1
 * on why refreshPrices() calls this before returning (serverless functions don't guarantee
 * detached work outlives the response). */
export async function drainInFlightRefreshes() {
  await Promise.allSettled([...inFlight.values()]);
}

export type QuoteResult = { quote: CachedQuote; stale: boolean };

/**
 * fresh -> serve cached, no external call.
 * stale-but-present -> serve the stale value immediately, kick a deduplicated background refresh.
 * missing -> fetch synchronously (joining an in-flight fetch if one already started), write, serve.
 */
export async function getQuote(
  symbol: string,
  exchange: string | null | undefined,
  fetcher: () => Promise<CachedQuote>,
): Promise<QuoteResult> {
  const cached = await readCache(symbol);
  const now = new Date();

  if (cached) {
    const ageMs = now.getTime() - new Date(cached.fetchedAt).getTime();
    if (ageMs < ttlMsFor(exchange, now)) {
      recordCache("hit");
      return { quote: cached, stale: false };
    }
    recordCache("stale");
    startOrJoinRefresh(symbol, fetcher).catch(() => {
      // The stale value already went out; a failed background refresh just means we try again next read.
    });
    return { quote: cached, stale: true };
  }

  recordCache("miss");
  const fresh = await startOrJoinRefresh(symbol, fetcher);
  return { quote: fresh, stale: false };
}
