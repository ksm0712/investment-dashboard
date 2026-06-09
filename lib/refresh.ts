import { getSecurities, updateRefreshFields } from "./db";
import { getFx } from "./fx";
import type { Security } from "./types";

type PriceResult = {
  price: number;
  date: string;
  source: string;
};

function parsePrice(value?: string | null) {
  const parsed = Number(String(value || "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseDate(value?: string | null) {
  const date = new Date(String(value || ""));
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
}

async function yahooPrice(symbol: string) {
  const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1d`, {
    headers: {
      "Accept": "application/json,text/plain,*/*",
      "Accept-Language": "en-US,en;q=0.9",
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36",
    },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Yahoo ${symbol} returned ${res.status}`);
  const data = await res.json();
  const result = data.chart?.result?.[0];
  if (data.chart?.error) throw new Error(data.chart.error.description || "Yahoo chart error");
  const closes = result?.indicators?.quote?.[0]?.close || [];
  const timestamps = result?.timestamp || [];
  for (let i = closes.length - 1; i >= 0; i--) {
    if (Number.isFinite(Number(closes[i])) && Number(closes[i]) > 0) {
      return {
        price: Number(closes[i]),
        date: new Date(timestamps[i] * 1000).toISOString().slice(0, 10),
        source: "yahoo",
      };
    }
  }
  const marketPrice = Number(result?.meta?.regularMarketPrice);
  const marketTime = Number(result?.meta?.regularMarketTime);
  if (Number.isFinite(marketPrice) && marketPrice > 0) {
    return {
      price: marketPrice,
      date: marketTime ? new Date(marketTime * 1000).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
      source: "yahoo",
    };
  }
  throw new Error(`No Yahoo price for ${symbol}`);
}

async function nasdaqPrice(symbol: string, assetType: string) {
  const clean = symbol.trim().replace(/\.(US|U)$/i, "");
  if (!clean || clean.includes(".")) throw new Error(`Nasdaq unsupported symbol ${symbol}`);
  const classes = assetType === "ETF" ? ["etf", "stocks"] : ["stocks", "etf"];
  const errors: string[] = [];
  for (const assetClass of classes) {
    try {
      const res = await fetch(`https://api.nasdaq.com/api/quote/${encodeURIComponent(clean)}/info?assetclass=${assetClass}`, {
        headers: {
          "Accept": "application/json,text/plain,*/*",
          "Accept-Language": "en-US,en;q=0.9",
          "Origin": "https://www.nasdaq.com",
          "Referer": `https://www.nasdaq.com/market-activity/${assetClass}/${encodeURIComponent(clean.toLowerCase())}`,
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36",
        },
        cache: "no-store",
      });
      if (!res.ok) {
        errors.push(`Nasdaq ${assetClass} returned ${res.status}`);
        continue;
      }
      const data = await res.json();
      const primary = data.data?.primaryData;
      const price = parsePrice(primary?.lastSalePrice);
      if (price) {
        return {
          price,
          date: parseDate(primary?.lastTradeTimestamp),
          source: "nasdaq",
        };
      }
      errors.push(data.status?.bCodeMessage?.[0]?.errorMessage || `No Nasdaq ${assetClass} price`);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : `Nasdaq ${assetClass} failed`);
    }
  }
  throw new Error(errors.filter(Boolean).join("; ") || `No Nasdaq price for ${symbol}`);
}

async function marketPrice(symbol: string, assetType: string): Promise<PriceResult> {
  const errors: string[] = [];
  try {
    return await yahooPrice(symbol);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "Yahoo failed");
  }
  try {
    return await nasdaqPrice(symbol, assetType);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "Nasdaq failed");
  }
  throw new Error(errors.join("; "));
}

async function mfPrice(code: string) {
  const res = await fetch(`https://api.mfapi.in/mf/${encodeURIComponent(code)}`, { cache: "no-store" });
  const data = await res.json();
  const nav = data.data?.[0];
  if (!nav) throw new Error("No NAV");
  return {
    price: Number(nav.nav),
    date: String(nav.date),
    source: "mfapi",
  };
}

function bucketName(result: string) {
  if (result === "updated") return "updated";
  if (result === "manual") return "manual";
  if (result === "failed") return "failed";
  if (result === "unchanged") return "unchanged";
  return "not_refreshed";
}

export async function refreshPrices(userId: string) {
  const securities = await getSecurities(userId);
  const fx = await getFx();
  const summary: any = { updated: 0, unchanged: 0, manual: 0, not_refreshed: 0, failed: 0, total: securities.length, byType: {}, details: [] };

  async function mark(sec: Security, result: string) {
    const bucket = bucketName(result);
    summary[bucket] += 1;
    summary.byType[sec.assetType] ||= { updated: 0, unchanged: 0, manual: 0, not_refreshed: 0, failed: 0 };
    summary.byType[sec.assetType][bucket] += 1;
  }

  for (const sec of securities) {
    try {
      if (["Savings", "Bond", "Other"].includes(sec.assetType) || sec.pricingMode === "manual") {
        await updateRefreshFields(userId, sec.id, {
          refreshStatus: "manual_value",
          refreshNote: "Manual asset. User controls value.",
          latestValue: sec.latestValue ?? sec.value,
          latestValueInr: sec.latestValueInr ?? sec.valueInr,
        });
        await mark(sec, "manual");
        continue;
      }
      const symbol = sec.priceSymbol || sec.ticker || "";
      if (!symbol) {
        await updateRefreshFields(userId, sec.id, { refreshStatus: "needs_mapping", refreshNote: "Missing identifier." });
        await mark(sec, "not_refreshed");
        continue;
      }
      const latest = sec.assetType === "Mutual Fund" && sec.currency === "INR" ? await mfPrice(symbol) : await marketPrice(symbol, sec.assetType);
      if (!sec.quantity) {
        await updateRefreshFields(userId, sec.id, {
          latestPrice: latest.price,
          priceAsOn: latest.date,
          refreshStatus: "needs_quantity",
          refreshNote: "Price found but quantity missing.",
        });
        await mark(sec, "not_refreshed");
        continue;
      }
      const latestValue = latest.price * sec.quantity;
      const latestValueInr = sec.currency === "INR" ? latestValue : latestValue * (fx[sec.currency] || 1);
      await updateRefreshFields(userId, sec.id, {
        latestPrice: latest.price,
        priceAsOn: latest.date,
        latestValue,
        latestValueInr,
        refreshStatus: "updated",
        refreshNote: `Updated via ${latest.source} price ${latest.price} on ${latest.date}.`,
        priceSource: latest.source,
      });
      await mark(sec, "updated");
    } catch (error) {
      const note = error instanceof Error ? error.message : "Refresh failed.";
      await updateRefreshFields(userId, sec.id, {
        refreshStatus: "failed",
        refreshNote: note,
      });
      summary.details.push({ name: sec.name, status: "failed", note });
      await mark(sec, "failed");
    }
  }
  return summary;
}
