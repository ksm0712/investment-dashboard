import { AsyncLocalStorage } from "node:async_hooks";

export type BatchedPrice = {
  price: number;
  date: string;
  source: string;
  symbol: string;
  week52Low?: number;
  week52High?: number;
};

const storage = new AsyncLocalStorage<Map<string, BatchedPrice>>();

/**
 * Scopes a prefetched FMP batch quote map (keyed by uppercased symbol) around `fn`, so every
 * refreshPrices() call gets its own map via AsyncLocalStorage rather than a shared module-scope
 * one two concurrent refreshes (e.g. the cron's 2 user-workers) could clobber.
 */
export async function withFmpBatch<T>(prefetched: Map<string, BatchedPrice>, fn: () => Promise<T>): Promise<T> {
  return storage.run(prefetched, fn);
}

export function getBatchedFmpPrice(symbol: string): BatchedPrice | undefined {
  return storage.getStore()?.get(symbol.toUpperCase());
}
