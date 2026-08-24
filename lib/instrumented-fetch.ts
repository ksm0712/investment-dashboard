import { AsyncLocalStorage } from "node:async_hooks";

export type CallRecord = {
  provider: string;
  endpoint: string;
  ms: number;
  ok: boolean;
  sql?: string;
  params?: unknown[];
  serverMs?: number;
  rowsRead?: number;
};

export type CacheEvent = "hit" | "stale" | "miss";

type Metrics = {
  calls: CallRecord[];
  cache: CacheEvent[];
};

const storage = new AsyncLocalStorage<Metrics>();

/**
 * Scopes a fresh metrics collector around `fn`. Every `timed`/`timedDb`/`recordCache`
 * call made anywhere inside `fn` (including across awaited async boundaries) is
 * attributed to this scope via AsyncLocalStorage. Outside any scope, those calls
 * are no-ops, so production route handlers pay only the cost of a getStore() check.
 */
export async function runWithMetrics<T>(fn: () => Promise<T>): Promise<{ result: T; metrics: Metrics }> {
  const metrics: Metrics = { calls: [], cache: [] };
  const result = await storage.run(metrics, fn);
  return { result, metrics };
}

export function recordCall(record: CallRecord) {
  storage.getStore()?.calls.push(record);
}

export function recordCache(event: CacheEvent) {
  storage.getStore()?.cache.push(event);
}

export function getMetrics(): Metrics | undefined {
  return storage.getStore();
}

/** Times one external market-data provider call. `endpoint` is typically the symbol looked up. */
export async function timed<T>(provider: string, endpoint: string, fn: () => Promise<T>): Promise<T> {
  const start = performance.now();
  try {
    const result = await fn();
    recordCall({ provider, endpoint, ms: performance.now() - start, ok: true });
    return result;
  } catch (error) {
    recordCall({ provider, endpoint, ms: performance.now() - start, ok: false });
    throw error;
  }
}

/**
 * Times one Turso query. Keeps the SQL/params so a benchmark can re-run EXPLAIN QUERY PLAN
 * on the slowest ones, and (when the caller reports it) the server-side query_duration_ms/
 * rows_read Turso's HTTP pipeline returns per statement — a closer analogue to Postgres's
 * EXPLAIN ANALYZE than our own wall-clock timing, which also includes HTTP round-trip time.
 */
export async function timedDb<T>(
  sql: string,
  params: unknown[],
  fn: () => Promise<T & { serverMs?: number; rowsRead?: number }>,
): Promise<T> {
  const start = performance.now();
  const endpoint = sql.trim().split(/\s+/).slice(0, 4).join(" ");
  try {
    const result = await fn();
    recordCall({
      provider: "turso-db",
      endpoint,
      ms: performance.now() - start,
      ok: true,
      sql,
      params,
      serverMs: result.serverMs,
      rowsRead: result.rowsRead,
    });
    return result;
  } catch (error) {
    recordCall({ provider: "turso-db", endpoint, ms: performance.now() - start, ok: false, sql, params });
    throw error;
  }
}
