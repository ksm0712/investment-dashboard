import { getSecurities, updateRefreshFields } from "./db";
import { getFx } from "./fx";
import type { Security } from "./types";

type PriceResult = {
  price: number;
  date: string;
  source: string;
  symbol?: string;
};

const exchangeSuffixes: Record<string, string> = {
  NSE: ".NS",
  BSE: ".BO",
  SGX: ".SI",
  SES: ".SI",
  LSE: ".L",
  TSE: ".T",
  JPX: ".T",
  HKEX: ".HK",
  ASX: ".AX",
  TSX: ".TO",
  XETRA: ".DE",
  FRA: ".DE",
  FWB: ".DE",
};

const countrySuffixes: Record<string, string> = {
  India: ".NS",
  Singapore: ".SI",
  "United Kingdom": ".L",
  Japan: ".T",
  "Hong Kong": ".HK",
  Australia: ".AX",
  Canada: ".TO",
  Germany: ".DE",
};

function parsePrice(value?: string | null) {
  const parsed = Number(String(value || "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseDate(value?: string | null) {
  const date = new Date(String(value || ""));
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
}

function yahooChartUrl(symbol: string) {
  return `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1d`;
}

function parseYahooChart(data: any, symbol: string, source: string): PriceResult {
  if (data.chart?.error) throw new Error(data.chart.error.description || "Yahoo chart error");
  const result = data.chart?.result?.[0];
  const closes = result?.indicators?.quote?.[0]?.close || [];
  const timestamps = result?.timestamp || [];

  for (let i = closes.length - 1; i >= 0; i--) {
    if (Number.isFinite(Number(closes[i])) && Number(closes[i]) > 0) {
      return {
        price: Number(closes[i]),
        date: new Date(timestamps[i] * 1000).toISOString().slice(0, 10),
        source,
        symbol,
      };
    }
  }

  const marketPrice = Number(result?.meta?.regularMarketPrice);
  const marketTime = Number(result?.meta?.regularMarketTime);
  if (Number.isFinite(marketPrice) && marketPrice > 0) {
    return {
      price: marketPrice,
      date: marketTime ? new Date(marketTime * 1000).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
      source,
      symbol,
    };
  }

  throw new Error(`No Yahoo price for ${symbol}`);
}

function parseJsonFromReader(text: string) {
  const start = text.indexOf('{"chart"');
  if (start < 0) throw new Error("Yahoo fallback returned no chart data");

  const json = text.slice(start).trim();
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < json.length; i++) {
    const char = json[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') inString = true;
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return JSON.parse(json.slice(0, i + 1));
    }
  }

  throw new Error("Yahoo fallback returned incomplete chart data");
}

async function yahooPrice(symbol: string) {
  const res = await fetch(yahooChartUrl(symbol), {
    headers: {
      "Accept": "application/json,text/plain,*/*",
      "Accept-Language": "en-US,en;q=0.9",
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36",
    },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Yahoo ${symbol} returned ${res.status}`);
  return parseYahooChart(await res.json(), symbol, "yahoo");
}

async function yahooFallbackPrice(symbol: string) {
  const res = await fetch(`https://r.jina.ai/http://${yahooChartUrl(symbol)}`, {
    headers: {
      "Accept": "text/plain,*/*",
      "Accept-Language": "en-US,en;q=0.9",
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36",
    },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Yahoo fallback ${symbol} returned ${res.status}`);
  return parseYahooChart(parseJsonFromReader(await res.text()), symbol, "yahoo-fallback");
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
          symbol: clean,
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
    return await yahooFallbackPrice(symbol);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "Yahoo fallback failed");
  }
  try {
    return await nasdaqPrice(symbol, assetType);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "Nasdaq failed");
  }
  throw new Error(errors.join("; "));
}

function priceSymbols(sec: Security) {
  const candidates = new Set<string>();
  const rawSymbols = [sec.priceSymbol, sec.ticker]
    .map((value) => String(value || "").trim())
    .filter(Boolean);

  for (const raw of rawSymbols) {
    candidates.add(raw);
    if (!raw.includes(".")) {
      const exchangeSuffix = sec.exchange ? exchangeSuffixes[sec.exchange.toUpperCase()] : "";
      const countrySuffix = countrySuffixes[sec.country];
      const suffix = exchangeSuffix || countrySuffix;
      if (suffix) candidates.add(`${raw}${suffix}`);
    }
  }

  return [...candidates];
}

async function marketPriceForSecurity(sec: Security) {
  const errors: string[] = [];
  for (const symbol of priceSymbols(sec)) {
    try {
      return await marketPrice(symbol, sec.assetType);
    } catch (error) {
      errors.push(`${symbol}: ${error instanceof Error ? error.message : "refresh failed"}`);
    }
  }
  throw new Error(errors.join("; ") || "Missing identifier.");
}

async function mfPrice(code: string): Promise<PriceResult> {
  const res = await fetch(`https://api.mfapi.in/mf/${encodeURIComponent(code)}`, { cache: "no-store" });
  const data = await res.json();
  const nav = data.data?.[0];
  if (!nav) throw new Error("No NAV");
  return {
    price: Number(nav.nav),
    date: String(nav.date),
    source: "mfapi",
    symbol: code,
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

      const symbols = priceSymbols(sec);
      if (!symbols.length) {
        await updateRefreshFields(userId, sec.id, { refreshStatus: "needs_mapping", refreshNote: "Missing identifier." });
        await mark(sec, "not_refreshed");
        continue;
      }

      const latest = sec.assetType === "Mutual Fund" && sec.currency === "INR" ? await mfPrice(symbols[0]) : await marketPriceForSecurity(sec);
      if (!sec.quantity) {
        await updateRefreshFields(userId, sec.id, {
          latestPrice: latest.price,
          priceAsOn: latest.date,
          refreshStatus: "needs_quantity",
          refreshNote: "Price found but quantity missing.",
          priceSymbol: latest.symbol,
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
        priceSymbol: latest.symbol,
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
